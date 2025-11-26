import {sessions} from "@/lib/db/schema/sessions";
import {sessionAiDrafts} from "@/lib/db/schema/session-ai-drafts";

type SessionRow = typeof sessions.$inferSelect;
type SessionDraftRow = typeof sessionAiDrafts.$inferSelect;

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
        persist: {
            hasPendingChanges: session.persistHasChanges,
            draftCount: Number(session.persistDraftCount ?? 0),
            pr: session.persistPrId
                ? {
                    id: session.persistPrId,
                    url: session.persistPrUrl ?? null,
                    branch: session.persistPrBranch ?? null,
                    title: session.persistPrTitle ?? null,
                    updatedAt: session.persistUpdatedAt
                        ? session.persistUpdatedAt.toISOString()
                        : null,
                }
                : null,
        },
        jiraTask: session.jiraTaskUrl
            ? {
                key: session.jiraTaskKey ?? null,
                url: session.jiraTaskUrl,
                summary: session.jiraTaskSummary ?? null,
                createdAt: session.jiraTaskCreatedAt
                    ? session.jiraTaskCreatedAt.toISOString()
                    : null,
            }
            : null,
    };
};

export const mapSessionDetails = (
    session: SessionRow,
    extra?: { branchAvailable?: boolean | null; drafts?: SessionDraftRow[] },
) => {
    const files = (session.contextFiles ?? []) as SessionContextFile[] | null;
    const drafts = (extra?.drafts ?? []).map((draft) => ({
        path: draft.path,
        content: draft.content,
        summary: draft.summary,
        needsPersist: draft.needsPersist,
        updatedAt: draft.updatedAt.toISOString(),
    }));
    const summary = mapSessionSummary(session);
    return {
        ...summary,
        branchAvailable: extra?.branchAvailable ?? null,
        context: {
            folderExists: session.contextFolderExists,
            truncated: session.contextTruncated,
            hasBootstrap: session.contextHasBootstrap,
            files: files ?? [],
        },
        persist: {
            ...summary.persist,
            drafts,
            hasPendingChanges:
                drafts.some((draft) => draft.needsPersist) ||
                summary.persist.hasPendingChanges,
        },
    };
};
