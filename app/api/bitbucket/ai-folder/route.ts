import {NextRequest, NextResponse} from "next/server";
import {
    assertBitbucketConfig,
    BITBUCKET_SESSION_COOKIE,
    fetchAiFolderListing,
    fetchFileContent,
} from "@/lib/bitbucket/client";
import {ensureFreshSession, readBitbucketSession} from "@/app/api/sessions/utils";
import {AI_FOLDER_MAX_FILES} from "@/lib/bitbucket/config";

type AiFolderContent = {
    path: string;
    content: string;
    truncated: boolean;
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
    const workspace = searchParams.get("workspace");
    const repository = searchParams.get("repository");
    const branch = searchParams.get("branch");

    if (!workspace || !repository || !branch) {
        return NextResponse.json(
            {error: "workspace, repository, and branch are required"},
            {status: 400},
        );
    }

    const {session: rawSession, cookieStore} = await readBitbucketSession();
    if (!rawSession) {
        return NextResponse.json({linked: false, files: []}, {status: 401});
    }

    const session = await ensureFreshSession(rawSession, cookieStore);
    if (!session) {
        return NextResponse.json({linked: false, files: []}, {status: 401});
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

        const limitedFiles = listing.files.slice(0, AI_FOLDER_MAX_FILES);
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
            truncated: listing.files.length > AI_FOLDER_MAX_FILES,
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
