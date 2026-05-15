/*
Basic list navigation utilities for use across plugins.

Supported:

- basic vertical motions: `j`, `k`, `gg`, `G`
- absolute jumps with counts on `gg`/`G`: `3gg`, `5G`
- single-axis counts for simple motions and linewise deletes: `5j`, `3dd`
- delete operator with relative count composition: `3dj`, `d2j`, `3d2j`
- basic list actions via configurable keys: `Space`, `Enter`
- boundary clamping and a nullable "no focus" state

Not implementing:

- horizontal or semantic motions such as `h`, `l`, `w`, `b`
- visual mode or persistent range selection
- search commands such as `/`, `n`, `N`
- undo/redo for destructive actions
- text objects, registers, marks, or macros
*/

import { computed, ref, onUnmounted, watch, type Ref } from "vue";
import { Err, Ok, type Result, assertNever } from "./utils";

export function shouldIgnoreGlobalKeydown(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return true;

  const target = event.target;
  if (!(target instanceof HTMLElement)) return false;

  return (
    target.isContentEditable ||
    target.closest("input, select, textarea, button, [contenteditable='true']") !== null
  );
}

type VimCount = Readonly<{ value: number }>;

function createCount(value: number): VimCount {
  return { value };
}

function appendCount(
  current: VimCount | null,
  digit: string
): Result<VimCount, string> {
  if (!/^\d$/.test(digit)) return Err(`expected a digit, got ${JSON.stringify(digit)}`);
  if (current === null) {
    return digit === "0"
      ? Err("counts cannot start with 0")
      : Ok(createCount(parseInt(digit, 10)));
  }
  return Ok(createCount(current.value * 10 + parseInt(digit, 10)));
}

export type VimListAction = "select" | "toggle" | "delete";
export type VimListActionKey = "space" | "enter";

export type VimListMoveTarget =
  | { kind: "relative"; direction: "down" | "up"; count: number }
  | { kind: "absolute"; target: "first" }
  | { kind: "absolute"; target: "last" }
  | { kind: "absolute"; target: "index"; index: number };

export type VimListAbsoluteTarget = Extract<VimListMoveTarget, { kind: "absolute" }>;

export type VimListDeleteTarget = { kind: "line"; count: number } | VimListMoveTarget;

export type VimListCommand =
  | { kind: "move"; target: VimListMoveTarget }
  | { kind: "action"; key: VimListActionKey; count: number }
  | { kind: "delete"; target: VimListDeleteTarget }
  | { kind: "clear-focus" };

export type VimListParserState =
  | { kind: "idle"; count: VimCount | null }
  | { kind: "awaiting-g"; count: VimCount | null }
  | {
      kind: "awaiting-delete-motion";
      operatorCount: VimCount | null;
      motionCount: VimCount | null;
    }
  | {
      kind: "awaiting-delete-g";
      operatorCount: VimCount | null;
      motionCount: VimCount | null;
    };

export const VIM_LIST_IDLE_STATE: VimListParserState = {
  kind: "idle",
  count: null
};

export type VimListKeyStep =
  | { status: "pending"; state: VimListParserState }
  | { status: "complete"; command: VimListCommand }
  | { status: "reset" }
  | { status: "error"; reason: string };

export interface VimListExecutionResult {
  nextFocus: number | null;
  action:
    | null
    | {
        kind: "delete";
        startIndex: number;
        count: number;
      }
    | {
        kind: "custom";
        key: VimListActionKey;
        startIndex: number;
        count: number;
      };
}

function complete(command: VimListCommand): VimListKeyStep {
  return {
    status: "complete",
    command
  };
}

function pending(state: VimListParserState): VimListKeyStep {
  return {
    status: "pending",
    state
  };
}

function reset(): VimListKeyStep {
  return { status: "reset" };
}

function error(reason: string): VimListKeyStep {
  return { status: "error", reason };
}

function absoluteTargetFromCount(
  count: VimCount | null,
  fallback: "first" | "last"
): VimListAbsoluteTarget {
  if (count === null) {
    return {
      kind: "absolute",
      target: fallback
    };
  }

  return {
    kind: "absolute",
    target: "index",
    index: count.value - 1
  };
}

