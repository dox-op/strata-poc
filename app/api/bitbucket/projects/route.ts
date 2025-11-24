import {NextRequest, NextResponse} from "next/server";
import {assertBitbucketConfig, BITBUCKET_SESSION_COOKIE, withAuthHeader,} from "@/lib/bitbucket/client";
import {ensureFreshSession, readBitbucketSession} from "@/app/api/sessions/utils";
import {getBitbucketCache, isBitbucketCacheFresh, saveBitbucketCache,} from "@/lib/bitbucket/cache";

type BitbucketWorkspace = {
    slug?: string;
    name?: string;
    uuid?: string;
};

type BitbucketProject = {
    uuid: string;
    key: string;
    name: string;
    workspace: {
        slug?: string;
        name?: string;
        uuid?: string;
    };
};

const fetchAllProjects = async (accessToken: string) => {
    const workspacesResponse = await fetch(
        "https://api.bitbucket.org/2.0/workspaces?role=member",
        {
            headers: withAuthHeader(accessToken),
            cache: "no-store",
        },
    );

    if (!workspacesResponse.ok) {
        throw new Error("workspace_fetch_failed");
    }

    const workspacesJson = (await workspacesResponse.json()) as {
        values?: BitbucketWorkspace[];
    };

    const workspaces = workspacesJson.values ?? [];

    const allProjects: BitbucketProject[] = [];

    for (const workspace of workspaces) {
        const workspaceSlug = workspace.slug ?? workspace.uuid;
        if (!workspaceSlug) {
            continue;
        }

        const projectsResponse = await fetch(
            `https://api.bitbucket.org/2.0/workspaces/${encodeURIComponent(workspaceSlug)}/projects?pagelen=100`,
            {
                headers: withAuthHeader(accessToken),
                cache: "no-store",
            },
        );

        if (!projectsResponse.ok) {
            // Skip workspaces we cannot access.
            continue;
        }

        const projectsJson = (await projectsResponse.json()) as {
            values?: Array<{
                uuid?: string;
                key?: string;
                name?: string;
            }>;
        };

        for (const project of projectsJson.values ?? []) {
            if (!project.uuid || !project.name || !project.key) {
                continue;
            }

            allProjects.push({
                uuid: project.uuid,
                key: project.key,
                name: project.name,
                workspace: {
                    slug: workspace.slug,
                    name: workspace.name,
                    uuid: workspace.uuid,
                },
            });
        }
    }

    return allProjects;
};

export async function GET(request: NextRequest) {
    try {
        assertBitbucketConfig();
    } catch (error) {
        return NextResponse.json(
            {error: "Bitbucket OAuth is not configured."},
            {status: 500},
        );
    }

    const {session: rawSession, cookieStore} = await readBitbucketSession();
    if (!rawSession) {
        return NextResponse.json(
            {linked: false, projects: []},
            {status: 401},
        );
    }

    const session = await ensureFreshSession(rawSession, cookieStore);
    if (!session) {
        return NextResponse.json(
            {linked: false, projects: []},
            {status: 401},
        );
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const cacheKey = "projects";

    if (!forceRefresh) {
        const cached = await getBitbucketCache<BitbucketProject[]>(
            session.sessionId,
            "projects",
            cacheKey,
        );

        if (cached && isBitbucketCacheFresh(cached.updatedAt)) {
            return NextResponse.json({linked: true, projects: cached.payload});
        }
    }

    try {
        const projects = await fetchAllProjects(session.accessToken);
        await saveBitbucketCache(
            session.sessionId,
            "projects",
            cacheKey,
            projects,
        );
        return NextResponse.json({linked: true, projects});
    } catch (error) {
        if (error instanceof Error && error.message === "workspace_fetch_failed") {
            cookieStore.delete(BITBUCKET_SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, projects: []},
                {status: 401},
            );
        }

        return NextResponse.json(
            {linked: true, projects: [], error: "project_fetch_failed"},
            {status: 500},
        );
    }
}
