import {createHmac, randomUUID} from "node:crypto";
import {NextResponse} from "next/server";
import {env} from "@/lib/env.mjs";

const STATE_TTL_SECONDS = 10 * 60;

export async function GET() {
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

    const nonce = randomUUID();
    const expiresAt = Date.now() + STATE_TTL_SECONDS * 1000;
    const payload = `${nonce}.${expiresAt}`;
    const signature = createHmac("sha256", env.BITBUCKET_CLIENT_SECRET)
        .update(payload)
        .digest("hex");
    const encodedState = `${nonce}.${expiresAt}.${signature}`;

    const params = new URLSearchParams({
        client_id: env.BITBUCKET_CLIENT_ID,
        response_type: "code",
        state: encodedState,
        scope: "account project repository:write pullrequest:write",
        redirect_uri: env.BITBUCKET_REDIRECT_URI,
    });

    return NextResponse.redirect(
        `https://bitbucket.org/site/oauth2/authorize?${params.toString()}`,
        {
            status: 302,
        },
    );
}
