import {NextRequest, NextResponse} from "next/server";
import {cookies} from "next/headers";
import {
    assertBitbucketConfig,
    BITBUCKET_SESSION_COOKIE,
    type BitbucketSession,
    fetchAiFolderListing,
    fetchFileContent,
    refreshAccessToken,
} from "@/lib/bitbucket/client";

const isProduction = process.env.NODE_ENV === "production";

type AiFolderContent = {
    path: string;
    content: string;
    truncated: boolean;
};

const MAX_FILES = 20;

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
    const rawSession = cookieStore.get(BITBUCKET_SESSION_COOKIE)?.value;

    if (!rawSession) {
        return NextResponse.json({linked: false, files: []}, {status: 401});
    }

    let session: BitbucketSession;
    try {
        session = JSON.parse(rawSession) as BitbucketSession;
    } catch (error) {
        cookieStore.delete(BITBUCKET_SESSION_COOKIE);
        return NextResponse.json({linked: false, files: []}, {status: 401});
    }

    if (Date.now() >= session.expiresAt - 60 * 1000) {
        const refreshed = await refreshAccessToken(session);
        if (!refreshed) {
            cookieStore.delete(BITBUCKET_SESSION_COOKIE);
            return NextResponse.json(
                {linked: false, files: []},
                {status: 401},
            );
        }

        session = refreshed;
        cookieStore.set(BITBUCKET_SESSION_COOKIE, JSON.stringify(session), {
            httpOnly: true,
            sameSite: "lax",
            secure: isProduction,
            path: "/",
            maxAge: 30 * 24 * 60 * 60,
        });
    }

    try {
        const listing = await fetchAiFolderListing(
            session.accessToken,
            workspace,
            repository,
            branch,
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
                session.accessToken,
                workspace,
                repository,
                branch,
                entry.path,
            );

            if (file) {
                contents.push({
                    path: entry.path,
                    content: file.content,
                    truncated: file.truncated,
                });
            }
        }

        return NextResponse.json({
            folderExists: true,
            files: contents,
            truncated: listing.files.length > MAX_FILES,
        });
    } catch (error) {
        if (error instanceof Error && error.message === "unauthorized") {
            cookieStore.delete(BITBUCKET_SESSION_COOKIE);
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
