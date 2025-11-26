import * as React from "react"
import {Slot} from "@radix-ui/react-slot"
import {tv, type VariantProps} from "tailwind-variants"
import {cn} from "@/lib/utils";

const buttonVariants = tv({
    base:
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-neutral-300 disabled:text-neutral-600 disabled:opacity-80 disabled:shadow-none dark:disabled:bg-neutral-700 dark:disabled:text-neutral-300",
    variants: {
        variant: {
            default: "bg-primary text-primary-foreground hover:bg-primary/90",
            destructive:
                "bg-destructive text-destructive-foreground hover:bg-destructive/90",
            outline:
                "border border-input bg-background hover:bg-accent hover:text-white dark:hover:text-white disabled:border-muted",
            secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
            ghost:
                "hover:bg-accent hover:text-white dark:hover:text-white disabled:bg-transparent",
            link: "text-primary underline-offset-4 hover:underline disabled:bg-transparent disabled:no-underline",
        },
        size: {
            default: "h-10 px-4 py-2",
            sm: "h-9 rounded-md px-3",
            lg: "h-11 rounded-md px-8",
            icon: "h-10 w-10",
        },
    },
    defaultVariants: {
        variant: "default",
        size: "default",
    },
})

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({className, variant, size, asChild = false, ...props}, ref) => {
        const Comp = asChild ? Slot : "button"
        return (
            <Comp
                className={cn(buttonVariants({variant, size, className}))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

export {Button, buttonVariants}
