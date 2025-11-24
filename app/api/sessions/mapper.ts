import {sessions} from "@/lib/db/schema/sessions";

type SessionRow = typeof sessions.$inferSelect;

export type SessionContextFile = {
    path: string;
    content: string;
    truncated: boolean;
};

export const mapSessionSummary = (session: SessionRow) => {
    const files = (session.contextFiles ?? []) as SessionContextFile[] | null;
    return {
        id: session.id,
        label: session.label,
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
        project: {
            uuid: session.projectUuid,
            key: session.projectKey,
            name: session.projectName,
        },
        workspace: {
            slug: session.workspaceSlug,
            name: session.workspaceName,
            uuid: session.workspaceUuid,
        },
        repository: {
            slug: session.repositorySlug,
            name: session.repositoryName,
        },
        branch: {
            name: session.branchName,
            isDefault: session.branchIsDefault,
        },
        context: {
            folderExists: session.contextFolderExists,
            truncated: session.contextTruncated,
            hasBootstrap: session.contextHasBootstrap,
            fileCount: files?.length ?? 0,
        },
    };
};

export const mapSessionDetails = (
    session: SessionRow,
    extra?: { branchAvailable?: boolean | null },
) => {
    const files = (session.contextFiles ?? []) as SessionContextFile[] | null;
    return {
        ...mapSessionSummary(session),
        branchAvailable: extra?.branchAvailable ?? null,
        context: {
            folderExists: session.contextFolderExists,
            truncated: session.contextTruncated,
            hasBootstrap: session.contextHasBootstrap,
            files: files ?? [],
        },
    };
};
