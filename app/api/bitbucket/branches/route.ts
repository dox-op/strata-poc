import {NextRequest, NextResponse} from "next/server";
import {assertBitbucketConfig, BITBUCKET_SESSION_COOKIE, withAuthHeader,} from "@/lib/bitbucket/client";
import {ensureFreshSession, readBitbucketSession} from "@/app/api/sessions/utils";
import {getBitbucketCache, isBitbucketCacheFresh, saveBitbucketCache,} from "@/lib/bitbucket/cache";

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
    try {
        assertBitbucketConfig();
    } catch (error) {
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

    const {session: rawSession, cookieStore} = await readBitbucketSession();
    if (!rawSession) {
        return NextResponse.json({linked: false, branches: []}, {status: 401});
    }

    const session = await ensureFreshSession(rawSession, cookieStore);
    if (!session) {
        return NextResponse.json({linked: false, branches: []}, {status: 401});
    }

    const forceRefresh = request.nextUrl.searchParams.get("refresh") === "1";
    const cacheKey = `${workspace}:${projectUuid}`;

    if (!forceRefresh) {
        const cached = await getBitbucketCache<ResolvedBranch[]>(
            session.sessionId,
            "branches",
            cacheKey,
        );

        if (cached && isBitbucketCacheFresh(cached.updatedAt)) {
            return NextResponse.json({branches: cached.payload});
        }
    }

    try {
        const repositories = await fetchRepositoriesForProject(
            workspace,
            projectUuid,
            projectKey,
            session.accessToken,
        );

        if (repositories.length === 0) {
            await saveBitbucketCache(
                session.sessionId,
                "branches",
                cacheKey,
                [],
            );
            return NextResponse.json({branches: []});
        }

        const branches = await fetchBranchesForRepositories(
            workspace,
            repositories,
            session.accessToken,
        );

        await saveBitbucketCache(
            session.sessionId,
            "branches",
            cacheKey,
            branches,
        );

        return NextResponse.json({branches});
    } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") {
            cookieStore.delete(BITBUCKET_SESSION_COOKIE);
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
