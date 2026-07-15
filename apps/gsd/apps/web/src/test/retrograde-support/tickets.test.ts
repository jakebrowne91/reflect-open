import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  launchAriGoldAgent,
  sendAriGoldFollowup,
} from "@kan/api/utils/ariGold";
import {
  postSupportTicketCreatedSlackAlert,
  postSupportTicketStatusSlackUpdate,
} from "@kan/api/utils/retrogradeSupport";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import * as schema from "@kan/db/schema";

import ticketsHandler from "~/pages/api/retrograde-support/tickets";
import {
  countRows,
  createTestDb,
  getTestDb,
  makeRequest,
  makeResponse,
  makeSignedRequest,
  setTestDb,
} from "./harness";

vi.mock("~/env", () => ({
  env: {
    NODE_ENV: "test",
    RETROGRADE_GSD_API_SECRET: "test-gsd-api-secret",
    // OPENAI_API_KEY intentionally unset: generateSupportCardTitle must take
    // its no-network fallback path.
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

vi.mock("@kan/api/utils/ariGold", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    launchAriGoldAgent: vi.fn(),
    sendAriGoldFollowup: vi.fn(),
  };
});

vi.mock("@kan/api/utils/retrogradeSupport", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    postSupportTicketCreatedSlackAlert: vi.fn(() => Promise.resolve()),
    postSupportTicketStatusSlackUpdate: vi.fn(() => Promise.resolve()),
  };
});

function ticketPayload(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "evt-100",
    sourceEventId: "src-evt-100",
    source: "ari_gold",
    title: "Emma scheduling bug",
    summary: "Customer reports scheduled posts are not going out",
    status: "bug_raised",
    customer: { email: "creator@example.com", name: "Creator One" },
    parameters: { issueCategory: "scheduling", userId: "user-42" },
    metadata: {
      agent: { internalNote: "Investigated inbox, looks like a bug" },
    },
    ...overrides,
  };
}

async function postTicket(payload: unknown) {
  const req = makeSignedRequest(payload);
  const res = makeResponse();
  await ticketsHandler(req, res);
  return res;
}

async function listsByName() {
  const db = getTestDb();
  const lists = await db.query.lists.findMany({
    columns: { id: true, publicId: true, name: true },
  });
  return new Map(lists.map((list) => [list.name, list]));
}

