"use client";

import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {Checkbox} from "@/components/ui/checkbox";
import {Button} from "@/components/ui/button";
import {SearchableSelect} from "@/components/ui/searchable-select";
import {UIMessage, useChat} from "@ai-sdk/react";
import React, {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {AnimatePresence, motion} from "framer-motion";
import ReactMarkdown, {Options} from "react-markdown";
import ProjectOverview from "@/components/project-overview";
import {LoadingIcon} from "@/components/icons";
import {cn} from "@/lib/utils";
import {toast} from "sonner";
import {getToolName, isToolUIPart} from "ai";
import {type BitbucketProject, BitbucketProjectPicker,} from "@/components/bitbucket-project-picker";
import {type BitbucketBranch, BitbucketBranchPicker,} from "@/components/bitbucket-branch-picker";

const NEW_SESSION_OPTION = "new" as const;

type SessionSelectValue = typeof NEW_SESSION_OPTION | string;

type BitbucketConnectionStatus =
    | "loading"
    | "linked"
    | "disconnected"
    | "error";

type SessionContextState =
    | "idle"
    | "loading"
    | "ready"
    | "missing"
    | "empty"
    | "error"
    | "auth-required";

type SessionContextFile = {
    path: string;
    content: string;
    truncated: boolean;
};

type SessionContextMetadata = {
    fileCount: number;
    truncated: boolean;
    folderExists: boolean;
    hasBootstrap: boolean;
};

type SessionPersistSummary = {
    allowWrites: boolean;
    hasPendingChanges: boolean;
    draftCount: number;
    pr: {
        id: string;
        url: string | null;
        branch: string | null;
        title: string | null;
        updatedAt: string | null;
    } | null;
};

type SessionPersistDraft = {
    path: string;
    content: string;
    summary: string | null;
    needsPersist: boolean;
    updatedAt: string;
};

type SessionSummary = {
    id: string;
    label: string;
    createdAt: string;
    updatedAt: string;
    project: {
        uuid: string;
        key: string;
        name: string;
    };
    workspace: {
        slug: string | null;
        name: string | null;
        uuid: string | null;
    };
    repository: {
        slug: string;
        name: string;
    };
    branch: {
        name: string;
        isDefault: boolean;
    };
    context: {
        folderExists: boolean;
        truncated: boolean;
        hasBootstrap: boolean;
        fileCount: number;
    };
    persist: SessionPersistSummary;
};

type SessionDetails = Omit<SessionSummary, "context"> & {
    context: {
        folderExists: boolean;
        truncated: boolean;
        hasBootstrap: boolean;
        files: SessionContextFile[];
    };
    branchAvailable: boolean | null;
    persist: SessionPersistSummary & {
        drafts: SessionPersistDraft[];
    };
};

export default function Chat() {
    const [sessions, setSessions] = useState<SessionSummary[]>([]);
    const [selectedSessionId, setSelectedSessionId] =
        useState<SessionSelectValue>(NEW_SESSION_OPTION);
    const [activeSession, setActiveSession] = useState<SessionDetails | null>(
        null,
    );

    const [selectedProject, setSelectedProject] =
        useState<BitbucketProject | null>(null);
    const [selectedBranch, setSelectedBranch] =
        useState<BitbucketBranch | null>(null);

    const [bitbucketStatus, setBitbucketStatus] =
        useState<BitbucketConnectionStatus>("loading");

    const [sessionContextState, setSessionContextState] =
        useState<SessionContextState>("idle");
    const [sessionContextError, setSessionContextError] = useState<string | null>(
        null,
    );
    const [sessionContextMetadata, setSessionContextMetadata] =
        useState<SessionContextMetadata | null>(null);

    const [input, setInput] = useState("");
    const [pendingPersistEnabled, setPendingPersistEnabled] =
        useState<boolean>(false);
    const [isPersistTogglePending, setIsPersistTogglePending] =
        useState<boolean>(false);
    const [isPersistActionPending, setIsPersistActionPending] =
        useState<boolean>(false);

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
    );

    const sessionCreationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

    const {messages, status, sendMessage, setMessages} = useChat({
        id: activeSession?.id,
        body: activeSession ? {sessionId: activeSession.id} : undefined,
        onToolCall({toolCall}) {
            console.log("Tool call:", toolCall);
        },
        onError: () => {
            toast.error("You've been rate limited, please try again later!");
        },
    });

    const previousChatStatusRef = useRef(status);

    const fetchSessions = useCallback(async () => {
        try {
            const response = await fetch("/api/sessions", {cache: "no-store"});
            if (!response.ok) {
                throw new Error("failed_to_fetch_sessions");
            }
            const data = (await response.json()) as { sessions?: SessionSummary[] };
            const ordered = (data.sessions ?? []).slice().sort((a, b) =>
                b.updatedAt.localeCompare(a.updatedAt),
            );
            setSessions(ordered);
        } catch (error) {
            console.error("Failed to load sessions", error);
        }
    }, []);

    useEffect(() => {
        void fetchSessions();
    }, [fetchSessions]);

  useEffect(() => {
      if (messages.length > 0) {
          setIsExpanded(true);
      }
  }, [messages]);

    useEffect(() => {
        return () => {
            if (sessionCreationTimerRef.current) {
                clearTimeout(sessionCreationTimerRef.current);
                sessionCreationTimerRef.current = null;
            }
        };
    }, []);

    const generateMessageId = useCallback(() => {
        if (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        ) {
            return crypto.randomUUID();
        }
        return Math.random().toString(36).slice(2);
    }, []);

    const clearConversation = useCallback(() => {
        setMessages(() => []);
    }, [setMessages]);

    const summarizeSession = useCallback(
        (session: SessionDetails): SessionSummary => ({
            id: session.id,
            label: session.label,
            createdAt: session.createdAt,
            updatedAt: session.updatedAt,
            project: session.project,
            workspace: session.workspace,
            repository: session.repository,
            branch: session.branch,
            context: {
                folderExists: session.context.folderExists,
                truncated: session.context.truncated,
                hasBootstrap: session.context.hasBootstrap,
                fileCount: session.context.files.length,
            },
            persist: {
                allowWrites: session.persist.allowWrites,
                hasPendingChanges: session.persist.hasPendingChanges,
                draftCount: session.persist.draftCount,
                pr: session.persist.pr,
            },
        }),
        [],
    );

    const sessionOptions = useMemo(
        () => [
            {
                value: NEW_SESSION_OPTION,
                label: "Create new session",
                description: "Start from a Bitbucket project and branch",
                searchText: "create new session start",
            },
            ...sessions.map((session) => {
                const updatedAt = new Date(session.updatedAt);
                const formattedLabel = Number.isNaN(updatedAt.getTime())
                    ? session.label
                    : `${session.label} · ${sessionUpdatedFormatter.format(updatedAt)}`;

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
                };
            }),
        ],
        [sessions, sessionUpdatedFormatter],
    );

    const applySessionContext = useCallback(
        (session: SessionDetails) => {
            const headerLines = [
                `Project: ${session.project.name}${
                    session.project.key ? ` (${session.project.key})` : ""
                }`,
                session.workspace.name
                    ? `Workspace: ${session.workspace.name}`
                    : session.workspace.slug
                        ? `Workspace: ${session.workspace.slug}`
                        : null,
                `Repository: ${session.repository.name} (${session.repository.slug})`,
                `Branch: ${session.branch.name}`,
            ].filter(Boolean);

            const files = session.context.files;
            let state: SessionContextState = "ready";
            const sections: string[] = [];

            if (!session.context.folderExists) {
                state = "missing";
                sections.push(
                    `${headerLines.join(
                        "\n",
                    )}\n\nThe persistency layer was not found for this branch. This session will start without repository context.`,
                );
            } else if (files.length === 0) {
                state = "empty";
                const bootstrapNote = session.context.hasBootstrap
                    ? ""
                    : "\nThe ai-bootstrap.mdc file was not found.";
                sections.push(
                    `${headerLines.join(
                        "\n",
                    )}\n\nThe persistency layer does not contain any .mdc files.${bootstrapNote}\nThis session will start without repository context.`,
                );
            } else {
                const notes: string[] = [];
                if (!session.context.hasBootstrap) {
                    notes.push(
                        "Warning: ai-bootstrap.mdc was not found. Results may be limited.",
                    );
                }
                if (session.context.truncated) {
                    notes.push(
                        "Additional files exist in the persistency layer but were omitted to respect the limit.",
                    );
                }

                const fileSections = files
                    .map((file) => {
                        const lines = [
                            `### ${file.path}`,
                            "```",
                            file.content,
                            "```",
                        ];
                        if (file.truncated) {
                            lines.push("_Note: File content truncated to 100kB for preview._");
                        }
                        return lines.join("\n");
                    })
                    .join("\n\n");

                sections.push(
                    [
                        headerLines.join("\n"),
                        `Loaded files: ${files.length}`,
                        notes.length > 0 ? notes.join(" ") : null,
                        "",
                        fileSections,
                    ]
                        .filter((part) => part != null && part.length > 0)
                        .join("\n\n"),
                );
            }

            const contextStatus =
                state === "ready" ? "ready" : state === "missing" ? "missing" : "empty";

            const message: UIMessage = {
                id: generateMessageId(),
                role: "user",
                parts: [
                    {
                        type: "text",
                        text: sections.join("\n\n"),
                    },
                ],
                metadata: {
                    source: "bitbucket-ai-folder",
                    autoGenerated: true,
                    contextStatus,
                    context: {
                        project: session.project,
                        workspace: session.workspace,
                        repository: session.repository,
                        branch: {
                            name: session.branch.name,
                            isDefault: session.branch.isDefault,
                        },
                        files,
                        folderExists: session.context.folderExists,
                        truncated: session.context.truncated,
                        hasBootstrap: session.context.hasBootstrap,
                    },
                },
            };

            setMessages(() => [message]);

            setSessionContextMetadata({
                fileCount: files.length,
                truncated: session.context.truncated,
                folderExists: session.context.folderExists,
                hasBootstrap: session.context.hasBootstrap,
            });
            setSessionContextError(null);
            setSessionContextState(state);
            setActiveSession(session);

            setSelectedProject({
                uuid: session.project.uuid,
                key: session.project.key,
                name: session.project.name,
                workspace: {
                    slug: session.workspace.slug ?? undefined,
                    name: session.workspace.name ?? undefined,
                    uuid: session.workspace.uuid ?? undefined,
                },
            });

            setSelectedBranch({
                id: `${session.repository.slug}:${session.branch.name}`,
                name: session.branch.name,
                repository: session.repository,
                isDefault: session.branch.isDefault,
            });

            if (session.branchAvailable === false) {
                setSessionContextState("error");
                setSessionContextError(
                    "The selected Bitbucket branch is no longer available. This session is read-only.",
                );
            }
        },
        [generateMessageId, setMessages],
    );

    const loadSessionDetails = useCallback(
        async (sessionId: string) => {
            try {
                const response = await fetch(`/api/sessions/${sessionId}`, {
                    cache: "no-store",
                });
                if (response.status === 404) {
                    setSessionContextState("error");
                    setSessionContextError("Session not found.");
                    setActiveSession(null);
                    return;
                }
                if (!response.ok) {
                    throw new Error("failed_to_load_session");
                }
                const data = (await response.json()) as { session: SessionDetails };
                const detail = data.session;

                setSessions((prev) => {
                    const summary = summarizeSession(detail);
                    const others = prev.filter((item) => item.id !== summary.id);
                    return [summary, ...others];
                });

                applySessionContext(detail);
            } catch (error) {
                console.error("Failed to load session details", error);
                setSessionContextState("error");
                setSessionContextError("Unable to load the selected session.");
                setActiveSession(null);
            }
        },
        [applySessionContext, summarizeSession],
    );

    useEffect(() => {
        if (
            previousChatStatusRef.current === "streaming" &&
            status === "ready" &&
            activeSession
        ) {
            void loadSessionDetails(activeSession.id);
        }
        previousChatStatusRef.current = status;
    }, [status, activeSession, loadSessionDetails]);

    const createSession = useCallback(
        async (project: BitbucketProject, branch: BitbucketBranch) => {
            clearConversation();
            setSessionContextState("loading");
            setSessionContextError(null);
            setSessionContextMetadata(null);

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
            });

                if (response.status === 401) {
                    setSessionContextState("auth-required");
                    setSessionContextError("Log in to Bitbucket to create a session.");
                    setActiveSession(null);
                    return;
                }

                if (!response.ok) {
                    throw new Error("failed_to_create_session");
                }

                const data = (await response.json()) as { session: SessionDetails };
                const detail = data.session;

                setSessions((prev) => {
                    const summary = summarizeSession(detail);
                    const others = prev.filter((item) => item.id !== summary.id);
                    return [summary, ...others];
                });

                applySessionContext(detail);
                setSelectedSessionId(detail.id);
            } catch (error) {
                console.error("Failed to create session", error);
                setSessionContextState("error");
                setSessionContextError(
                    "Unable to create the session. Please try again.",
                );
                setActiveSession(null);
            } finally {
                sessionCreationTimerRef.current = null;
            }
        },
        [
            applySessionContext,
            summarizeSession,
            clearConversation,
            pendingPersistEnabled,
        ],
    );

    useEffect(() => {
        if (selectedSessionId === NEW_SESSION_OPTION) {
            setActiveSession(null);

            if (bitbucketStatus === "linked") {
                if (!selectedProject || !selectedBranch) {
                    setSessionContextState("idle");
                }
                setSessionContextError(null);
            } else if (
                bitbucketStatus === "disconnected" ||
                bitbucketStatus === "error"
            ) {
                setSessionContextState("auth-required");
                setSessionContextError("Log in to Bitbucket to create a session.");
            }

            setSessionContextMetadata(null);
            return;
        }

        if (activeSession && activeSession.id === selectedSessionId) {
            return;
        }

        setSessionContextState("loading");
        setSessionContextError(null);
        setSessionContextMetadata(null);
        clearConversation();

        void loadSessionDetails(selectedSessionId);
    }, [
        selectedSessionId,
        bitbucketStatus,
        activeSession,
        selectedProject,
        selectedBranch,
        clearConversation,
        loadSessionDetails,
    ]);

    useEffect(() => {
        if (selectedSessionId !== NEW_SESSION_OPTION) {
            if (sessionCreationTimerRef.current) {
                clearTimeout(sessionCreationTimerRef.current);
                sessionCreationTimerRef.current = null;
            }
            return;
        }

        if (bitbucketStatus !== "linked") {
            if (!sessionCreationTimerRef.current) {
                setSessionContextState("auth-required");
                setSessionContextError("Log in to Bitbucket to create a session.");
                setSessionContextMetadata(null);
            }
            return;
        }

        if (!selectedProject || !selectedBranch) {
            if (!sessionCreationTimerRef.current) {
                setSessionContextState("idle");
                setSessionContextError(null);
                setSessionContextMetadata(null);
            }
            return;
        }

        if (sessionCreationTimerRef.current) {
            clearTimeout(sessionCreationTimerRef.current);
        }

        setSessionContextState("loading");
        setSessionContextError(null);
        setSessionContextMetadata(null);

        sessionCreationTimerRef.current = setTimeout(() => {
            sessionCreationTimerRef.current = null;
            void createSession(selectedProject, selectedBranch);
        }, 2000);

        return () => {
            if (sessionCreationTimerRef.current) {
                clearTimeout(sessionCreationTimerRef.current);
                sessionCreationTimerRef.current = null;
            }
        };
    }, [
        selectedSessionId,
        selectedProject,
        selectedBranch,
        bitbucketStatus,
        createSession,
    ]);

    useEffect(() => {
        if (activeSession) {
            setInput("");
        }
    }, [activeSession]);

    const currentToolCall = useMemo(() => {
        const lastAssistant = [...messages]
            .reverse()
            .find((message) => message.role === "assistant");

        if (!lastAssistant) {
            return undefined;
        }

        const pendingPart = [...lastAssistant.parts].reverse().find((part) => {
            if (part.type === "dynamic-tool") {
                return (
                    part.state !== "output-available" && part.state !== "output-error"
                );
            }

            if (!isToolUIPart(part)) {
                return false;
            }

            const toolPart = part as { state?: string };
            return (
                toolPart.state !== "output-available" &&
                toolPart.state !== "output-error"
            );
        });

        if (!pendingPart) {
            return undefined;
        }

        if (pendingPart.type === "dynamic-tool") {
            return pendingPart.toolName;
        }

        if (isToolUIPart(pendingPart)) {
            return getToolName(pendingPart);
        }

        return undefined;
    }, [messages]);

    const isAwaitingResponse =
        status === "submitted" || status === "streaming" || currentToolCall != null;

    const [showLoading, setShowLoading] = useState(isAwaitingResponse);

    useEffect(() => {
        if (isAwaitingResponse) {
            setShowLoading(true);
            return;
        }

        const timeout = setTimeout(() => setShowLoading(false), 120);
        return () => clearTimeout(timeout);
    }, [isAwaitingResponse]);

    const canSend =
        activeSession != null &&
        sessionContextState !== "loading" &&
        sessionContextState !== "error" &&
        sessionContextState !== "auth-required";

    const isInputDisabled = !canSend;

    const isNewSessionSelection = selectedSessionId === NEW_SESSION_OPTION;
    const persistCheckboxChecked = isNewSessionSelection
        ? pendingPersistEnabled
        : activeSession?.persist.allowWrites ?? false;
    const persistCheckboxDisabled = isNewSessionSelection
        ? !selectedProject || !selectedBranch
        : !activeSession || isPersistTogglePending;

    const persistButtonState: "create" | "review" | "update" =
        activeSession?.persist.allowWrites
            ? activeSession.persist.pr
                ? activeSession.persist.hasPendingChanges
                    ? "update"
                    : "review"
                : "create"
            : "create";

    const persistActionDisabled =
        !activeSession ||
        !activeSession.persist.allowWrites ||
        isPersistActionPending ||
        (persistButtonState === "review"
            ? !activeSession.persist.pr?.url
            : !activeSession.persist.hasPendingChanges ||
              activeSession.persist.draftCount === 0);

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
        : null;

    const handleSessionSelect = (value: SessionSelectValue) => {
        if (value === NEW_SESSION_OPTION) {
            setSelectedSessionId(NEW_SESSION_OPTION);
            setSelectedProject(null);
            setSelectedBranch(null);
            setActiveSession(null);
            clearConversation();
            setSessionContextMetadata(null);
            setSessionContextError(null);
            setSessionContextState(
                bitbucketStatus === "linked" ? "idle" : "auth-required",
            );
            return;
        }

        setSelectedSessionId(value);
    };

    const handlePersistCheckboxChange = useCallback(
        async (checked: boolean) => {
            if (selectedSessionId === NEW_SESSION_OPTION) {
                setPendingPersistEnabled(checked);
                return;
            }

            if (!activeSession || isPersistTogglePending) {
                return;
            }

            setIsPersistTogglePending(true);
            try {
                const response = await fetch(`/api/sessions/${activeSession.id}`, {
                    method: "PATCH",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({allowPersist: checked}),
                });

                if (!response.ok) {
                    throw new Error("failed_to_update_persist");
                }

                await loadSessionDetails(activeSession.id);
            } catch (error) {
                console.error("Failed to update persistence preference", error);
                toast.error(
                    "Unable to update the persistency layer setting. Please try again.",
                );
            } finally {
                setIsPersistTogglePending(false);
            }
        },
        [
            selectedSessionId,
            activeSession,
            isPersistTogglePending,
            loadSessionDetails,
        ],
    );

    const handlePersistAction = useCallback(async () => {
        if (
            selectedSessionId === NEW_SESSION_OPTION ||
            !activeSession ||
            !activeSession.persist.allowWrites
        ) {
            return;
        }

        const hasPending = activeSession.persist.hasPendingChanges;
        const existingPr = activeSession.persist.pr;

        if (!hasPending && existingPr?.url) {
            window.open(existingPr.url, "_blank", "noreferrer");
            return;
        }

        if (!hasPending) {
            toast.error("No persistency layer changes are pending for this session.");
            return;
        }

        setIsPersistActionPending(true);
        try {
            const response = await fetch(
                `/api/sessions/${activeSession.id}/persist`,
                {
                    method: "POST",
                    headers: {"Content-Type": "application/json"},
                    body: JSON.stringify({}),
                },
            );

            if (!response.ok) {
                const error = (await response.json().catch(() => null)) as {
                    error?: string;
                } | null;
                throw new Error(error?.error ?? "persist_failed");
            }

            await loadSessionDetails(activeSession.id);

            if (existingPr) {
                toast.success("Updated the pull request with the latest persistency layer changes.");
            } else {
                toast.success("Created a pull request for the persistency layer changes.");
            }
        } catch (error) {
            console.error("Failed to sync persistency layer changes", error);
            toast.error(
                "Unable to sync persistency layer changes with Bitbucket. Please try again.",
            );
        } finally {
            setIsPersistActionPending(false);
        }
    }, [activeSession, selectedSessionId, loadSessionDetails]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
      if (!canSend) {
          return;
      }
    if (input.trim() !== "") {
      sendMessage({ text: input });
      setInput("");
    }
  };

  const userQuery: UIMessage | undefined = messages
    .filter((m) => m.role === "user")
    .slice(-1)[0];

  const lastAssistantMessage: UIMessage | undefined = messages
    .filter((m) => m.role !== "user")
    .slice(-1)[0];

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
              <div className="flex flex-col gap-1">
                  <Label
                      htmlFor="session-picker"
                      className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                  >
                      Session
                  </Label>
              <SearchableSelect
                id="session-picker"
                value={selectedSessionId}
                onChange={(nextValue) =>
                  handleSessionSelect(nextValue as SessionSelectValue)
                }
                options={sessionOptions}
                placeholder="Choose a session"
                searchPlaceholder="Search sessions..."
                emptyMessage="No sessions found."
                onReload={() => fetchSessions()}
              />
              </div>

              {selectedSessionId === NEW_SESSION_OPTION ? (
                  <>
                      <BitbucketProjectPicker
                          value={selectedProject?.uuid ?? null}
                          onChange={setSelectedProject}
                          onStatusChange={setBitbucketStatus}
                      />
                      <BitbucketBranchPicker
                          project={selectedProject}
                          value={selectedBranch?.id ?? null}
                          onChange={setSelectedBranch}
                      />
                  </>
              ) : (
                  <>
                      <div className="flex flex-col gap-1">
                          <Label
                              htmlFor="session-project"
                              className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                          >
                              Project
                          </Label>
                          <select
                              id="session-project"
                              disabled
                              className="w-full rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                          >
                              <option>
                                  {activeSession
                                      ? `${activeSession.project.name}${
                                          activeSession.project.key
                                              ? ` (${activeSession.project.key})`
                                              : ""
                                      }`
                                      : "Loading project..."}
                              </option>
                          </select>
                      </div>
                      <div className="flex flex-col gap-1">
                          <Label
                              htmlFor="session-branch"
                              className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                          >
                              Branch
                          </Label>
                          <select
                              id="session-branch"
                              disabled
                              className="w-full rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                          >
                              <option>
                                  {activeSession
                                      ? `${activeSession.repository.name} · ${activeSession.branch.name}`
                                      : "Loading branch..."}
                              </option>
                          </select>
                      </div>
                  </>
              )}

              <div className="rounded-md border border-neutral-200 bg-white/60 p-3 dark:border-neutral-700 dark:bg-neutral-900/60">
                  <div className="flex items-center justify-between gap-4">
                      <div className="flex flex-col">
                          <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                              Persistency layer writes
                          </span>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">
                              Allow the assistant to prepare updates for the persistency layer.
                          </span>
                      </div>
                      <Checkbox
                          disabled={persistCheckboxDisabled}
                          checked={persistCheckboxChecked}
                          onChange={(event) =>
                              handlePersistCheckboxChange(event.target.checked)
                          }
                      />
                  </div>

                  {activeSession && !isNewSessionSelection && (
                      <div className="mt-3 flex flex-col gap-2">
                          <Button
                              size="sm"
                              disabled={persistActionDisabled}
                              onClick={handlePersistAction}
                              variant="outline"
                          >
                              {persistButtonState === "review"
                                  ? "Review PR"
                                  : persistButtonState === "update"
                                      ? "Update PR"
                                      : "Create PR"}
                          </Button>
                          {persistHelperText && (
                              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                                  {persistButtonState === "review" &&
                                  activeSession.persist.pr?.url
                                      ? "Open the existing pull request to review the persistency layer changes."
                                      : persistHelperText}
                              </p>
                          )}
                      </div>
                  )}
              </div>

              {sessionContextState === "loading" && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Preparing session context…
                  </p>
              )}
              {sessionContextState === "ready" && sessionContextMetadata && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Loaded persistency layer ({sessionContextMetadata.fileCount}
                      {sessionContextMetadata.truncated ? "+" : ""} files).
                  </p>
              )}
              {sessionContextState === "missing" && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Persistency layer not found. You can still continue with this session.
                  </p>
              )}
              {sessionContextState === "empty" && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      The persistency layer does not contain usable .mdc files. Session
                      context is blank.
                  </p>
              )}
              {sessionContextState === "auth-required" && (
                  <p className="text-xs text-neutral-500 dark:text-neutral-400">
                      Log in to Bitbucket to create a new session.
                  </p>
              )}
              {sessionContextState === "error" && sessionContextError && (
                  <p className="text-xs text-red-500">{sessionContextError}</p>
              )}

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
            <motion.div
              transition={{
                type: "spring",
              }}
              className="min-h-fit flex flex-col gap-2"
            >
              <AnimatePresence>
                {showLoading ? (
                  <div className="px-2 min-h-12">
                    <div className="dark:text-neutral-400 text-neutral-500 text-sm w-fit mb-1">
                      {userQuery?.parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join(" ")}
                    </div>
                    <Loading tool={currentToolCall ?? undefined} />
                  </div>
                ) : lastAssistantMessage ? (
                  <div className="px-2 min-h-12">
                    <div className="dark:text-neutral-400 text-neutral-500 text-sm w-fit mb-1">
                      {userQuery?.parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join(" ")}
                    </div>
                    <AssistantMessage message={lastAssistantMessage} />
                  </div>
                ) : null}
              </AnimatePresence>
            </motion.div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

