"use client";

import {useCallback, useEffect, useMemo, useState} from "react";
import {Button} from "@/components/ui/button";
import {Label} from "@/components/ui/label";

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
}

const ProjectsEmptyState = () => (
    <p className="text-xs text-neutral-500 dark:text-neutral-400">
        No Bitbucket projects were found for the connected account.
    </p>
);

export const BitbucketProjectPicker = ({
                                           value,
                                           onChange,
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

    const loadProjects = useCallback(async () => {
        setStatus("loading");
        try {
            const response = await fetch("/api/bitbucket/projects", {
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
    }, [onChange]);

    useEffect(() => {
        void loadProjects();
    }, [loadProjects]);

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

    const handleProjectChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const selected = sortedProjects.find(
            (project) => project.uuid === event.target.value,
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

            {status === "linked" && sortedProjects.length > 0 && (
                <select
                    id="bitbucket-project"
                    className="w-full rounded-md border border-neutral-200 bg-neutral-100 px-3 py-2 text-sm text-neutral-800 outline-none transition focus:border-neutral-400 focus:ring-0 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100"
                    value={selectedProjectId ?? ""}
                    onChange={handleProjectChange}
                >
                    {sortedProjects.map((project) => (
                        <option key={project.uuid} value={project.uuid}>
                            {project.name}
                            {project.workspace?.name
                                ? ` · ${project.workspace.name}`
                                : project.workspace?.slug
                                    ? ` · ${project.workspace.slug}`
                                    : ""}
                        </option>
                    ))}
                </select>
            )}

            {status === "linked" && sortedProjects.length === 0 && (
                <ProjectsEmptyState/>
            )}
        </div>
    );
};
