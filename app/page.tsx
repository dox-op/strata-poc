"use client"

import {Button} from "@/components/ui/button"
import {Checkbox} from "@/components/ui/checkbox"
import {type UIMessage, useChat} from "@ai-sdk/react"
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react"
import {AnimatePresence, motion} from "framer-motion"
import {toast} from "sonner"
import {getToolName, isToolUIPart} from "ai"

import ProjectOverview from "@/components/project-overview"
import {SessionSelection} from "@/components/chat/session-selection"
import {SessionContextStatus} from "@/components/chat/session-context-status"
import {AssistantMessage} from "@/components/chat/assistant-message"
import {LoadingIndicator} from "@/components/chat/loading-indicator"
import {useSessionManager} from "@/hooks/use-session-manager"

export default function Chat() {
    const [input, setInput] = useState("")
    const [isExpanded, setIsExpanded] = useState(false)
    const setMessagesRef = useRef<
        | ((
        value: UIMessage[] | ((messages: UIMessage[]) => UIMessage[]),
    ) => void)
        | null
    >(null)
    const promptInputRef = useRef<HTMLDivElement | null>(null)
    const lastAssistantMessageIdRef = useRef<string | null>(null)
    const [globalWriteMode, setGlobalWriteMode] = useState(false)
    const [writeModeSettings, setWriteModeSettings] = useState<Record<string, boolean>>({})
    const [writeModeHistory, setWriteModeHistory] = useState<Record<string, boolean>>({})

    const {
        activeSession,
        fetchSessions,
        handlePersistAction,
        handleSessionSelect,
        isNewSessionSelection,
        persistActionDisabled,
        persistButtonState,
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
        refreshPersistState,
        isSessionCreationPending,
    } = useSessionManager({setMessagesRef})

    const {messages, status, sendMessage, setMessages} = useChat({
        id: activeSession?.id,
        onToolCall({toolCall}) {
            console.log("Tool call:", toolCall)
        },
        onError: () => {
            toast.error("You've been rate limited, please try again later!")
        },
    })
    setMessagesRef.current = setMessages

    useEffect(() => {
        if (messages.length > 0) {
            setIsExpanded(true)
        }
    }, [messages])

    useEffect(() => {
        if (activeSession) {
            setInput("")
        }
    }, [activeSession])

    useEffect(() => {
        if (!activeSession) {
            return
        }

        setWriteModeSettings((prev) => {
            if (prev[activeSession.id] !== undefined) {
                return prev
            }
            return {
                ...prev,
                [activeSession.id]: globalWriteMode,
            }
        })

        setWriteModeHistory((prev) => {
            if (prev[activeSession.id] !== undefined) {
                return prev
            }
            return {
                ...prev,
                [activeSession.id]: false,
            }
        })
        if (
            activeSession.persist.hasPendingChanges ||
            activeSession.persist.draftCount > 0 ||
            activeSession.persist.pr
        ) {
            setWriteModeHistory((prev) => ({
                ...prev,
                [activeSession.id]: true,
            }))
        }
    }, [activeSession, globalWriteMode])

    useEffect(() => {
        if (!activeSession) {
            lastAssistantMessageIdRef.current = null
            return
        }

        const lastAssistant = [...messages]
            .reverse()
            .find((message) => message.role === "assistant")

        if (!lastAssistant) {
            return
        }

        if (lastAssistantMessageIdRef.current === lastAssistant.id) {
            return
        }

        lastAssistantMessageIdRef.current = lastAssistant.id
        void refreshPersistState(activeSession.id)
    }, [messages, activeSession, refreshPersistState])

    const currentToolCall = useMemo(() => {
        const lastAssistant = [...messages]
            .reverse()
            .find((message) => message.role === "assistant")

        if (!lastAssistant) {
            return undefined
        }

        const pendingPart = [...lastAssistant.parts].reverse().find((part) => {
            if (part.type === "dynamic-tool") {
                return part.state !== "output-available" && part.state !== "output-error"
            }

            if (!isToolUIPart(part)) {
                return false
            }

            const toolPart = part as { state?: string }
            return (
                toolPart.state !== "output-available" &&
                toolPart.state !== "output-error"
            )
        })

        if (!pendingPart) {
            return undefined
        }

        if (pendingPart.type === "dynamic-tool") {
            return pendingPart.toolName
        }

        if (isToolUIPart(pendingPart)) {
            return getToolName(pendingPart)
        }

        return undefined
    }, [messages])

    const isAwaitingResponse =
        status === "submitted" || status === "streaming" || currentToolCall != null

    const [showLoading, setShowLoading] = useState(isAwaitingResponse)

    useEffect(() => {
        if (isAwaitingResponse) {
            setShowLoading(true)
            return
        }

        const timeout = setTimeout(() => setShowLoading(false), 120)
        return () => clearTimeout(timeout)
    }, [isAwaitingResponse])

    const canSend =
        activeSession != null &&
        sessionContextState !== "loading" &&
        sessionContextState !== "error" &&
        sessionContextState !== "auth-required"

    const isInputDisabled = !canSend
    const currentSessionId = activeSession?.id ?? null
    const currentWriteMode =
        currentSessionId != null
            ? writeModeSettings[currentSessionId] ?? globalWriteMode
            : globalWriteMode
    const sessionHasWriteHistory =
        currentSessionId != null
            ? Boolean(writeModeHistory[currentSessionId])
            : false
    const showPersistButton =
        !!activeSession &&
        (sessionHasWriteHistory ||
            activeSession.persist.hasPendingChanges ||
            activeSession.persist.draftCount > 0 ||
            Boolean(activeSession.persist.pr))
    const persistButtonLabel =
        persistButtonState === "review"
            ? "Review PR"
            : persistButtonState === "update"
                ? "Update PR"
                : "Create PR"

    const handleWriteModeToggle = (checked: boolean) => {
        if (currentSessionId) {
            setWriteModeSettings((prev) => ({
                ...prev,
                [currentSessionId]: checked,
            }))
        } else {
            setGlobalWriteMode(checked)
        }
    }

    const submitPrompt = useCallback(() => {
        if (!canSend || !activeSession) {
            return
        }
        if (input.trim().length === 0) {
            return
        }

        void sendMessage(
            {text: input},
            {body: {sessionId: activeSession.id, writeMode: currentWriteMode}},
        )

        if (currentWriteMode) {
            setWriteModeHistory((prev) => ({
                ...prev,
                [activeSession.id]: true,
            }))
        }

        setInput("")
        if (promptInputRef.current) {
            promptInputRef.current.innerText = ""
        }
    }, [activeSession, canSend, currentWriteMode, input, sendMessage])

    const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault()
        submitPrompt()
    }

    const conversationMessages = useMemo(
        () =>
            messages.filter(
                (message) =>
                    message.role === "user" || message.role === "assistant",
            ),
        [messages],
    )

    return (
        <div
            className="flex min-h-screen w-full items-start justify-center bg-neutral-100 px-4 py-6 dark:bg-neutral-900">
            <div className="grid w-full max-w-6xl grid-cols-1 gap-6 lg:grid-cols-2">
                <div className="flex flex-col items-center">
                    <ProjectOverview/>
                    <div className="mt-4 flex w-full flex-col gap-3 rounded-lg bg-neutral-200 p-4 dark:bg-neutral-800">
                        <SessionSelection
                            activeSession={activeSession}
                            isNewSessionSelection={isNewSessionSelection}
                            sessionCreationPending={isSessionCreationPending}
                            onBitbucketStatusChange={setBitbucketStatus}
                            onBranchChange={setSelectedBranch}
                            onProjectChange={setSelectedProject}
                            onReloadSessions={fetchSessions}
                            onSessionSelect={handleSessionSelect}
                            selectedBranch={selectedBranch}
                            selectedProject={selectedProject}
                            selectedSessionId={selectedSessionId}
                            sessionOptions={sessionOptions}
                        />

                        <SessionContextStatus
                            state={sessionContextState}
                            metadata={sessionContextMetadata}
                            error={sessionContextError}
                        />
                    </div>
                </div>

                <div
                    className="flex flex-col space-y-4 rounded-lg border border-neutral-200 bg-white/80 p-4 dark:border-neutral-700 dark:bg-neutral-900/60">
                    {showPersistButton && (
                        <div
                            className="flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-neutral-900">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
                                    Persistency layer PR
                                </p>
                                <Button
                                    size="sm"
                                    variant="outline"
                                    disabled={persistActionDisabled}
                                    onClick={handlePersistAction}
                                >
                                    {persistButtonLabel}
                                </Button>
                            </div>
                            {persistHelperText && (
                                <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                    {persistHelperText}
                                </p>
                            )}
                        </div>
                    )}

                    <motion.div
                        transition={{type: "spring"}}
                        className="flex max-h-[60vh] flex-col gap-4 overflow-y-auto rounded-lg border border-neutral-200 bg-white/70 p-3 dark:border-neutral-700 dark:bg-neutral-900/60"
                    >
                        <AnimatePresence>
                            {conversationMessages.length === 0 ? (
                                <p className="text-sm text-neutral-500 dark:text-neutral-400">
                                    Start chatting to see responses here.
                                </p>
                            ) : (
                                conversationMessages.map((message) =>
                                    message.role === "assistant" ? (
                                        <div key={message.id}>
                                            <p className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                                                Strata
                                            </p>
                                            <AssistantMessage message={message}/>
                                        </div>
                                    ) : (
                                        <div
                                            key={message.id}
                                            className="rounded-lg bg-neutral-100 p-3 text-sm text-neutral-800 dark:bg-neutral-800 dark:text-neutral-100"
                                        >
                                            {message.parts
                                                .filter((part) => part.type === "text")
                                                .map((part) => part?.text)
                                                .join(" ")}
                                        </div>
                                    ),
                                )
                            )}
                        </AnimatePresence>
                        {showLoading && (
                            <div className="border-t border-dashed border-neutral-300 pt-2">
                                <LoadingIndicator tool={currentToolCall ?? undefined}/>
                            </div>
                        )}
                    </motion.div>

                    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                        <div
                            className="relative rounded-lg border border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-900">
                            {input.length === 0 && (
                                <p className="pointer-events-none select-none text-sm text-neutral-400 dark:text-neutral-500 absolute left-3 top-3">
                                    Ask me anything...
                                </p>
                            )}
                            <div
                                ref={promptInputRef}
                                role="textbox"
                                aria-multiline="true"
                                contentEditable
                                suppressContentEditableWarning
                                className="max-h-60 min-h-[80px] overflow-y-auto whitespace-pre-wrap p-3 text-sm text-neutral-800 focus:outline-none dark:text-neutral-100"
                                onInput={(event) => {
                                    setInput(event.currentTarget.textContent ?? "")
                                }}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter" && !event.shiftKey) {
                                        event.preventDefault()
                                        submitPrompt()
                                    }
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <label className="flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
                                <Checkbox
                                    checked={currentWriteMode}
                                    onChange={(event) =>
                                        handleWriteModeToggle(event.target.checked)
                                    }
                                />
                                Write mode
                            </label>
                            <Button
                                type="submit"
                                size="sm"
                                disabled={isInputDisabled || input.trim().length === 0}
                            >
                                Send
                            </Button>
                        </div>
                    </form>
                </div>
            </div>
        </div>
    )
}
