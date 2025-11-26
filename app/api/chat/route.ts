import {NextResponse} from "next/server";
import {createResource} from "@/lib/actions/resources";
import {findRelevantContent, type RetrievalContextBlock,} from "@/lib/ai/embedding";
import {convertToModelMessages, generateObject, stepCountIs, streamText, tool, UIMessage,} from "ai";
import {z} from "zod";
import {db} from "@/lib/db";
import {sessions} from "@/lib/db/schema/sessions";
import {sessionAiDrafts} from "@/lib/db/schema/session-ai-drafts";
import {and, eq} from "drizzle-orm";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

const PERSISTENCY_LAYER_RULES = `
Persistency layer guardrails (apply even if some files are missing for the current branch):
- The persistency layer is a human-legible knowledge base made of .mdc files inside the ai/ directory.
- ai/ai-bootstrap.mdc explains how the layer is organised. Treat it as mandatory and consult it before touching other folders.
- All .mdc files must be written entirely in English; do not mix languages when updating or creating documents.
- ai/ai-meta/ contains agent playbooks, prompts, and best-practice catalogues (ai/ai-meta/best-practices/ expands the catalogue; migration-brief.mdc is optional per project).
- ai/technical/ holds architecture, operations, and decision records; ai/functional/ holds functional intent, workflows, and glossaries. All of these folders, and any nested topic folder under them, must maintain an index.mdc that summarises the folder contents and structure.
- When you create a new topic folder under ai/, immediately create an index.mdc within it so humans/agents can navigate the area.
- Keep ai/functional/summary.mdc aligned whenever you add or change documents in ai/functional/acceptance, integrations, requirements, or taxonomy.
- Never add manual change logs to .mdc files; overwrite content so it always reflects the current truth and rely on Git history for diffs.
- Always reference only the ai/ directory (persistency layer). If a required summary/index file is missing, call it out and recommend adding it to restore navigability.
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

    const sessionContextBlocks = buildSessionContextBlocks(sessionRecord);
    const bitbucketContextBlocks = extractBitbucketContextBlocks(messages);
    const combinedContextBlocks = mergeContextBlocks(
        sessionContextBlocks,
        bitbucketContextBlocks,
    );

    const persistenceGuidance = writeModeEnabled
        ? "Write mode is enabled for this prompt. When the user asks you to write to the persistency layer (ai/ folder), call the writeAiFile tool with the full updated .mdc content for the appropriate ai/ path. These updates will be committed back to the selected Bitbucket project/branch and used to create or update the pull request, so only send text that should exist in the repository and never leave the ai/ directory."
        : "Write mode is disabled for this prompt. This session is read-only for now, so do not attempt to update the persistency layer (ai/ folder) or call the writeAiFile tool.";

    const result = streamText({
        model: "openai/gpt-4o",
        messages: convertToModelMessages(messages),
        system: `You are a helpful assistant acting as the users' second brain.
    Use tools on every request.
    Be sure to getInformation from your knowledge base before answering any questions.
    If the user presents information about themselves, use the addResource tool to store it.
    If a response requires multiple tools, call one tool after another without responding to the user.
    If a response requires information from an additional tool to generate a response, call the appropriate tools in order before responding to the user.
    ONLY respond to questions using information from tool calls.
    if no relevant information is found in the tool calls, respond, "Sorry, I don't know."
    Be sure to adhere to any instructions in tool calls ie. if they say to respond like "...", do exactly that.
    If the relevant information is not a direct match to the users prompt, you can be creative in deducing the answer.
    Keep responses short and concise. Answer in a single sentence where possible.
    If you are unsure, use the getInformation tool and you can use common sense to reason based on the information you do have.
    Use your abilities as a reasoning machine to answer questions based on the information you do have.
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
                description: `Queue changes to the Bitbucket persistency layer (ai/ folder). Only use this tool when the user explicitly asks you to update or create content inside the ai/ directory. Always provide the complete .mdc file contents exactly as they should appear in the repository so the system can commit them to the project/branch pull request.`,
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
                        return "Write mode is disabled for this prompt. Ask the user to enable write mode if they want to update the persistency layer.";
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
