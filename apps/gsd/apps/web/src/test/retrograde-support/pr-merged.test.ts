import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { postSupportTicketStatusSlackUpdate } from "@kan/api/utils/retrogradeSupport";
import * as cardAgentRunRepo from "@kan/db/repository/cardAgentRun.repo";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import * as schema from "@kan/db/schema";

import prMergedHandler from "~/pages/api/retrograde-support/pr-merged";
import {
  countRows,
  createTestDb,
  getTestDb,
  makeResponse,
  makeSignedRequest,
  seedBoard,
  seedCard,
  setTestDb,
} from "./harness";

vi.mock("~/env", () => ({
  env: {
    NODE_ENV: "test",
    RETROGRADE_GSD_API_SECRET: "test-gsd-api-secret",
  },
}));

vi.mock("@kan/db/client", async () => {
  const { getTestDb } = await import("./harness");
  return {
    createDrizzleClient: () => getTestDb(),
    closeDrizzleClient: () => Promise.resolve(),
  };
});

vi.mock("@kan/logger", () => {
  const noop = () => undefined;
  const logger: Record<string, unknown> = {
    info: noop,
    warn: noop,
    error: noop,
    debug: noop,
  };
  logger.child = () => logger;
  return { logger, createLogger: () => logger };
});

vi.mock("@kan/api/utils/retrogradeSupport", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    postSupportTicketStatusSlackUpdate: vi.fn(() => Promise.resolve()),
  };
});

const PR_URL = "https://github.com/creatorcomputecompany/emma/pull/123";

async function postPrMerged(payload: unknown) {
  const req = makeSignedRequest(payload);
  const res = makeResponse();
  await prMergedHandler(req, res);
  return res;
}

/** Seeds a board with a card in the given list and an agent run whose
 * response.ticketUpdate.prUrl matches `prUrl`. */
async function seedRunWithPr(args: { listName: string; prUrl: string }) {
  const db = getTestDb();
  const { user, lists } = await seedBoard(db, {
    listNames: ["New", "Ready for Review", "Resolved"],
  });
  const list = lists.get(args.listName);
  if (!list) throw new Error(`List ${args.listName} not seeded`);

  const card = await seedCard(db, {
    listId: list.id,
    createdBy: user.id,
    title: "Fix scheduling bug",
  });
  const run = await cardAgentRunRepo.create(db, {
    cardId: card.id,
    createdBy: user.id,
    agent: "ari-gold",
    prompt: "Investigate the scheduling bug",
  });
  await cardAgentRunRepo.markRunning(db, {
    publicId: run.publicId,
    supersetWorkspaceId: null,
    supersetSessionId: "ari-sess-1",
    supersetUrl: null,
    response: {
      ticketUpdate: { status: "ready_for_review", prUrl: args.prUrl },
    },
  });

  return { db, user, lists, card, run };
}

