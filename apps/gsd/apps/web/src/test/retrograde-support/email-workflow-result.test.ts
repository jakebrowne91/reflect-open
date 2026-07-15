import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as schema from "@kan/db/schema";

import emailWorkflowResultHandler from "~/pages/api/retrograde-support/email-workflow-result";
import {
  countRows,
  createTestDb,
  getTestDb,
  makeResponse,
  makeSignedRequest,
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

function workflowResultPayload(overrides: Record<string, unknown> = {}) {
  return {
    sourceEventId: "email:gmail:spam-msg-1",
    sourceCaseKey: "email:support:gmail:thread:spam-thread-1",
    email: {
      provider: "gmail",
      providerMessageId: "spam-msg-1",
      providerThreadId: "spam-thread-1",
      mailbox: "support@getretrograde.ai",
      subject: "You have WON a prize",
      bodyText: "Click here to claim your prize now",
      receivedAt: "2026-06-09T10:00:00.000Z",
      from: { email: "spammer@example.com", name: "Spammer" },
    },
    classification: { category: "spam", confidence: "high" },
    summary: "Unsolicited spam email",
    ...overrides,
  };
}

async function postWorkflowResult(payload: unknown) {
  const req = makeSignedRequest(payload);
  const res = makeResponse();
  await emailWorkflowResultHandler(req, res);
  return res;
}

describe("POST /api/retrograde-support/email-workflow-result", () => {
  beforeEach(async () => {
    setTestDb(await createTestDb());
    vi.clearAllMocks();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error(
          "Unexpected fetch during email-workflow-result handler test",
        );
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTestDb(null);
  });

  it("persists a card-less recorded_spam email message for spam workflow results", async () => {
    const db = getTestDb();
    const res = await postWorkflowResult(workflowResultPayload());

    expect(res.statusCode).toBe(200);
    expect(res.body()).toEqual({
      ok: true,
      recordedWithoutCard: true,
      processingStatus: "recorded_spam",
      sourceCaseKey: "email:support:gmail:thread:spam-thread-1",
      supportCaseId: undefined,
    });

    const message = await db.query.supportEmailMessages.findFirst({
      where: eq(
        schema.supportEmailMessages.sourceEventId,
        "email:gmail:spam-msg-1",
      ),
    });
    expect(message).toBeDefined();
    expect(message?.cardId).toBeNull();
    expect(message?.processingStatus).toBe("recorded_spam");
    expect(message?.direction).toBe("inbound");
    expect(message?.customerEmail).toBe("spammer@example.com");
    expect(message?.subject).toBe("You have WON a prize");
    expect(message?.bodyText).toBe("Click here to claim your prize now");
    expect(message?.classification).toEqual({
      category: "spam",
      confidence: "high",
    });

    // Spam never creates a card or a ticket event.
    expect(await countRows(db, schema.cards)).toBe(0);
    expect(await countRows(db, schema.supportTicketEvents)).toBe(0);
  });

  it("records non-spam results without a matching card as recorded_no_card", async () => {
    const db = getTestDb();
    const res = await postWorkflowResult(
      workflowResultPayload({
        sourceEventId: "email:gmail:question-msg-1",
        sourceCaseKey: "email:support:gmail:thread:question-thread-1",
        classification: { category: "question" },
        summary: "Customer asking about billing",
      }),
    );

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.recordedWithoutCard).toBe(true);
    expect(body.processingStatus).toBe("recorded_no_card");

    const message = await db.query.supportEmailMessages.findFirst({
      where: eq(
        schema.supportEmailMessages.sourceEventId,
        "email:gmail:question-msg-1",
      ),
    });
    expect(message?.cardId).toBeNull();
    expect(message?.processingStatus).toBe("recorded_no_card");
  });
});
