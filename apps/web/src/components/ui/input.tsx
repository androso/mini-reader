import * as React from "react";

import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, ...props }, ref) => {
        return (
            <input
                type={type}
                className={cn(
                    "ease-hallmark-out flex h-11 w-full rounded-[var(--radius-input)] border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] px-3 py-2 pr-9 text-sm text-[var(--color-ink)] outline-2 outline-transparent transition-[background-color,border-color] duration-short file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-[var(--color-ink)] placeholder:text-[var(--color-ink-soft)] focus-visible:border-[var(--color-ink-2)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-1 disabled:cursor-not-allowed disabled:opacity-[0.55]",
                    className
                )}
                ref={ref}
                {...props}
            />
        );
    }
);
Input.displayName = "Input";

export { Input };
