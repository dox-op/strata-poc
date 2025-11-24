import {embed, embedMany} from "ai";
import {cosineDistance, desc, gt, sql} from "drizzle-orm";
import {embeddings as embeddingsTable} from "../db/schema/embeddings";
import {db} from "../db";

const embeddingModel = "openai/text-embedding-ada-002";

const CONTEXT_CHUNK_SIZE = 1_500;
const MAX_CONTEXT_CHUNKS = 120;
const MIN_CONTEXT_SIMILARITY = 0.25;
const DEFAULT_RESULT_LIMIT = 6;

const normalizeWhitespace = (input: string) =>
    input.replace(/\s+/g, " ").trim();

const splitIntoSentences = (input: string): string[] =>
    input
        .replace(/\r\n/g, " ")
        .split(".")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);

const vectorNorm = (vector: number[]) =>
    Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));

const dotProduct = (a: number[], b: number[]) =>
    a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);

const cosineSimilarity = (a: number[], b: number[]) => {
    const denominator = vectorNorm(a) * vectorNorm(b);
    if (denominator === 0) {
        return 0;
    }
    return dotProduct(a, b) / denominator;
};

const createContextChunks = (
    blocks: Array<{
        id: string;
        label: string;
        content: string;
        metadata?: Record<string, unknown>;
    }>,
) => {
    const chunks: Array<{
        id: string;
        label: string;
        content: string;
        metadata?: Record<string, unknown>;
    }> = [];

    outer: for (const block of blocks) {
        const normalized = normalizeWhitespace(block.content);
        if (normalized.length === 0) {
            continue;
        }

        let chunkIndex = 0;
        for (
            let position = 0;
            position < normalized.length;
            position += CONTEXT_CHUNK_SIZE
        ) {
            if (chunks.length >= MAX_CONTEXT_CHUNKS) {
                break outer;
            }

            const segment = normalized
                .slice(position, position + CONTEXT_CHUNK_SIZE)
                .trim();

            if (segment.length === 0) {
                continue;
            }

            chunks.push({
                id: `${block.id}#${chunkIndex}`,
                label: block.label,
                content: segment,
                metadata: {
                    ...block.metadata,
                    parentId: block.id,
                    chunkIndex,
                },
            });
            chunkIndex += 1;
        }
    }

    return chunks;
};

const buildContextMatches = async (
    queryEmbedding: number[],
    blocks: Array<{
        id: string;
        label: string;
        content: string;
        metadata?: Record<string, unknown>;
    }>,
) => {
    if (blocks.length === 0) {
        return [] as RetrievalResult[];
    }

    const chunks = createContextChunks(blocks);
    if (chunks.length === 0) {
        return [] as RetrievalResult[];
    }

    const {embeddings} = await embedMany({
        model: embeddingModel,
        values: chunks.map((chunk) => chunk.content),
    });

    return chunks
        .map<RetrievalResult>((chunk, index) => {
            const similarityScore = cosineSimilarity(
                queryEmbedding,
                embeddings[index],
            );
            return {
                name: chunk.label,
                similarity: similarityScore,
                source: "bitbucket",
                metadata: {
                    ...chunk.metadata,
                    preview: chunk.content.slice(0, 300),
                },
            };
        })
        .filter((match) => match.similarity >= MIN_CONTEXT_SIMILARITY)
        .sort((a, b) => b.similarity - a.similarity);
};

export const generateEmbeddings = async (
    value: string,
): Promise<Array<{ embedding: number[]; content: string }>> => {
    const sentences = splitIntoSentences(value);
    if (sentences.length === 0) {
        return [];
    }
    const {embeddings} = await embedMany({
        model: embeddingModel,
        values: sentences,
    });
    return embeddings.map((embedding, index) => ({
        content: sentences[index] ?? "",
        embedding,
    }));
};

export const generateEmbedding = async (value: string): Promise<number[]> => {
    const normalized = normalizeWhitespace(value);
    const {embedding} = await embed({
        model: embeddingModel,
        value: normalized,
    });
    return embedding;
};

export type RetrievalContextBlock = {
    id: string;
    label: string;
    content: string;
    metadata?: Record<string, unknown>;
};

export type RetrievalResult = {
    name: string;
    similarity: number;
    source?: "database" | "bitbucket";
    metadata?: Record<string, unknown>;
};

export type FindRelevantContentOptions = {
    contextBlocks?: RetrievalContextBlock[];
    limit?: number;
    queryEmbedding?: number[];
};

export const findRelevantContent = async (
    userQuery: string,
    options?: FindRelevantContentOptions,
): Promise<RetrievalResult[]> => {
    const limit = options?.limit ?? DEFAULT_RESULT_LIMIT;
    const queryEmbedding =
        options?.queryEmbedding ?? (await generateEmbedding(userQuery));

    const similarity = sql<number>`1 - (${cosineDistance(embeddingsTable.embedding, queryEmbedding)})`;

    const databaseMatches = await db
        .select({
            name: embeddingsTable.content,
            similarity,
        })
        .from(embeddingsTable)
        .where(gt(similarity, 0.3))
        .orderBy((table) => desc(table.similarity))
        .limit(limit);

    const databaseResults: RetrievalResult[] = databaseMatches.map((match) => ({
        name: match.name,
        similarity: match.similarity,
        source: "database",
        metadata: {
            parentId: match.name,
        },
    }));

    const contextResults = options?.contextBlocks?.length
        ? await buildContextMatches(queryEmbedding, options.contextBlocks)
        : [];

    const combined = [...databaseResults, ...contextResults].sort(
        (a, b) => b.similarity - a.similarity,
    );

    const uniqueResults: RetrievalResult[] = [];
    const seen = new Set<string>();

    for (const result of combined) {
        const key =
            `${result.source ?? "database"}:` +
            `${(result.metadata?.parentId as string | undefined) ?? result.name}`;
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        uniqueResults.push(result);
        if (uniqueResults.length >= limit) {
            break;
        }
    }

    return uniqueResults;
};
