import {NextResponse} from "next/server";
import {z} from "zod";

const intentSchema = z.object({
    text: z.string().min(1),
});

const jiraArtifactKeywords = [
    "jira",
    "ticket",
    "tickets",
    "task",
    "issue",
    "story",
    "bug",
    "segnalazione",
];

const persistArtifactKeywords = [
    "pull request",
    "pull-request",
    "pullrequest",
    "pr ",
    " pr",
    "pr.",
    "pr?",
    "persistency",
    "persistency layer",
    "persistenza",
    "ai/",
];

const verbKeywords = [
    "create",
    "open",
    "file",
    "raise",
    "log",
    "draft",
    "crea",
    "creare",
    "creami",
    "crearlo",
    "aprimi",
    "genera",
    "generami",
];

const matchesIntent = (text: string, artifactList: string[]) => {
    const normalized = text.toLowerCase();
    const mentionsArtifact = artifactList.some((term) =>
        normalized.includes(term),
    );
    if (!mentionsArtifact) {
        return false;
    }
    return verbKeywords.some((verb) => normalized.includes(verb));
};

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

    const requiresJiraTicket = matchesIntent(text, jiraArtifactKeywords);
    const requiresPersistPr = matchesIntent(text, persistArtifactKeywords);

    return NextResponse.json({
        requiresJiraTicket,
        requiresPersistPr,
    });
}
