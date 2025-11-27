import {NextResponse} from "next/server";
import {createResource} from "@/lib/actions/resources";
import {findRelevantContent, type RetrievalContextBlock,} from "@/lib/ai/embedding";
import {convertToModelMessages, generateObject, stepCountIs, streamText, tool, UIMessage,} from "ai";
import {z} from "zod";
import {db} from "@/lib/db";
import {sessions} from "@/lib/db/schema/sessions";
import {sessionAiDrafts} from "@/lib/db/schema/session-ai-drafts";
import {and, eq} from "drizzle-orm";
import {mapSessionDetails} from "@/app/api/sessions/mapper";
import {buildSessionContextPayload, generateMessageId} from "@/lib/session/utils";
import {detectDeliveryIntent} from "@/lib/delivery-intent";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const PERSISTENCY_LAYER_BASIC_RULES = `
Strata taxonomy baseline:
- Personas: Functional Lead, Developer, Client.
- Workflow stages: Capture → Refine → Persist → Implement → Merge.
- Knowledge artifacts: Requirement Draft, Validated Task, Persistency PR.
- Jira tickets and ai/ updates must reference these shared terms so every stakeholder reads consistent language.
`;

const PERSISTENCY_LAYER_RULES = `
${PERSISTENCY_LAYER_BASIC_RULES}

Persistency layer guardrails (apply even if some files are missing for the current branch):
- The persistency layer is a human-legible knowledge base made of .mdc files inside the ai/ directory.
- ai/ai-bootstrap.mdc explains how the layer is organised. Treat it as mandatory and consult it before touching other folders.
- All .mdc files must be written entirely in English; do not mix languages when updating or creating documents.
- ai/ai-meta/ contains agent playbooks, prompts, and best-practice catalogues (ai/ai-meta/best-practices/ expands the catalogue; migration-brief.mdc is optional per project).
- ai/technical/ holds architecture, operations, and decision records; ai/functional/ holds functional intent, workflows, and glossaries. All of these folders, and any nested topic folder under them, must maintain an index.mdc that summarises the folder contents and structure.
- When you create a new topic folder under ai/, immediately create an index.mdc within it so humans/agents can navigate the area, and update the parent folder index (and any summaries referencing it) so the new topic is discoverable.
- Before creating a new .mdc file, inspect the existing context (the provided files plus any getInformation/search results). If a document already covers what the user is asking for, update that file instead of creating a new one.
- Keep ai/functional/summary.mdc aligned whenever you add or change documents in ai/functional/acceptance, integrations, requirements, or taxonomy.
- Never add manual change logs to .mdc files; overwrite content so it always reflects the current truth and rely on Git history for diffs.
- Always reference only the ai/ directory (persistency layer). If a required summary/index file is missing, call it out and recommend adding it to restore navigability.
- Jira tickets must describe how the persistency layer is updated with the same guardrails above (update existing files first, only create new topics when necessary, and keep indexes in sync). Once Jira assigns the key (e.g., ABC-123), create a branch named `<KEY>` and ensure the first commit carries the queued persistency-layer changes before any implementation work.
`;

type BitbucketContextMetadata = {
    source?: string;
    context?: {
        repository?: {
            name?: string;
            slug?: string;
        };
        branch?: {
            name?: string;
        };
        workspace?: {
            name?: string;
            slug?: string;
            uuid?: string;
        };
        folderExists?: boolean;
        truncated?: boolean;
        files?: Array<{
            path?: string;
            content?: string;
            truncated?: boolean;
        }>;
    };
};

