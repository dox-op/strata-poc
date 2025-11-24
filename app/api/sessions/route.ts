import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {sessions} from "@/lib/db/schema/sessions";
import {desc} from "drizzle-orm";
import {
    assertBitbucketConfig,
    BITBUCKET_SESSION_COOKIE,
    fetchAiFolderListing,
    fetchFileContent,
} from "@/lib/bitbucket/client";
import {ensureFreshSession, readBitbucketSession} from "@/app/api/sessions/utils";
import {mapSessionDetails, mapSessionSummary, type SessionContextFile,} from "@/app/api/sessions/mapper";

const MAX_FILES = 20;

const createSessionSchema = z.object({
    project: z.object({
        uuid: z.string().min(1),
        key: z.string().min(1),
        name: z.string().min(1),
        workspace: z.object({
            slug: z.string().min(1).optional(),
            name: z.string().optional(),
            uuid: z.string().optional(),
        }),
    }),
    branch: z.object({
        name: z.string().min(1),
        isDefault: z.boolean().optional(),
    }),
    repository: z.object({
        slug: z.string().min(1),
        name: z.string().min(1),
    }),
    allowPersist: z.boolean().optional(),
});

export async function GET() {
    const data = await db
        .select()
        .from(sessions)
        .orderBy(desc(sessions.updatedAt));

    return NextResponse.json({
        sessions: data.map(mapSessionSummary),
    });
}

export async function POST(request: NextRequest) {
    try {
        assertBitbucketConfig();
    } catch (error) {
        return NextResponse.json(
            {error: "Bitbucket OAuth is not configured."},
            {status: 500},
        );
    }

    const parseResult = createSessionSchema.safeParse(await request.json());
    if (!parseResult.success) {
        return NextResponse.json(
            {error: "invalid_request", details: parseResult.error.flatten()},
            {status: 400},
        );
    }

    const payload = parseResult.data;
    const workspaceSlug =
        payload.project.workspace.slug ?? payload.project.workspace.uuid;

    if (!workspaceSlug) {
        return NextResponse.json(
            {error: "workspace_slug_required"},
            {status: 400},
        );
    }

    const {session: rawSession, cookieStore} = await readBitbucketSession();
    if (!rawSession) {
        return NextResponse.json({error: "unauthorized"}, {status: 401});
    }

    const session = await ensureFreshSession(rawSession, cookieStore);
    if (!session) {
        return NextResponse.json({error: "unauthorized"}, {status: 401});
    }

    let folderExists = false;
    let contextTruncated = false;
    let contextHasBootstrap = false;
    let contextFiles: SessionContextFile[] = [];

    try {
        const listing = await fetchAiFolderListing(
            session.accessToken,
            workspaceSlug,
            payload.repository.slug,
            payload.branch.name,
        );

        folderExists = listing.exists;

        if (listing.exists) {
            const mdcEntries = listing.files.filter(
                (entry) =>
                    entry.path &&
                    entry.path.toLowerCase().endsWith(".mdc"),
            );

            const limitedEntries = mdcEntries.slice(0, MAX_FILES);
            contextTruncated =
                listing.files.length > MAX_FILES ||
                mdcEntries.length > limitedEntries.length;

            const files: SessionContextFile[] = [];

            for (const entry of limitedEntries) {
                if (!entry.path) {
                    continue;
                }

                const file = await fetchFileContent(
                    session.accessToken,
                    workspaceSlug,
                    payload.repository.slug,
                    payload.branch.name,
                    entry.path,
                );

                if (!file) {
                    continue;
                }

                files.push({
                    path: entry.path,
                    content: file.content,
                    truncated: file.truncated,
                });

                if (
                    entry.path.toLowerCase().endsWith("ai-bootstrap.mdc") ||
                    entry.path.toLowerCase() === "ai-bootstrap.mdc"
                ) {
                    contextHasBootstrap = true;
                }
            }

            if (!contextHasBootstrap) {
                // If ai-bootstrap is missing, fall back to a blank context.
                contextFiles = [];
            } else {
                contextFiles = files.sort((a, b) =>
                    a.path.localeCompare(b.path),
                );
            }
        }
    } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") {
            cookieStore.delete(BITBUCKET_SESSION_COOKIE);
            return NextResponse.json({error: "unauthorized"}, {status: 401});
        }

        return NextResponse.json(
            {error: "bitbucket_fetch_failed"},
            {status: 500},
        );
    }

    const now = new Date();
    const label = `${payload.project.name} · ${payload.branch.name}`;

    const [created] = await db
        .insert(sessions)
        .values({
            label,
            projectUuid: payload.project.uuid,
            projectKey: payload.project.key,
            projectName: payload.project.name,
            workspaceSlug,
            workspaceName: payload.project.workspace.name ?? null,
            workspaceUuid: payload.project.workspace.uuid ?? null,
            repositorySlug: payload.repository.slug,
            repositoryName: payload.repository.name,
            branchName: payload.branch.name,
            branchIsDefault: payload.branch.isDefault ?? false,
            contextFolderExists: folderExists,
            contextTruncated,
            contextHasBootstrap,
            contextFiles,
            persistAllowWrites: payload.allowPersist ?? false,
            createdAt: now,
            updatedAt: now,
        })
        .returning();

    return NextResponse.json({
        session: mapSessionDetails(created, {branchAvailable: true, drafts: []}),
    });
}
