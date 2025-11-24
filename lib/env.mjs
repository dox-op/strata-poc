import {createEnv} from "@t3-oss/env-nextjs";
import {z} from "zod";
import dotenv from "dotenv";

const loadedEnv = dotenv.config({
    path: ".env",
});

/**
 * Mimics simple dotenv variable interpolation so entries like
 * `DATABASE_URL=postgresql://${DATABASE_USER}:...` are usable at runtime.
 * Only replaces patterns that already exist in `process.env`.
 */
if (loadedEnv.parsed) {
    for (const [key, value] of Object.entries(loadedEnv.parsed)) {
        if (typeof value === "string" && value.includes("${")) {
            process.env[key] = value.replace(/\$\{([A-Z0-9_]+)\}/gi, (_match, varName) => {
                const replacement = process.env[varName];
                return typeof replacement === "string" ? replacement : _match;
            });
        }
    }
}

export const env = createEnv({
    server: {
        NODE_ENV: z
            .enum(["development", "test", "production"])
            .default("development"),

        DATABASE_HOST: z.string().min(1),
        DATABASE_PORT: z.coerce.number().int().positive(),
        DATABASE_USER: z.string().min(1),
        DATABASE_PASSWORD: z.string().min(1),
        DATABASE_DB: z.string().min(1),
        DATABASE_URL: z.url().min(1),
    },
    client: {
        // NEXT_PUBLIC_PUBLISHABLE_KEY: z.string().min(1),
    },
    // If you're using Next.js < 13.4.4, you'll need to specify the runtimeEnv manually
    runtimeEnv: {
        NODE_ENV: process.env.NODE_ENV,
        DATABASE_HOST: process.env.DATABASE_HOST,
        DATABASE_PORT: process.env.DATABASE_PORT,
        DATABASE_USER: process.env.DATABASE_USER,
        DATABASE_PASSWORD: process.env.DATABASE_PASSWORD,
        DATABASE_DB: process.env.DATABASE_DB,
        DATABASE_URL: process.env.DATABASE_URL,
        //   NEXT_PUBLIC_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_PUBLISHABLE_KEY,
    },
    // For Next.js >= 13.4.4, you only need to destructure client variables:
    experimental__runtimeEnv: {
        // NEXT_PUBLIC_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_PUBLISHABLE_KEY,
        DATABASE_URL: process.env.DATABASE_URL,
    },
});
