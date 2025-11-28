"use client"

import {useCallback, useEffect, useRef, useSyncExternalStore} from "react"
import {AbstractChat, type ChatInit, type ChatState, type ChatStatus, type UIMessage,} from "ai"

const maybeStructuredClone = <T, >(value: T): T => {
    if (typeof structuredClone === "function") {
        return structuredClone(value)
    }
    return JSON.parse(JSON.stringify(value))
}

const throttle = (callback: () => void, wait?: number) => {
    if (!wait || wait <= 0) {
        return callback
    }
    let timeout: ReturnType<typeof setTimeout> | null = null
    let pending = false
    const run = () => {
        callback()
        timeout = setTimeout(() => {
            timeout = null
            if (pending) {
                pending = false
                run()
            }
        }, wait)
    }
    return () => {
        if (timeout) {
            pending = true
            return
        }
        run()
    }
}

class ReactChatState<UI_MESSAGE extends UIMessage> implements ChatState<UI_MESSAGE> {
    private messageSubscribers = new Set<() => void>()

    private statusSubscribers = new Set<() => void>()

    private errorSubscribers = new Set<() => void>()

    private _messages: UI_MESSAGE[]

    private _status: ChatStatus = "ready"

    private _error: Error | undefined

    constructor(initialMessages: UI_MESSAGE[] = []) {
        this._messages = [...initialMessages]
    }

    get status() {
        return this._status
    }

    set status(value: ChatStatus) {
        this._status = value
        this.notify(this.statusSubscribers)
    }

    get error() {
        return this._error
    }

    set error(value: Error | undefined) {
        this._error = value
        this.notify(this.errorSubscribers)
    }

    get messages() {
        return this._messages
    }

    set messages(value: UI_MESSAGE[]) {
        this._messages = [...value]
        this.notify(this.messageSubscribers)
    }

    pushMessage = (message: UI_MESSAGE) => {
        this._messages = [...this._messages, message]
        this.notify(this.messageSubscribers)
    }

    popMessage = () => {
        this._messages = this._messages.slice(0, -1)
        this.notify(this.messageSubscribers)
    }

    replaceMessage = (index: number, message: UI_MESSAGE) => {
        this._messages = [
            ...this._messages.slice(0, index),
            this.snapshot(message),
            ...this._messages.slice(index + 1),
        ]
        this.notify(this.messageSubscribers)
    }

    snapshot = <T, >(value: T): T => maybeStructuredClone(value)

    registerMessagesCallback = (cb: () => void, wait?: number) => {
        const listener = throttle(cb, wait)
        this.messageSubscribers.add(listener)
        return () => this.messageSubscribers.delete(listener)
    }

    registerStatusCallback = (cb: () => void) => {
        this.statusSubscribers.add(cb)
        return () => this.statusSubscribers.delete(cb)
    }

    registerErrorCallback = (cb: () => void) => {
        this.errorSubscribers.add(cb)
        return () => this.errorSubscribers.delete(cb)
    }

    private notify(subscribers: Set<() => void>) {
        subscribers.forEach((cb) => {
            try {
                cb()
            } catch (error) {
                console.error("Chat subscriber failed", error)
            }
        })
    }
}

class CodexChat<UI_MESSAGE extends UIMessage> extends AbstractChat<UI_MESSAGE> {
    private reactState: ReactChatState<UI_MESSAGE>

    constructor({messages = [], ...init}: ChatInit<UI_MESSAGE> = {}) {
        const state = new ReactChatState(messages)
        super({state, ...init})
        this.reactState = state
    }

    registerMessagesCallback = (cb: () => void, wait?: number) =>
        this.reactState.registerMessagesCallback(cb, wait)

    registerStatusCallback = (cb: () => void) =>
        this.reactState.registerStatusCallback(cb)

    registerErrorCallback = (cb: () => void) =>
        this.reactState.registerErrorCallback(cb)
}

export type UseCodexChatOptions<UI_MESSAGE extends UIMessage = UIMessage> =
    | (ChatInit<UI_MESSAGE> & {
    experimentalThrottle?: number
    resume?: boolean
})
    | ({
    chat: CodexChat<UI_MESSAGE>
    experimentalThrottle?: number
    resume?: boolean
})

export type UseCodexChatHelpers<UI_MESSAGE extends UIMessage = UIMessage> = {
    id: string
    messages: UI_MESSAGE[]
    status: ChatStatus
    error: Error | undefined
    setMessages: (messages: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])) => void
} & Pick<CodexChat<UI_MESSAGE>,
    | "sendMessage"
    | "regenerate"
    | "stop"
    | "resumeStream"
    | "addToolOutput"
    | "clearError"
>

export const useCodexChat = <UI_MESSAGE extends UIMessage = UIMessage>(
    options?: UseCodexChatOptions<UI_MESSAGE>,
): UseCodexChatHelpers<UI_MESSAGE> => {
    const {
        experimentalThrottle: throttleWaitMs,
        resume = false,
        chat,
        ...chatInit
    } = (options ?? {messages: []}) as ChatInit<UI_MESSAGE> & {
        experimentalThrottle?: number
        resume?: boolean
        chat?: CodexChat<UI_MESSAGE>
    }

    const chatRef = useRef<CodexChat<UI_MESSAGE>>(chat ?? new CodexChat(chatInit))

    const optionsId = chat?.id ?? chatInit.id ?? null

    const shouldRecreate = chat
        ? chatRef.current !== chat
        : chatInit.id !== undefined && chatRef.current.id !== chatInit.id

    if (shouldRecreate) {
        chatRef.current = chat ?? new CodexChat(chatInit)
    }

    const subscribeToMessages = useCallback(
        (update: () => void) => chatRef.current.registerMessagesCallback(update, throttleWaitMs),
        [chatRef, throttleWaitMs, optionsId],
    )

    const messages = useSyncExternalStore(
        subscribeToMessages,
        () => chatRef.current.messages,
        () => chatRef.current.messages,
    )

    const subscribeToStatus = useCallback(
        (update: () => void) => chatRef.current.registerStatusCallback(update),
        [chatRef, optionsId],
    )
    const status = useSyncExternalStore(
        subscribeToStatus,
        () => chatRef.current.status,
        () => chatRef.current.status,
    )

    const subscribeToError = useCallback(
        (update: () => void) => chatRef.current.registerErrorCallback(update),
        [chatRef, optionsId],
    )
    const error = useSyncExternalStore(
        subscribeToError,
        () => chatRef.current.error,
        () => chatRef.current.error,
    )

    const setMessages = useCallback(
        (messagesParam: UI_MESSAGE[] | ((messages: UI_MESSAGE[]) => UI_MESSAGE[])) => {
            const value =
                typeof messagesParam === "function"
                    ? (messagesParam as (messages: UI_MESSAGE[]) => UI_MESSAGE[])(chatRef.current.messages)
                    : messagesParam
            chatRef.current.messages = value
        },
        [chatRef],
    )

    useEffect(() => {
        if (resume) {
            void chatRef.current.resumeStream()
        }
    }, [resume])

    return {
        id: chatRef.current.id,
        messages,
        setMessages,
        sendMessage: chatRef.current.sendMessage,
        regenerate: chatRef.current.regenerate,
        stop: chatRef.current.stop,
        resumeStream: chatRef.current.resumeStream,
        addToolOutput: chatRef.current.addToolOutput,
        clearError: chatRef.current.clearError,
        error,
        status,
    }
}
