import * as React from "react"

import {tv} from "tailwind-variants"
import {cn} from "@/lib/utils";

export interface InputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {}

const inputStyles = tv({
    base:
        "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground disabled:border-muted disabled:shadow-none disabled:focus-visible:ring-0 disabled:focus-visible:ring-offset-0",
})

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(inputStyles({className}))}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

export {Input}
