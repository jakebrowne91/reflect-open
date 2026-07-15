import { describe, expect, it } from "vitest";

import { defaultBoardViewMode, getBoardViewMode } from "./boardView";

describe("board view mode", () => {
  it("accepts board and list view modes", () => {
    expect(getBoardViewMode("board")).toBe("board");
    expect(getBoardViewMode("list")).toBe("list");
  });

  it("rejects unknown values", () => {
    expect(getBoardViewMode("table")).toBeNull();
    expect(getBoardViewMode(undefined)).toBeNull();
  });

  it("keeps board as the default mode", () => {
    expect(defaultBoardViewMode).toBe("board");
  });
});
