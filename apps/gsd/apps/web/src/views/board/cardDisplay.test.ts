import { afterEach, describe, expect, it, vi } from "vitest";

import {
  defaultBoardCardDisplayFields,
  getBoardCardDisplayItems,
  normaliseBoardCardDisplayFields,
  persistBoardCardDisplayPreference,
  readBoardCardDisplayPreference,
} from "./cardDisplay";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("board card display fields", () => {
  it("shows all known fields by default", () => {
    expect(defaultBoardCardDisplayFields).toEqual([
      "sourceChannel",
      "source",
      "sourceSystem",
      "issueCategory",
      "reportedAt",
      "updatedAt",
      "customerName",
      "email",
      "userId",
      "emmaUserId",
      "externalId",
    ]);
  });

  it("normalises persisted fields and removes invalid values", () => {
    expect(
      normaliseBoardCardDisplayFields([
        "sourceChannel",
        "sourceChannel",
        "not-real",
        "userId",
      ]),
    ).toEqual(["sourceChannel", "userId"]);
  });

  it("formats support ticket metadata for compact card display", () => {
    const items = getBoardCardDisplayItems(
      {
        externalId: "slack-support:codex-smoke:1778956231003:session-long-id",
        source: "slack_bot",
        sourceSystem: "slack_bot",
        sourceChannel: "slack",
        userId: "1e661d90-79c2-4fdc-81d5-97fc3af98486",
        emmaUserId: "97937b98-cc5d-44cd-b8be-7364740814ad",
        email: "creator@example.com",
        customerName: "Creator One",
        issueCategory: "staff_escalation",
        reportedAt: new Date("2026-05-16T13:43:18.075Z"),
      },
      defaultBoardCardDisplayFields,
      (value) =>
        (value instanceof Date ? value : new Date(value)).toISOString(),
    );

    expect(items).toMatchObject([
      { key: "sourceChannel", label: "Channel", value: "Slack" },
      { key: "issueCategory", label: "Type", value: "Staff request" },
      {
        key: "reportedAt",
        label: "Reported",
        value: "2026-05-16T13:43:18.075Z",
      },
      { key: "customerName", label: "Customer", value: "Creator One" },
      { key: "email", label: "Email", value: "creator@example.com" },
      { key: "userId", label: "User ID", value: "1e661d90-79c...3af98486" },
      { key: "emmaUserId", label: "Emma ID", value: "97937b98-cc5...740814ad" },
      {
        key: "externalId",
        label: "External ID",
        value: "slack-suppor...-long-id",
      },
    ]);
  });

  it("persists card field preferences per board", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    persistBoardCardDisplayPreference("board-1", ["sourceChannel", "userId"]);

    expect(readBoardCardDisplayPreference("board-1")).toEqual([
      "sourceChannel",
      "userId",
    ]);
  });

  it("keeps updated time visible when reading legacy preferences", () => {
    const storage = new Map<string, string>([
      [
        "gsd:board-card-fields:board-1",
        JSON.stringify({
          version: 1,
          fields: ["sourceChannel", "userId"],
        }),
      ],
    ]);
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    expect(readBoardCardDisplayPreference("board-1")).toEqual([
      "sourceChannel",
      "userId",
      "updatedAt",
    ]);
  });

  it("allows updated time to be hidden in current preferences", () => {
    const storage = new Map<string, string>();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value),
      },
    });

    persistBoardCardDisplayPreference("board-1", []);

    expect(readBoardCardDisplayPreference("board-1")).toEqual([]);
  });
});
