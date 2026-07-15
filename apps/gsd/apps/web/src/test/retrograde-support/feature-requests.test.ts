import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { launchAriGoldAgent } from "@kan/api/utils/ariGold";

import featureRequestsHandler from "~/pages/api/retrograde-support/feature-requests";
import featureRequestDetailHandler from "~/pages/api/retrograde-support/feature-requests/[cardPublicId]";
import ticketsHandler from "~/pages/api/retrograde-support/tickets";
import {
  createTestDb,
  makeRequest,
  makeResponse,
  makeSignedRequest,
  setTestDb,
} from "./harness";

const TEST_SSO_SECRET = "test-gsd-sso-secret";

vi.mock("~/env", () => ({
  env: {
    NODE_ENV: "test",
    RETROGRADE_GSD_API_SECRET: "test-gsd-api-secret",
    RETROGRADE_GSD_SSO_SECRET: "test-gsd-sso-secret",
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

function base64UrlEncode(value: string): string {
  return Buffer.from(value).toString("base64url");
}

function signSsoToken(
  overrides: Record<string, unknown> = {},
  secret = TEST_SSO_SECRET,
) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "retrograde-admin",
    aud: "kan-retrograde-support",
    sub: "admin@example.com",
    email: "admin@example.com",
    iat: now,
    exp: now + 300,
    ...overrides,
  };
  const header = base64UrlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = base64UrlEncode(JSON.stringify(payload));
  const signature = createHmac("sha256", secret)
    .update(`${header}.${body}`)
    .digest("base64url");

  return `${header}.${body}.${signature}`;
}

function ticketPayload(overrides: Record<string, unknown> = {}) {
  return {
    externalId: "evt-feature-1",
    sourceEventId: "src-evt-feature-1",
    source: "email",
    title: "Support email: Give us managed inboxes",
    summary: "Creator asks for managed inboxes instead of their own Gmail",
    status: "resolved",
    customer: { email: "creator@example.com", name: "Creator One" },
    parameters: {
      issueCategory: "feature_request",
      sourceSystem: "support_email_worker",
      sourceChannel: "gmail",
      email: "creator@example.com",
      customerName: "Creator One",
    },
    ...overrides,
  };
}

async function getFeatureRequests(headers: Record<string, string> = {}) {
  const req = makeRequest({ body: "", method: "GET", headers });
  const res = makeResponse();
  await featureRequestsHandler(req, res);
  return res;
}

async function getFeatureRequestDetail(
  cardPublicId: string,
  headers: Record<string, string> = {},
) {
  const req = makeRequest({ body: "", method: "GET", headers });
  (req as { query: Record<string, unknown> }).query = { cardPublicId };
  const res = makeResponse();
  await featureRequestDetailHandler(req, res);
  return res;
}

describe("GET /api/retrograde-support/feature-requests", () => {
  beforeEach(async () => {
    setTestDb(await createTestDb());
    vi.clearAllMocks();
    vi.mocked(launchAriGoldAgent).mockResolvedValue({
      agent: "ari-gold",
      sessionId: "ari-sess-1",
      url: "https://superset.example/session/ari-sess-1",
      response: { ok: true, sessionId: "ari-sess-1" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected fetch during feature-requests test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTestDb(null);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await getFeatureRequests();

    expect(res.statusCode).toBe(401);
    expect(res.body()).toEqual({
      ok: false,
      error: "Invalid or expired token",
    });
  });

  it("rejects tokens signed with the wrong secret", async () => {
    const res = await getFeatureRequests({
      authorization: `Bearer ${signSsoToken({}, "wrong-secret")}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects expired tokens", async () => {
    const now = Math.floor(Date.now() / 1000);
    const res = await getFeatureRequests({
      authorization: `Bearer ${signSsoToken({ iat: now - 600, exp: now - 300 })}`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("rejects non-GET methods", async () => {
    const req = makeRequest({
      body: "",
      method: "POST",
      headers: { authorization: `Bearer ${signSsoToken()}` },
    });
    const res = makeResponse();
    await featureRequestsHandler(req, res);

    expect(res.statusCode).toBe(405);
  });

  it("returns an empty list when the support workspace does not exist", async () => {
    const res = await getFeatureRequests({
      authorization: `Bearer ${signSsoToken()}`,
    });

    expect(res.statusCode).toBe(200);
    expect(res.body()).toEqual({
      ok: true,
      cardPrefix: null,
      featureRequests: [],
    });
  });

  it("returns feature-request cards created through the tickets endpoint", async () => {
    const ticketRes = makeResponse();
    await ticketsHandler(makeSignedRequest(ticketPayload()), ticketRes);
    expect(ticketRes.statusCode).toBe(200);

    const bugRes = makeResponse();
    await ticketsHandler(
      makeSignedRequest(
        ticketPayload({
          externalId: "evt-bug-1",
          sourceEventId: "src-evt-bug-1",
          title: "Scheduling bug",
          parameters: { issueCategory: "bug_report" },
        }),
      ),
      bugRes,
    );
    expect(bugRes.statusCode).toBe(200);

    const res = await getFeatureRequests({
      authorization: `Bearer ${signSsoToken()}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);
    expect(typeof body.cardPrefix).toBe("string");

    const featureRequests = body.featureRequests as Record<string, unknown>[];
    expect(featureRequests).toHaveLength(1);
    expect(featureRequests[0]).toMatchObject({
      source: "email",
      sourceSystem: "support_email_worker",
      sourceChannel: "gmail",
      email: "creator@example.com",
      customerName: "Creator One",
    });
    expect(featureRequests[0]?.cardPublicId).toEqual(expect.any(String));
    expect(featureRequests[0]?.listName).toEqual(expect.any(String));
  });

  it("includes the agent assessment fields extracted from the workflow metadata", async () => {
    const ticketRes = makeResponse();
    await ticketsHandler(
      makeSignedRequest(
        ticketPayload({
          metadata: {
            classification: {
              category: "feature_request",
              urgency: "low",
              summary: "Creator wants managed inboxes",
              confidence: "high",
            },
            reconciliation: {
              component: "email_inboxes",
              internalSummary: "Asks for kaerma.ai-hosted inboxes",
              needsEngineering: true,
            },
            agent: { internalNote: "Recurring ask, third creator this month" },
          },
        }),
      ),
      ticketRes,
    );
    expect(ticketRes.statusCode).toBe(200);

    const res = await getFeatureRequests({
      authorization: `Bearer ${signSsoToken()}`,
    });

    const featureRequests = res.body().featureRequests as Record<
      string,
      unknown
    >[];
    expect(featureRequests[0]).toMatchObject({
      component: "email_inboxes",
      urgency: "low",
      summary: "Asks for kaerma.ai-hosted inboxes",
    });
  });
});

describe("GET /api/retrograde-support/feature-requests/[cardPublicId]", () => {
  beforeEach(async () => {
    setTestDb(await createTestDb());
    vi.clearAllMocks();
    vi.mocked(launchAriGoldAgent).mockResolvedValue({
      agent: "ari-gold",
      sessionId: "ari-sess-1",
      url: "https://superset.example/session/ari-sess-1",
      response: { ok: true, sessionId: "ari-sess-1" },
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("Unexpected fetch during feature-requests test");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setTestDb(null);
  });

  it("rejects requests without a bearer token", async () => {
    const res = await getFeatureRequestDetail("card-x");

    expect(res.statusCode).toBe(401);
  });

  it("returns 404 for unknown cards", async () => {
    const res = await getFeatureRequestDetail("does-not-exist", {
      authorization: `Bearer ${signSsoToken()}`,
    });

    expect(res.statusCode).toBe(404);
  });

  it("returns the card, assessment, and email thread", async () => {
    const ticketRes = makeResponse();
    await ticketsHandler(
      makeSignedRequest(
        ticketPayload({
          metadata: {
            email: {
              subject: "Give us managed inboxes",
              bodyText:
                "I wish you would give us kaerma.ai inboxes to use instead of our own Gmail.",
            },
            classification: {
              category: "feature_request",
              urgency: "low",
              summary: "Creator wants managed inboxes",
            },
            reconciliation: {
              component: "email_inboxes",
              internalSummary: "Asks for kaerma.ai-hosted inboxes",
            },
          },
        }),
      ),
      ticketRes,
    );
    expect(ticketRes.statusCode).toBe(200);
    const cardPublicId = ticketRes.body().cardPublicId as string;

    const res = await getFeatureRequestDetail(cardPublicId, {
      authorization: `Bearer ${signSsoToken()}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.body();
    expect(body.ok).toBe(true);

    const featureRequest = body.featureRequest as Record<string, unknown>;
    expect(featureRequest).toMatchObject({
      cardPublicId,
      source: "email",
      email: "creator@example.com",
      customerName: "Creator One",
      issueCategory: "feature_request",
    });
    expect(featureRequest.assessment).toMatchObject({
      category: "feature_request",
      component: "email_inboxes",
      summary: "Asks for kaerma.ai-hosted inboxes",
    });
    expect(Array.isArray(featureRequest.messages)).toBe(true);
  });
});
