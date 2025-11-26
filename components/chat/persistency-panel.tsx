"use client"

import {Button} from "@/components/ui/button"
import {Checkbox} from "@/components/ui/checkbox"

type PersistButtonState = "create" | "review" | "update"

type PersistencyPanelProps = {
    actionDisabled: boolean
    buttonState: PersistButtonState
    checkboxChecked: boolean
    checkboxDisabled: boolean
    helperText: string | null
    onAction: () => void
    onCheckboxChange: (checked: boolean) => void
    showActions: boolean
}

export const PersistencyPanel = ({
                                     actionDisabled,
                                     buttonState,
                                     checkboxChecked,
                                     checkboxDisabled,
                                     helperText,
                                     onAction,
                                     onCheckboxChange,
                                     showActions,
                                 }: PersistencyPanelProps) => {
    return (
        <div
            className="rounded-md border border-neutral-200 bg-white/60 p-3 dark:border-neutral-700 dark:bg-neutral-900/60">
            <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col">
          <span className="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
            Persistency layer writes
          </span>
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">
            Allow the assistant to prepare ai/ .mdc updates that will be committed
            back to your Bitbucket project/branch through a pull request.
          </span>
                </div>
                <Checkbox
                    disabled={checkboxDisabled}
                    checked={checkboxChecked}
                    onChange={(event) => onCheckboxChange(event.target.checked)}
                />
            </div>

            {showActions && (
                <div className="mt-3 flex flex-col gap-2">
                    <Button
                        size="sm"
                        disabled={actionDisabled}
                        onClick={onAction}
                        variant="outline"
                    >
                        {buttonState === "review"
                            ? "Review PR"
                            : buttonState === "update"
                                ? "Update PR"
                                : "Create PR"}
                    </Button>
                    {helperText && (
                        <p className="text-xs text-neutral-500 dark:text-neutral-400">
                            {helperText}
                        </p>
                    )}
                </div>
            )}
        </div>
    )
}
