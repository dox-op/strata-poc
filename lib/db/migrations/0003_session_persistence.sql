ALTER TABLE "sessions"
    ADD COLUMN "persist_allow_writes" boolean DEFAULT false NOT NULL,
    ADD COLUMN "persist_has_changes" boolean DEFAULT false NOT NULL,
    ADD COLUMN "persist_draft_count" integer DEFAULT 0 NOT NULL,
    ADD COLUMN "persist_pr_id" varchar(191),
    ADD COLUMN "persist_pr_url" text,
    ADD COLUMN "persist_pr_branch" varchar(191),
    ADD COLUMN "persist_pr_title" text,
    ADD COLUMN "persist_updated_at" timestamp;

CREATE TABLE IF NOT EXISTS "session_ai_drafts"
(
    "session_id"
    varchar
(
    191
) NOT NULL,
    "path" text NOT NULL,
    "content" text NOT NULL,
    "summary" text,
    "needs_persist" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now
(
) NOT NULL,
    "updated_at" timestamp DEFAULT now
(
) NOT NULL,
    CONSTRAINT "session_ai_drafts_session_id_sessions_id_fk"
    FOREIGN KEY
(
    "session_id"
) REFERENCES "sessions"
(
    "id"
) ON DELETE CASCADE,
    CONSTRAINT "session_ai_drafts_session_id_path_pk"
    PRIMARY KEY
(
    "session_id",
    "path"
)
    );
