"use client";

import type {ReactNode} from "react";
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {Check, ChevronsUpDown, Loader2, RotateCw} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {cn} from "@/lib/utils";

export type SearchableSelectOption = {
    value: string;
    label: ReactNode;
    description?: ReactNode;
    searchText?: string;
    keywords?: string[];
};

interface SearchableSelectProps {
    id?: string;
    value?: string | null;
    onChange?: (value: string) => void;
    placeholder?: string;
    searchPlaceholder?: string;
    emptyMessage?: string;
    options: SearchableSelectOption[];
    disabled?: boolean;
    className?: string;
    onReload?: () => Promise<void> | void;
    loadingMessage?: string;
}

export const SearchableSelect = ({
                                     id,
                                     value,
                                     onChange,
                                     placeholder = "Select an option",
                                     searchPlaceholder = "Search…",
                                     emptyMessage = "No results found.",
                                     options,
                                     disabled = false,
                                     className,
                                     onReload,
                                     loadingMessage = "Refreshing options…",
                                 }: SearchableSelectProps) => {
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [isReloading, setIsReloading] = useState(false);
    const containerRef = useRef<HTMLDivElement | null>(null);
    const inputRef = useRef<HTMLInputElement | null>(null);
    const listId = id ? `${id}-list` : undefined;

    const selected = useMemo(
        () => options.find((option) => option.value === (value ?? "")) ?? null,
        [options, value],
    );

    const normalizedQuery = query.trim().toLowerCase();

    const filtered = useMemo(() => {
        if (!normalizedQuery) {
            return options;
        }

        return options.filter((option) => {
            const base = [
                option.searchText,
                typeof option.label === "string" ? option.label : null,
                ...(option.keywords ?? []),
            ]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();

            return base.includes(normalizedQuery);
        });
    }, [options, normalizedQuery]);

    useEffect(() => {
        if (!open) {
            setQuery("");
            return;
        }

        const focusTimer = window.setTimeout(() => {
            inputRef.current?.focus();
        }, 0);

        return () => {
            window.clearTimeout(focusTimer);
        };
    }, [open]);

    useEffect(() => {
        const handleClick = (event: MouseEvent) => {
            if (
                containerRef.current &&
                !containerRef.current.contains(event.target as Node)
            ) {
                setOpen(false);
            }
        };

        document.addEventListener("mousedown", handleClick);
        return () => document.removeEventListener("mousedown", handleClick);
    }, []);

    useEffect(() => {
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                setOpen(false);
            }
        };

        if (!open) {
            return;
        }

        document.addEventListener("keydown", handleKey);
        return () => document.removeEventListener("keydown", handleKey);
    }, [open]);

    const handleSelect = (optionValue: string) => {
        if (disabled) {
            return;
        }
        onChange?.(optionValue);
        setOpen(false);
    };

    const handleReload = useCallback(async () => {
        if (!onReload || isReloading) {
            return;
        }

        setIsReloading(true);
        try {
            await onReload();
        } catch (error) {
            console.error("Failed to reload select options", error);
        } finally {
            setIsReloading(false);
        }
    }, [onReload, isReloading]);

    const searchId = id ? `${id}-search` : undefined;

    return (
        <div ref={containerRef} className="relative w-full">
            <Button
                type="button"
                id={id}
                role="combobox"
                aria-expanded={open}
                aria-controls={listId}
                aria-haspopup="listbox"
                onClick={() => {
                    if (!disabled) {
                        setOpen((prev) => !prev);
                    }
                }}
                disabled={disabled}
                variant="outline"
                className={cn(
                    "w-full justify-between border border-neutral-200 bg-neutral-100 text-left font-normal text-neutral-800 hover:bg-neutral-50 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-100 dark:hover:bg-neutral-800",
                    className,
                )}
            >
                <span className={cn("truncate", !selected && "text-neutral-500")}>
                    {selected ? selected.label : placeholder}
                </span>
                <ChevronsUpDown className="h-4 w-4 opacity-50"/>
            </Button>

            {open && (
                <div
                    role="listbox"
                    id={listId}
                    aria-labelledby={id}
                    className="absolute left-0 right-0 z-50 mt-1 origin-top rounded-md border border-neutral-200 bg-white shadow-lg ring-1 ring-black/5 focus:outline-none dark:border-neutral-700 dark:bg-neutral-900"
                >
                    <div
                        className="border-b border-neutral-200 bg-neutral-50 p-2 dark:border-neutral-800 dark:bg-neutral-900/80">
                        <div className="flex items-center gap-2">
                            <Input
                                id={searchId}
                                ref={inputRef}
                                placeholder={searchPlaceholder}
                                value={query}
                                onChange={(event) => setQuery(event.target.value)}
                                className="h-8 w-full flex-1 bg-white text-sm text-neutral-800 placeholder:text-neutral-400 dark:bg-neutral-900 dark:text-neutral-100 dark:placeholder:text-neutral-500"
                            />
                            {onReload && (
                                <button
                                    type="button"
                                    onClick={() => void handleReload()}
                                    disabled={isReloading}
                                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 transition hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"
                                    title={isReloading ? "Refreshing…" : "Reload options"}
                                >
                                    {isReloading ? (
                                        <Loader2 className="h-4 w-4 animate-spin"/>
                                    ) : (
                                        <RotateCw className="h-4 w-4"/>
                                    )}
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="max-h-60 overflow-y-auto p-1">
                        {isReloading ? (
                            <div
                                className="flex items-center gap-2 px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">
                                <Loader2 className="h-4 w-4 animate-spin"/>
                                <span>{loadingMessage}</span>
                            </div>
                        ) : filtered.length === 0 ? (
                            <p className="px-3 py-2 text-sm text-neutral-500 dark:text-neutral-400">
                                {emptyMessage}
                            </p>
                        ) : (
                            filtered.map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => handleSelect(option.value)}
                                    className={cn(
                                        "flex w-full items-center gap-2 rounded-sm px-3 py-2 text-left text-sm text-neutral-800 transition hover:bg-neutral-100 focus:bg-neutral-100 focus:outline-none dark:text-neutral-100 dark:hover:bg-neutral-800",
                                        {
                                            "bg-neutral-100 dark:bg-neutral-800":
                                                selected?.value === option.value,
                                        },
                                    )}
                                >
                                    <Check
                                        className={cn(
                                            "h-4 w-4 flex-shrink-0 text-primary transition-opacity",
                                            selected?.value === option.value
                                                ? "opacity-100"
                                                : "opacity-0",
                                        )}
                                    />
                                    <div className="flex flex-col">
                                        <span className="text-sm font-medium leading-none">
                                            {option.label}
                                        </span>
                                        {option.description && (
                                            <span className="text-xs text-neutral-500 dark:text-neutral-400">
                                                {option.description}
                                            </span>
                                        )}
                                    </div>
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
