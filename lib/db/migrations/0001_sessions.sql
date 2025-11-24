CREATE TABLE IF NOT EXISTS "sessions"
(
    "id"
    varchar
(
    191
) PRIMARY KEY,
    "label" text NOT NULL,
    "project_uuid" varchar
(
    191
) NOT NULL,
    "project_key" varchar
(
    191
) NOT NULL,
    "project_name" text NOT NULL,
    "workspace_slug" varchar
(
    191
) NOT NULL,
    "workspace_name" text,
    "workspace_uuid" varchar
(
    191
),
    "repository_slug" varchar
(
    191
) NOT NULL,
    "repository_name" text NOT NULL,
    "branch_name" varchar
(
    191
) NOT NULL,
    "branch_is_default" boolean DEFAULT false NOT NULL,
    "context_folder_exists" boolean DEFAULT false NOT NULL,
    "context_truncated" boolean DEFAULT false NOT NULL,
    "context_has_bootstrap" boolean DEFAULT false NOT NULL,
    "context_files" jsonb,
    "created_at" timestamp DEFAULT now
(
) NOT NULL,
    "updated_at" timestamp DEFAULT now
(
) NOT NULL
    );
