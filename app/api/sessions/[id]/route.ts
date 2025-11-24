import {NextRequest, NextResponse} from "next/server";
import {db} from "@/lib/db";
import {sessions} from "@/lib/db/schema/sessions";
import {eq} from "drizzle-orm";
import {assertBitbucketConfig, fetchRepositoryBranches,} from "@/lib/bitbucket/client";
import {ensureFreshSession, readBitbucketSession} from "@/app/api/sessions/utils";
import {mapSessionDetails} from "@/app/api/sessions/mapper";
import {sessionAiDrafts} from "@/lib/db/schema/session-ai-drafts";
import {z} from "zod";

type SessionUpdate = typeof sessions.$inferInsert;

const updateSessionSchema = z.object({
    allowPersist: z.boolean().optional(),
});

export async function GET(
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

    let branchAvailable: boolean | null = null;

    try {
        assertBitbucketConfig();
        const {session: bitbucketSession, cookieStore} =
            await readBitbucketSession();

        if (bitbucketSession) {
            const refreshed = await ensureFreshSession(
                bitbucketSession,
                cookieStore,
            );

            if (refreshed) {
                try {
                    const branch = await fetchRepositoryBranches(
                        refreshed.accessToken,
                        session.workspaceSlug,
                        session.repositorySlug,
                        session.branchName,
                    );
                    branchAvailable = branch !== null;
                } catch (error) {
                    if (
                        error instanceof Error &&
                        error.message === "branch_fetch_failed"
                    ) {
                        branchAvailable = null;
                    }
                }
            }
        }
    } catch (error) {
        // If Bitbucket isn't configured or no session exists, fall back to stored data.
        branchAvailable = branchAvailable ?? null;
    }

    const drafts = await db
        .select()
        .from(sessionAiDrafts)
        .where(eq(sessionAiDrafts.sessionId, sessionId));

    return NextResponse.json({
        session: mapSessionDetails(session, {branchAvailable, drafts}),
    });
}

export async function PATCH(
    request: NextRequest,
    {params}: { params: { id?: string } },
) {
    const sessionId = params.id;

    if (!sessionId) {
        return NextResponse.json({error: "session_id_required"}, {status: 400});
    }

    const parseResult = updateSessionSchema.safeParse(await request.json());
    if (!parseResult.success) {
        return NextResponse.json(
            {error: "invalid_request", details: parseResult.error.flatten()},
            {status: 400},
        );
    }

    const [session] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!session) {
        return NextResponse.json({error: "session_not_found"}, {status: 404});
    }

    const updates: Partial<SessionUpdate> = {};

    if (typeof parseResult.data.allowPersist === "boolean") {
        updates.persistAllowWrites = parseResult.data.allowPersist;
    }

    if (Object.keys(updates).length === 0) {
        return NextResponse.json({error: "no_updates"}, {status: 400});
    }

    updates.updatedAt = new Date();

    await db
        .update(sessions)
        .set(updates)
        .where(eq(sessions.id, sessionId));

    return NextResponse.json({success: true});
}
