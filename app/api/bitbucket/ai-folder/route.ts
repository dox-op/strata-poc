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

type BitbucketDirectoryEntry = {
    path?: string;
    type?: "commit_file" | "commit_directory";
    size?: number;
};

type AiFolderContent = {
    path: string;
    content: string;
    truncated: boolean;
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

const fetchAiFolderListing = async (
    workspace: string,
    repository: string,
    branch: string,
    accessToken: string,
): Promise<{ exists: boolean; files: BitbucketDirectoryEntry[] }> => {
    const files: BitbucketDirectoryEntry[] = [];
    let url = `https://api.bitbucket.org/2.0/repositories/${encodeURIComponent(workspace)}/${encodeURIComponent(repository)}/src/${encodeURIComponent(branch)}/ai?pagelen=100`;

    while (url) {
        const response = await fetch(url, {
            headers: withAuthHeader(accessToken),
            cache: "no-store",
        });

        if (response.status === 404) {
            return {exists: false, files: []};
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

        for (const entry of json.values ?? []) {
            if (entry?.type === "commit_file" && entry.path) {
                files.push(entry);
            }
        }

        url = json.next ?? "";
    }

    return {exists: true, files};
};

const TEXTUAL_CONTENT_TYPES = [
    "text/",
    "application/json",
    "application/javascript",
    "application/xml",
    "application/yaml",
    "application/x-yaml",
    "application/graphql",
];

const MAX_FILES = 20;
const MAX_BYTES_PER_FILE = 100_000;

const isLikelyText = (contentType: string | null) => {
    if (!contentType) {
        return true;
    }

    return TEXTUAL_CONTENT_TYPES.some((prefix) =>
        contentType.toLowerCase().startsWith(prefix),
    );
};

const fetchFileContent = async (
    workspace: string,
    repository: string,
    branch: string,
    path: string,
    accessToken: string,
): Promise<AiFolderContent | null> => {
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
    if (!isLikelyText(contentType)) {
        return null;
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const truncated = buffer.byteLength > MAX_BYTES_PER_FILE;
    const limitedBuffer = truncated
        ? buffer.subarray(0, MAX_BYTES_PER_FILE)
        : buffer;

    return {
        path,
        content: limitedBuffer.toString("utf-8"),
        truncated,
    };
};

export async function GET(request: NextRequest) {
    if (!ensureConfig()) {
        return NextResponse.json(
            {error: "Bitbucket OAuth is not configured."},
            {status: 500},
        );
    }

    const searchParams = request.nextUrl.searchParams;
    const workspace = searchParams.get("workspace");
    const repository = searchParams.get("repository");
    const branch = searchParams.get("branch");

    if (!workspace || !repository || !branch) {
        return NextResponse.json(
            {error: "workspace, repository, and branch are required"},
            {status: 400},
        );
    }

    const cookieStore = await cookies();
    const rawSession = cookieStore.get(SESSION_COOKIE)?.value;

    if (!rawSession) {
        return NextResponse.json({linked: false, files: []}, {status: 401});
    }

    let session: BitbucketSession;
    try {
        session = JSON.parse(rawSession) as BitbucketSession;
    } catch (error) {
        cookieStore.delete(SESSION_COOKIE);
        return NextResponse.json({linked: false, files: []}, {status: 401});
    }

    if (Date.now() >= session.expiresAt - 60 * 1000) {
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            cookieStore.delete(SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, files: []},
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
        const listing = await fetchAiFolderListing(
            workspace,
            repository,
            branch,
            session.accessToken,
        );

        if (!listing.exists) {
            return NextResponse.json({
                folderExists: false,
                files: [],
            });
        }

        if (listing.files.length === 0) {
            return NextResponse.json({
                folderExists: true,
                files: [],
            });
        }

        const limitedFiles = listing.files.slice(0, MAX_FILES);
        const contents: AiFolderContent[] = [];

        for (const entry of limitedFiles) {
            if (!entry.path) {
                continue;
            }

            const file = await fetchFileContent(
                workspace,
                repository,
                branch,
                entry.path,
                session.accessToken,
            );

            if (file) {
                contents.push(file);
            }
        }

        return NextResponse.json({
            folderExists: true,
            files: contents,
            truncated: listing.files.length > MAX_FILES,
        });
    } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") {
            cookieStore.delete(SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, files: []},
                {status: 401},
            );
        }

        return NextResponse.json(
            {error: "ai_folder_fetch_failed", files: []},
            {status: 500},
        );
    }
}
