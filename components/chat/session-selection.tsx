"use client"

import {Label} from "@/components/ui/label"
import {SearchableSelect, type SearchableSelectOption,} from "@/components/ui/searchable-select"
import {type BitbucketProject, BitbucketProjectPicker,} from "@/components/bitbucket-project-picker"
import {type BitbucketBranch, BitbucketBranchPicker,} from "@/components/bitbucket-branch-picker"
import type {BitbucketConnectionStatus, SessionDetails, SessionSelectValue,} from "@/lib/session/types"

type SessionSelectionProps = {
    activeSession: SessionDetails | null
    isNewSessionSelection: boolean
    onBitbucketStatusChange: (status: BitbucketConnectionStatus) => void
    onBranchChange: (branch: BitbucketBranch | null) => void
    onProjectChange: (project: BitbucketProject | null) => void
    onReloadSessions: () => Promise<void> | void
    onSessionSelect: (value: SessionSelectValue) => void
    selectedBranch: BitbucketBranch | null
    selectedProject: BitbucketProject | null
    selectedSessionId: SessionSelectValue
    sessionOptions: SearchableSelectOption[]
}

export const SessionSelection = ({
                                     activeSession,
                                     isNewSessionSelection,
                                     onBitbucketStatusChange,
                                     onBranchChange,
                                     onProjectChange,
                                     onReloadSessions,
                                     onSessionSelect,
                                     selectedBranch,
                                     selectedProject,
                                     selectedSessionId,
                                     sessionOptions,
                                 }: SessionSelectionProps) => {
    return (
        <>
            <div className="flex flex-col gap-1">
                <Label
                    htmlFor="session-picker"
                    className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                >
                    Session
                </Label>
                <SearchableSelect
                    id="session-picker"
                    value={selectedSessionId}
                    onChange={(nextValue) =>
                        onSessionSelect(nextValue as SessionSelectValue)
                    }
                    options={sessionOptions}
                    placeholder="Choose a session"
                    searchPlaceholder="Search sessions..."
                    emptyMessage="No sessions found."
                    onReload={onReloadSessions}
                />
            </div>

            {isNewSessionSelection ? (
                <>
                    <BitbucketProjectPicker
                        value={selectedProject?.uuid ?? null}
                        onChange={onProjectChange}
                        onStatusChange={onBitbucketStatusChange}
                    />
                    <BitbucketBranchPicker
                        project={selectedProject}
                        value={selectedBranch?.id ?? null}
                        onChange={onBranchChange}
                    />
                </>
            ) : (
                <>
                    <div className="flex flex-col gap-1">
                        <Label
                            htmlFor="session-project"
                            className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                        >
                            Project
                        </Label>
                        <select
                            id="session-project"
                            disabled
                            className="w-full rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        >
                            <option>
                                {activeSession
                                    ? `${activeSession.project.name}${
                                        activeSession.project.key
                                            ? ` (${activeSession.project.key})`
                                            : ""
                                    }`
                                    : "Loading project..."}
                            </option>
                        </select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <Label
                            htmlFor="session-branch"
                            className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
                        >
                            Branch
                        </Label>
                        <select
                            id="session-branch"
                            disabled
                            className="w-full rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                        >
                            <option>
                                {activeSession
                                    ? `${activeSession.repository.name} · ${activeSession.branch.name}`
                                    : "Loading branch..."}
                            </option>
                        </select>
                    </div>
                </>
            )}
        </>
    )
}