function resolveRelativeDeleteCount(
  operatorCount: VimCount | null,
  motionCount: VimCount | null
): number {
  return (operatorCount?.value ?? 1) * (motionCount?.value ?? 1);
}

function resolveAbsoluteDeleteTarget(
  operatorCount: VimCount | null,
  motionCount: VimCount | null,
  fallback: "first" | "last"
): Result<VimListAbsoluteTarget, string> {
  if (operatorCount !== null && motionCount !== null) {
    return Err("absolute delete motions do not accept both operator and motion counts");
  }

  return Ok(absoluteTargetFromCount(motionCount ?? operatorCount, fallback));
}

function completeAbsoluteDeleteTarget(
  operatorCount: VimCount | null,
  motionCount: VimCount | null,
  fallback: "first" | "last"
): VimListKeyStep {
  const target = resolveAbsoluteDeleteTarget(operatorCount, motionCount, fallback);
  return target.ok
    ? complete({
        kind: "delete",
        target: target.value
      })
    : error(target.error);
}

function resolveActionBinding(
  actionBindings: Readonly<Record<VimListActionKey, Exclude<VimListAction, "delete">>>,
  key: VimListActionKey
): Result<Exclude<VimListAction, "delete">, string> {
  const action = actionBindings[key];
  return action === undefined ? Err(`missing action binding for ${key}`) : Ok(action);
}

export function hasPendingVimListInput(state: VimListParserState): boolean {
  switch (state.kind) {
    case "idle":
      return state.count !== null;
    case "awaiting-g":
    case "awaiting-delete-motion":
    case "awaiting-delete-g":
      return true;
  }

  return assertNever(
    state,
    "unhandled vim list parser state in hasPendingVimListInput"
  );
}

export function isRecognizedVimListKey(key: string): boolean {
  return (
    key === "Escape" ||
    key === "Enter" ||
    key === " " ||
    key === "j" ||
    key === "k" ||
    key === "g" ||
    key === "G" ||
    key === "d" ||
    /^\d$/.test(key)
  );
}

export function describeVimListParserState(state: VimListParserState): string | null {
  switch (state.kind) {
    case "idle":
      return state.count?.value.toString() ?? null;
    case "awaiting-g":
      return `${state.count?.value ?? ""}g`;
    case "awaiting-delete-motion":
      return `${state.operatorCount?.value ?? ""}d${state.motionCount?.value ?? ""}`;
    case "awaiting-delete-g":
      return `${state.operatorCount?.value ?? ""}d${state.motionCount?.value ?? ""}g`;
  }

  return assertNever(
    state,
    "unhandled vim list parser state in describeVimListParserState"
  );
}

