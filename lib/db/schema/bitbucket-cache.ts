import {jsonb, pgTable, serial, text, timestamp, uniqueIndex} from "drizzle-orm/pg-core";

export const bitbucketCache = pgTable(
    "bitbucket_cache",
    {
        id: serial("id").primaryKey(),
        sessionId: text("session_id").notNull(),
        scope: text("scope").notNull(),
        cacheKey: text("cache_key").notNull(),
        payload: jsonb("payload").notNull(),
        updatedAt: timestamp("updated_at", {withTimezone: false})
            .defaultNow()
            .notNull(),
    },
    (table) => ({
        sessionScopeKeyIdx: uniqueIndex("bitbucket_cache_session_scope_key_idx").on(
            table.sessionId,
            table.scope,
            table.cacheKey,
        ),
    }),
);
