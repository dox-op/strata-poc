import {and, eq} from "drizzle-orm";
import {db} from "@/lib/db";
import {bitbucketCache} from "@/lib/db/schema/bitbucket-cache";

export type BitbucketCacheScope = "projects" | "branches";

export const BITBUCKET_CACHE_TTL_MS = 10 * 60 * 1000;

export const isBitbucketCacheFresh = (updatedAt: Date) => {
    return Date.now() - updatedAt.getTime() < BITBUCKET_CACHE_TTL_MS;
};

export const getBitbucketCache = async <T>(
    sessionId: string,
    scope: BitbucketCacheScope,
    cacheKey: string,
): Promise<{ payload: T; updatedAt: Date } | null> => {
    const [record] = await db
        .select({
            payload: bitbucketCache.payload,
            updatedAt: bitbucketCache.updatedAt,
        })
        .from(bitbucketCache)
        .where(
            and(
                eq(bitbucketCache.sessionId, sessionId),
                eq(bitbucketCache.scope, scope),
                eq(bitbucketCache.cacheKey, cacheKey),
            ),
        )
        .limit(1);

    if (!record?.updatedAt) {
        return null;
    }

    return {
        payload: record.payload as T,
        updatedAt: record.updatedAt,
    };
};

export const saveBitbucketCache = async <T>(
    sessionId: string,
    scope: BitbucketCacheScope,
    cacheKey: string,
    payload: T,
) => {
    await db
        .insert(bitbucketCache)
        .values({
            sessionId,
            scope,
            cacheKey,
            payload: payload as unknown,
            updatedAt: new Date(),
        })
        .onConflictDoUpdate({
            target: [
                bitbucketCache.sessionId,
                bitbucketCache.scope,
                bitbucketCache.cacheKey,
            ],
            set: {
                payload: payload as unknown,
                updatedAt: new Date(),
            },
        });
};
