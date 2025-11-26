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

const encode = (value: string) => encodeURIComponent(value);

export async function GET(
    _request: NextRequest,
    {params}: { params: { id?: string } },
) {
    const sessionId = params.id;
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

    return NextResponse.json({
        persist: {
            allowWrites: session.persistAllowWrites,
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
    {params}: { params: { id?: string } },
) {
    const sessionId = params.id;
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

    if (!session.persistAllowWrites) {
        return NextResponse.json(
            {error: "persistence_disabled"},
            {status: 400},
        );
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

    const formData = new FormData();
    formData.append(
        "message",
        session.persistPrTitle ??
        `Update persistency layer via session ${session.label ?? session.id}`,
    );
    formData.append("branch", featureBranch);

    drafts.forEach((draft) => {
        formData.append(
            `files/${draft.path}`,
            new Blob([draft.content], {type: "text/plain"}),
            draft.path.split("/").pop() ?? "ai.mdc",
        );
    });

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
    let prTitle =
        session.persistPrTitle ??
        `AI session updates - ${session.projectName} · ${session.branchName}`;

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

    return NextResponse.json({
        status: session.persistPrId ? "updated" : "created",
        prUrl,
    });
}
