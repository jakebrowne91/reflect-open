import { beforeEach, describe, expect, it } from "vitest";

import * as cardAgentRunRepo from "@kan/db/repository/cardAgentRun.repo";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

const DAY_MS = 24 * 60 * 60 * 1000;

function daysAgo(days: number) {
  return new Date(Date.now() - days * DAY_MS);
}

describe("cardAgentRun repository integration tests", () => {
  let db: TestDbClient;
  let testUser: { id: string };
  let resolvedList: { id: number };
  let readyForReviewList: { id: number };
  let investigatingList: { id: number };
  let cardCounter: number;
  let runCounter: number;

  async function createList(args: { boardId: number; name: string }) {
    cardCounter += 1;
    const [list] = await db
      .insert(schema.lists)
      .values({
        publicId: `list${String(cardCounter).padStart(8, "0")}`,
        name: args.name,
        index: cardCounter,
        createdBy: testUser.id,
        boardId: args.boardId,
      })
      .returning();

    return list!;
  }

  async function createCard(args: {
    listId: number;
    title?: string;
    updatedAt?: Date;
    deletedAt?: Date;
  }) {
    cardCounter += 1;
    const [card] = await db
      .insert(schema.cards)
      .values({
        publicId: `card${String(cardCounter).padStart(8, "0")}`,
        title: args.title ?? `Card ${cardCounter}`,
        index: cardCounter,
        createdBy: testUser.id,
        listId: args.listId,
        updatedAt: args.updatedAt ?? null,
        deletedAt: args.deletedAt ?? null,
      })
      .returning();

    return card!;
  }

  async function createRun(args: {
    cardId: number;
    response?: unknown;
    createdAt?: Date;
  }) {
    runCounter += 1;
    const [run] = await db
      .insert(schema.cardAgentRuns)
      .values({
        publicId: `run${String(runCounter).padStart(9, "0")}`,
        cardId: args.cardId,
        createdBy: testUser.id,
        agent: "ari-gold",
        status: "ready_for_review",
        prompt: "Investigate this ticket.",
        response: args.response ?? null,
        createdAt: args.createdAt ?? new Date(),
      })
      .returning();

    return run!;
  }

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    testUser = seeded.user;
    cardCounter = 0;
    runCounter = 0;

    const [board] = await db
      .insert(schema.boards)
      .values({
        publicId: "board1234567",
        name: "Customer Support",
        slug: "customer-support",
        createdBy: testUser.id,
        workspaceId: seeded.workspace.id,
      })
      .returning();

    resolvedList = await createList({ boardId: board!.id, name: "Resolved" });
    readyForReviewList = await createList({
      boardId: board!.id,
      name: "Ready for Review",
    });
    investigatingList = await createList({
      boardId: board!.id,
      name: "Investigating",
    });
  });

  describe("listRecentKnownIssues", () => {
    it("returns recently resolved/ready cards with root cause and fix from the latest ticket update", async () => {
      const resolvedCard = await createCard({
        listId: resolvedList.id,
        title: "Outreach emails not sending",
        updatedAt: daysAgo(1),
      });
      const readyCard = await createCard({
        listId: readyForReviewList.id,
        title: "Analytics dashboard shows stale data",
        updatedAt: daysAgo(2),
      });
      await createCard({
        listId: investigatingList.id,
        title: "Still being investigated",
        updatedAt: daysAgo(1),
      });

      await supportTicketMetadataRepo.upsertForCard(db, {
        cardId: resolvedCard.id,
        externalId: `external-${resolvedCard.id}`,
        source: "email",
        issueCategory: "deliverability",
      });

      // Older run with a ticket update — must be superseded by the newer one.
      await createRun({
        cardId: resolvedCard.id,
        response: {
          ticketUpdate: { rootCause: "old root cause", fix: "old fix" },
        },
        createdAt: daysAgo(3),
      });
      await createRun({
        cardId: resolvedCard.id,
        response: {
          ticketUpdate: {
            rootCause: "Sendgrid API key was rotated without redeploy",
            fix: "Redeployed worker with the rotated key",
          },
        },
        createdAt: daysAgo(1),
      });
      // Run without a ticketUpdate must not contribute root cause/fix.
      await createRun({
        cardId: readyCard.id,
        response: { prUrl: "https://github.com/org/repo/pull/1" },
        createdAt: daysAgo(1),
      });

      const issues = await cardAgentRunRepo.listRecentKnownIssues(db);

      expect(issues.map((issue) => issue.cardPublicId)).toEqual([
        resolvedCard.publicId,
        readyCard.publicId,
      ]);
      expect(issues[0]).toMatchObject({
        title: "Outreach emails not sending",
        issueCategory: "deliverability",
        rootCause: "Sendgrid API key was rotated without redeploy",
        fix: "Redeployed worker with the rotated key",
      });
      expect(issues[0]!.resolvedAt).toBeInstanceOf(Date);
      expect(issues[1]).toMatchObject({
        title: "Analytics dashboard shows stale data",
        issueCategory: null,
        rootCause: null,
        fix: null,
      });
    });

    it("excludes deleted cards and cards resolved outside the window", async () => {
      const recentCard = await createCard({
        listId: resolvedList.id,
        updatedAt: daysAgo(1),
      });
      await createCard({
        listId: resolvedList.id,
        title: "Resolved too long ago",
        updatedAt: daysAgo(20),
      });
      await createCard({
        listId: resolvedList.id,
        title: "Deleted card",
        updatedAt: daysAgo(1),
        deletedAt: new Date(),
      });

      const issues = await cardAgentRunRepo.listRecentKnownIssues(db);

      expect(issues.map((issue) => issue.cardPublicId)).toEqual([
        recentCard.publicId,
      ]);
    });

    it("caps results at the provided limit and excludes the requested card", async () => {
      const cards: Awaited<ReturnType<typeof createCard>>[] = [];
      for (let index = 0; index < 4; index += 1) {
        cards.push(
          await createCard({
            listId: resolvedList.id,
            updatedAt: daysAgo(index + 1),
          }),
        );
      }

      const issues = await cardAgentRunRepo.listRecentKnownIssues(db, {
        limit: 2,
        excludeCardId: cards[0]!.id,
      });

      expect(issues.map((issue) => issue.cardPublicId)).toEqual([
        cards[1]!.publicId,
        cards[2]!.publicId,
      ]);
    });
  });
});
