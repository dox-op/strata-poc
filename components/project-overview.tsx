import React from "react";
import {motion} from "framer-motion";
import {InformationIcon, VercelIcon} from "./icons";

const ProjectOverview = () => {
  return (
    <motion.div
      className="w-full max-w-[600px] my-4"
      initial={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      transition={{ duration: 5 }}
    >
      <div className="border rounded-lg p-6 flex flex-col gap-4 text-neutral-500 text-sm dark:text-neutral-400 dark:border-neutral-700 dark:bg-neutral-900">
        <p className="flex flex-row justify-center gap-4 items-center text-neutral-900 dark:text-neutral-50">
          <VercelIcon size={16} />
          <span>+</span>
          <InformationIcon />
        </p>
          <p>
              Strata POC is a passive-to-active chat assistant that syncs Bitbucket
              sessions with a persistency layer. Pick a project + branch, decide if the
              AI can write to <code>ai/</code>, and chat. When allowed, responses can be
              staged into drafts and pushed via auto-generated pull requests so every
              change stays reviewable.
          </p>
          <p>
              Context comes from the repository’s <code>ai/</code> directory, which we
              index and feed into the model. Any write operation is gated by your
              session preference and always limited to that folder, ensuring the rest
              of the codebase stays untouched.
          </p>
      </div>
    </motion.div>
  );
};

export default ProjectOverview;
