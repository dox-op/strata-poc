CREATE TABLE IF NOT EXISTS "bitbucket_cache"
(
    "id"
    serial
    PRIMARY
    KEY,
    "session_id"
    text
    NOT
    NULL,
    "scope"
    text
    NOT
    NULL,
    "cache_key"
    text
    NOT
    NULL,
    "payload"
    jsonb
    NOT
    NULL,
    "updated_at"
    timestamp
    DEFAULT
    now
(
) NOT NULL
    );

CREATE UNIQUE INDEX IF NOT EXISTS "bitbucket_cache_session_scope_key_idx"
    ON "bitbucket_cache" ("session_id", "scope", "cache_key");
