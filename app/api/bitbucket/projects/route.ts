import {Buffer} from "node:buffer";
import {NextResponse} from "next/server";
import {cookies} from "next/headers";
import {env} from "@/lib/env.mjs";

const SESSION_COOKIE = "bitbucket-oauth-session";
const isProduction = process.env.NODE_ENV === "production";

type BitbucketSession = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
};

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

const ensureConfig = () =>
    env.BITBUCKET_CLIENT_ID &&
    env.BITBUCKET_CLIENT_SECRET &&
    env.BITBUCKET_REDIRECT_URI;

const withAuthHeader = (token: string) => ({
    Authorization: `Bearer ${token}`,
});

const refreshAccessToken = async (
    session: BitbucketSession,
): Promise<BitbucketSession | null> => {
    if (!ensureConfig()) {
        return null;
    }

    const body = new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: session.refreshToken,
    });

    const basicAuth = Buffer.from(
        `${env.BITBUCKET_CLIENT_ID}:${env.BITBUCKET_CLIENT_SECRET}`,
    ).toString("base64");

    const response = await fetch(
        "https://bitbucket.org/site/oauth2/access_token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${basicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        },
    );

    if (!response.ok) {
        return null;
    }

    const json = (await response.json()) as {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
    };

    if (!json?.access_token || !json.refresh_token || !json.expires_in) {
        return null;
    }

    return {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
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

export async function GET() {
    if (!ensureConfig()) {
        return NextResponse.json(
            {error: "Bitbucket OAuth is not configured."},
            {status: 500},
        );
    }

    const cookieStore = await cookies();
    const rawSession = cookieStore.get(SESSION_COOKIE)?.value;

    if (!rawSession) {
        return NextResponse.json(
            {linked: false, projects: []},
            {status: 401},
        );
    }

    let session: BitbucketSession;
    try {
        session = JSON.parse(rawSession) as BitbucketSession;
    } catch (error) {
        cookieStore.delete(SESSION_COOKIE);
        return NextResponse.json(
            {linked: false, projects: []},
            {status: 401},
        );
    }

    // Refresh token if it is expiring in the next 60 seconds.
    if (Date.now() >= session.expiresAt - 60 * 1000) {
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            cookieStore.delete(SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, projects: []},
                {status: 401},
            );
        }

        session = refreshed;
        cookieStore.set(SESSION_COOKIE, JSON.stringify(session), {
            httpOnly: true,
            sameSite: "lax",
            secure: isProduction,
            path: "/",
            maxAge: 30 * 24 * 60 * 60,
        });
    }

    try {
        const projects = await fetchAllProjects(session.accessToken);
        return NextResponse.json({linked: true, projects});
    } catch (error) {
        if (error instanceof Error && error.message === "workspace_fetch_failed") {
            cookieStore.delete(SESSION_COOKIE);
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
