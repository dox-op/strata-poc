import {NextRequest, NextResponse} from "next/server";
import {db} from "@/lib/db";
import {sessions} from "@/lib/db/schema/sessions";
import {sessionAiDrafts} from "@/lib/db/schema/session-ai-drafts";
import {and, desc, eq, inArray, sql} from "drizzle-orm";
import {
    assertBitbucketConfig,
    BITBUCKET_SESSION_COOKIE,
    fetchRepositoryBranches,
    withAuthHeader,
} from "@/lib/bitbucket/client";
import {ensureFreshSession, readBitbucketSession} from "@/app/api/sessions/utils";
import {normalizeAiFilePath} from "@/lib/ai/file-path";

const encode = (value: string) => encodeURIComponent(value);

type RouteParams = { id?: string };
type SessionAiDraftRow = typeof sessionAiDrafts.$inferSelect;

const MAX_PR_TITLE_LENGTH = 140;

const truncateTitle = (value: string) =>
    value.length > MAX_PR_TITLE_LENGTH ? `${value.slice(0, MAX_PR_TITLE_LENGTH - 1).trimEnd()}…` : value;

const deriveConversationSummaryTitle = (drafts: SessionAiDraftRow[]) => {
    const summaryParts = drafts
        .map((draft) => (draft.summary ?? "").replace(/\s+/g, " ").trim())
        .filter((entry) => entry.length > 0);

    if (summaryParts.length > 0) {
        const uniqueSummaries = Array.from(new Set(summaryParts));
        return truncateTitle(uniqueSummaries.slice(0, 3).join(" · "));
    }

    const pathHints: string[] = [];
    for (const draft of drafts) {
        const rawPath = typeof draft.path === "string" ? draft.path : "";
        if (!rawPath) {
            continue;
        }

        let normalizedPath = rawPath;
        try {
            normalizedPath = normalizeAiFilePath(rawPath);
        } catch {
            // If normalization fails, fall back to the original path without blocking.
        }

        const segments = normalizedPath.split("/");
        const fileName = segments[segments.length - 1] ?? normalizedPath;
        if (!fileName) {
            continue;
        }

        const label = fileName.replace(/\.mdc$/i, "").trim();
        if (label.length === 0 || pathHints.includes(label)) {
            continue;
        }

        pathHints.push(label);
        if (pathHints.length >= 3) {
            break;
        }
    }

    if (pathHints.length > 0) {
        const joined =
            pathHints.length === 1
                ? `Strata updates for ${pathHints[0]}`
                : `Strata updates for ${pathHints.join(", ")}`;
        return truncateTitle(joined);
    }

    return null;
};

export async function GET(
    _request: NextRequest,
    {params}: { params: Promise<RouteParams> },
) {
    const sessionId = (await params).id;
    if (!sessionId) {
        return NextResponse.json({error: "session_id_required"}, {status: 400});
    }

    const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!session) {
        return NextResponse.json({error: "session_not_found"}, {status: 404});
    }

    const drafts = await db
        .select()
        .from(sessionAiDrafts)
        .where(eq(sessionAiDrafts.sessionId, sessionId))
        .orderBy(desc(sessionAiDrafts.updatedAt));

    const draftCount =
        typeof session.persistDraftCount === "number"
            ? Number(session.persistDraftCount)
            : drafts.length;

    console.info(
        "[persist:get]",
        JSON.stringify({
            sessionId,
            draftCount,
            hasPendingChanges: session.persistHasChanges,
        }),
    );

    return NextResponse.json({
        persist: {
            hasPendingChanges: session.persistHasChanges,
            draftCount,
            drafts: drafts.map((draft) => ({
                path: draft.path,
                content: draft.content,
                summary: draft.summary,
                needsPersist: draft.needsPersist,
                updatedAt: draft.updatedAt.toISOString(),
            })),
            pr: session.persistPrId
                ? {
                    id: session.persistPrId,
                    url: session.persistPrUrl ?? null,
                    branch: session.persistPrBranch ?? null,
                    title: session.persistPrTitle ?? null,
                    updatedAt: session.persistUpdatedAt
                        ? session.persistUpdatedAt.toISOString()
                        : null,
                }
                : null,
        },
    });
}