const extractBitbucketContextBlocks = (
    messages: UIMessage[],
): RetrievalContextBlock[] => {
    const blocks: RetrievalContextBlock[] = [];
    const seen = new Set<string>();

    for (const message of messages) {
        const metadata = (message.metadata ?? {}) as BitbucketContextMetadata;
        if (metadata?.source !== "bitbucket-ai-folder") {
            continue;
        }

        const context = metadata.context;
        const files = Array.isArray(context?.files) ? context?.files ?? [] : [];

        if (!files || files.length === 0) {
            continue;
        }

        const repositoryName =
            context?.repository?.name ?? context?.repository?.slug ?? "Repository";
        const branchName = context?.branch?.name
            ? ` (${context.branch.name})`
            : "";

        for (const file of files) {
            if (!file?.path || typeof file?.content !== "string") {
                continue;
            }

            const identifier = `${
                context?.repository?.slug ?? repositoryName
            }:${context?.branch?.name ?? "default"}:${file.path}`;

            if (seen.has(identifier)) {
                continue;
            }

            seen.add(identifier);

            blocks.push({
                id: identifier,
                label: `${repositoryName}${branchName} · ${file.path}`,
                content: file.content,
                metadata: {
                    path: file.path,
                    truncated: Boolean(file.truncated),
                    repository: context?.repository,
                    branch: context?.branch,
                    workspace: context?.workspace,
                },
            });
        }
    }

    return blocks;
};

const isAutoGeneratedContextMessage = (message: UIMessage) => {
    const metadata = (message.metadata ?? {}) as {
        autoGenerated?: boolean;
        source?: string;
    };
    return Boolean(metadata?.autoGenerated) || metadata?.source === "bitbucket-ai-folder";
};

type SessionRow = typeof sessions.$inferSelect;
type StoredSessionFile = {
    path?: string;
    content?: string;
    truncated?: boolean;
};

const buildSessionContextBlocks = (
    session: SessionRow | null,
): RetrievalContextBlock[] => {
    if (!session) {
        return [];
    }

    const files = Array.isArray(session.contextFiles)
        ? (session.contextFiles as StoredSessionFile[])
        : [];

    if (files.length === 0) {
        return [];
    }

    const repositoryLabel = session.repositoryName ?? session.repositorySlug;
    const branchLabel = session.branchName ? ` (${session.branchName})` : "";
    const workspaceMetadata =
        session.workspaceSlug || session.workspaceName || session.workspaceUuid
            ? {
                slug: session.workspaceSlug ?? undefined,
                name: session.workspaceName ?? undefined,
                uuid: session.workspaceUuid ?? undefined,
            }
            : undefined;

    const blocks: RetrievalContextBlock[] = [];

    for (const file of files) {
        if (!file?.path || typeof file.content !== "string") {
            continue;
        }

        blocks.push({
            id: `${session.repositorySlug}:${session.branchName}:${file.path}`,
            label: `${repositoryLabel}${branchLabel} · ${file.path}`,
            content: file.content,
            metadata: {
                path: file.path,
                truncated: Boolean(file.truncated),
                repository: {
                    slug: session.repositorySlug,
                    name: session.repositoryName,
                },
                branch: {
                    name: session.branchName,
                    isDefault: session.branchIsDefault,
                },
                workspace: workspaceMetadata,
            },
        });
    }

    return blocks;
};

const mergeContextBlocks = (
    primary: RetrievalContextBlock[],
    secondary: RetrievalContextBlock[],
): RetrievalContextBlock[] => {
    const merged = new Map<string, RetrievalContextBlock>();
    for (const block of [...primary, ...secondary]) {
        if (!merged.has(block.id)) {
            merged.set(block.id, block);
        }
    }
    return Array.from(merged.values());
};

const sanitizeAiFilePath = (path: string) => {
    if (!path || typeof path !== "string") {
        throw new Error("invalid_ai_path");
    }
    const normalized = path.trim().replace(/^\/+/, "");
    if (!normalized.toLowerCase().startsWith("ai/")) {
        throw new Error("ai_path_out_of_scope");
    }
    if (!normalized.toLowerCase().endsWith(".mdc")) {
        throw new Error("ai_path_extension_required");
    }
    if (normalized.includes("..")) {
        throw new Error("ai_path_out_of_scope");
    }
    return normalized;
};

