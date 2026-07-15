import { describe, expect, it } from "vitest";

import {
  boardSourceFilterOptions,
  getBoardSourceFilter,
  normaliseBoardSourceFilters,
} from "./sourceFilter";

describe("board source filters", () => {
  it("defines the support source buckets shown in the filter menu", () => {
    expect(boardSourceFilterOptions.map((option) => option.key)).toEqual([
      "slack",
      "emma",
      "sentry",
      "email",
    ]);
  });

  it("accepts only known support source filters", () => {
    expect(getBoardSourceFilter("slack")).toBe("slack");
    expect(getBoardSourceFilter("staff")).toBeNull();
    expect(getBoardSourceFilter(undefined)).toBeNull();
  });

  it("deduplicates selected source filters and drops unknown values", () => {
    expect(
      normaliseBoardSourceFilters(["slack", "staff", "slack", "email"]),
    ).toEqual(["slack", "email"]);
  });
});
