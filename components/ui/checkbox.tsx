"use client";

import * as React from "react";
import {cn} from "@/lib/utils";

export type CheckboxProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({className, ...props}, ref) => (
        <input
            type="checkbox"
            ref={ref}
            className={cn(
                "h-4 w-4 cursor-pointer rounded border border-neutral-300 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 checked:bg-neutral-900 checked:text-white dark:border-neutral-700 dark:bg-neutral-900 dark:checked:bg-white dark:checked:text-neutral-900",
                "disabled:cursor-not-allowed disabled:opacity-50",
                className,
            )}
            {...props}
        />
    ),
);
Checkbox.displayName = "Checkbox";
