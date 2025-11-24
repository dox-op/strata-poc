import {type MutableRefObject, useCallback, useEffect, useMemo, useRef, useState,} from "react"
import type {UIMessage} from "@ai-sdk/react"
import {toast} from "sonner"

import type {BitbucketProject} from "@/components/bitbucket-project-picker"
import type {BitbucketBranch} from "@/components/bitbucket-branch-picker"
import type {SearchableSelectOption} from "@/components/ui/searchable-select"
import {
    type BitbucketConnectionStatus,
    NEW_SESSION_OPTION,
    type SessionContextMetadata,
    type SessionContextState,
    type SessionDetails,
    type SessionSelectValue,
    type SessionSummary,
} from "@/lib/session/types"
import {buildSessionContextPayload, generateMessageId, summarizeSession,} from "@/lib/session/utils"

type SetMessagesFn = (
    value: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
) => void

type PersistButtonState = "create" | "review" | "update"

type UseSessionManagerOptions = {
    setMessagesRef: MutableRefObject<SetMessagesFn | null>
}

export const useSessionManager = ({
                                      setMessagesRef,
                                  }: UseSessionManagerOptions) => {
    const [sessions, setSessions] = useState<SessionSummary[]>([])
    const [selectedSessionId, setSelectedSessionId] =
        useState<SessionSelectValue>(NEW_SESSION_OPTION)
    const [activeSession, setActiveSession] = useState<SessionDetails | null>(null)
    const [selectedProject, setSelectedProject] =
        useState<BitbucketProject | null>(null)
    const [selectedBranch, setSelectedBranch] =
        useState<BitbucketBranch | null>(null)
    const [bitbucketStatus, setBitbucketStatus] =
        useState<BitbucketConnectionStatus>("loading")
    const [sessionContextState, setSessionContextState] =
        useState<SessionContextState>("idle")
    const [sessionContextError, setSessionContextError] = useState<string | null>(
        null,
    )
    const [sessionContextMetadata, setSessionContextMetadata] =
        useState<SessionContextMetadata | null>(null)
    const [pendingPersistEnabled, setPendingPersistEnabled] = useState(false)
    const [isPersistTogglePending, setIsPersistTogglePending] = useState(false)
    const [isPersistActionPending, setIsPersistActionPending] = useState(false)

    const sessionCreationTimerRef =
        useRef<ReturnType<typeof setTimeout> | null>(null)

    const sessionUpdatedFormatter = useMemo(
        () =>
            new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "2-digit",
                year: "numeric",
                hour: "2-digit",
                minute: "2-digit",
            }),
        [],
    )

    const clearConversation = useCallback(() => {
        setMessagesRef.current?.(() => [])
    }, [setMessagesRef])

    const fetchSessions = useCallback(async () => {
        try {
            const response = await fetch("/api/sessions", {cache: "no-store"})
            if (!response.ok) {
                throw new Error("failed_to_fetch_sessions")
            }
            const data = (await response.json()) as { sessions?: SessionSummary[] }
            const ordered = (data.sessions ?? []).slice().sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt),
            )
            setSessions(ordered)
        } catch (error) {
            console.error("Failed to load sessions", error)
        }
    }, [])

    useEffect(() => {
        void fetchSessions()
    }, [fetchSessions])

    useEffect(() => {
        return () => {
            if (sessionCreationTimerRef.current) {
                clearTimeout(sessionCreationTimerRef.current)
                sessionCreationTimerRef.current = null
            }
        }
    }, [])

    const sessionOptions = useMemo<SearchableSelectOption[]>(() => {
        return [
            {
                value: NEW_SESSION_OPTION,
                label: "Create new session",
                description: "Start from a Bitbucket project and branch",
                searchText: "create new session start",
            },
            ...sessions.map((session) => {
                const updatedAt = new Date(session.updatedAt)
                const formattedLabel = Number.isNaN(updatedAt.getTime())
                    ? session.label
                    : `${session.label} · ${sessionUpdatedFormatter.format(updatedAt)}`

                return {
                    value: session.id,
                    label: formattedLabel,
                    description: `${session.project.name} · ${session.branch.name}`,
                    searchText: [
                        session.label,
                        session.project.name,
                        session.project.key,
                        session.workspace.name,
                        session.workspace.slug,
                        session.repository.name,
                        session.repository.slug,
                        session.branch.name,
                    ]
                        .filter(Boolean)
                        .join(" "),
                }
            }),
        ]
    }, [sessions, sessionUpdatedFormatter])

    const applySessionContext = useCallback(
        (session: SessionDetails) => {
            const contextPayload = buildSessionContextPayload(
                session,
                generateMessageId(),
            )
            setMessagesRef.current?.(() => [contextPayload.message])
            setSessionContextMetadata(contextPayload.metadata)
            setSessionContextError(null)
            setSessionContextState(contextPayload.state)
            setActiveSession(session)

            setSelectedProject({
                uuid: session.project.uuid,
                key: session.project.key,
                name: session.project.name,
                workspace: {
                    slug: session.workspace.slug ?? undefined,
                    name: session.workspace.name ?? undefined,
                    uuid: session.workspace.uuid ?? undefined,
                },
            })

            setSelectedBranch({
                id: `${session.repository.slug}:${session.branch.name}`,
                name: session.branch.name,
                repository: session.repository,
                isDefault: session.branch.isDefault,
            })

            if (session.branchAvailable === false) {
                setSessionContextState("error")
                setSessionContextError(
                    "The selected Bitbucket branch is no longer available. This session is read-only.",
                )
            }
        },
        [setMessagesRef],
    )

    const loadSessionDetails = useCallback(
        async (sessionId: string) => {
            try {
                const response = await fetch(`/api/sessions/${sessionId}`, {
                    cache: "no-store",
                })
                if (response.status === 404) {
                    setSessionContextState("error")
                    setSessionContextError("Session not found.")
                    setActiveSession(null)
                    return
                }
                if (!response.ok) {
                    throw new Error("failed_to_load_session")
                }
                const data = (await response.json()) as { session: SessionDetails }
                const detail = data.session

                setSessions((prev) => {
                    const summary = summarizeSession(detail)
                    const others = prev.filter((item) => item.id !== summary.id)
                    return [summary, ...others]
                })

                applySessionContext(detail)
            } catch (error) {
                console.error("Failed to load session details", error)
                setSessionContextState("error")
                setSessionContextError("Unable to load the selected session.")
                setActiveSession(null)
            }
        },
        [applySessionContext],
    )

    const createSession = useCallback(
        async (project: BitbucketProject, branch: BitbucketBranch) => {
            clearConversation()
            setSessionContextState("loading")
            setSessionContextError(null)
            setSessionContextMetadata(null)

            try {
                const response = await fetch("/api/sessions", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        project: {
                            uuid: project.uuid,
                            key: project.key,
                            name: project.name,
                            workspace: {
                                slug: project.workspace?.slug,
                                name: project.workspace?.name,
                                uuid: project.workspace?.uuid,
                            },
                        },
                        branch: {
                            name: branch.name,
                            isDefault: branch.isDefault ?? false,
                        },
                        repository: {
                            slug: branch.repository.slug,
                            name: branch.repository.name,
                        },
                        allowPersist: pendingPersistEnabled,
                    }),
                })

                if (response.status === 401) {
                    setSessionContextState("auth-required")
                    setSessionContextError("Log in to Bitbucket to create a session.")
                    setActiveSession(null)
                    return
                }

                if (!response.ok) {
                    throw new Error("failed_to_create_session")
                }

                const data = (await response.json()) as { session: SessionDetails }
                const detail = data.session

                setSessions((prev) => {
                    const summary = summarizeSession(detail)
                    const others = prev.filter((item) => item.id !== summary.id)
                    return [summary, ...others]
                })

                applySessionContext(detail)
                setSelectedSessionId(detail.id)
            } catch (error) {
                console.error("Failed to create session", error)
                setSessionContextState("error")
                setSessionContextError(
                    "Unable to create the session. Please try again.",
                )
                setActiveSession(null)
            } finally {
                sessionCreationTimerRef.current = null
            }
        },
        [applySessionContext, pendingPersistEnabled, clearConversation],
    )

    useEffect(() => {
        if (selectedSessionId === NEW_SESSION_OPTION) {
            setActiveSession(null)

            if (bitbucketStatus === "linked") {
                if (!selectedProject || !selectedBranch) {
                    setSessionContextState("idle")
                }
                setSessionContextError(null)
            } else if (
                bitbucketStatus === "disconnected" ||
                bitbucketStatus === "error"
            ) {
                setSessionContextState("auth-required")
                setSessionContextError("Log in to Bitbucket to create a session.")
            }

            setSessionContextMetadata(null)
            return
        }

        if (activeSession && activeSession.id === selectedSessionId) {
            return
        }

        setSessionContextState("loading")
        setSessionContextError(null)
        setSessionContextMetadata(null)
        clearConversation()

        void loadSessionDetails(selectedSessionId)
    }, [
        selectedSessionId,
        bitbucketStatus,
        activeSession,
        selectedProject,
        selectedBranch,
        clearConversation,
        loadSessionDetails,
    ])

    useEffect(() => {
        if (selectedSessionId !== NEW_SESSION_OPTION) {
            if (sessionCreationTimerRef.current) {
                clearTimeout(sessionCreationTimerRef.current)
                sessionCreationTimerRef.current = null
            }
            return
        }

        if (bitbucketStatus !== "linked") {
            if (!sessionCreationTimerRef.current) {
                setSessionContextState("auth-required")
                setSessionContextError("Log in to Bitbucket to create a session.")
                setSessionContextMetadata(null)
            }
            return
        }

        if (!selectedProject || !selectedBranch) {
            if (!sessionCreationTimerRef.current) {
                setSessionContextState("idle")
                setSessionContextError(null)
                setSessionContextMetadata(null)
            }
            return
        }

        if (sessionCreationTimerRef.current) {
            clearTimeout(sessionCreationTimerRef.current)
        }

        setSessionContextState("loading")
        setSessionContextError(null)
        setSessionContextMetadata(null)

        sessionCreationTimerRef.current = setTimeout(() => {
            sessionCreationTimerRef.current = null
            void createSession(selectedProject, selectedBranch)
        }, 2000)

        return () => {
            if (sessionCreationTimerRef.current) {
                clearTimeout(sessionCreationTimerRef.current)
                sessionCreationTimerRef.current = null
            }
        }
    }, [
        selectedSessionId,
        selectedProject,
        selectedBranch,
        bitbucketStatus,
        createSession,
    ])

    const isNewSessionSelection = selectedSessionId === NEW_SESSION_OPTION

    const persistCheckboxChecked = isNewSessionSelection
        ? pendingPersistEnabled
        : activeSession?.persist.allowWrites ?? false
    const persistCheckboxDisabled = isNewSessionSelection
        ? !selectedProject || !selectedBranch
        : !activeSession || isPersistTogglePending

    const persistButtonState: PersistButtonState = activeSession?.persist.allowWrites
        ? activeSession.persist.pr
            ? activeSession.persist.hasPendingChanges
                ? "update"
                : "review"
            : "create"
        : "create"

    const persistActionDisabled =
        !activeSession ||
        !activeSession.persist.allowWrites ||
        isPersistActionPending ||
        (persistButtonState === "review"
            ? !activeSession.persist.pr?.url
            : !activeSession.persist.hasPendingChanges ||
            activeSession.persist.draftCount === 0)

    const persistHelperText = activeSession
        ? activeSession.persist.allowWrites
            ? activeSession.persist.pr
                ? activeSession.persist.hasPendingChanges
                    ? "New persistency layer changes are ready to update the pull request."
                    : "The pull request is up to date with the latest persistency layer changes."
                : activeSession.persist.draftCount > 0
                    ? `${activeSession.persist.draftCount} persistency layer draft${
                        activeSession.persist.draftCount === 1 ? "" : "s"
                    } ready to create a PR.`
                    : "Generate persistency layer content with the assistant to create a pull request."
            : "Enable persistence to allow the assistant to prepare persistency layer updates."
        : null

    const handleSessionSelect = useCallback(
        (value: SessionSelectValue) => {
            if (value === NEW_SESSION_OPTION) {
                setSelectedSessionId(NEW_SESSION_OPTION)
                setSelectedProject(null)
                setSelectedBranch(null)
                setActiveSession(null)
                clearConversation()
                setSessionContextMetadata(null)
                setSessionContextError(null)
                setSessionContextState(
                    bitbucketStatus === "linked" ? "idle" : "auth-required",
                )
                return
            }

            setSelectedSessionId(value)
        },
        [bitbucketStatus, clearConversation],
    )

    const handlePersistCheckboxChange = useCallback(
        async (checked: boolean) => {
            if (selectedSessionId === NEW_SESSION_OPTION) {
                setPendingPersistEnabled(checked)
                return
            }

            if (!activeSession || isPersistTogglePending) {
                return
            }

            setIsPersistTogglePending(true)
            try {
                const response = await fetch(`/api/sessions/${activeSession.id}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({allowPersist: checked}),
                })

                if (!response.ok) {
                    throw new Error("failed_to_update_persist")
                }

                await loadSessionDetails(activeSession.id)
            } catch (error) {
                console.error("Failed to update persistence preference", error)
                toast.error(
                    "Unable to update the persistency layer setting. Please try again.",
                )
            } finally {
                setIsPersistTogglePending(false)
            }
        },
        [
            selectedSessionId,
            activeSession,
            isPersistTogglePending,
            loadSessionDetails,
        ],
    )

    const handlePersistAction = useCallback(async () => {
        if (
            selectedSessionId === NEW_SESSION_OPTION ||
            !activeSession ||
            !activeSession.persist.allowWrites
        ) {
            return
        }

        const hasPending = activeSession.persist.hasPendingChanges
        const existingPr = activeSession.persist.pr

        if (!hasPending && existingPr?.url) {
            window.open(existingPr.url, "_blank", "noreferrer")
            return
        }

        if (!hasPending) {
            toast.error("No persistency layer changes are pending for this session.")
            return
        }

        setIsPersistActionPending(true)
        try {
            const response = await fetch(
                `/api/sessions/${activeSession.id}/persist`,
                {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({}),
                },
            )

            if (!response.ok) {
                const error = (await response.json().catch(() => null)) as {
                    error?: string
                } | null
                throw new Error(error?.error ?? "persist_failed")
            }

            await loadSessionDetails(activeSession.id)

            if (existingPr) {
                toast.success(
                    "Updated the pull request with the latest persistency layer changes.",
                )
            } else {
                toast.success(
                    "Created a pull request for the persistency layer changes.",
                )
            }
        } catch (error) {
            console.error("Failed to sync persistency layer changes", error)
            toast.error(
                "Unable to sync persistency layer changes with Bitbucket. Please try again.",
            )
        } finally {
            setIsPersistActionPending(false)
        }
    }, [activeSession, selectedSessionId, loadSessionDetails])

    return {
        activeSession,
        bitbucketStatus,
        fetchSessions,
        handlePersistAction,
        handlePersistCheckboxChange,
        handleSessionSelect,
        isNewSessionSelection,
        persistActionDisabled,
        persistButtonState,
        persistCheckboxChecked,
        persistCheckboxDisabled,
        persistHelperText,
        selectedBranch,
        selectedProject,
        sessionContextError,
        sessionContextMetadata,
        sessionContextState,
        sessionOptions,
        setBitbucketStatus,
        setSelectedBranch,
        setSelectedProject,
        selectedSessionId,
        loadSessionDetails,
    }
}
