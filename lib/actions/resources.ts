"use server";

import {insertResourceSchema, NewResourceParams, resources,} from "@/lib/db/schema/resources";
import {generateEmbeddings} from "../ai/embedding";
import {db} from "../db";
import {embeddings as embeddingsTable} from "../db/schema/embeddings";

export const createResource = async (input: NewResourceParams) => {
  try {
    const { content } = insertResourceSchema.parse(input);

    const [resource] = await db
      .insert(resources)
      .values({ content })
      .returning();

    const embeddings = await generateEmbeddings(content);
      if (embeddings.length > 0) {
          await db.insert(embeddingsTable).values(
              embeddings.map((embedding) => ({
                  resourceId: resource.id,
                  ...embedding,
              })),
          );
      }
    return "Resource successfully created and embedded.";
  } catch (error) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : "Error, please try again.";
  }
};
