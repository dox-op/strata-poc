import {Buffer} from "node:buffer";
import {createHmac, timingSafeEqual} from "node:crypto";
import {NextRequest, NextResponse} from "next/server";
import {cookies} from "next/headers";
import {env} from "@/lib/env.mjs";

const SESSION_COOKIE = "bitbucket-oauth-session";

type BitbucketTokenResponse = {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    scopes: string;
    token_type: string;
};

const isProduction = process.env.NODE_ENV === "production";

export async function GET(request: NextRequest) {
    if (
        !env.BITBUCKET_CLIENT_ID ||
        !env.BITBUCKET_CLIENT_SECRET ||
        !env.BITBUCKET_REDIRECT_URI
    ) {
        return NextResponse.json(
            {error: "Bitbucket OAuth is not configured."},
            {status: 500},
        );
    }

    const url = request.nextUrl;
    const code = url.searchParams.get("code");
    const returnedState = url.searchParams.get("state");

    if (!code || !returnedState) {
        const errorParam = url.searchParams.get("error");
        console.error("[bitbucket] Missing code or state", {
            codePresent: !!code,
            returnedState,
            errorParam,
            fullUrl: url.toString(),
        });
        return NextResponse.redirect(
            new URL("/?bitbucketError=oauth_state", request.nextUrl.origin),
        );
    }

    const [nonce, expiresAtRaw, signature] = returnedState.split(".");
    const expiresAt = Number(expiresAtRaw);

    if (!nonce || !expiresAtRaw || Number.isNaN(expiresAt) || !signature) {
        console.error("[bitbucket] State parse failed", {
            nonce,
            expiresAtRaw,
            signaturePresent: !!signature,
        });
        return NextResponse.redirect(
            new URL("/?bitbucketError=oauth_state", request.nextUrl.origin),
        );
    }

    if (Date.now() > expiresAt) {
        console.error("[bitbucket] State expired", {expiresAt, now: Date.now()});
        return NextResponse.redirect(
            new URL("/?bitbucketError=oauth_state", request.nextUrl.origin),
        );
    }

    const payload = `${nonce}.${expiresAt}`;
    const expectedSignature = createHmac(
        "sha256",
        env.BITBUCKET_CLIENT_SECRET,
    )
        .update(payload)
        .digest("hex");

    const signaturesMatch =
        expectedSignature.length === signature.length &&
        timingSafeEqual(
            Buffer.from(expectedSignature, "hex"),
            Buffer.from(signature, "hex"),
        );

    if (!signaturesMatch) {
        console.error("[bitbucket] Signature mismatch", {
            payload,
            expectedSignature,
            signature,
        });
        return NextResponse.redirect(
            new URL("/?bitbucketError=oauth_state", request.nextUrl.origin),
        );
    }

    const cookieStore = await cookies();

    const body = new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: env.BITBUCKET_REDIRECT_URI,
    });

    const basicAuth = Buffer.from(
        `${env.BITBUCKET_CLIENT_ID}:${env.BITBUCKET_CLIENT_SECRET}`,
    ).toString("base64");

    const tokenResponse = await fetch(
        "https://bitbucket.org/site/oauth2/access_token",
        {
            method: "POST",
            headers: {
                Authorization: `Basic ${basicAuth}`,
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        },
    );

    if (!tokenResponse.ok) {
        return NextResponse.redirect(
            new URL("/?bitbucketError=token_exchange", request.nextUrl.origin),
        );
    }

    const tokenJson =
        (await tokenResponse.json()) as BitbucketTokenResponse | undefined;

    if (!tokenJson?.access_token || !tokenJson.refresh_token) {
        return NextResponse.redirect(
            new URL("/?bitbucketError=token_payload", request.nextUrl.origin),
        );
    }

    const sessionPayload = JSON.stringify({
        accessToken: tokenJson.access_token,
        refreshToken: tokenJson.refresh_token,
        expiresAt: Date.now() + tokenJson.expires_in * 1000,
    });

    cookieStore.set(SESSION_COOKIE, sessionPayload, {
        httpOnly: true,
        sameSite: "lax",
        secure: isProduction,
        path: "/",
        maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return NextResponse.redirect(new URL("/?bitbucket=connected", url.origin));
}
