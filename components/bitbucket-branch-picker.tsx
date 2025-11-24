"use client";

import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";
import {SearchableSelect} from "@/components/ui/searchable-select";
import {BitbucketProject} from "@/components/bitbucket-project-picker";

export type BitbucketBranch = {
    id: string;
    name: string;
    repository: {
        slug: string;
        name: string;
    };
    latestCommit?: string;
    isDefault: boolean;
};

type Status = "idle" | "loading" | "ready" | "empty" | "error" | "disconnected";

interface BitbucketBranchPickerProps {
    project: BitbucketProject | null;
    value?: string | null;
    onChange?: (branch: BitbucketBranch | null) => void;
}

const BranchesEmptyState = () => (
    <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No branches were found for the selected project.
    </p>
);

export const BitbucketBranchPicker = ({
                                          project,
                                          value,
                                          onChange,
                                      }: BitbucketBranchPickerProps) => {
    const [status, setStatus] = useState<Status>("idle");
    const [branches, setBranches] = useState<BitbucketBranch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(
        value ?? null,
    );
    const latestProjectIdRef = useRef<string | null>(project?.uuid ?? null);

    const sortedBranches = useMemo(() => {
        return [...branches].sort((a, b) => {
            const aRepo = a.repository.name.toLowerCase();
            const bRepo = b.repository.name.toLowerCase();
            if (aRepo !== bRepo) {
                return aRepo.localeCompare(bRepo);
            }

            if (a.isDefault !== b.isDefault) {
                return a.isDefault ? -1 : 1;
            }

            return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });
    }, [branches]);

    const branchOptions = useMemo(
        () =>
            sortedBranches.map((branch) => ({
                value: branch.id,
                label: branch.name,
                description: `${branch.repository.name}${
                    branch.isDefault ? " · default" : ""
                }`,
                searchText: [
                    branch.name,
                    branch.repository.name,
                    branch.repository.slug,
                    branch.latestCommit,
                ]
                    .filter(Boolean)
                    .join(" "),
            })),
        [sortedBranches],
    );

    useEffect(() => {
        setSelectedBranchId(value ?? null);
    }, [value]);

    useEffect(() => {
        if (!project) {
            setStatus("idle");
            setBranches([]);
            setSelectedBranchId(null);
            onChange?.(null);
        }
    }, [project, onChange]);

    useEffect(() => {
        latestProjectIdRef.current = project?.uuid ?? null;
    }, [project]);

    const loadBranches = useCallback(
        async (options?: { forceRefresh?: boolean; silent?: boolean }) => {
            if (!project) {
                setStatus("idle");
                return;
            }

            const workspace =
                project.workspace?.slug ?? project.workspace?.uuid ?? null;
            const projectUuid = project.uuid;

            if (!workspace) {
                if (latestProjectIdRef.current === projectUuid) {
                    setStatus("error");
                    setBranches([]);
                    setSelectedBranchId(null);
                    onChange?.(null);
                }
                return;
            }

            if (!options?.silent) {
                setStatus("loading");
            }

            const params = new URLSearchParams({
                projectUuid: project.uuid,
                workspace,
            });

            if (project.key) {
                params.set("projectKey", project.key);
            }

            if (options?.forceRefresh) {
                params.set("refresh", "1");
            }

            try {
                const response = await fetch(
                    `/api/bitbucket/branches?${params.toString()}`,
                    {
                        credentials: "include",
                    },
                );

                if (response.status === 401) {
                    if (latestProjectIdRef.current === projectUuid) {
                        setStatus("disconnected");
                        setBranches([]);
                        setSelectedBranchId(null);
                        onChange?.(null);
                    }
                    return;
                }

                if (!response.ok) {
                    throw new Error("failed_to_load_branches");
                }

                const data = (await response.json()) as {
                    branches?: BitbucketBranch[];
                };

                const fetchedBranches = data.branches ?? [];

                if (latestProjectIdRef.current !== projectUuid) {
                    return;
                }

                if (fetchedBranches.length === 0) {
                    setStatus("empty");
                    setBranches([]);
                    setSelectedBranchId(null);
                    onChange?.(null);
                    return;
                }

                setBranches(fetchedBranches);
                setStatus("ready");
            } catch (error) {
                if (latestProjectIdRef.current === projectUuid) {
                    setStatus("error");
                    setBranches([]);
                    setSelectedBranchId(null);
                    onChange?.(null);
                }
            }
        },
        [project, onChange],
    );

    useEffect(() => {
        if (!project) {
            return;
        }

        void loadBranches();
    }, [project, loadBranches]);

    useEffect(() => {
        if (status !== "ready") {
            return;
        }

        if (sortedBranches.length === 0) {
            if (selectedBranchId !== null) {
                setSelectedBranchId(null);
                onChange?.(null);
            }
            return;
        }

        if (
            selectedBranchId &&
            !sortedBranches.some((branch) => branch.id === selectedBranchId)
        ) {
            setSelectedBranchId(null);
            onChange?.(null);
        }
    }, [status, sortedBranches, selectedBranchId, onChange]);

    const handleBranchChange = (branchId: string) => {
        if (!project) {
            return;
        }

        const branch = sortedBranches.find((item) => item.id === branchId);

        setSelectedBranchId(branch?.id ?? null);
        onChange?.(branch ?? null);
    };

    const handleLogin = () => {
        window.location.href = "/api/bitbucket/login";
    };

    if (!project) {
        return null;
    }

    return (
        <div className="flex flex-col gap-1">
            <Label
                htmlFor="bitbucket-branch"
                className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400"
            >
                Branch
            </Label>

            {status === "loading" && (
                <div className="text-sm text-neutral-500 dark:text-neutral-400">
                    Loading branches…
                </div>
            )}

            {status === "error" && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-red-500">
                        Unable to load Bitbucket branches.
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadBranches()}
                    >
                        Try again
                    </Button>
                </div>
            )}

            {status === "disconnected" && (
                <Button onClick={handleLogin} size="sm">
                    log in Bitbucket
                </Button>
            )}

            {status === "empty" && <BranchesEmptyState/>}

            {status === "ready" && sortedBranches.length > 0 && (
                <SearchableSelect
                    id="bitbucket-branch"
                    value={selectedBranchId}
                    onChange={handleBranchChange}
                    options={branchOptions}
                    placeholder="Select a branch"
                    searchPlaceholder="Search branches..."
                    emptyMessage="No branches match your search."
                    onReload={() =>
                        loadBranches({
                            forceRefresh: true,
                            silent: sortedBranches.length > 0,
                        })
                    }
                />
            )}
        </div>
    );
};
