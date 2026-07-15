import { describe, expect, it } from "vitest";

import {
  canonicalSupportSource,
  getSourceCaseKey,
  getSourceEventId,
  parseRetrogradeSupportContext,
  sourceLookupAliases,
} from "./retrogradeSupport";

describe("parseRetrogradeSupportContext", () => {
  it("extracts hard parameters from Retrograde support ticket descriptions", () => {
    const context = parseRetrogradeSupportContext(`## Hard Parameters

- Event ID: event-hard-param-smoke-1778699333656
- User ID: user-hard-param-smoke
- Emma user ID: emma-hard-param-smoke
- Email: hard-param-smoke@example.com
- Issue category: outreach
- Date range: 2026-05-13 to 2026-05-13 (Europe/Dublin)
- Reported at: 2026-05-13T19:10:00.000Z
- Source channel: production_smoke
- Ari session ID: ari-session-hard-param-smoke
- Ari session URL: https://ari-gold.vercel.app/session/ari-session-hard-param-smoke
- Repo: creatorcomputecompany/emma

## Summary

Signed production smoke for hard ticket parameter rendering.`);

    expect(context?.parameters).toHaveLength(11);
    expect(context?.byKey.userId).toBe("user-hard-param-smoke");
    expect(context?.byKey.emmaUserId).toBe("emma-hard-param-smoke");
    expect(context?.byKey.email).toBe("hard-param-smoke@example.com");
    expect(context?.byKey.repoFullName).toBe("creatorcomputecompany/emma");
  });

  it("returns null for ordinary cards", () => {
    expect(
      parseRetrogradeSupportContext("Regular card description"),
    ).toBeNull();
  });
});

describe("support intake source identity", () => {
  it("normalizes canonical sources while preserving legacy aliases for lookup", () => {
    expect(canonicalSupportSource("support_email")).toBe("email");
    expect(canonicalSupportSource("slack_bot")).toBe("slack");
    expect(canonicalSupportSource("ari_gold")).toBe("emma");
    expect(canonicalSupportSource("external_agent")).toBe("emma");
    expect(canonicalSupportSource("sentry")).toBe("sentry");

    expect(sourceLookupAliases("slack", "slack")).toEqual([
      "slack",
      "slack_bot",
    ]);
    expect(sourceLookupAliases("emma", "emma")).toEqual([
      "emma",
      "ari_gold",
      "external_agent",
    ]);
    expect(sourceLookupAliases("email", "support_email")).toEqual([
      "email",
      "support_email",
    ]);
  });

  it("prefers explicit source event and case keys", () => {
    const input = {
      externalId: "external-123",
      sourceEventId: "event-explicit",
      sourceCaseKey: "case-explicit",
      title: "Creator cannot log in",
      parameters: {
        eventId: "event-param",
        sourceEventId: "event-param-source",
        sourceCaseKey: "case-param-source",
      },
    };

    expect(getSourceEventId(input)).toBe("event-explicit");
    expect(getSourceCaseKey(input, "email")).toBe("case-explicit");
  });

  it("keeps email replies on the provider thread case key", () => {
    const input = {
      externalId: "message-2",
      title: "Re: Cannot connect Gmail",
      customer: { email: "creator@example.com" },
      parameters: {
        provider: "gmail",
        providerThreadId: "thread-abc",
        mailbox: "support@getretrograde.ai",
      },
    };

    expect(getSourceCaseKey(input, "email")).toBe(
      "email:support@getretrograde.ai:gmail:thread:thread-abc",
    );
  });

  it("falls back to stable sender and subject keys when email thread IDs are missing", () => {
    const input = {
      externalId: "message-1",
      title: "Cannot connect Gmail!",
      metadata: {
        email: {
          provider: "cloudflare",
          mailbox: "Support@getretrograde.ai",
          from: { email: "CREATOR@example.com" },
        },
      },
    };

    expect(getSourceCaseKey(input, "email")).toBe(
      "email:support@getretrograde.ai:cloudflare:message:creator@example.com:cannot-connect-gmail",
    );
  });

  it("caps generated email case keys to the metadata column size", () => {
    const longTitle = Array.from(
      { length: 80 },
      (_, index) => `Part ${index}`,
    ).join(" ");
    const input = {
      externalId: "message-long",
      title: longTitle,
      metadata: {
        email: {
          provider: "cloudflare",
          mailbox: "Support@getretrograde.ai",
          from: { email: "creator@example.com" },
        },
      },
    };

    const caseKey = getSourceCaseKey(input, "email");

    expect(caseKey).toHaveLength(300);
    expect(caseKey).toMatch(
      /^email:support@getretrograde.ai:cloudflare:message:creator@example.com:/,
    );
    expect(caseKey).toMatch(/:[a-z0-9]+$/);
  });

  it("uses Slack channel and thread timestamps for Slack case keys", () => {
    const input = {
      externalId: "slack-support:C123:1778941800.000000",
      title: "Slack escalation",
      metadata: {
        slack: {
          channel: "C123",
          threadTs: "1778941800.000000",
        },
      },
    };

    expect(getSourceCaseKey(input, "slack")).toBe(
      "slack:c123:1778941800.000000",
    );
  });

  it("keeps Emma case keys tied to the Emma user and source event", () => {
    const input = {
      externalId: "emma-support-1",
      title: "Emma user issue",
      parameters: {
        eventId: "ari-completion-42",
        emmaUserId: "emma-user-123",
      },
    };

    expect(getSourceCaseKey(input, "emma")).toBe(
      "emma:emma-user-123:ari-completion-42",
    );
  });
});
