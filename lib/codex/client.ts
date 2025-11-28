import {env} from "@/lib/env.mjs";

const DEFAULT_CODEX_BASE_URL = "https://api.openai.com/v1";

const resolveBaseUrl = () => env.CODEX_BASE_URL ?? DEFAULT_CODEX_BASE_URL;

const getApiKey = () => {
    const apiKey = env.CODEX_API_KEY ?? process.env.CODEX_API_KEY;
    if (!apiKey) {
        throw new Error(
            "CODEX_API_KEY is not configured. Set it in your environment before calling Codex APIs.",
        );
    }
    return apiKey;
};

type CodexRequestOptions = {
    path: string;
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
    headers?: Record<string, string>;
};

export class CodexAPIError extends Error {
    readonly status: number;

    readonly details?: unknown;

    readonly requestId?: string;

    constructor(message: string, status: number, details?: unknown, requestId?: string) {
        super(message);
        this.name = "CodexAPIError";
        this.status = status;
        this.details = details;
        this.requestId = requestId;
    }
}

const performCodexFetch = async ({
                                     path,
                                     method = "POST",
                                     body,
                                     signal,
                                     headers,
                                 }: CodexRequestOptions): Promise<Response> => {
    const apiKey = getApiKey();
    const baseUrl = resolveBaseUrl();
    const absoluteUrl = new URL(path, baseUrl).toString();

    const mergedHeaders: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        ...headers,
    };

    if (env.CODEX_ORG_ID) {
        mergedHeaders["OpenAI-Organization"] = env.CODEX_ORG_ID;
    }

    const serializedBody =
        body === undefined || body === null
            ? undefined
            : typeof body === "string" || body instanceof ArrayBuffer
                ? (body as BodyInit)
                : JSON.stringify(body);

    return fetch(absoluteUrl, {
        method,
        body: serializedBody,
        headers: mergedHeaders,
        signal,
    });
};

const parseResponsePayload = async (response: Response) => {
    const text = await response.text();
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch {
        return text;
    }
};

export const codexJsonRequest = async <T>(options: CodexRequestOptions): Promise<T> => {
    const response = await performCodexFetch(options);
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const payload = await parseResponsePayload(response);

    if (!response.ok) {
        throw new CodexAPIError(
            `Codex request failed with status ${response.status}`,
            response.status,
            payload,
            requestId,
        );
    }

    return payload as T;
};

export const codexStreamRequest = async (
    options: CodexRequestOptions,
): Promise<Response> => {
    const response = await performCodexFetch(options);
    const requestId = response.headers.get("x-request-id") ?? undefined;

    if (!response.ok) {
        const payload = await parseResponsePayload(response);
        throw new CodexAPIError(
            `Codex request failed with status ${response.status}`,
            response.status,
            payload,
            requestId,
        );
    }

    if (!response.body) {
        throw new CodexAPIError(
            "Codex response is missing a body",
            500,
            undefined,
            requestId,
        );
    }

    return response;
};
