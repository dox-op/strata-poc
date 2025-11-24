"use client";

import * as React from "react";
import {cn} from "@/lib/utils";

export interface CheckboxProps
    extends React.InputHTMLAttributes<HTMLInputElement> {
    indeterminate?: boolean;
}

export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
    ({className, indeterminate = false, ...props}, ref) => {
        const internalRef = React.useRef<HTMLInputElement | null>(null);

        const mergedRef = React.useCallback(
            (node: HTMLInputElement | null) => {
                internalRef.current = node;
                if (typeof ref === "function") {
                    ref(node);
                } else if (ref) {
                    // eslint-disable-next-line no-param-reassign
                    (ref as React.MutableRefObject<HTMLInputElement | null>).current =
                        node;
                }
            },
            [ref],
        );

        React.useEffect(() => {
            if (internalRef.current) {
                internalRef.current.indeterminate = indeterminate;
            }
        }, [indeterminate]);

        const ariaChecked =
            indeterminate === true
                ? "mixed"
                : props.checked
                    ? "true"
                    : "false";

        return (
            <input
                type="checkbox"
                ref={mergedRef}
                aria-checked={ariaChecked}
                className={cn(
                    "h-4 w-4 cursor-pointer rounded border border-neutral-300 bg-white text-primary focus:outline-none focus:ring-2 focus:ring-neutral-400 focus:ring-offset-2 checked:bg-neutral-900 checked:text-white dark:border-neutral-700 dark:bg-neutral-900 dark:checked:bg-white dark:checked:text-neutral-900",
                    "disabled:cursor-not-allowed disabled:opacity-50",
                    className,
                )}
                {...props}
            />
        );
    },
);
Checkbox.displayName = "Checkbox";