export function stepVimListParser(
  state: VimListParserState,
  key: string
): VimListKeyStep {
  if (key === "Escape") {
    return complete({ kind: "clear-focus" });
  }

  if (!isRecognizedVimListKey(key)) {
    return reset();
  }

  switch (state.kind) {
    case "idle": {
      if (/^\d$/.test(key)) {
        const count = appendCount(state.count, key);
        return count.ok ? pending({ kind: "idle", count: count.value }) : reset();
      }

      const count = state.count?.value ?? 1;

      if (key === "j") {
        return complete({
          kind: "move",
          target: { kind: "relative", direction: "down", count }
        });
      }

      if (key === "k") {
        return complete({
          kind: "move",
          target: { kind: "relative", direction: "up", count }
        });
      }

      if (key === "G") {
        return complete({
          kind: "move",
          target: absoluteTargetFromCount(state.count, "last")
        });
      }

      if (key === "g") {
        return pending({
          kind: "awaiting-g",
          count: state.count
        });
      }

      if (key === "d") {
        return pending({
          kind: "awaiting-delete-motion",
          operatorCount: state.count,
          motionCount: null
        });
      }

      if (key === " ") {
        return complete({ kind: "action", key: "space", count });
      }

      if (key === "Enter") {
        return complete({ kind: "action", key: "enter", count });
      }

      return reset();
    }

    case "awaiting-g": {
      if (key === "g") {
        return complete({
          kind: "move",
          target: absoluteTargetFromCount(state.count, "first")
        });
      }

      return reset();
    }

    case "awaiting-delete-motion": {
      if (/^\d$/.test(key)) {
        const motionCount = appendCount(state.motionCount, key);
        return !motionCount.ok
          ? reset()
          : pending({
              kind: "awaiting-delete-motion",
              operatorCount: state.operatorCount,
              motionCount: motionCount.value
            });
      }

      if (key === "d") {
        return complete({
          kind: "delete",
          target: {
            kind: "line",
            count: resolveRelativeDeleteCount(state.operatorCount, state.motionCount)
          }
        });
      }

      if (key === "j") {
        return complete({
          kind: "delete",
          target: {
            kind: "relative",
            direction: "down",
            count: resolveRelativeDeleteCount(state.operatorCount, state.motionCount)
          }
        });
      }

      if (key === "k") {
        return complete({
          kind: "delete",
          target: {
            kind: "relative",
            direction: "up",
            count: resolveRelativeDeleteCount(state.operatorCount, state.motionCount)
          }
        });
      }

      if (key === "G") {
        return completeAbsoluteDeleteTarget(
          state.operatorCount,
          state.motionCount,
          "last"
        );
      }

      if (key === "g") {
        return pending({
          kind: "awaiting-delete-g",
          operatorCount: state.operatorCount,
          motionCount: state.motionCount
        });
      }

      return reset();
    }

    case "awaiting-delete-g": {
      if (key === "g") {
        return completeAbsoluteDeleteTarget(
          state.operatorCount,
          state.motionCount,
          "first"
        );
      }

      return reset();
    }
  }

  return assertNever(state, "unhandled vim list parser state in stepVimListParser");
}

function clampIndex(index: number, itemCount: number): number {
  return Math.max(0, Math.min(index, itemCount - 1));
}

function resolveAbsoluteIndex(
  target: VimListAbsoluteTarget,
  itemCount: number
): number {
  switch (target.target) {
    case "first":
      return 0;
    case "last":
      return itemCount - 1;
    case "index":
      return clampIndex(target.index, itemCount);
  }

  return assertNever(
    target,
    "unhandled vim list absolute target in resolveAbsoluteIndex"
  );
}

export function executeVimListCommand(
  command: VimListCommand,
  focusedIndex: number | null,
  itemCount: number
): VimListExecutionResult {
  if (command.kind === "clear-focus" || itemCount === 0) {
    return {
      nextFocus: null,
      action: null
    };
  }

  const currentIndex = focusedIndex === null ? 0 : clampIndex(focusedIndex, itemCount);

  switch (command.kind) {
    case "move": {
      const nextFocus =
        command.target.kind === "relative"
          ? clampIndex(
              currentIndex +
                (command.target.direction === "down"
                  ? command.target.count
                  : -command.target.count),
              itemCount
            )
          : resolveAbsoluteIndex(command.target, itemCount);

      return {
        nextFocus,
        action: null
      };
    }

    case "action": {
      return {
        nextFocus: currentIndex,
        action: {
          kind: "custom",
          key: command.key,
          startIndex: currentIndex,
          count: Math.max(1, Math.min(command.count, itemCount - currentIndex))
        }
      };
    }

    case "delete": {
      let deleteStart = currentIndex;
      let deleteEnd = currentIndex;

      if (command.target.kind === "line") {
        deleteEnd = clampIndex(currentIndex + command.target.count - 1, itemCount);
      } else if (command.target.kind === "relative") {
        deleteEnd = clampIndex(
          currentIndex +
            (command.target.direction === "down"
              ? command.target.count
              : -command.target.count),
          itemCount
        );
        deleteStart = Math.min(currentIndex, deleteEnd);
        deleteEnd = Math.max(currentIndex, deleteEnd);
      } else {
        const absoluteIndex = resolveAbsoluteIndex(command.target, itemCount);
        deleteStart = Math.min(currentIndex, absoluteIndex);
        deleteEnd = Math.max(currentIndex, absoluteIndex);
      }

      const deleteCount = deleteEnd - deleteStart + 1;
      const remainingCount = itemCount - deleteCount;

      return {
        nextFocus:
          remainingCount === 0 ? null : Math.min(deleteStart, remainingCount - 1),
        action: {
          kind: "delete",
          startIndex: deleteStart,
          count: deleteCount
        }
      };
    }
  }

  return assertNever(command, "unhandled vim list command in executeVimListCommand");
}

