"use client"

import type {SessionContextMetadata, SessionContextState,} from "@/lib/session/types"

type SessionContextStatusProps = {
    error: string | null
    metadata: SessionContextMetadata | null
    state: SessionContextState
}

export const SessionContextStatus = ({
                                         error,
                                         metadata,
                                         state,
                                     }: SessionContextStatusProps) => {
    if (state === "loading") {
        return (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Preparing session context…
            </p>
        )
    }

    if (state === "ready" && metadata) {
        return (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Loaded persistency layer ({metadata.fileCount}
                {metadata.truncated ? "+" : ""} files).
            </p>
        )
    }

    if (state === "missing") {
        return (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Persistency layer not found. You can still continue with this session.
            </p>
        )
    }

    if (state === "empty") {
        return (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                The persistency layer does not contain usable .mdc files. Session
                context is blank.
            </p>
        )
    }

    if (state === "auth-required") {
        return (
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
                Log in to Bitbucket to create a new session.
            </p>
        )
    }

    if (state === "error" && error) {
        return <p className="text-xs text-red-500">{error}</p>
    }

    return null
}
