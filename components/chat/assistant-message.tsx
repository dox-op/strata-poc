"use client"

import {AnimatePresence, motion} from "framer-motion"
import type {UIMessage} from "ai"
import ReactMarkdown, {type Options} from "react-markdown"
import React from "react"

const MemoizedReactMarkdown: React.FC<Options> = React.memo(
    ReactMarkdown,
    (prevProps, nextProps) =>
        prevProps.children === nextProps.children &&
        prevProps.className === nextProps.className,
)

export const AssistantMessage = ({
                                     message,
                                 }: {
    message: UIMessage | undefined
}) => {
    if (message === undefined) return "HELLO"

    return (
        <AnimatePresence mode="wait">
            <motion.div
                key={message.id}
                initial={{opacity: 0}}
                animate={{opacity: 1}}
                exit={{opacity: 0}}
                className="whitespace-pre-wrap font-mono anti text-sm text-neutral-800 dark:text-neutral-200 overflow-hidden"
                id="markdown"
            >
                <MemoizedReactMarkdown className="max-h-72 overflow-y-scroll no-scrollbar-gutter">
                    {message.parts
                        .filter((part) => part.type === "text")
                        .map((part) => part.text)
                        .join(" ")}
                </MemoizedReactMarkdown>
            </motion.div>
        </AnimatePresence>
    )
}
