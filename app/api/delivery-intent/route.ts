import {NextResponse} from "next/server";
import {z} from "zod";
import {detectDeliveryIntent} from "@/lib/delivery-intent";

const intentSchema = z.object({
    text: z.string().min(1),
});

export async function POST(request: Request) {
    const body = await request.json().catch(() => null);
    const parsed = intentSchema.safeParse(body);

    if (!parsed.success) {
        return NextResponse.json(
            {error: "invalid_request", details: parsed.error.flatten()},
            {status: 400},
        );
    }

    const {text} = parsed.data;
    const {requiresJiraTicket, requiresPersistPr} = detectDeliveryIntent(text);

    return NextResponse.json({
        requiresJiraTicket,
        requiresPersistPr,
    });
}
