export const NEW_SESSION_OPTION = "new" as const

export type SessionSelectValue = typeof NEW_SESSION_OPTION | string

export type BitbucketConnectionStatus =
    | "loading"
    | "linked"
    | "disconnected"
    | "error"

export type SessionContextState =
    | "idle"
    | "loading"
    | "ready"
    | "missing"
    | "empty"
    | "error"
    | "auth-required"

export type SessionContextFile = {
    path: string
    content: string
    truncated: boolean
}

export type SessionContextMetadata = {
    fileCount: number
    truncated: boolean
    folderExists: boolean
    hasBootstrap: boolean
}

export type SessionPersistSummary = {
    hasPendingChanges: boolean
    draftCount: number
    pr: {
        id: string
        url: string | null
        branch: string | null
        title: string | null
        updatedAt: string | null
    } | null
}

export type SessionPersistDraft = {
    path: string
    content: string
    summary: string | null
    needsPersist: boolean
    updatedAt: string
}

export type SessionJiraTask = {
    key: string | null
    url: string
    summary: string | null
    createdAt: string | null
}

export type SessionSummary = {
    id: string
    label: string
    createdAt: string
    updatedAt: string
    project: {
        uuid: string
        key: string
        name: string
    }
    workspace: {
        slug: string | null
        name: string | null
        uuid: string | null
    }
    repository: {
        slug: string
        name: string
    }
    branch: {
        name: string
        isDefault: boolean
    }
    context: {
        folderExists: boolean
        truncated: boolean
        hasBootstrap: boolean
        fileCount: number
    }
    persist: SessionPersistSummary
    jiraTask: SessionJiraTask | null
}

export type SessionDetails = Omit<SessionSummary, "context"> & {
    context: {
        folderExists: boolean
        truncated: boolean
        hasBootstrap: boolean
        files: SessionContextFile[]
    }
    branchAvailable: boolean | null
    persist: SessionPersistSummary & {
        drafts: SessionPersistDraft[]
    }
}
