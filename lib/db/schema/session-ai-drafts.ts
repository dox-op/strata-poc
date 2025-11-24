import {boolean, pgTable, primaryKey, text, timestamp, varchar,} from "drizzle-orm/pg-core";
import {sessions} from "@/lib/db/schema/sessions";

export const sessionAiDrafts = pgTable(
    "session_ai_drafts",
    {
        sessionId: varchar("session_id", {length: 191})
            .notNull()
            .references(() => sessions.id, {onDelete: "cascade"}),
        path: text("path").notNull(),
        content: text("content").notNull(),
        summary: text("summary"),
        needsPersist: boolean("needs_persist").default(true).notNull(),
        createdAt: timestamp("created_at", {withTimezone: false})
            .defaultNow()
            .notNull(),
        updatedAt: timestamp("updated_at", {withTimezone: false})
            .defaultNow()
            .notNull(),
    },
    (table) => ({
        pk: primaryKey({
            columns: [table.sessionId, table.path],
        }),
    }),
);
