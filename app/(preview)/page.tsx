"use client";

import {Input} from "@/components/ui/input";
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

export default function Chat() {
    const {messages, status, sendMessage, setMessages} = useChat({
    onToolCall({ toolCall }) {
      console.log("Tool call:", toolCall);
    },
    onError: () => {
      toast.error("You've been rate limited, please try again later!");
    },
  });

  const [input, setInput] = useState("");

    const [selectedProject, setSelectedProject] =
        useState<BitbucketProject | null>(null);
    const [selectedBranch, setSelectedBranch] =
        useState<BitbucketBranch | null>(null);
    const [branchContextState, setBranchContextState] = useState<
        "idle" | "loading" | "ready" | "missing" | "error"
    >("idle");
    const [branchContextError, setBranchContextError] = useState<string | null>(
        null,
    );
    const [branchContextMetadata, setBranchContextMetadata] = useState<{
        fileCount: number;
        truncated: boolean;
    } | null>(null);
    const branchContextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
        null,
    );
    const branchContextAbortControllerRef = useRef<AbortController | null>(null);
    const branchSelectionKeyRef = useRef<string | null>(null);

  const [isExpanded, setIsExpanded] = useState<boolean>(false);

    useEffect(() => {
        return () => {
            if (branchContextTimerRef.current) {
                clearTimeout(branchContextTimerRef.current);
                branchContextTimerRef.current = null;
            }
            branchContextAbortControllerRef.current?.abort();
            branchContextAbortControllerRef.current = null;
        };
    }, []);

  useEffect(() => {
    if (messages.length > 0) setIsExpanded(true);
  }, [messages]);

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

    useEffect(() => {
        setInput("");
    }, [selectedProject?.uuid, selectedBranch?.id]);

    const generateMessageId = useCallback(() => {
        if (
            typeof crypto !== "undefined" &&
            typeof crypto.randomUUID === "function"
        ) {
            return crypto.randomUUID();
        }
        return Math.random().toString(36).slice(2);
    }, []);

    const resetChatSession = useCallback(() => {
        setMessages(() => []);
    }, [setMessages]);

    const scheduleContextLoad = useCallback(() => {
        if (!selectedProject || !selectedBranch) {
            setBranchContextState("idle");
            setBranchContextError(null);
            setBranchContextMetadata(null);
            resetChatSession();
            return;
        }

        const workspace =
            selectedProject.workspace?.slug ?? selectedProject.workspace?.uuid ?? null;

        if (!workspace) {
            setBranchContextState("error");
            setBranchContextError(
                "Unable to determine workspace for the selected project.",
            );
            setBranchContextMetadata(null);
            resetChatSession();
            return;
        }

        const branchKey = `${selectedProject.uuid}:${selectedBranch.id}`;
        branchSelectionKeyRef.current = branchKey;
        setBranchContextState("loading");
        setBranchContextError(null);
        setBranchContextMetadata(null);
        resetChatSession();

        if (branchContextTimerRef.current) {
            clearTimeout(branchContextTimerRef.current);
            branchContextTimerRef.current = null;
        }

        branchContextAbortControllerRef.current?.abort();
        branchContextAbortControllerRef.current = null;

        branchContextTimerRef.current = setTimeout(() => {
            branchContextTimerRef.current = null;
            const controller = new AbortController();
            branchContextAbortControllerRef.current = controller;

            const params = new URLSearchParams({
                workspace,
                repository: selectedBranch.repository.slug,
                branch: selectedBranch.name,
            });

            void (async () => {
                try {
                    const response = await fetch(
                        `/api/bitbucket/ai-folder?${params.toString()}`,
                        {
                            credentials: "include",
                            signal: controller.signal,
                        },
                    );

                    if (controller.signal.aborted) {
                        return;
                    }

                    if (response.status === 401) {
                        setBranchContextState("error");
                        setBranchContextError("Bitbucket session expired. Please reconnect.");
                        setBranchContextMetadata(null);
                        resetChatSession();
                        return;
                    }

                    if (!response.ok) {
                        throw new Error("failed_to_fetch_ai_folder");
                    }

                    const data = (await response.json()) as {
                        folderExists?: boolean;
                        files?: Array<{
                            path: string;
                            content: string;
                            truncated?: boolean;
                        }>;
                        truncated?: boolean;
                    };

                    if (
                        branchSelectionKeyRef.current !== branchKey ||
                        controller.signal.aborted
                    ) {
                        return;
                    }

                    const files = data.files ?? [];
                    const projectSnapshot = selectedProject;
                    const branchSnapshot = selectedBranch;

                    const headerLines = [
                        projectSnapshot
                            ? `Project: ${projectSnapshot.name}${
                                projectSnapshot.key ? ` (${projectSnapshot.key})` : ""
                            }`
                            : null,
                        projectSnapshot?.workspace?.name
                            ? `Workspace: ${projectSnapshot.workspace.name}`
                            : projectSnapshot?.workspace?.slug
                                ? `Workspace: ${projectSnapshot.workspace.slug}`
                                : null,
                        `Repository: ${branchSnapshot.repository.name} (${branchSnapshot.repository.slug})`,
                        `Branch: ${branchSnapshot.name}`,
                    ].filter(Boolean);

                    const sharedContextMetadata = {
                        workspace: {
                            slug: selectedProject.workspace?.slug,
                            name: selectedProject.workspace?.name,
                            uuid: selectedProject.workspace?.uuid,
                        },
                        project: {
                            uuid: selectedProject.uuid,
                            key: selectedProject.key,
                            name: selectedProject.name,
                        },
                        repository: {
                            name: selectedBranch.repository.name,
                            slug: selectedBranch.repository.slug,
                        },
                        branch: {
                            name: selectedBranch.name,
                            isDefault: selectedBranch.isDefault,
                        },
                    };

                    if (!data.folderExists) {
                        const messageText = `${headerLines.join("\n")}\n\nThe ai/ folder was not found in this branch.`;
                        const message: UIMessage = {
                            id: generateMessageId(),
                            role: "user",
                            parts: [
                                {
                                    type: "text",
                                    text: messageText,
                                },
                            ],
                            metadata: {
                                source: "bitbucket-ai-folder",
                                autoGenerated: true,
                                contextStatus: "missing",
                                context: {
                                    ...sharedContextMetadata,
                                    folderExists: false,
                                    files: [],
                                },
                            },
                        };
                        setMessages(() => [message]);
                        setBranchContextState("missing");
                        setBranchContextError(null);
                        setBranchContextMetadata(null);
                        return;
                    }

                    if (files.length === 0) {
                        const messageText = `${headerLines.join("\n")}\n\nThe ai/ folder is empty in this branch.`;
                        const message: UIMessage = {
                            id: generateMessageId(),
                            role: "user",
                            parts: [
                                {
                                    type: "text",
                                    text: messageText,
                                },
                            ],
                            metadata: {
                                source: "bitbucket-ai-folder",
                                autoGenerated: true,
                                contextStatus: "empty",
                                context: {
                                    ...sharedContextMetadata,
                                    folderExists: true,
                                    files: [],
                                },
                            },
                        };
                        setMessages(() => [message]);
                        setBranchContextState("ready");
                        setBranchContextError(null);
                        setBranchContextMetadata({fileCount: 0, truncated: false});
                        return;
                    }

                    const notes: string[] = [];
                    if (data.truncated) {
                        notes.push(
                            "Additional files exist in ai/ but were omitted to respect the limit.",
                        );
                    }

                    const fileSections = files
                        .map((file) => {
                            const sectionLines = [
                                `### ${file.path}`,
                                "```",
                                file.content,
                                "```",
                            ];
                            if (file.truncated) {
                                sectionLines.push(
                                    "_Note: File content truncated to 100kB for preview._",
                                );
                            }
                            return sectionLines.join("\n");
                        })
                        .join("\n\n");

                    const messageLines = [
                        ...headerLines,
                        `Loaded files: ${files.length}`,
                        notes.length > 0 ? notes.join(" ") : null,
                        "",
                        fileSections,
                    ].filter((line) => line != null && line !== "");

                    const message: UIMessage = {
                        id: generateMessageId(),
                        role: "user",
                        parts: [
                            {
                                type: "text",
                                text: messageLines.join("\n\n"),
                            },
                        ],
                        metadata: {
                            source: "bitbucket-ai-folder",
                            autoGenerated: true,
                            contextStatus: "ready",
                            context: {
                                ...sharedContextMetadata,
                                folderExists: true,
                                files: files.map((file) => ({
                                    path: file.path,
                                    content: file.content,
                                    truncated: Boolean(file.truncated),
                                })),
                                truncated: Boolean(data.truncated),
                            },
                        },
                    };

                    setMessages(() => [message]);
                    setBranchContextState("ready");
                    setBranchContextError(null);
                    setBranchContextMetadata({
                        fileCount: files.length,
                        truncated: Boolean(data.truncated),
                    });
                } catch (error) {
                    if (
                        controller.signal.aborted ||
                        branchSelectionKeyRef.current !== branchKey
                    ) {
                        return;
                    }

                    console.error("Failed to hydrate ai/ context", error);
                    setBranchContextState("error");
                    setBranchContextError("Unable to load repository context.");
                    setBranchContextMetadata(null);
                    resetChatSession();
                } finally {
                    if (
                        branchSelectionKeyRef.current === branchKey &&
                        !controller.signal.aborted
                    ) {
                        branchContextAbortControllerRef.current = null;
                    }
                }
            })();
        }, 2000);
    }, [
        generateMessageId,
        resetChatSession,
        selectedBranch,
        selectedProject,
        setMessages,
    ]);

    useEffect(() => {
        if (branchContextTimerRef.current) {
            clearTimeout(branchContextTimerRef.current);
            branchContextTimerRef.current = null;
        }
        branchContextAbortControllerRef.current?.abort();
        branchContextAbortControllerRef.current = null;
        scheduleContextLoad();
    }, [scheduleContextLoad]);

    const canSend =
        selectedProject != null &&
        selectedBranch != null &&
        branchContextState !== "loading";
    const isInputDisabled = !canSend;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    console.log("Submitting form");
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
              <BitbucketProjectPicker
                  value={selectedProject?.uuid ?? null}
                  onChange={(project) => {
                      setSelectedProject(project);
                      setSelectedBranch(null);
                  }}
              />
              {selectedProject ? (
                  <>
                      <BitbucketBranchPicker
                          project={selectedProject}
                          value={selectedBranch?.id ?? null}
                          onChange={setSelectedBranch}
                      />
                      {branchContextState === "loading" ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              Preparing repository context…
                          </p>
                      ) : null}
                      {branchContextState === "ready" && branchContextMetadata ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              Loaded ai/ folder ({branchContextMetadata.fileCount}
                              {branchContextMetadata.truncated ? "+" : ""} files).
                          </p>
                      ) : null}
                      {branchContextState === "missing" ? (
                          <p className="text-xs text-neutral-500 dark:text-neutral-400">
                              No ai/ folder found for this branch. You can still continue.
                          </p>
                      ) : null}
                      {branchContextState === "error" && branchContextError ? (
                          <p className="text-xs text-red-500">{branchContextError}</p>
                      ) : null}
                  </>
              ) : null}
            <form onSubmit={handleSubmit} className="flex space-x-2">
              <Input
                className={`bg-neutral-100 text-base w-full text-neutral-700 dark:bg-neutral-700 dark:placeholder:text-neutral-400 dark:text-neutral-300`}
                minLength={3}
                required
                value={input}
                placeholder={"Ask me anything..."}
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