describe("POST /api/retrograde-support/tickets", () => {
  beforeEach(async () => {
    setTestDb(await createTestDb());
    vi.clearAllMocks();
    vi.mocked(launchAriGoldAgent).mockResolvedValue({
      agent: "ari-gold",
      sessionId: "ari-sess-1",
      url: "https://superset.example/session/ari-sess-1",
      response: { ok: true, sessionId: "ari-sess-1" },
    });
    // Any direct network call from the handler is a test failure.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected fetch during tickets handler test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTestDb(null);
  });

  it("rejects requests with an invalid signature", async () => {
    const req = makeRequest({
      body: JSON.stringify(ticketPayload()),
      headers: {
        "x-retrograde-gsd-timestamp": String(Math.floor(Date.now() / 1000)),
        "x-retrograde-gsd-signature": `sha256=${"ab".repeat(32)}`,
      },
    });
    const res = makeResponse();

    await ticketsHandler(req, res);

    expect(res.statusCode).toBe(401);
    expect(res.body()).toEqual({ ok: false, error: "Invalid signature" });
    expect(await countRows(getTestDb(), schema.cards)).toBe(0);
  });

  it("creates a ticket: bootstraps the board, card, comments, metadata and launches Ari", async () => {
    const db = getTestDb();
    const res = await postTicket(ticketPayload());

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.cardPublicId).toEqual(expect.any(String));
    expect(body.cardNumber).toBe(1);

    // Workspace/board/lists bootstrap.
    const workspace = await db.query.workspaces.findFirst({
      where: (table, { eq }) => eq(table.slug, "retrograde-support"),
    });
    expect(workspace).toBeDefined();
    const board = await db.query.boards.findFirst({
      where: (table, { eq }) => eq(table.slug, "customer-support"),
    });
    expect(board).toBeDefined();
    const lists = await listsByName();
    expect([...lists.keys()].sort()).toEqual(
      [
        "New",
        "Investigating",
        "Needs Customer",
        "Bug Raised",
        "Ready for Review",
        "Resolved",
        "Failed",
      ].sort(),
    );

    // bug_raised with no ari.sessionId triggers the (mocked) launch path,
    // which then moves the card to Investigating.
    expect(launchAriGoldAgent).toHaveBeenCalledTimes(1);
    const card = await db.query.cards.findFirst({
      where: (table, { eq }) => eq(table.publicId, body.cardPublicId as string),
    });
    if (!card) throw new Error("Created card not found");
    expect(card.listId).toBe(lists.get("Investigating")?.id);
    expect(body.listPublicId).toBe(lists.get("Investigating")?.publicId);

    // Support comments (agent notes + raw metadata for this payload).
    expect(await countRows(db, schema.comments)).toBe(2);

    // Metadata row, including the Ari session captured from the launch.
    const metadata = await supportTicketMetadataRepo.getByCardId(db, card.id);
    expect(metadata?.source).toBe("emma");
    expect(metadata?.issueCategory).toBe("scheduling");
    expect(metadata?.userId).toBe("user-42");
    expect(metadata?.ariSessionId).toBe("ari-sess-1");

    // Dedup event row keyed by canonical source + sourceEventId.
    const event = await supportTicketMetadataRepo.getEventBySourceEventId(db, {
      source: "emma",
      sourceEventId: "src-evt-100",
    });
    expect(event?.card.publicId).toBe(body.cardPublicId);
    expect(event?.eventType).toBe("inbound");

    expect(postSupportTicketCreatedSlackAlert).toHaveBeenCalledTimes(1);
  });

  it("returns duplicate:true for a re-POST of the same sourceEventId without creating a second card", async () => {
    const db = getTestDb();
    const first = await postTicket(ticketPayload());
    const cardPublicId = first.body().cardPublicId;

    const second = await postTicket(ticketPayload());

    expect(second.statusCode).toBe(200);
    expect(second.body().ok).toBe(true);
    expect(second.body().duplicate).toBe(true);
    expect(second.body().cardPublicId).toBe(cardPublicId);
    expect(await countRows(db, schema.cards)).toBe(1);
    expect(launchAriGoldAgent).toHaveBeenCalledTimes(1);
    expect(postSupportTicketCreatedSlackAlert).toHaveBeenCalledTimes(1);
  });

  it("commentOnly appends a comment to the sourceCaseKey-matched card without moving it or contacting Ari", async () => {
    const db = getTestDb();
    const created = await postTicket(
      ticketPayload({
        externalId: "evt-A",
        sourceEventId: "src-evt-A",
        sourceCaseKey: "case-key-shared",
        status: "new",
        metadata: undefined,
      }),
    );
    const cardPublicId = created.body().cardPublicId;
    const lists = await listsByName();
    expect(created.body().listPublicId).toBe(lists.get("New")?.publicId);
    const commentsBefore = await countRows(db, schema.comments);

    const res = await postTicket(
      ticketPayload({
        externalId: "evt-B",
        sourceEventId: "src-evt-B",
        sourceCaseKey: "case-key-shared",
        commentOnly: true,
        // A status that would normally move the card — commentOnly must not.
        status: "resolved",
        title: "Follow-up note",
        summary: "Customer added more details",
        metadata: undefined,
      }),
    );

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);
    expect(body.duplicate).toBe(false);
    expect(body.updatedExisting).toBe(true);
    expect(body.commentOnly).toBe(true);
    expect(body.cardPublicId).toBe(cardPublicId);
    expect(body.listPublicId).toBe(lists.get("New")?.publicId);

    const card = await db.query.cards.findFirst({
      where: (table, { eq }) => eq(table.publicId, cardPublicId as string),
    });
    expect(card?.listId).toBe(lists.get("New")?.id);
    expect(await countRows(db, schema.comments)).toBe(commentsBefore + 1);
    expect(await countRows(db, schema.cards)).toBe(1);

    expect(launchAriGoldAgent).not.toHaveBeenCalled();
    expect(sendAriGoldFollowup).not.toHaveBeenCalled();
    expect(postSupportTicketStatusSlackUpdate).not.toHaveBeenCalled();
  });

  it("commentOnly with no matching ticket records nothing and creates no card", async () => {
    const db = getTestDb();
    const res = await postTicket(
      ticketPayload({
        commentOnly: true,
        sourceCaseKey: "case-key-without-ticket",
        status: "new",
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body()).toEqual({
      ok: true,
      recorded: false,
      reason: "no_matching_ticket",
    });
    expect(await countRows(db, schema.cards)).toBe(0);
    expect(launchAriGoldAgent).not.toHaveBeenCalled();
  });

  it('accepts status "failed" and lands the card in the Failed list without launching Ari', async () => {
    const db = getTestDb();
    const res = await postTicket(
      ticketPayload({
        externalId: "evt-failed",
        sourceEventId: "src-evt-failed",
        status: "failed",
        metadata: undefined,
      }),
    );

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);
    const lists = await listsByName();
    expect(body.listPublicId).toBe(lists.get("Failed")?.publicId);

    const card = await db.query.cards.findFirst({
      where: (table, { eq }) => eq(table.publicId, body.cardPublicId as string),
    });
    expect(card?.listId).toBe(lists.get("Failed")?.id);
    expect(launchAriGoldAgent).not.toHaveBeenCalled();
  });

  it("launches Ari and stores the session for a Sentry bug alert", async () => {
    const db = getTestDb();
    const res = await postTicket({
      externalId: "sentry-12345",
      sourceEventId: "sentry:issue:12345",
      source: "sentry",
      title: "TypeError in scheduler worker",
      summary: "Unhandled TypeError seen 14 times in the last hour",
      status: "bug_raised",
      parameters: {
        issueCategory: "sentry_alert",
        sourceChannel: "sentry",
        component: "scheduler-worker",
      },
      ari: {
        repo: "CreatorComputeCompany/emma",
        mode: "coding",
        model: "openai/gpt-5.5",
        codingAgent: "opencode",
        spawnSource: "sentry",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);

    const metadata = await supportTicketMetadataRepo.getByCardPublicId(db, {
      cardPublicId: body.cardPublicId as string,
    });
    expect(metadata?.source).toBe("sentry");
    expect(metadata?.issueCategory).toBe("sentry_alert");
    expect(metadata?.sourceChannel).toBe("sentry");
    expect(metadata?.externalId).toBe("sentry-12345");
    expect(metadata?.ariSessionId).toBe("ari-sess-1");
    expect(launchAriGoldAgent).toHaveBeenCalledTimes(1);
    expect(launchAriGoldAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        codingAgent: "opencode",
        spawnSource: "sentry",
        supportContext: expect.objectContaining({
          codingAgent: "opencode",
          spawnSource: "sentry",
          sourceChannel: "sentry",
        }),
      }),
    );
    expect(res.body().agentRun).toEqual(
      expect.objectContaining({
        agent: "ari-gold",
        status: "running",
        supersetSessionId: "ari-sess-1",
      }),
    );
  });
});
