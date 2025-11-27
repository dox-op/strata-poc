export type DeliveryIntent = {
    requiresJiraTicket: boolean
    requiresPersistPr: boolean
}

const jiraArtifactKeywords = [
    "jira",
    "ticket",
    "tickets",
    "task",
    "issue",
    "story",
    "bug",
    "segnalazione",
]

const persistArtifactKeywords = [
    "pull request",
    "pull-request",
    "pullrequest",
    " pr",
    "pr ",
    "pr.",
    "pr?",
    "persistency",
    "persistency layer",
    "persistenza",
    "peristenza",
    "strato di persistenza",
    "strato di peristenza",
    "ai/",
    "ai\\/",
    "persist",
]

const verbKeywords = [
    "create",
    "open",
    "file",
    "raise",
    "log",
    "draft",
    "update",
    "aggiorna",
    "aggiornare",
    "aggiornami",
    "crea",
    "creare",
    "creami",
    "crearlo",
    "aprimi",
    "genera",
    "generami",
]

const matchesIntent = (text: string, artifactList: string[]): boolean => {
    const normalized = text.toLowerCase()
    const mentionsArtifact = artifactList.some((term) =>
        normalized.includes(term),
    )
    if (!mentionsArtifact) {
        return false
    }
    return verbKeywords.some((verb) => normalized.includes(verb))
}

export const detectDeliveryIntent = (text: string): DeliveryIntent => {
    if (!text || text.trim().length === 0) {
        return {
            requiresJiraTicket: false,
            requiresPersistPr: false,
        }
    }
    return {
        requiresJiraTicket: matchesIntent(text, jiraArtifactKeywords),
        requiresPersistPr: matchesIntent(text, persistArtifactKeywords),
    }
}
