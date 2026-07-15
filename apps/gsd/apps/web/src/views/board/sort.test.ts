import { describe, expect, it } from "vitest";

import type { SortableBoardCard, SortableBoardListItem } from "./sort";
import { getBoardSortBy, sortBoardCards, sortBoardListItems } from "./sort";

const card = (
  publicId: string,
  values: Partial<SortableBoardCard>,
): SortableBoardCard & { publicId: string } => ({
  publicId,
  index: 0,
  createdAt: "2026-05-16T10:00:00.000Z",
  updatedAt: null,
  priority: null,
  labels: [],
  supportTicketMetadata: null,
  ...values,
});

const ids = (cards: { publicId: string }[]) =>
  cards.map((item) => item.publicId);

const item = (
  publicId: string,
  listName: string,
  listIndex: number,
  values: Partial<SortableBoardCard> = {},
): SortableBoardListItem<SortableBoardCard & { publicId: string }> & {
  card: SortableBoardCard & { publicId: string };
} => ({
  card: card(publicId, values),
  list: { name: listName },
  listIndex,
  cardIndex: values.index ?? 0,
});

describe("board card sorting", () => {
  it("accepts source as a board sort key", () => {
    expect(getBoardSortBy("source")).toBe("source");
  });

  it("accepts list as a board sort key", () => {
    expect(getBoardSortBy("list")).toBe("list");
  });

  it("sorts by source channel and system", () => {
    const cards = [
      card("whatsapp", {
        supportTicketMetadata: {
          sourceChannel: "whatsapp",
          sourceSystem: "ari_gold",
        },
      }),
      card("slack", {
        supportTicketMetadata: {
          sourceChannel: "slack",
          sourceSystem: "slack_bot",
        },
      }),
      card("imessage", {
        supportTicketMetadata: {
          sourceChannel: "imessage",
          sourceSystem: "ari_gold",
        },
      }),
    ];

    expect(
      ids(sortBoardCards(cards, [{ sortBy: "source", direction: "asc" }])),
    ).toEqual(["imessage", "slack", "whatsapp"]);
    expect(
      ids(sortBoardCards(cards, [{ sortBy: "source", direction: "desc" }])),
    ).toEqual(["whatsapp", "slack", "imessage"]);
  });

  it("sorts recently updated cards using the other card timestamp", () => {
    const cards = [
      card("older", {
        index: 1,
        createdAt: "2026-05-16T08:00:00.000Z",
        updatedAt: "2026-05-16T09:00:00.000Z",
      }),
      card("newer", {
        index: 2,
        createdAt: "2026-05-16T08:00:00.000Z",
        updatedAt: "2026-05-16T11:00:00.000Z",
      }),
      card("fallback-created", {
        index: 3,
        createdAt: "2026-05-16T10:00:00.000Z",
        updatedAt: null,
      }),
    ];

    expect(
      ids(sortBoardCards(cards, [{ sortBy: "updatedAt", direction: "desc" }])),
    ).toEqual(["newer", "fallback-created", "older"]);
  });

  it("uses secondary sort after source matches", () => {
    const cards = [
      card("late", {
        index: 1,
        createdAt: "2026-05-16T11:00:00.000Z",
        supportTicketMetadata: { sourceChannel: "slack" },
      }),
      card("early", {
        index: 2,
        createdAt: "2026-05-16T09:00:00.000Z",
        supportTicketMetadata: { sourceChannel: "slack" },
      }),
    ];

    expect(
      ids(
        sortBoardCards(cards, [
          { sortBy: "source", direction: "asc" },
          { sortBy: "createdAt", direction: "asc" },
        ]),
      ),
    ).toEqual(["early", "late"]);
  });

  it("sorts list view rows by list order", () => {
    const items = [
      item("todo", "Todo", 0),
      item("done", "Done", 2),
      item("doing", "Doing", 1),
    ];

    expect(
      ids(
        sortBoardListItems(items, [{ sortBy: "list", direction: "asc" }]).map(
          ({ card }) => card,
        ),
      ),
    ).toEqual(["todo", "doing", "done"]);
    expect(
      ids(
        sortBoardListItems(items, [{ sortBy: "list", direction: "desc" }]).map(
          ({ card }) => card,
        ),
      ),
    ).toEqual(["done", "doing", "todo"]);
  });

  it("sorts list view rows globally instead of inside each list", () => {
    const items = [
      item("gmail", "Done", 1, {
        supportTicketMetadata: { sourceChannel: "gmail" },
      }),
      item("ari", "Todo", 0, {
        supportTicketMetadata: { sourceChannel: "ari" },
      }),
      item("slack", "Todo", 0, {
        supportTicketMetadata: { sourceChannel: "slack" },
      }),
    ];

    expect(
      ids(
        sortBoardListItems(items, [{ sortBy: "source", direction: "asc" }]).map(
          ({ card }) => card,
        ),
      ),
    ).toEqual(["ari", "gmail", "slack"]);
  });
});
