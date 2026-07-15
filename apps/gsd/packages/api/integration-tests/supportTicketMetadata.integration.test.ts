import { beforeEach, describe, expect, it } from "vitest";

import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import * as schema from "@kan/db/schema";

import type { TestDbClient } from "./test-db";
import { createTestDb, seedTestData } from "./test-db";

describe("supportTicketMetadata repository integration tests", () => {
  let db: TestDbClient;
  let testUser: { id: string; name: string | null };
  let testWorkspace: { id: number; publicId: string };
  let testList: { id: number };
  let cardCounter: number;

  async function createBoardWithList(args: {
    workspaceId: number;
    boardPublicId: string;
    listPublicId: string;
  }) {
    const [board] = await db
      .insert(schema.boards)
      .values({
        publicId: args.boardPublicId,
        name: "Customer Support",
        slug: args.boardPublicId,
        createdBy: testUser.id,
        workspaceId: args.workspaceId,
      })
      .returning();

    const [list] = await db
      .insert(schema.lists)
      .values({
        publicId: args.listPublicId,
        name: "Inbox",
        index: 0,
        createdBy: testUser.id,
        boardId: board!.id,
      })
      .returning();

    return { board: board!, list: list! };
  }

  async function createCard(args: {
    listId: number;
    title?: string;
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
        deletedAt: args.deletedAt ?? null,
      })
      .returning();

    return card!;
  }

  async function createMetadata(args: {
    cardId: number;
    issueCategory?: string | null;
    reportedAt?: Date | null;
    email?: string | null;
    customerName?: string | null;
    source?: string;
  }) {
    return supportTicketMetadataRepo.upsertForCard(db, {
      cardId: args.cardId,
      externalId: `external-${args.cardId}`,
      source: args.source ?? "email",
      issueCategory: args.issueCategory ?? null,
      reportedAt: args.reportedAt ?? null,
      email: args.email ?? null,
      customerName: args.customerName ?? null,
    });
  }

  beforeEach(async () => {
    db = await createTestDb();
    const seeded = await seedTestData(db);
    testUser = seeded.user;
    testWorkspace = seeded.workspace;
    cardCounter = 0;

    const { list } = await createBoardWithList({
      workspaceId: testWorkspace.id,
      boardPublicId: "board1234567",
      listPublicId: "list12345678",
    });
    testList = list;
  });

  async function createEmailMessage(args: {
    sourceEventId: string;
    cardId?: number | null;
    direction?: "inbound" | "outbound";
    processingStatus?: string;
    customerEmail?: string | null;
    customerName?: string | null;
    subject?: string | null;
    summary?: string | null;
    classification?: Record<string, unknown> | null;
    receivedAt?: Date | null;
  }) {
    return supportTicketMetadataRepo.upsertEmailMessage(db, {
      cardId: args.cardId ?? null,
      sourceEventId: args.sourceEventId,
      direction: args.direction ?? "inbound",
      processingStatus: args.processingStatus,
      customerEmail: args.customerEmail ?? null,
      customerName: args.customerName ?? null,
      subject: args.subject ?? null,
      summary: args.summary ?? null,
      classification: args.classification ?? null,
      receivedAt: args.receivedAt ?? null,
    });
  }

  describe("listOutboundEmailMessages", () => {
    it("returns only outbound messages with their card when linked", async () => {
      const card = await createCard({
        listId: testList.id,
        title: "Billing issue",
      });

      await createEmailMessage({
        sourceEventId: "inbound:1",
        cardId: card.id,
        direction: "inbound",
        processingStatus: "linked",
      });
      await createEmailMessage({
        sourceEventId: "outbound:reply-1",
        cardId: card.id,
        direction: "outbound",
        processingStatus: "sent",
        customerEmail: "ada@example.com",
        customerName: "Ada Lovelace",
        subject: "Re: Billing issue",
        summary: "customer_reply sent",
      });
      await createEmailMessage({
        sourceEventId: "outbound:cardless-1",
        cardId: null,
        direction: "outbound",
        processingStatus: "sent",
        subject: "Re: Unmatched thread",
      });

      const results =
        await supportTicketMetadataRepo.listOutboundEmailMessages(db);

      expect(results).toHaveLength(2);
      expect(results.every((message) => message.direction === "outbound")).toBe(
        true,
      );

      const linked = results.find(
        (message) => message.sourceEventId === "outbound:reply-1",
      );
      expect(linked?.card?.publicId).toBe(card.publicId);
      expect(linked?.card?.title).toBe("Billing issue");
      expect(linked?.customerEmail).toBe("ada@example.com");
      expect(linked?.summary).toBe("customer_reply sent");

      const cardless = results.find(
        (message) => message.sourceEventId === "outbound:cardless-1",
      );
      expect(cardless?.card).toBeNull();
    });

    it("orders newest first and caps results at the provided limit", async () => {
      for (let index = 0; index < 3; index += 1) {
        await createEmailMessage({
          sourceEventId: `outbound:order-${index}`,
          direction: "outbound",
          processingStatus: "sent",
        });
      }

      const results = await supportTicketMetadataRepo.listOutboundEmailMessages(
        db,
        { limit: 2 },
      );

      expect(results).toHaveLength(2);
      // Same createdAt resolution — falls back to id desc (newest insert first).
      expect(results.map((message) => message.sourceEventId)).toEqual([
        "outbound:order-2",
        "outbound:order-1",
      ]);
    });
  });

  describe("listCardlessEmailMessages", () => {
    it("returns only card-less messages with recorded statuses", async () => {
      const card = await createCard({ listId: testList.id });

      await createEmailMessage({
        sourceEventId: "inbound:spam-1",
        cardId: null,
        processingStatus: "recorded_spam",
        customerEmail: "bot@example.com",
        subject: "You won!",
        classification: { category: "spam", reasoning: "Bulk marketing." },
      });
      await createEmailMessage({
        sourceEventId: "inbound:non-issue-1",
        cardId: null,
        processingStatus: "recorded_non_issue",
      });
      await createEmailMessage({
        sourceEventId: "inbound:no-card-1",
        cardId: null,
        processingStatus: "recorded_no_card",
      });
      // Excluded: card-less but not a recorded status.
      await createEmailMessage({
        sourceEventId: "inbound:pending-1",
        cardId: null,
        processingStatus: "received",
      });
      // Excluded: recorded status but linked to a card.
      await createEmailMessage({
        sourceEventId: "inbound:linked-1",
        cardId: card.id,
        processingStatus: "recorded_spam",
      });

      const results =
        await supportTicketMetadataRepo.listCardlessEmailMessages(db);

      expect(results.map((message) => message.sourceEventId).sort()).toEqual([
        "inbound:no-card-1",
        "inbound:non-issue-1",
        "inbound:spam-1",
      ]);
      expect(results.every((message) => message.cardId === null)).toBe(true);

      const spam = results.find(
        (message) => message.sourceEventId === "inbound:spam-1",
      );
      expect(spam?.classification).toEqual({
        category: "spam",
        reasoning: "Bulk marketing.",
      });
    });

    it("orders by received date, falling back to created date", async () => {
      await createEmailMessage({
        sourceEventId: "inbound:old",
        cardId: null,
        processingStatus: "recorded_spam",
        receivedAt: new Date("2026-06-01T10:00:00Z"),
      });
      await createEmailMessage({
        sourceEventId: "inbound:new",
        cardId: null,
        processingStatus: "recorded_spam",
        receivedAt: new Date("2026-06-08T10:00:00Z"),
      });
      // No receivedAt — falls back to createdAt (now), so it sorts newest.
      await createEmailMessage({
        sourceEventId: "inbound:unreceived",
        cardId: null,
        processingStatus: "recorded_spam",
      });

      const results =
        await supportTicketMetadataRepo.listCardlessEmailMessages(db);

      expect(results.map((message) => message.sourceEventId)).toEqual([
        "inbound:unreceived",
        "inbound:new",
        "inbound:old",
      ]);
    });

    it("caps results at the provided limit", async () => {
      for (let index = 0; index < 3; index += 1) {
        await createEmailMessage({
          sourceEventId: `inbound:limit-${index}`,
          cardId: null,
          processingStatus: "recorded_spam",
          receivedAt: new Date(`2026-06-0${index + 1}T10:00:00Z`),
        });
      }

      const results = await supportTicketMetadataRepo.listCardlessEmailMessages(
        db,
        { limit: 2 },
      );

      expect(results.map((message) => message.sourceEventId)).toEqual([
        "inbound:limit-2",
        "inbound:limit-1",
      ]);
    });
  });

  describe("listByIssueCategory", () => {
    it("returns only cards with the requested issue category", async () => {
      const featureCard = await createCard({
        listId: testList.id,
        title: "Add dark mode",
      });
      const bugCard = await createCard({ listId: testList.id });

      await createMetadata({
        cardId: featureCard.id,
        issueCategory: "feature_request",
        email: "ada@example.com",
        customerName: "Ada Lovelace",
      });
      await createMetadata({ cardId: bugCard.id, issueCategory: "bug_report" });

      const results = await supportTicketMetadataRepo.listByIssueCategory(db, {
        workspaceId: testWorkspace.id,
        issueCategory: "feature_request",
      });

      expect(results).toHaveLength(1);
      expect(results[0]!.cardId).toBe(featureCard.id);
      expect(results[0]!.email).toBe("ada@example.com");
      expect(results[0]!.customerName).toBe("Ada Lovelace");
      expect(results[0]!.card.title).toBe("Add dark mode");
      expect(results[0]!.card.list?.name).toBe("Inbox");
    });

    it("orders results newest first by reported date, falling back to created date", async () => {
      const oldest = await createCard({ listId: testList.id });
      const newest = await createCard({ listId: testList.id });
      const unreported = await createCard({ listId: testList.id });

      await createMetadata({
        cardId: oldest.id,
        issueCategory: "feature_request",
        reportedAt: new Date("2026-06-01T10:00:00Z"),
      });
      await createMetadata({
        cardId: newest.id,
        issueCategory: "feature_request",
        reportedAt: new Date("2026-06-08T10:00:00Z"),
      });
      // No reportedAt — falls back to createdAt (now), so it sorts newest.
      await createMetadata({
        cardId: unreported.id,
        issueCategory: "feature_request",
      });

      const results = await supportTicketMetadataRepo.listByIssueCategory(db, {
        workspaceId: testWorkspace.id,
        issueCategory: "feature_request",
      });

      expect(results.map((row) => row.cardId)).toEqual([
        unreported.id,
        newest.id,
        oldest.id,
      ]);
    });

    it("excludes deleted cards and cards outside the workspace", async () => {
      const activeCard = await createCard({ listId: testList.id });
      const deletedCard = await createCard({
        listId: testList.id,
        deletedAt: new Date(),
      });

      const [otherWorkspace] = await db
        .insert(schema.workspaces)
        .values({
          publicId: "wsother12345",
          name: "Other Workspace",
          slug: "other-workspace",
          ownerId: testUser.id,
        })
        .returning();
      const { list: otherList } = await createBoardWithList({
        workspaceId: otherWorkspace!.id,
        boardPublicId: "boardother12",
        listPublicId: "listother123",
      });
      const otherWorkspaceCard = await createCard({ listId: otherList.id });

      await createMetadata({
        cardId: activeCard.id,
        issueCategory: "feature_request",
      });
      await createMetadata({
        cardId: deletedCard.id,
        issueCategory: "feature_request",
      });
      await createMetadata({
        cardId: otherWorkspaceCard.id,
        issueCategory: "feature_request",
      });

      const results = await supportTicketMetadataRepo.listByIssueCategory(db, {
        workspaceId: testWorkspace.id,
        issueCategory: "feature_request",
      });

      expect(results.map((row) => row.cardId)).toEqual([activeCard.id]);
    });

    it("caps results at the provided limit", async () => {
      for (let index = 0; index < 3; index += 1) {
        const card = await createCard({ listId: testList.id });
        await createMetadata({
          cardId: card.id,
          issueCategory: "feature_request",
          reportedAt: new Date(`2026-06-0${index + 1}T10:00:00Z`),
        });
      }

      const results = await supportTicketMetadataRepo.listByIssueCategory(db, {
        workspaceId: testWorkspace.id,
        issueCategory: "feature_request",
        limit: 2,
      });

      expect(results).toHaveLength(2);
      expect(results.map((row) => row.reportedAt)).toEqual([
        new Date("2026-06-03T10:00:00Z"),
        new Date("2026-06-02T10:00:00Z"),
      ]);
    });
  });
});
