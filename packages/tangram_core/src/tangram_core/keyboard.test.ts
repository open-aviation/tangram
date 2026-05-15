import { describe, expect, it } from "vitest";
import {
  VIM_LIST_IDLE_STATE,
  executeVimListCommand,
  stepVimListParser,
  type VimListCommand,
  type VimListKeyStep,
  type VimListParserState
} from "./keyboard";

type SequenceResult =
  | { status: "success"; command: VimListCommand }
  | { status: "incomplete"; state: VimListParserState }
  | { status: "error"; reason: string };

function parseSequence(keys: string[]): SequenceResult {
  let state: VimListParserState = VIM_LIST_IDLE_STATE;

  for (const key of keys) {
    const result: VimListKeyStep = stepVimListParser(state, key);

    if (result.status === "pending") {
      state = result.state;
      continue;
    }

    if (result.status === "complete") {
      return {
        status: "success",
        command: result.command
      };
    }

    if (result.status === "error") {
      return result;
    }

    return {
      status: "error",
      reason: "sequence reset"
    };
  }

  return {
    status: "incomplete",
    state
  };
}

function expectSuccess(result: SequenceResult): VimListCommand {
  expect(result.status).toBe("success");
  if (result.status !== "success") {
    throw new Error(`expected success, got ${result.status}`);
  }
  return result.command;
}

describe("stepVimListParser", () => {
  it("parses gg as an absolute jump to the first item", () => {
    const command = expectSuccess(parseSequence(["g", "g"]));

    expect(command).toEqual({
      kind: "move",
      target: { kind: "absolute", target: "first" }
    });
  });

  it("parses a counted relative move", () => {
    const command = expectSuccess(parseSequence(["5", "j"]));

    expect(command).toEqual({
      kind: "move",
      target: { kind: "relative", direction: "down", count: 5 }
    });
  });

  it("parses dd and dG delete forms", () => {
    expect(expectSuccess(parseSequence(["d", "d"]))).toEqual({
      kind: "delete",
      target: { kind: "line", count: 1 }
    });

    expect(expectSuccess(parseSequence(["d", "5", "d"]))).toEqual({
      kind: "delete",
      target: { kind: "line", count: 5 }
    });

    expect(expectSuccess(parseSequence(["d", "G"]))).toEqual({
      kind: "delete",
      target: { kind: "absolute", target: "last" }
    });
  });

  it("multiplies operator and motion counts for relative delete motions", () => {
    expect(expectSuccess(parseSequence(["3", "d", "2", "j"]))).toEqual({
      kind: "delete",
      target: { kind: "relative", direction: "down", count: 6 }
    });
  });
});

describe("executeVimListCommand", () => {
  it("moves focus for gg and counted j", () => {
    expect(
      executeVimListCommand(expectSuccess(parseSequence(["g", "g"])), 6, 10)
    ).toEqual({
      nextFocus: 0,
      action: null
    });

    expect(
      executeVimListCommand(expectSuccess(parseSequence(["5", "j"])), 1, 10)
    ).toEqual({
      nextFocus: 6,
      action: null
    });
  });

  it("deletes counted lines with dd", () => {
    expect(
      executeVimListCommand(expectSuccess(parseSequence(["3", "d", "d"])), 4, 10)
    ).toEqual({
      nextFocus: 4,
      action: {
        kind: "delete",
        startIndex: 4,
        count: 3
      }
    });

    expect(
      executeVimListCommand(expectSuccess(parseSequence(["d", "5", "d"])), 4, 10)
    ).toEqual({
      nextFocus: 4,
      action: {
        kind: "delete",
        startIndex: 4,
        count: 5
      }
    });
  });

  it("deletes through the end with dG", () => {
    expect(
      executeVimListCommand(expectSuccess(parseSequence(["d", "G"])), 4, 10)
    ).toEqual({
      nextFocus: 3,
      action: {
        kind: "delete",
        startIndex: 4,
        count: 6
      }
    });
  });

  it("deletes an inclusive relative range with multiplied counts", () => {
    expect(
      executeVimListCommand(expectSuccess(parseSequence(["3", "d", "2", "j"])), 2, 10)
    ).toEqual({
      nextFocus: 2,
      action: {
        kind: "delete",
        startIndex: 2,
        count: 7
      }
    });
  });
});
