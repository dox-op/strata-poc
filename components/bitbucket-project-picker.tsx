"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";
import {SearchableSelect} from "@/components/ui/searchable-select";

export type BitbucketProject = {
    uuid: string;
    key: string;
    name: string;
    workspace: {
        slug?: string;
        name?: string;
        uuid?: string;
    };
};

type Status = "loading" | "linked" | "disconnected" | "error";

interface BitbucketProjectPickerProps {
    value?: string | null;
    onChange?: (project: BitbucketProject | null) => void;
    onStatusChange?: (status: Status) => void;
    disabled?: boolean;
}

const ProjectsEmptyState = () => (
    <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No Bitbucket projects were found for the connected account.
    </p>
);

export const BitbucketProjectPicker = ({
                                           value,
                                           onChange,
                                           onStatusChange,
                                           disabled = false,
                                       }: BitbucketProjectPickerProps) => {
    const [status, setStatus] = useState<Status>("loading");
    const [projects, setProjects] = useState<BitbucketProject[]>([]);
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
        value ?? null,
    );

    const sortedProjects = useMemo(
        () =>
            [...projects].sort((a, b) =>
                a.name.toLowerCase().localeCompare(b.name.toLowerCase()),
            ),
        [projects],
    );

    const projectOptions = useMemo(
        () =>
            sortedProjects.map((project) => ({
                value: project.uuid,
                label: project.name,
                description:
                    project.workspace?.name ??
                    project.workspace?.slug ??
                    project.key,
                searchText: [
                    project.name,
                    project.key,
                    project.workspace?.name,
                    project.workspace?.slug,
                ]
                    .filter(Boolean)
                    .join(" "),
            })),
        [sortedProjects],
    );

    const loadProjects = useCallback(
        async (options?: { forceRefresh?: boolean; silent?: boolean }) => {
            if (!options?.silent) {
                setStatus("loading");
            }

            try {
                const endpoint = options?.forceRefresh
                    ? "/api/bitbucket/projects?refresh=1"
                    : "/api/bitbucket/projects";
                const response = await fetch(endpoint, {
                    credentials: "include",
                });

                if (response.status === 401) {
                    setProjects([]);
                    setStatus("disconnected");
                    setSelectedProjectId(null);
                    onChange?.(null);
                    return;
                }

                if (!response.ok) {
                    throw new Error("failed_to_load_projects");
                }

                const data = (await response.json()) as {
                    projects?: BitbucketProject[];
                };

                if (!data.projects) {
                    setProjects([]);
                    setStatus("linked");
                    return;
                }

                setProjects(data.projects);
                setStatus("linked");
            } catch (error) {
                setStatus("error");
                setProjects([]);
                setSelectedProjectId(null);
                onChange?.(null);
            }
        },
        [onChange],
    );

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

    useEffect(() => {
        onStatusChange?.(status);
    }, [status, onStatusChange]);

    useEffect(() => {
        if (value) {
            setSelectedProjectId(value);
        }
    }, [value]);

    useEffect(() => {
        if (status === "linked") {
            if (sortedProjects.length === 0) {
                if (selectedProjectId !== null) {
                    setSelectedProjectId(null);
                    onChange?.(null);
                }
                return;
            }

            const existing = sortedProjects.find(
                (project) => project.uuid === selectedProjectId,
            );

            if (!existing) {
                const firstProject = sortedProjects[0];
                setSelectedProjectId(firstProject.uuid);
                onChange?.(firstProject);
            }
            return;
        }

        if (
            (status === "disconnected" || status === "error") &&
            selectedProjectId !== null
        ) {
            setSelectedProjectId(null);
            onChange?.(null);
        }
    }, [status, sortedProjects, selectedProjectId, onChange]);

    const handleProjectChange = (projectId: string) => {
        const selected = sortedProjects.find(
            (project) => project.uuid === projectId,
        );
        setSelectedProjectId(selected?.uuid ?? null);
        onChange?.(selected ?? null);
    };

    const handleLogin = () => {
        window.location.href = "/api/bitbucket/login";
    };

    return (
        <div className="flex flex-col gap-1">
            <Label htmlFor="bitbucket-project"
                   className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Bitbucket Project
            </Label>

            {status === "loading" && (
                <div className="text-sm text-neutral-500 dark:text-neutral-400">
                    Loading projects…
                </div>
            )}

            {status === "error" && (
                <div className="flex flex-col gap-2">
                    <p className="text-sm text-red-500">
                        Unable to load Bitbucket projects.
                    </p>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void loadProjects()}
                        disabled={disabled}
                    >
                        Try again
                    </Button>
                </div>
            )}

            {status === "disconnected" && (
                <Button onClick={handleLogin} size="sm" disabled={disabled}>
                    log in Bitbucket
                </Button>
            )}

            {status === "linked" && sortedProjects.length > 0 && (
                <SearchableSelect
                    id="bitbucket-project"
                    value={selectedProjectId}
                    onChange={handleProjectChange}
                    options={projectOptions}
                    placeholder="Select a Bitbucket project"
                    searchPlaceholder="Search projects..."
                    emptyMessage="No projects match your search."
                    onReload={() =>
                        loadProjects({
                            forceRefresh: true,
                            silent: sortedProjects.length > 0,
                        })
                    }
                    disabled={disabled}
                />
            )}

            {status === "linked" && sortedProjects.length === 0 && (
                <ProjectsEmptyState/>
            )}
        </div>
    );
};
