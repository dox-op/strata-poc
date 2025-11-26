import {nanoid} from "@/lib/utils";
import {boolean, integer, jsonb, pgTable, text, timestamp, varchar,} from "drizzle-orm/pg-core";

export const sessions = pgTable("sessions", {
    id: varchar("id", {length: 191})
        .primaryKey()
        .$defaultFn(() => nanoid()),
    label: text("label").notNull(),
    projectUuid: varchar("project_uuid", {length: 191}).notNull(),
    projectKey: varchar("project_key", {length: 191}).notNull(),
    projectName: text("project_name").notNull(),
    workspaceSlug: varchar("workspace_slug", {length: 191}).notNull(),
    workspaceName: text("workspace_name"),
    workspaceUuid: varchar("workspace_uuid", {length: 191}),
    repositorySlug: varchar("repository_slug", {length: 191}).notNull(),
    repositoryName: text("repository_name").notNull(),
    branchName: varchar("branch_name", {length: 191}).notNull(),
    branchIsDefault: boolean("branch_is_default").default(false).notNull(),
    contextFolderExists: boolean("context_folder_exists").default(false).notNull(),
    contextTruncated: boolean("context_truncated").default(false).notNull(),
    contextHasBootstrap: boolean("context_has_bootstrap").default(false).notNull(),
    contextFiles: jsonb("context_files").$type<Array<{
        path: string;
        content: string;
        truncated: boolean;
    }>>(),
    persistAllowWrites: boolean("persist_allow_writes").default(false).notNull(),
    persistHasChanges: boolean("persist_has_changes").default(false).notNull(),
    persistDraftCount: integer("persist_draft_count").default(0).notNull(),
    persistPrId: varchar("persist_pr_id", {length: 191}),
    persistPrUrl: text("persist_pr_url"),
    persistPrBranch: varchar("persist_pr_branch", {length: 191}),
    persistPrTitle: text("persist_pr_title"),
    persistUpdatedAt: timestamp("persist_updated_at", {withTimezone: false}),
    jiraTaskKey: varchar("jira_task_key", {length: 191}),
    jiraTaskUrl: text("jira_task_url"),
    jiraTaskSummary: text("jira_task_summary"),
    jiraTaskCreatedAt: timestamp("jira_task_created_at", {withTimezone: false}),
    createdAt: timestamp("created_at", {withTimezone: false})
        .defaultNow()
        .notNull(),
    updatedAt: timestamp("updated_at", {withTimezone: false})
        .defaultNow()
        .notNull(),
});

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
