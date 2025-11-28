const AI_DIRECTORY = "ai/";

const stripLeadingSlashes = (input: string) => input.replace(/^\/+/, "");

const stripLegacyPrefix = (input: string) =>
    input.replace(/^(files\/)+/i, "");

/**
 * Normalizes an ai/ file path ensuring it points inside the persistency layer.
 * - Allows callers to pass legacy prefixes like "files/ai/…" but always returns "ai/…".
 * - Enforces `.mdc` extension and rejects attempts to escape the ai/ directory.
 */
export const normalizeAiFilePath = (path: string): string => {
    if (!path || typeof path !== "string") {
        throw new Error("invalid_ai_path");
    }

    let normalized = stripLeadingSlashes(path.trim());
    normalized = stripLegacyPrefix(normalized);

    if (!normalized.toLowerCase().startsWith(AI_DIRECTORY)) {
        throw new Error("ai_path_out_of_scope");
    }

    if (!normalized.toLowerCase().endsWith(".mdc")) {
        throw new Error("ai_path_extension_required");
    }

    if (normalized.includes("..")) {
        throw new Error("ai_path_out_of_scope");
    }

    return normalized;
};
