import {cookies} from "next/headers";
import {randomUUID} from "node:crypto";
import {BITBUCKET_SESSION_COOKIE, type BitbucketSession, refreshAccessToken,} from "@/lib/bitbucket/client";

const isProduction = process.env.NODE_ENV === "production";

type StoredBitbucketSession = Omit<BitbucketSession, "sessionId"> & {
    sessionId?: string;
};

export const readBitbucketSession = async (): Promise<{
    session: BitbucketSession | null;
    cookieStore: Awaited<ReturnType<typeof cookies>>;
}> => {
    const cookieStore = await cookies();
    const rawSession = cookieStore.get(BITBUCKET_SESSION_COOKIE)?.value ?? null;

    if (!rawSession) {
        return {session: null, cookieStore};
    }

    try {
        const storedSession = JSON.parse(rawSession) as StoredBitbucketSession;
        const session: BitbucketSession = storedSession.sessionId
            ? (storedSession as BitbucketSession)
            : {
                ...storedSession,
                sessionId: randomUUID(),
            };

        if (!storedSession.sessionId) {
            cookieStore.set(BITBUCKET_SESSION_COOKIE, JSON.stringify(session), {
                httpOnly: true,
                sameSite: "lax",
                secure: isProduction,
                path: "/",
                maxAge: 30 * 24 * 60 * 60,
            });
        }

        return {session, cookieStore};
    } catch (error) {
        cookieStore.delete(BITBUCKET_SESSION_COOKIE);
        return {session: null, cookieStore};
    }
};

export const ensureFreshSession = async (
    session: BitbucketSession,
    cookieStore: Awaited<ReturnType<typeof cookies>>,
): Promise<BitbucketSession | null> => {
    if (Date.now() < session.expiresAt - 60 * 1000) {
        return session;
    }

    const refreshed = await refreshAccessToken(session);
    if (!refreshed) {
        cookieStore.delete(BITBUCKET_SESSION_COOKIE);
        return null;
    }

    cookieStore.set(BITBUCKET_SESSION_COOKIE, JSON.stringify(refreshed), {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
        maxAge: 30 * 24 * 60 * 60,
    });

    return refreshed;
};