describe("POST /api/retrograde-support/pr-merged", () => {
  beforeEach(async () => {
    setTestDb(await createTestDb());
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected fetch during pr-merged handler test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTestDb(null);
  });

  it("moves a Ready for Review card with a matching PR to Resolved and records the merge", async () => {
    const { db, lists, card } = await seedRunWithPr({
      listName: "Ready for Review",
      prUrl: PR_URL,
    });

    const res = await postPrMerged({
      prUrl: PR_URL,
      prTitle: "fix: stop dropping scheduled posts",
      mergedBy: "jake",
    });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);
    expect(body.matched).toBe(true);
    expect(body.moved).toBe(true);
    expect(body.cardPublicId).toBe(card.publicId);

    const movedCard = await db.query.cards.findFirst({
      where: eq(schema.cards.publicId, card.publicId),
    });
    expect(movedCard?.listId).toBe(lists.get("Resolved")?.id);

    // pr_merged dedup event.
    const event = await supportTicketMetadataRepo.getEventBySourceEventId(db, {
      source: "github",
      sourceEventId: `github:pr-merged:${PR_URL}`,
    });
    expect(event?.eventType).toBe("pr_merged");
    expect(event?.status).toBe("resolved");

    // Auto-resolve comment from the support bot.
    expect(await countRows(db, schema.comments)).toBe(1);

    // Slack resolution ping.
    expect(postSupportTicketStatusSlackUpdate).toHaveBeenCalledTimes(1);
    expect(postSupportTicketStatusSlackUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: card.publicId,
        status: "resolved",
        prUrl: PR_URL,
      }),
    );
  });

  it("treats a redelivery after the move as not-ready (card already Resolved)", async () => {
    await seedRunWithPr({ listName: "Ready for Review", prUrl: PR_URL });
    await postPrMerged({ prUrl: PR_URL });
    vi.mocked(postSupportTicketStatusSlackUpdate).mockClear();

    const res = await postPrMerged({ prUrl: PR_URL });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.matched).toBe(true);
    expect(body.moved).toBe(false);
    expect(body.reason).toBe("card_not_ready_for_review");
    expect(body.currentStatus).toBe("resolved");
    expect(postSupportTicketStatusSlackUpdate).not.toHaveBeenCalled();
  });

  it("returns duplicate:true and skips the move/Slack ping when the pr_merged event already exists", async () => {
    const { db, lists, card } = await seedRunWithPr({
      listName: "Ready for Review",
      prUrl: PR_URL,
    });
    await postPrMerged({ prUrl: PR_URL });

    // Operator drags the card back to Ready for Review, then GitHub redelivers.
    const readyList = lists.get("Ready for Review");
    if (!readyList) throw new Error("Ready for Review list not seeded");
    await db
      .update(schema.cards)
      .set({ listId: readyList.id })
      .where(eq(schema.cards.id, card.id));
    vi.mocked(postSupportTicketStatusSlackUpdate).mockClear();
    const commentsAfterFirst = await countRows(db, schema.comments);

    const res = await postPrMerged({ prUrl: PR_URL });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.matched).toBe(true);
    expect(body.moved).toBe(false);
    expect(body.duplicate).toBe(true);
    expect(body.cardPublicId).toBe(card.publicId);

    const unchangedCard = await db.query.cards.findFirst({
      where: eq(schema.cards.id, card.id),
    });
    expect(unchangedCard?.listId).toBe(readyList.id);
    expect(await countRows(db, schema.comments)).toBe(commentsAfterFirst);
    expect(postSupportTicketStatusSlackUpdate).not.toHaveBeenCalled();
  });

  it("hands a resolved gsd_ticket_update to the email DO for email-originated cards", async () => {
    const { db, card } = await seedRunWithPr({
      listName: "Ready for Review",
      prUrl: PR_URL,
    });
    await supportTicketMetadataRepo.upsertForCard(db, {
      cardId: card.id,
      externalId: "email:nylas:msg-1",
      source: "email",
      sourceCaseKey: "email:support@itsemma.ai:nylas:thread:thread-1",
      supportCaseId: "EMMA-ABC123",
      email: "customer@example.com",
      customerName: "Customer Person",
      provider: "nylas",
      providerThreadId: "thread-1",
      providerMessageId: "msg-1",
    });
    vi.stubEnv(
      "ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_URL",
      "https://agent-webhook.example.com/webhooks/external-agent",
    );
    vi.stubEnv("INTERNAL_CALLBACK_SECRET", "internal-secret");
    const fetchMock = vi.fn((input: RequestInfo | URL, _init?: RequestInit) => {
      if (String(input).includes("/internal/support-email/process")) {
        return Promise.resolve(Response.json({ ok: true }));
      }
      throw new Error(`Unexpected fetch: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await postPrMerged({ prUrl: PR_URL });

    expect(res.statusCode).toBe(200);
    expect(res.body().customerEmailTriggered).toBe(true);
    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).includes("/internal/support-email/process"),
    );
    expect(call).toBeDefined();
    const [, init] = call!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer internal-secret");
    const payload = JSON.parse(String((init as RequestInit).body)) as Record<
      string,
      any
    >;
    expect(payload.kind).toBe("gsd_ticket_update");
    expect(payload.input.status).toBe("resolved");
    expect(payload.input.sourceCaseKey).toBe(
      "email:support@itsemma.ai:nylas:thread:thread-1",
    );
    expect(payload.input.email.customerEmail).toBe("customer@example.com");
    vi.unstubAllEnvs();
  });

  it("returns matched:false when no agent run references the PR url", async () => {
    await seedRunWithPr({ listName: "Ready for Review", prUrl: PR_URL });

    const res = await postPrMerged({
      prUrl: "https://github.com/creatorcomputecompany/emma/pull/999",
    });

    expect(res.statusCode).toBe(200);
    expect(res.body()).toEqual({ ok: true, matched: false });
    expect(postSupportTicketStatusSlackUpdate).not.toHaveBeenCalled();
  });

  it("returns moved:false when the matched card is not in Ready for Review", async () => {
    const { db, lists, card } = await seedRunWithPr({
      listName: "New",
      prUrl: PR_URL,
    });

    const res = await postPrMerged({ prUrl: PR_URL });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.matched).toBe(true);
    expect(body.moved).toBe(false);
    expect(body.reason).toBe("card_not_ready_for_review");
    expect(body.currentStatus).toBe("new");

    const unchangedCard = await db.query.cards.findFirst({
      where: eq(schema.cards.id, card.id),
    });
    expect(unchangedCard?.listId).toBe(lists.get("New")?.id);
    expect(postSupportTicketStatusSlackUpdate).not.toHaveBeenCalled();
  });
});