const upsertAiDraft = async ({
                                 sessionId,
                                 path,
                                 content,
                                 summary,
                                 currentDraftCount,
                             }: {
    sessionId: string;
    path: string;
    content: string;
    summary?: string | null;
    currentDraftCount: number;
}) => {
    const normalizedPath = sanitizeAiFilePath(path);
    const now = new Date();

    const [existing] = await db
        .select()
        .from(sessionAiDrafts)
        .where(
            and(
                eq(sessionAiDrafts.sessionId, sessionId),
                eq(sessionAiDrafts.path, normalizedPath),
            ),
        )
        .limit(1);

    let nextDraftCount = currentDraftCount;

    if (existing) {
        await db
            .update(sessionAiDrafts)
            .set({
                content,
                summary: summary ?? null,
                needsPersist: true,
                updatedAt: now,
            })
            .where(
                and(
                    eq(sessionAiDrafts.sessionId, sessionId),
                    eq(sessionAiDrafts.path, normalizedPath),
                ),
            );
    } else {
        await db.insert(sessionAiDrafts).values({
            sessionId,
            path: normalizedPath,
            content,
            summary: summary ?? null,
            needsPersist: true,
            createdAt: now,
            updatedAt: now,
        });
        nextDraftCount = currentDraftCount + 1;
    }

    await db
        .update(sessions)
        .set({
            persistHasChanges: true,
            persistDraftCount: nextDraftCount,
            updatedAt: now,
        })
        .where(eq(sessions.id, sessionId));

    return {path: normalizedPath, nextDraftCount};
};

