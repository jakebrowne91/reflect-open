import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildAriGoldSupportPrompt, launchAriGoldAgent } from "./ariGold";

beforeEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("buildAriGoldSupportPrompt", () => {
  it("tells Ari to implement clear product improvements without calling them bugs", () => {
    const prompt = buildAriGoldSupportPrompt({
      title: "Email link shows 404",
      description:
        "Customer opened an auth-scoped email link while logged into a different account.",
      boardName: "Support",
      listName: "Investigating",
      ticketNumber: "RS-123",
      cardUrl: "https://admin.example.com/gsd/cards/card-123",
    });

    expect(prompt).toContain(
      "If this is expected behavior but creates a poor UX, do not call it a bug.",
    );
    expect(prompt).toContain("Classify it as a product improvement.");
    expect(prompt).toContain(
      "If the improvement is obvious, low-risk, and well-scoped, implement it, commit it, and open a PR for human review.",
    );
    expect(prompt).toContain('"resolutionType":"product_improvement"');
    expect(prompt).toContain('"engineeringAction":"opened_pr"');
    expect(prompt).toContain(
      'Set "resolutionType" to "bug" for real defects, "product_improvement" for expected behavior with a clear UX/product improvement',
    );
  });
});

describe("launchAriGoldAgent", () => {
  it("uses low reasoning for generic Ari launches by default", async () => {
    vi.stubEnv("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET", "test-secret");
    vi.stubEnv(
      "ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_URL",
      "https://agent-webhook.example.com/webhooks/external-agent",
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionId: "ari-sess-1",
          sessionUrl: "https://ari.example.com/session/ari-sess-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await launchAriGoldAgent({
      eventId: "gsd-card:card-123:run-1",
      title: "Support ticket",
      repo: "creatorcomputecompany/emma",
      prompt: "debug this support ticket",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const payload = JSON.parse(String(init.body));

    expect(payload).toEqual(
      expect.objectContaining({
        mode: "coding",
        model: "openai/gpt-5.5",
        reasoningEffort: "low",
        codingAgent: "opencode",
      }),
    );
  });

  it("applies Sentry source defaults before the generic coding agent fallback", async () => {
    vi.stubEnv("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET", "test-secret");
    vi.stubEnv(
      "ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_URL",
      "https://agent-webhook.example.com/webhooks/external-agent",
    );
    vi.stubEnv("ARI_GOLD_DEFAULT_CODING_AGENT", "pi");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionId: "ari-sess-1",
          sessionUrl: "https://ari.example.com/session/ari-sess-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await launchAriGoldAgent({
      eventId: "gsd-card:card-123:run-1",
      title: "Sentry alert",
      repo: "creatorcomputecompany/emma",
      prompt: "debug this sentry alert",
      spawnSource: "sentry",
      supportContext: {
        cardPublicId: "card-123",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const payload = JSON.parse(String(init.body));

    expect(payload).toEqual(
      expect.objectContaining({
        mode: "coding",
        model: "openai/gpt-5.5",
        reasoningEffort: "low",
        codingAgent: "opencode",
        spawnSource: "sentry",
        supportContext: expect.objectContaining({
          cardPublicId: "card-123",
          mode: "coding",
          codingAgent: "opencode",
          spawnSource: "sentry",
          repoFullName: "creatorcomputecompany/emma",
        }),
      }),
    );
  });

  it("applies the support-email source default (opencode) over the pi fallback", async () => {
    vi.stubEnv("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET", "test-secret");
    vi.stubEnv(
      "ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_URL",
      "https://agent-webhook.example.com/webhooks/external-agent",
    );
    // Even when the generic fallback is pi, support-email launches must use opencode.
    vi.stubEnv("ARI_GOLD_DEFAULT_CODING_AGENT", "pi");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          sessionId: "ari-sess-1",
          sessionUrl: "https://ari.example.com/session/ari-sess-1",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    await launchAriGoldAgent({
      eventId: "gsd-card:card-123:run-1",
      title: "Support email ticket",
      repo: "creatorcomputecompany/emma",
      prompt: "investigate this support ticket",
      spawnSource: "support-email",
      supportContext: {
        cardPublicId: "card-123",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      RequestInfo | URL,
      RequestInit,
    ];
    const payload = JSON.parse(String(init.body));

    expect(payload).toEqual(
      expect.objectContaining({
        codingAgent: "opencode",
        spawnSource: "support-email",
        supportContext: expect.objectContaining({
          codingAgent: "opencode",
          spawnSource: "support-email",
        }),
      }),
    );
  });
});