export async function POST(
    request: NextRequest,
    {params}: { params: Promise<RouteParams> },
) {
    const sessionId = (await params).id;
    if (!sessionId) {
        return NextResponse.json({error: "session_id_required"}, {status: 400});
    }

    let persistPayload: { title?: string | null } | null = null;
    try {
        persistPayload = (await request.json()) as { title?: string | null };
    } catch {
        persistPayload = null;
    }

    const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!session) {
        return NextResponse.json({error: "session_not_found"}, {status: 404});
    }

    if (!session.workspaceSlug) {
        return NextResponse.json(
            {error: "workspace_slug_required"},
            {status: 400},
        );
    }

    const drafts = await db
        .select()
        .from(sessionAiDrafts)
        .where(
            and(
                eq(sessionAiDrafts.sessionId, sessionId),
                eq(sessionAiDrafts.needsPersist, true),
            ),
        );

    if (drafts.length === 0) {
        console.warn(
            "[persist:post] No pending drafts",
            JSON.stringify({sessionId}),
        );
        return NextResponse.json(
            {error: "no_pending_ai_changes"},
            {status: 400},
        );
    }

    try {
        assertBitbucketConfig();
    } catch (error) {
        return NextResponse.json(
            {error: "bitbucket_not_configured"},
            {status: 500},
        );
    }

    const {session: rawSession, cookieStore} = await readBitbucketSession();
    if (!rawSession) {
        return NextResponse.json({error: "unauthorized"}, {status: 401});
    }

    const bitbucketSession = await ensureFreshSession(rawSession, cookieStore);
    if (!bitbucketSession) {
        return NextResponse.json({error: "unauthorized"}, {status: 401});
    }

    const workspace = session.workspaceSlug;
    const repository = session.repositorySlug;
    const destinationBranch = session.branchName;

    const branchInfo = await fetchRepositoryBranches(
        bitbucketSession.accessToken,
        workspace,
        repository,
        destinationBranch,
    );

    if (!branchInfo?.target?.hash) {
        return NextResponse.json(
            {error: "branch_unavailable"},
            {status: 400},
        );
    }

    const sanitizedSessionId = session.id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
    const featureBranch =
        session.persistPrBranch ??
        `ai-session/${sanitizedSessionId || "updates"}`;

    if (!session.persistPrBranch) {
        const branchResponse = await fetch(
            `https://api.bitbucket.org/2.0/repositories/${encode(workspace)}/${encode(
                repository,
            )}/refs/branches`,
            {
                method: "POST",
                headers: {
                    ...withAuthHeader(bitbucketSession.accessToken),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    name: featureBranch,
                    target: {
                        hash: branchInfo.target?.hash,
                    },
                }),
            },
        );

        if (!branchResponse.ok && branchResponse.status !== 409) {
            return NextResponse.json(
                {error: "failed_to_create_branch"},
                {status: 500},
            );
        }
    }

    const fallbackTitle = `Update persistency layer via session ${
        session.label ?? session.id
    }`;
    const conversationSummaryTitle = deriveConversationSummaryTitle(drafts);

    const normalizedRequestedTitle =
        typeof persistPayload?.title === "string"
            ? persistPayload.title.replace(/\s+/g, " ").trim()
            : "";
    const existingTitle =
        typeof session.persistPrTitle === "string"
            ? session.persistPrTitle.trim()
            : "";
    const desiredTitle =
        normalizedRequestedTitle.length > 0
            ? normalizedRequestedTitle
            : existingTitle.length > 0
                ? existingTitle
                : conversationSummaryTitle ?? fallbackTitle;

    const formData = new FormData();
    formData.append(
        "message",
        desiredTitle,
    );
    formData.append("branch", featureBranch);

    let normalizedDrafts: Array<typeof drafts[number] & { safePath: string }>;
    try {
        normalizedDrafts = drafts.map((draft) => ({
            ...draft,
            safePath: normalizeAiFilePath(draft.path),
        }));
    } catch (error) {
        const message =
            error instanceof Error ? error.message : "ai_path_out_of_scope";
        return NextResponse.json({error: message}, {status: 400});
    }

    normalizedDrafts.forEach((draft) => {
        formData.append(
            `${draft.safePath}`,
            new Blob([draft.content], {type: "text/plain"}),
            draft.safePath.split("/").pop() ?? "ai.mdc",
        );
    });

    console.info(
        "[persist:post] Commit",
        JSON.stringify({
            sessionId,
            workspace,
            repository,
            featureBranch,
            destinationBranch,
            draftCount: drafts.length,
            normalizedDrafts
        }),
    );

    const commitResponse = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${encode(workspace)}/${encode(
            repository,
        )}/src`,
        {
            method: "POST",
            headers: withAuthHeader(bitbucketSession.accessToken),
            body: formData,
        },
    );

    if (!commitResponse.ok) {
        if (commitResponse.status === 401) {
            cookieStore.delete(BITBUCKET_SESSION_COOKIE);
            return NextResponse.json({error: "unauthorized"}, {status: 401});
        }
        return NextResponse.json(
            {error: "bitbucket_commit_failed"},
            {status: 500},
        );
    }

    let prId = session.persistPrId ?? null;
    let prUrl = session.persistPrUrl ?? null;
    let prTitle = desiredTitle;

    if (!session.persistPrId) {
        const prResponse = await fetch(
            `https://api.bitbucket.org/2.0/repositories/${encode(workspace)}/${encode(
                repository,
            )}/pullrequests`,
            {
                method: "POST",
                headers: {
                    ...withAuthHeader(bitbucketSession.accessToken),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: prTitle,
                    source: {
                        branch: {name: featureBranch},
                    },
                    destination: {
                        branch: {name: destinationBranch},
                    },
                    description: `Generated by Strata session ${session.label ?? session.id}.`,
                }),
            },
        );

        if (!prResponse.ok) {
            return NextResponse.json(
                {error: "bitbucket_pr_failed"},
                {status: 500},
            );
        }

        const prJson = (await prResponse.json()) as {
            id?: number | string;
            links?: { html?: { href?: string } };
        };

        prId = prJson.id ? String(prJson.id) : null;
        prUrl = prJson.links?.html?.href ?? null;
    } else if (
        session.persistPrId &&
        desiredTitle.length > 0 &&
        desiredTitle !== (session.persistPrTitle ?? "")
    ) {
        const updateResponse = await fetch(
            `https://api.bitbucket.org/2.0/repositories/${encode(workspace)}/${encode(
                repository,
            )}/pullrequests/${encode(session.persistPrId)}`,
            {
                method: "PUT",
                headers: {
                    ...withAuthHeader(bitbucketSession.accessToken),
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    title: desiredTitle,
                }),
            },
        );

        if (!updateResponse.ok) {
            return NextResponse.json(
                {error: "bitbucket_pr_update_failed"},
                {status: 500},
            );
        }
    }

    const updatedPaths = drafts.map((draft) => draft.path);
    const now = new Date();

    await db
        .update(sessionAiDrafts)
        .set({needsPersist: false, updatedAt: now})
        .where(
            and(
                eq(sessionAiDrafts.sessionId, sessionId),
                inArray(sessionAiDrafts.path, updatedPaths),
            ),
        );

    const [{pending}] = await db
        .select({
            pending: sql<number>`COUNT(*)`,
        })
        .from(sessionAiDrafts)
        .where(
            and(
                eq(sessionAiDrafts.sessionId, sessionId),
                eq(sessionAiDrafts.needsPersist, true),
            ),
        );

    const hasPending = Number(pending ?? 0) > 0;

    await db
        .update(sessions)
        .set({
            persistHasChanges: hasPending,
            persistPrId: prId,
            persistPrUrl: prUrl,
            persistPrBranch: featureBranch,
            persistPrTitle: prTitle,
            persistUpdatedAt: now,
            updatedAt: now,
        })
        .where(eq(sessions.id, sessionId));

    console.info(
        "[persist:post] Completed",
        JSON.stringify({
            sessionId,
            branch: featureBranch,
            status: session.persistPrId ? "updated" : "created",
            prUrl,
            remainingDrafts: hasPending ? pending : 0,
        }),
    );

    return NextResponse.json({
        status: session.persistPrId ? "updated" : "created",
        prUrl,
    });
}
