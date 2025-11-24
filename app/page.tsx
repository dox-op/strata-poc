"use client"

import {Input} from "@/components/ui/input"
import {type UIMessage, useChat} from "@ai-sdk/react"
import React, {useEffect, useMemo, useRef, useState} from "react"
import {AnimatePresence, motion} from "framer-motion"
import {toast} from "sonner"
import {getToolName, isToolUIPart} from "ai"

import ProjectOverview from "@/components/project-overview"
import {cn} from "@/lib/utils"
import {SessionSelection} from "@/components/chat/session-selection"
import {PersistencyPanel} from "@/components/chat/persistency-panel"
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

    const {
        activeSession,
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
    } = useSessionManager({setMessagesRef})

    const {messages, status, sendMessage, setMessages} = useChat({
        id: activeSession?.id,
        body: activeSession ? {sessionId: activeSession.id} : undefined,
        onToolCall({toolCall}) {
            console.log("Tool call:", toolCall)
        },
        onError: () => {
            toast.error("You've been rate limited, please try again later!")
        },
    })
    setMessagesRef.current = setMessages

    const previousChatStatusRef = useRef(status)

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
        if (
            previousChatStatusRef.current === "streaming" &&
            status === "ready" &&
            activeSession
        ) {
            void loadSessionDetails(activeSession.id)
        }
        previousChatStatusRef.current = status
    }, [status, activeSession, loadSessionDetails])

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

    const persistHelperDisplay =
        persistButtonState === "review" && activeSession?.persist.pr?.url
            ? "Open the existing pull request to review the persistency layer changes."
            : persistHelperText

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!canSend) {
          return
      }
    if (input.trim() !== "") {
        sendMessage({text: input})
        setInput("")
    }
  }

  const userQuery: UIMessage | undefined = messages
    .filter((m) => m.role === "user")
      .slice(-1)[0]

  const lastAssistantMessage: UIMessage | undefined = messages
    .filter((m) => m.role !== "user")
      .slice(-1)[0]

  return (
    <div className="flex justify-center items-start sm:pt-16 min-h-screen w-full dark:bg-neutral-900 px-4 md:px-0 py-4">
      <div className="flex flex-col items-center w-full max-w-[500px]">
        <ProjectOverview />
        <motion.div
          animate={{
            minHeight: isExpanded ? 200 : 0,
            padding: isExpanded ? 12 : 0,
          }}
          transition={{
            type: "spring",
            bounce: 0.5,
          }}
          className={cn(
            "rounded-lg w-full ",
            isExpanded
              ? "bg-neutral-200 dark:bg-neutral-800"
              : "bg-transparent",
          )}
        >
          <div className="flex flex-col w-full justify-between gap-2">
              <SessionSelection
                  activeSession={activeSession}
                  isNewSessionSelection={isNewSessionSelection}
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

              <PersistencyPanel
                  checkboxChecked={persistCheckboxChecked}
                  checkboxDisabled={persistCheckboxDisabled}
                  showActions={!!activeSession && !isNewSessionSelection}
                  actionDisabled={persistActionDisabled}
                  buttonState={persistButtonState}
                  helperText={persistHelperDisplay}
                  onAction={handlePersistAction}
                  onCheckboxChange={handlePersistCheckboxChange}
              />

              <SessionContextStatus
                  state={sessionContextState}
                  metadata={sessionContextMetadata}
                  error={sessionContextError}
              />
          </div>
        </motion.div>

          <div className="mt-4 w-full space-y-3">
              <motion.div
                  transition={{
                      type: "spring",
                  }}
                  className="min-h-fit flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white/70 p-2 dark:border-neutral-700 dark:bg-neutral-900/60"
              >
                  <AnimatePresence>
                      {showLoading ? (
                          <div className="min-h-12">
                              <div className="dark:text-neutral-400 text-neutral-500 text-sm w-fit mb-1">
                                  {userQuery?.parts
                                      .filter((part) => part.type === "text")
                                      .map((part) => part?.text)
                                      .join(" ")}
                              </div>
                              <LoadingIndicator tool={currentToolCall ?? undefined}/>
                          </div>
                      ) : lastAssistantMessage ? (
                          <div className="min-h-12">
                              <div className="dark:text-neutral-400 text-neutral-500 text-sm w-fit mb-1">
                                  {userQuery?.parts
                                      .filter((part) => part.type === "text")
                                      .map((part) => part?.text)
                                      .join(" ")}
                              </div>
                              <AssistantMessage message={lastAssistantMessage}/>
                          </div>
                      ) : (
                          <p className="text-sm text-neutral-500 dark:text-neutral-400">
                              Start chatting to see responses here.
                          </p>
                      )}
                  </AnimatePresence>
              </motion.div>

              <form onSubmit={handleSubmit} className="flex space-x-2">
                  <Input
                      className="bg-neutral-100 text-base w-full text-neutral-700 dark:bg-neutral-700 dark:placeholder:text-neutral-400 dark:text-neutral-300"
                      minLength={3}
                      required
                      value={input}
                      placeholder="Ask me anything..."
                      onChange={(e) => setInput(e.target.value)}
                      disabled={isInputDisabled}
                  />
              </form>
          </div>
      </div>
    </div>
  )
}
