ALTER TABLE "sessions"
    ADD COLUMN "jira_task_key" varchar(191),
    ADD COLUMN "jira_task_url" text,
    ADD COLUMN "jira_task_summary" text,
    ADD COLUMN "jira_task_created_at" timestamp;
