"use client";

import { memo } from "react";
import type { TimelineStep, StepState } from "../types/timeline";
import { useToolComplete } from "../hooks/use-tool-complete";
import { ToolRowBase } from "./tool-row-base";

export type ThinkingCollapsedProps = {
  step: Extract<TimelineStep, { type: "tool-call" }>;
  state: StepState;
  onComplete: () => void;
  defaultOpen?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

export function ThinkingCollapsed({
  step,
  state,
  onComplete,
  defaultOpen,
  expanded,
  onToggleExpand,
}: ThinkingCollapsedProps) {
  useToolComplete(state === "animating", step.duration, onComplete);

  return (
    <ToolRowBase
      shimmerLabel="Thinking"
      completeLabel="Thought"
      isAnimating={state === "animating"}
      expandable={!!step.thoughtContent}
      defaultOpen={defaultOpen}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    >
      <div className="max-h-[175px] overflow-y-auto">
        <p className="whitespace-pre-wrap text-sm text-[var(--an-foreground-muted,#737373)]">
          {step.thoughtContent}
        </p>
      </div>
    </ToolRowBase>
  );
}

export type ThinkingToolProps = {
  /** Pass a `part` from the Vercel AI SDK tool invocation, or provide step+state+onComplete directly. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  part?: any;
  step?: Extract<TimelineStep, { type: "tool-call" }>;
  state?: StepState;
  onComplete?: () => void;
  defaultOpen?: boolean;
  expanded?: boolean;
  onToggleExpand?: () => void;
};

export const ThinkingTool = memo(function ThinkingTool({
  part,
  step: externalStep,
  state: externalState,
  onComplete: externalOnComplete,
  defaultOpen,
  expanded,
  onToggleExpand,
}: ThinkingToolProps) {
  let step: Extract<TimelineStep, { type: "tool-call" }>;
  let stepState: StepState;
  let onComplete: () => void;

  if (externalStep && externalState && externalOnComplete) {
    step = externalStep;
    stepState = externalState;
    onComplete = externalOnComplete;
  } else if (part) {
    const aiState: "partial-call" | "call" | "result" =
      part.state === "output-available"
        ? "result"
        : part.state === "input-streaming"
          ? "partial-call"
          : "call";

    step = {
      id: part.toolCallId ?? part.id ?? "thinking",
      type: "tool-call",
      toolName: "Thinking",
      toolDetail: "",
      duration: Number.MAX_SAFE_INTEGER,
      toolVariant: "thinking",
      thoughtContent:
        typeof part.input?.thought === "string"
          ? part.input.thought
          : typeof part.result === "string"
            ? part.result
            : undefined,
    };
    stepState = aiState === "result" ? "complete" : "animating";
    onComplete = () => {};
  } else {
    return null;
  }

  return (
    <ThinkingCollapsed
      step={step}
      state={stepState}
      onComplete={onComplete}
      defaultOpen={defaultOpen}
      expanded={expanded}
      onToggleExpand={onToggleExpand}
    />
  );
});
