"use client";

import type { ReactNode } from "react";
import { Collapsible } from "@base-ui/react/collapsible";
import { TextShimmer } from "../text-shimmer";
import { IconChevronRight } from "@tabler/icons-react";
import { cn } from "../utils/cn";

export type ToolRowBaseProps = {
  icon?: ReactNode;
  shimmerLabel?: string;
  completeLabel: string;
  isAnimating: boolean;
  detail?: string;
  trailingContent?: ReactNode;
  expandable?: boolean;
  expanded?: boolean;
  defaultOpen?: boolean;
  onToggleExpand?: () => void;
  children?: ReactNode;
};

export function ToolRowBase({
  icon,
  shimmerLabel,
  completeLabel,
  isAnimating,
  detail,
  trailingContent,
  expandable = false,
  expanded,
  defaultOpen = false,
  onToggleExpand,
  children,
}: ToolRowBaseProps) {
  const isComplete = !isAnimating;
  const isExpanded = expanded ?? false;
  const canToggle = expandable && (isComplete || isExpanded || isAnimating);

  const row = (
    <div
      className={cn(
        "flex min-w-0 items-center gap-2 px-3 py-2",
        canToggle && "cursor-pointer select-none",
      )}
    >
      {icon && (
        <span className="flex size-4 shrink-0 items-center justify-center text-[var(--an-foreground-subtle,#a3a3a3)]">
          {icon}
        </span>
      )}
      <span className="min-w-0 flex-1 text-sm font-medium">
        {isAnimating && shimmerLabel ? (
          <TextShimmer as="span" duration={1.6}>
            {shimmerLabel}
          </TextShimmer>
        ) : (
          <span className="text-[var(--an-foreground-muted,#737373)]">
            {completeLabel}
          </span>
        )}
      </span>
      {detail && (
        <span className="truncate text-xs text-[var(--an-foreground-subtle,#a3a3a3)]">
          {detail}
        </span>
      )}
      {trailingContent}
      {expandable && (isComplete || isExpanded || isAnimating) && (
        <IconChevronRight
          className={cn(
            "size-3.5 shrink-0 text-[var(--an-foreground-subtle,#a3a3a3)] transition-transform duration-200",
            isExpanded && "rotate-90",
          )}
        />
      )}
    </div>
  );

  if (!expandable) {
    return (
      <div
        className={cn(
          "rounded-[var(--an-tool-border-radius,10px)] border border-[var(--an-tool-border-color,#e4e4e7)] bg-[var(--an-tool-background,#f5f5f5)]",
        )}
      >
        {row}
      </div>
    );
  }

  const rootProps =
    expanded === undefined
      ? { defaultOpen }
      : { open: expanded, onOpenChange: onToggleExpand };

  return (
    <Collapsible.Root
      {...rootProps}
      className={cn(
        "rounded-[var(--an-tool-border-radius,10px)] border border-[var(--an-tool-border-color,#e4e4e7)] bg-[var(--an-tool-background,#f5f5f5)]",
      )}
    >
      <Collapsible.Trigger className="w-full text-left">
        {row}
      </Collapsible.Trigger>
      <Collapsible.Panel className="overflow-hidden px-3 pb-3 pt-0">
        {children}
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