export function useVimList<T>(
  items: Ref<T[]>,
  options: {
    isActive: Ref<boolean>;
    target?: Ref<HTMLElement | null>;
    actionBindings?: Readonly<
      Record<VimListActionKey, Exclude<VimListAction, "delete">>
    >;
    onError?: (reason: string) => void;
    onAction: (action: VimListAction, startIndex: number, count: number) => void;
  }
) {
  const focusedIndex = ref<number | null>(null);
  const parserState = ref<VimListParserState>(VIM_LIST_IDLE_STATE);
  const lastError = ref<string | null>(null);
  let timer: number | null = null;
  const actionBindings = options.actionBindings ?? {
    space: "toggle",
    enter: "select"
  };

  const clear = () => {
    parserState.value = VIM_LIST_IDLE_STATE;
    if (timer) window.clearTimeout(timer);
    timer = null;
  };

  const refreshTimer = () => {
    if (timer) window.clearTimeout(timer);
    if (hasPendingVimListInput(parserState.value)) {
      timer = window.setTimeout(clear, 1000);
    } else {
      timer = null;
    }
  };

  const handleKeydown = (e: KeyboardEvent) => {
    if (!options.isActive.value || shouldIgnoreGlobalKeydown(e)) return;
    if (items.value.length === 0) {
      clear();
      return;
    }

    if (e.key === "Escape") {
      clear();
      focusedIndex.value = null;
      return;
    }

    if (!isRecognizedVimListKey(e.key)) {
      clear();
      return;
    }

    e.preventDefault();
    const step = stepVimListParser(parserState.value, e.key);

    if (step.status === "pending") {
      lastError.value = null;
      parserState.value = step.state;
      refreshTimer();
      return;
    }

    clear();

    if (step.status === "error") {
      lastError.value = step.reason;
      options.onError?.(step.reason);
      return;
    }

    if (step.status !== "complete") {
      lastError.value = null;
      return;
    }

    lastError.value = null;

    const execution = executeVimListCommand(
      step.command,
      focusedIndex.value,
      items.value.length
    );

    focusedIndex.value = execution.nextFocus;

    if (execution.action) {
      if (execution.action.kind === "delete") {
        options.onAction("delete", execution.action.startIndex, execution.action.count);
      } else {
        const action = resolveActionBinding(actionBindings, execution.action.key);
        if (!action.ok) {
          lastError.value = action.error;
          options.onError?.(action.error);
          return;
        }

        options.onAction(
          action.value,
          execution.action.startIndex,
          execution.action.count
        );
      }
    }
  };

  watch(
    () => items.value.length,
    len => {
      if (len === 0) focusedIndex.value = null;
      else if (focusedIndex.value !== null && focusedIndex.value >= len) {
        focusedIndex.value = len - 1;
      }
    }
  );

  watch(
    () => options.target?.value ?? null,
    (target, _previousTarget, onCleanup) => {
      const listenerTarget: Window | HTMLElement = target ?? window;
      listenerTarget.addEventListener("keydown", handleKeydown as EventListener);

      onCleanup(() => {
        listenerTarget.removeEventListener("keydown", handleKeydown as EventListener);
      });
    },
    { immediate: true }
  );

  onUnmounted(() => {
    clear();
  });

  return {
    focusedIndex,
    parserState: computed(() => parserState.value),
    pendingKeys: computed(() => describeVimListParserState(parserState.value)),
    lastError: computed(() => lastError.value),
    setFocus: (idx: number | null) => {
      focusedIndex.value = idx;
    }
  };
}
