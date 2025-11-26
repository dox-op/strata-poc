import {Buffer} from "node:buffer";
import {env} from "@/lib/env.mjs";

export const BITBUCKET_SESSION_COOKIE = "bitbucket-oauth-session";

export type BitbucketSession = {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    sessionId: string;
};

export type BitbucketDirectoryEntry = {
    path?: string;
    type?: "commit_file" | "commit_directory";
    size?: number;
};

export type BitbucketBranch = {
    name: string;
    target?: {
        hash?: string;
    };
    mainbranch?: {
        name?: string;
    };
};

const ensureConfig = () =>
    env.BITBUCKET_CLIENT_ID &&
    env.BITBUCKET_CLIENT_SECRET &&
    env.BITBUCKET_REDIRECT_URI;

export const assertBitbucketConfig = () => {
    if (!ensureConfig()) {
        throw new Error("bitbucket_oauth_not_configured");
    }
};

export const withAuthHeader = (token: string) => ({
    Authorization: `Bearer ${token}`,
});

export const refreshAccessToken = async (
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
        ...session,
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
    };
};

export const fetchAiFolderListing = async (
    accessToken: string,
    workspace: string,
    repository: string,
    branch: string,
): Promise<{ exists: boolean; files: BitbucketDirectoryEntry[] }> => {
    const workspaceId = encodeURIComponent(workspace);
    const repositoryId = encodeURIComponent(repository);
    const branchId = encodeURIComponent(branch);
    const baseUrl = `https://api.bitbucket.org/2.0/repositories/${workspaceId}/${repositoryId}/src/${branchId}`;

    const files: BitbucketDirectoryEntry[] = [];
    const visited = new Set<string>();
    const queue: string[] = ["ai"];
    let rootExists = false;

    const buildUrl = (path: string) => `${baseUrl}/${encodeURI(path)}?pagelen=100`;

    while (queue.length > 0) {
        const currentPath = queue.shift()!;
        if (visited.has(currentPath)) {
            continue;
        }
        visited.add(currentPath);

        let url = buildUrl(currentPath);
        while (url) {
            const response = await fetch(url, {
                headers: withAuthHeader(accessToken),
                cache: "no-store",
            });

            if (response.status === 404) {
                if (currentPath === "ai" && !rootExists) {
                    return {exists: false, files: []};
                }
                break;
            }

            if (response.status === 401) {
                throw new Error("unauthorized");
            }

            if (!response.ok) {
                throw new Error("ai_folder_listing_failed");
            }

            const json = (await response.json()) as {
                values?: BitbucketDirectoryEntry[];
                next?: string;
            };

            if (currentPath === "ai") {
                rootExists = true;
            }

            for (const entry of json.values ?? []) {
                if (!entry?.path) {
                    continue;
                }

                if (entry.type === "commit_file") {
                    files.push(entry);
                } else if (entry.type === "commit_directory") {
                    queue.push(entry.path);
                }
            }

            url = json.next ?? "";
        }
    }

    return {exists: rootExists, files};
};

export const fetchRepositoryBranches = async (
    accessToken: string,
    workspace: string,
    repository: string,
    branch: string,
) => {
    const response = await fetch(
        `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/refs/branches/${encodeURIComponent(branch)}`,
        {
            headers: withAuthHeader(accessToken),
            cache: "no-store",
        },
    );

    if (response.status === 404) {
        return null;
    }

    if (!response.ok) {
        throw new Error("branch_fetch_failed");
    }

    const json = (await response.json()) as BitbucketBranch | undefined;
    return json ?? null;
};

export const fetchFileContent = async (
    accessToken: string,
    workspace: string,
    repository: string,
    branch: string,
    path: string,
): Promise<{ content: string; truncated: boolean } | null> => {
    const url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/src/${encodeURIComponent(branch)}/${encodeURI(path)}`;

    const response = await fetch(url, {
        headers: withAuthHeader(accessToken),
        cache: "no-store",
    });

    if (response.status === 404) {
        return null;
    }

    if (response.status === 401) {
        throw new Error("unauthorized");
    }

    if (!response.ok) {
        throw new Error("ai_folder_file_fetch_failed");
    }

    const contentType = response.headers.get("content-type");
    if (contentType && !contentType.toLowerCase().startsWith("text/")) {
        return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const MAX_BYTES_PER_FILE = 100_000;
    const truncated = buffer.byteLength > MAX_BYTES_PER_FILE;
    const limitedBuffer = truncated
        ? buffer.subarray(0, MAX_BYTES_PER_FILE)
        : buffer;

    return {
        content: limitedBuffer.toString("utf-8"),
        truncated,
    };
};