const AssistantMessage = ({ message }: { message: UIMessage | undefined }) => {
  if (message === undefined) return "HELLO";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={message.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="whitespace-pre-wrap font-mono anti text-sm text-neutral-800 dark:text-neutral-200 overflow-hidden"
        id="markdown"
      >
        <MemoizedReactMarkdown
          className={"max-h-72 overflow-y-scroll no-scrollbar-gutter"}
        >
          {message.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(" ")}
        </MemoizedReactMarkdown>
      </motion.div>
    </AnimatePresence>
  );
};

const Loading = ({ tool }: { tool?: string }) => {
  const toolName =
    tool === "getInformation"
      ? "Getting information"
      : tool === "addResource"
        ? "Adding information"
        : "Thinking";

  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ type: "spring" }}
        className="overflow-hidden flex justify-start items-center"
      >
        <div className="flex flex-row gap-2 items-center">
          <div className="animate-spin dark:text-neutral-400 text-neutral-500">
            <LoadingIcon />
          </div>
          <div className="text-neutral-500 dark:text-neutral-400 text-sm">
            {toolName}...
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

const MemoizedReactMarkdown: React.FC<Options> = React.memo(
  ReactMarkdown,
  (prevProps, nextProps) =>
    prevProps.children === nextProps.children &&
    prevProps.className === nextProps.className,
);
