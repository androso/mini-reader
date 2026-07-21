import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "ease-hallmark-out inline-flex min-h-11 items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-pill)] text-sm font-semibold transition-[transform,background-color,border-color,color,box-shadow,opacity] duration-short focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--color-focus)] focus-visible:outline-offset-3 disabled:cursor-not-allowed disabled:pointer-events-none disabled:opacity-[0.55] active:translate-y-px [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
    {
        variants: {
            variant: {
                default:
                    "bg-[var(--color-accent)] text-[var(--color-accent-ink)] shadow-[0_4px_0_var(--color-accent-deep)] hover:-translate-y-0.5 hover:shadow-[0_6px_0_var(--color-accent-deep)]",
                destructive:
                    "border border-[var(--color-accent-3)] bg-transparent text-[var(--color-ink)] hover:bg-[var(--color-accent-3-soft)]",
                outline:
                    "border border-[var(--color-rule-strong)] bg-[var(--color-paper-raised)] text-[var(--color-ink)] hover:bg-[var(--color-paper-2)]",
                secondary:
                    "bg-[var(--color-accent-2-soft)] text-[var(--color-ink)] hover:bg-[var(--color-paper-3)]",
                ghost: "text-current hover:bg-[color-mix(in_oklch,currentColor_10%,transparent)]",
                link: "text-[var(--color-focus)] underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "min-h-11 px-3",
                lg: "min-h-12 px-8",
                icon: "h-11 w-11",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
);

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
        VariantProps<typeof buttonVariants> {
    asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        const Comp = asChild ? Slot : "button";
        return (
            <Comp
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        );
    }
);
Button.displayName = "Button";

export { Button, buttonVariants };
