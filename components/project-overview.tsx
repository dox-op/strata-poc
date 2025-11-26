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
              Strata turns the <code>ai/</code> directory into a living persistency layer:
              every `.mdc` file becomes the canonical source of truth for functional,
              technical, and agent guardrails. Sessions load that context automatically so
              functional leads, developers, and clients share the same knowledge.
          </p>
          <p>
              Prompt-by-prompt the <strong>read-only toggle</strong> keeps the AI from altering
              the layer until you explicitly allow it. Disable read-only when you want Strata
              to queue `.mdc` drafts that flow into a dedicated Bitbucket PR—keeping the layer
              reviewable and versioned like code.
          </p>
          <p>
              Workflows: capture requirements externally, refine them in Strata, create the
              Jira task, and persist the chain of thought via PR. Developers then implement
              the feature with the latest knowledge, and merged PRs refresh future sessions.
          </p>
      </div>
    </motion.div>
  );
};

export default ProjectOverview;
