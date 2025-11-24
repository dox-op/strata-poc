import {Buffer} from "node:buffer";
import {NextRequest, NextResponse} from "next/server";
import {cookies} from "next/headers";
import {env} from "@/lib/env.mjs";

const SESSION_COOKIE = "bitbucket-oauth-session";
const isProduction = process.env.NODE_ENV === "production";

type BitbucketSession = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
};

type BitbucketRepository = {
    slug: string;
    name?: string;
    mainbranch?: {
        name?: string;
    };
};

type BitbucketBranch = {
    name: string;
    target?: {
        hash?: string;
    };
};

type ResolvedBranch = {
    id: string;
    name: string;
    repository: {
        slug: string;
        name: string;
    };
    latestCommit?: string;
    isDefault: boolean;
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

const fetchRepositoriesForProject = async (
    workspace: string,
    projectUuid: string,
    projectKey: string | null,
    accessToken: string,
) => {
    const repositories: BitbucketRepository[] = [];

    const queryParts = [`project.uuid="${projectUuid}"`];
    if (projectKey) {
        queryParts.push(`project.key="${projectKey}"`);
    }

    const encodedQuery = encodeURIComponent(queryParts.join(" OR "));
    let url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}?pagelen=100&q=${encodedQuery}`;

    while (url) {
        const response = await fetch(url, {
            headers: withAuthHeader(accessToken),
            cache: "no-store",
        });

        if (response.status === 401) {
            throw new Error("unauthorized");
        }

        if (!response.ok) {
            throw new Error("repository_fetch_failed");
        }

        const json = (await response.json()) as {
            values?: Array<BitbucketRepository>;
            next?: string;
        };

        for (const repo of json.values ?? []) {
            if (!repo?.slug) {
                continue;
            }

            repositories.push(repo);
        }

        url = json.next ?? "";
    }

    return repositories;
};

const fetchBranchesForRepositories = async (
    workspace: string,
    repositories: BitbucketRepository[],
    accessToken: string,
): Promise<ResolvedBranch[]> => {
    const allBranches: ResolvedBranch[] = [];

    for (const repo of repositories) {
        const mainBranchName = repo.mainbranch?.name ?? null;
        let url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repo.slug)}/refs/branches?pagelen=100`;

        while (url) {
            const response = await fetch(url, {
                headers: withAuthHeader(accessToken),
                cache: "no-store",
            });

            if (response.status === 401) {
                throw new Error("unauthorized");
            }

            if (!response.ok) {
                throw new Error("branch_fetch_failed");
            }

            const json = (await response.json()) as {
                values?: Array<BitbucketBranch>;
                next?: string;
            };

            for (const branch of json.values ?? []) {
                if (!branch?.name) {
                    continue;
                }

                const repositoryName = repo.name ?? repo.slug;

                allBranches.push({
                    id: `${repo.slug}:${branch.name}`,
                    name: branch.name,
                    repository: {
                        slug: repo.slug,
                        name: repositoryName,
                    },
                    latestCommit: branch.target?.hash,
                    isDefault: branch.name === mainBranchName,
                });
            }

            url = json.next ?? "";
        }
    }

    return allBranches.sort((a, b) => {
        const aRepo = a.repository.name.toLowerCase();
        const bRepo = b.repository.name.toLowerCase();
        if (aRepo !== bRepo) {
            return aRepo.localeCompare(bRepo);
        }

        if (a.isDefault !== b.isDefault) {
            return a.isDefault ? -1 : 1;
        }

        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
};

export async function GET(request: NextRequest) {
    if (!ensureConfig()) {
        return NextResponse.json(
            {error: "Bitbucket OAuth is not configured."},
            {status: 500},
        );
    }

    const searchParams = request.nextUrl.searchParams;
    const projectUuid = searchParams.get("projectUuid");
    const projectKey = searchParams.get("projectKey");
    const workspace = searchParams.get("workspace");

    if (!projectUuid || !workspace) {
        return NextResponse.json(
            {error: "projectUuid and workspace are required"},
            {status: 400},
        );
    }

    const cookieStore = await cookies();
    const rawSession = cookieStore.get(SESSION_COOKIE)?.value;

    if (!rawSession) {
        return NextResponse.json({linked: false, branches: []}, {status: 401});
    }

    let session: BitbucketSession;
    try {
        session = JSON.parse(rawSession) as BitbucketSession;
    } catch (error) {
        cookieStore.delete(SESSION_COOKIE);
        return NextResponse.json({linked: false, branches: []}, {status: 401});
    }

    if (Date.now() >= session.expiresAt - 60 * 1000) {
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            cookieStore.delete(SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, branches: []},
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
        const repositories = await fetchRepositoriesForProject(
            workspace,
            projectUuid,
            projectKey,
            session.accessToken,
        );

        if (repositories.length === 0) {
            return NextResponse.json({branches: []});
        }

        const branches = await fetchBranchesForRepositories(
            workspace,
            repositories,
            session.accessToken,
        );

        return NextResponse.json({branches});
    } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") {
            cookieStore.delete(SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, branches: []},
                {status: 401},
            );
        }

        return NextResponse.json(
            {error: "branch_fetch_failed", branches: []},
            {status: 500},
        );
    }
}