export async function POST(req: Request) {
    const {
        messages,
        sessionId,
        writeMode,
    }: { messages: UIMessage[]; sessionId?: string; writeMode?: boolean } =
        await req.json();

    const writeModeEnabled = Boolean(writeMode);

    if (!sessionId) {
        return NextResponse.json(
            {error: "session_id_required"},
            {status: 400},
        );
    }

    const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!session) {
        return NextResponse.json(
            {error: "session_not_found"},
            {status: 404},
        );
    }

    await db
        .update(sessions)
        .set({updatedAt: new Date()})
        .where(eq(sessions.id, sessionId));
    let sessionRecord = session;

    const normalizedMessages = Array.isArray(messages) ? messages : [];
    const sanitizedMessages = normalizedMessages.filter(
        (message) => !isAutoGeneratedContextMessage(message),
    );

    const extractTextParts = (message: UIMessage): string => {
        return message.parts
            .map((part) => {
                if (part.type === "text" && typeof part.text === "string") {
                    return part.text;
                }
                return "";
            })
            .join(" ")
            .trim();
    };

    const lastUserMessage = [...sanitizedMessages]
        .reverse()
        .find((message) => message.role === "user");
    const lastUserText = lastUserMessage ? extractTextParts(lastUserMessage) : "";
    const deliveryIntent = detectDeliveryIntent(lastUserText);

    const sessionDetails = mapSessionDetails(sessionRecord, {
        branchAvailable: null,
        drafts: [],
    });

    const {message: persistencyContextMessage} = buildSessionContextPayload(
        sessionDetails,
        generateMessageId(),
    );

    const sessionContextBlocks = buildSessionContextBlocks(sessionRecord);
    const messagesWithContext = [persistencyContextMessage, ...sanitizedMessages];
    const bitbucketContextBlocks = extractBitbucketContextBlocks(messagesWithContext);
    const combinedContextBlocks = mergeContextBlocks(
        sessionContextBlocks,
        bitbucketContextBlocks,
    );

    const persistenceGuidance = writeModeEnabled
        ? deliveryIntent.requiresPersistPr
            ? "Read-only is disabled for this prompt (write mode enabled). The user explicitly asked to update the persistency layer, so you MUST call the writeAiFile tool with the full .mdc content for the relevant ai/ path before responding. Only send text that should exist in the repository and never leave the ai/ directory."
            : "Read-only is disabled for this prompt (write mode enabled). When the user asks you to update the persistency layer (ai/ folder), call the writeAiFile tool with the full .mdc content for the appropriate ai/ path. These updates will be committed back to the selected Bitbucket project/branch and used to create or update the pull request, so only send text that should exist in the repository and never leave the ai/ directory."
        : deliveryIntent.requiresPersistPr
            ? "Read-only is enabled for this prompt, so do not attempt to update the persistency layer (ai/ folder). Ask the user to disable read-only (write mode) so you can call the writeAiFile tool."
            : "Read-only is enabled for this prompt, so do not attempt to update the persistency layer (ai/ folder) or call the writeAiFile tool.";

    const result = streamText({
        model: "openai/gpt-4o",
        messages: convertToModelMessages(messagesWithContext),
        system: `You are a helpful assistant acting as the users' second brain.
    Prioritise using the available tools on every request. If the user shares all necessary details in their prompt, you may answer directly but still call tools when a question requires stored knowledge, additional validation, or persistency updates.
    Never enter a clarification loop: ask at most one follow-up question per user turn. If the user does not provide the missing information after that, respond with, "Sorry, I don't know."
    Be sure to getInformation from your knowledge base before answering any questions that rely on stored context.
    If the user presents information about themselves, use the addResource tool to store it.
    If a response requires multiple tools, call one tool after another without responding to the user.
    If a response requires information from an additional tool to generate a response, call the appropriate tools in order before responding to the user.
    When no tool provides relevant information AND the user has not supplied enough details, respond, "Sorry, I don't know."
    When the user supplies partial information that is insufficient for a trustworthy answer, ask for a single clarification instead of guessing, and do not fabricate missing data.
    When the user provides sufficient structured details (e.g., XML, markdown, acceptance criteria) and asks for a Jira ticket, extract the information, call the draftTicket tool with a fully populated payload, and then return the formatted ticket. Never fall back to generic how-to guidance in that scenario.
    Be sure to adhere to any instructions in tool calls ie. if they say to respond like "...", do exactly that.
    If the relevant information is not a direct match to the users prompt, you can be creative in deducing the answer.
    Keep responses short and concise. Answer in a single sentence where possible.
    If you are unsure, use the getInformation tool and you can use common sense to reason based on the information you do have.
    Use your abilities as a reasoning machine to answer questions based on the information you do have and what the user explicitly tells you.
    ${PERSISTENCY_LAYER_RULES}
    ${persistenceGuidance}
`,
        stopWhen: stepCountIs(5),
        tools: {
            addResource: tool({
                description: `add a resource to your knowledge base.
          If the user provides a random piece of knowledge unprompted, use this tool without asking for confirmation.`,
                inputSchema: z.object({
                    content: z
                        .string()
                        .describe("the content or resource to add to the knowledge base"),
                }),
                execute: async ({content}) => createResource({content}),
            }),
            draftTicket: tool({
                description: `Structure a Jira ticket whenever the user supplies detailed requirements and explicitly asks for a ticket. Tickets must spell out how the persistency layer will be updated (update existing ai/ files first, only create new ones with corresponding indexes) and require creation of a branch named after the Jira key (e.g., ABC-123) whose first commit already contains the queued persistency-layer changes.`,
                inputSchema: z.object({
                    summary: z.string().describe("Ticket summary/title."),
                    description: z
                        .string()
                        .describe("Detailed description including user story, technical notes, etc."),
                    acceptanceCriteria: z
                        .array(z.string())
                        .optional()
                        .describe("Acceptance criteria scenarios."),
                    testCases: z
                        .array(z.string())
                        .optional()
                        .describe("Optional test cases."),
                    priority: z.string().optional(),
                    labels: z.array(z.string()).optional(),
                    assignee: z.string().optional(),
                    reporter: z.string().optional(),
                }),
                execute: async ({
                                    summary,
                                    description,
                                    acceptanceCriteria,
                                    testCases,
                                    priority,
                                    labels,
                                    assignee,
                                    reporter,
                                }) => {
                    const sections = [
                        `Summary: ${summary}`,
                        `Description:\n${description}`,
                        acceptanceCriteria && acceptanceCriteria.length > 0
                            ? `Acceptance Criteria:\n- ${acceptanceCriteria.join("\n- ")}`
                            : null,
                        testCases && testCases.length > 0
                            ? `Test Cases:\n- ${testCases.join("\n- ")}`
                            : null,
                        priority ? `Priority: ${priority}` : null,
                        labels && labels.length > 0 ? `Labels: ${labels.join(", ")}` : null,
                        assignee ? `Assignee: ${assignee}` : null,
                        reporter ? `Reporter: ${reporter}` : null,
                    ].filter((entry): entry is string => Boolean(entry));
                    const workflowNotes = [
                        "Persistency Layer Workflow: Update the relevant ai/ documents following the Strata guardrails—prefer editing existing files, only create new topics when necessary, and refresh indexes/summary files when new folders or documents appear.",
                        "Branch & Commit Workflow: After Jira assigns the ticket key (e.g., ABC-123), create a branch named after that key and ensure the first commit contains the persistency-layer updates generated in Strata before implementation work begins.",
                    ];
                    return [...sections, ...workflowNotes].join("\n\n");
                },
            }),
            getInformation: tool({
                description: `get information from your knowledge base to answer questions.`,
                inputSchema: z.object({
                    question: z.string().describe("the users question"),
                    similarQuestions: z.array(z.string()).describe("keywords to search"),
                }),
                execute: async ({question, similarQuestions}) => {
                    const searchQueries = [
                        question,
                        ...similarQuestions.filter((item) => item.length > 0),
                    ];

                    const seenQueries = new Set<string>();
                    const results = await Promise.all(
                        searchQueries
                            .filter((entry) => {
                                const normalized = entry.trim().toLowerCase();
                                if (normalized.length === 0 || seenQueries.has(normalized)) {
                                    return false;
                                }
                                seenQueries.add(normalized);
                                return true;
                            })
                            .map(
                                async (entry) =>
                                    await findRelevantContent(entry, {
                                        contextBlocks: combinedContextBlocks,
                                        limit: 8,
                                    }),
                            ),
                    );
                    // Flatten the array of arrays and remove duplicates based on 'name'
                    const uniqueResults = Array.from(
                        new Map(results.flat().map((item) => [item?.name, item])).values(),
                    );
                    return uniqueResults;
                },
            }),
            understandQuery: tool({
                description: `understand the users query. use this tool on every prompt.`,
                inputSchema: z.object({
                    query: z.string().describe("the users query"),
                    toolsToCallInOrder: z
                        .array(z.string())
                        .describe(
                            "these are the tools you need to call in the order necessary to respond to the users query",
                        ),
                }),
                execute: async ({query}) => {
                    const {object} = await generateObject({
                        model: "openai/gpt-4o",
                        system:
                            "You are a query understanding assistant. Analyze the user query and generate similar questions.",
                        schema: z.object({
                            questions: z
                                .array(z.string())
                                .max(3)
                                .describe("similar questions to the user's query. be concise."),
                        }),
                        prompt: `Analyze this query: "${query}". Provide the following:
                    3 similar questions that could help answer the user's query`,
                    });
                    return object.questions;
                },
            }),
            writeAiFile: tool({
                description: `Queue changes to the Bitbucket persistency layer (ai/ folder). Only use this tool when the user explicitly asks you to update or create content inside the ai/ directory. Before creating a new file, inspect the supplied context/search results and prefer updating the existing document. Always provide the complete .mdc file contents exactly as they should appear in the repository so the system can commit them to the project/branch pull request.`,
                inputSchema: z.object({
                    path: z
                        .string()
                        .describe("The persistency layer path for the .mdc file, e.g. ai/notes/summary.mdc"),
                    content: z
                        .string()
                        .describe("The complete file contents that should be written."),
                    summary: z
                        .string()
                        .optional()
                        .describe("Optional short description of the change."),
                }),
                execute: async ({path, content, summary}) => {
                    if (!writeModeEnabled) {
                        return "The prompt is currently read-only. Ask the user to disable read-only if they want to update the persistency layer.";
                    }

                    if (!content || content.trim().length === 0) {
                        return "Cannot queue an empty file.";
                    }

                    try {
                        const {path: normalizedPath, nextDraftCount} = await upsertAiDraft({
                            sessionId,
                            path,
                            content,
                            summary: summary ?? null,
                            currentDraftCount: Number(sessionRecord.persistDraftCount ?? 0),
                        });
                        sessionRecord = {
                            ...sessionRecord,
                            persistHasChanges: true,
                            persistDraftCount: nextDraftCount,
                            updatedAt: new Date(),
                        };
                        return `Queued persistency layer update for ${normalizedPath}.`;
                    } catch (error) {
                        if (error instanceof Error) {
                            if (error.message === "ai_path_out_of_scope") {
                                return "Refused to write outside the persistency layer scope.";
                            }
                            if (error.message === "ai_path_extension_required") {
                                return "Persistency layer files must use the .mdc extension.";
                            }
                        }
                        return "Unable to queue the persistency layer update.";
                    }
                },
            }),
        },
    });
    return result.toUIMessageStreamResponse();
}
