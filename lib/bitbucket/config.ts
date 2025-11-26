import {env} from "@/lib/env.mjs";

const DEFAULT_AI_FOLDER_MAX_FILES = 60;

export const AI_FOLDER_MAX_FILES =
    env.BITBUCKET_AI_FOLDER_MAX_FILES ?? DEFAULT_AI_FOLDER_MAX_FILES;
