import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipPosition } from "@/types/tooltipTypes";

export default function TextSelectionTooltip({
    position,
    children,
}: {
    position: TooltipPosition;
    children: React.ReactNode;
}) {
    return (
        <TooltipProvider>
            <Tooltip open={true}>
                <TooltipTrigger asChild>
                    <div
                        className="absolute w-1 h-1 opacity-0"
                        style={{
                            left: `${position.x}px`,
                            top: `${position.y}px`,
                        }}
                    />
                </TooltipTrigger>
                <TooltipContent side="bottom" sideOffset={5}>
                    {children}
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    );
}
