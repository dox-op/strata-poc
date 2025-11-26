import {NextRequest, NextResponse} from "next/server";
import {z} from "zod";
import {db} from "@/lib/db";
import {sessions} from "@/lib/db/schema/sessions";
import {eq} from "drizzle-orm";

type RouteParams = { params: Promise<{ id?: string }> };

const payloadSchema = z.object({
    url: z.string().url(),
    key: z
        .string()
        .min(1)
        .regex(/[A-Za-z]+-\d+/, {
            message: "jira_key_format_invalid",
        })
        .optional(),
    summary: z
        .string()
        .min(1)
        .max(2000)
        .optional(),
});

const extractKeyFromUrl = (url: string) => {
    const pattern = /([A-Za-z]+-\d+)/;
    const match = url.match(pattern);
    return match ? match[1]?.toUpperCase() ?? null : null;
};

export async function POST(request: NextRequest, {params}: RouteParams) {
    const {id: sessionId} = await params;
    if (!sessionId) {
        return NextResponse.json({error: "session_id_required"}, {status: 400});
    }

    const json = await request.json().catch(() => null);
    const parsed = payloadSchema.safeParse(json);
    if (!parsed.success) {
        return NextResponse.json(
            {error: "invalid_request", details: parsed.error.flatten()},
            {status: 400},
        );
    }

    const payload = parsed.data;
    const keyFromInput = payload.key?.toUpperCase();
    const derivedKey = keyFromInput ?? extractKeyFromUrl(payload.url);

    const [session] = await db
        .select({id: sessions.id})
        .from(sessions)
        .where(eq(sessions.id, sessionId))
        .limit(1);

    if (!session) {
        return NextResponse.json({error: "session_not_found"}, {status: 404});
    }

    const now = new Date();
    const [updated] = await db
        .update(sessions)
        .set({
            jiraTaskUrl: payload.url,
            jiraTaskKey: derivedKey,
            jiraTaskSummary: payload.summary ?? null,
            jiraTaskCreatedAt: now,
            updatedAt: now,
        })
        .where(eq(sessions.id, sessionId))
        .returning({
            jiraTaskKey: sessions.jiraTaskKey,
            jiraTaskUrl: sessions.jiraTaskUrl,
            jiraTaskSummary: sessions.jiraTaskSummary,
            jiraTaskCreatedAt: sessions.jiraTaskCreatedAt,
        });

    return NextResponse.json({
        jiraTask: updated.jiraTaskUrl
            ? {
                key: updated.jiraTaskKey,
                url: updated.jiraTaskUrl,
                summary: updated.jiraTaskSummary,
                createdAt: updated.jiraTaskCreatedAt
                    ? updated.jiraTaskCreatedAt.toISOString()
                    : now.toISOString(),
            }
            : null,
    });
}
