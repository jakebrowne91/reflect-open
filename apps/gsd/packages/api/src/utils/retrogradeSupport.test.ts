import { afterEach, describe, expect, it, vi } from "vitest";

import type { SupportTicketStatus } from "./retrogradeSupport";
import {
  postSupportTicketCreatedSlackAlert,
  postSupportTicketStatusSlackUpdate,
  SUPPORT_LIST_NAMES,
  SUPPORT_STATUS_TO_LIST_NAME,
  supportStatusFromListName,
} from "./retrogradeSupport";

describe("support status <-> list name mapping", () => {
  it("maps the Failed list back to the failed status", () => {
    expect(supportStatusFromListName("Failed")).toBe("failed");
  });

  it("round-trips every status through its list name", () => {
    for (const [status, listName] of Object.entries(
      SUPPORT_STATUS_TO_LIST_NAME,
    )) {
      expect(supportStatusFromListName(listName)).toBe(
        status as SupportTicketStatus,
      );
    }
  });

  it("derives the default list names from the forward map", () => {
    expect(SUPPORT_LIST_NAMES).toEqual([
      "New",
      "Investigating",
      "Needs Customer",
      "Bug Raised",
      "Ready for Review",
      "Resolved",
      "Failed",
    ]);
  });

  it("returns null for unknown list names", () => {
    expect(supportStatusFromListName("Backlog")).toBeNull();
    expect(supportStatusFromListName(undefined)).toBeNull();
  });
});

describe("retrograde support Slack callbacks", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("treats Slack callback transport failures as best-effort notifications", async () => {
    vi.stubEnv(
      "SLACK_BOT_CALLBACK_URL",
      "https://slack-bot.example.com/callbacks",
    );
    vi.stubEnv("INTERNAL_CALLBACK_SECRET", "secret");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );

    await expect(
      postSupportTicketStatusSlackUpdate({
        eventId: "event-123",
        status: "ready_for_review",
        title: "Ticket ready",
      }),
    ).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("support.slack_callback_transport_failed"),
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("network down"));
  });

  it("warns when Slack callback config is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      postSupportTicketStatusSlackUpdate({
        eventId: "event-123",
        status: "investigating",
        title: "Ticket investigating",
      }),
    ).resolves.toBeUndefined();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("support.slack_callback_skipped"),
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("missing_slack_callback_url"),
    );
  });

  it("rewrites support ticket Slack links to the admin GSD card route", async () => {
    vi.stubEnv(
      "SLACK_BOT_CALLBACK_URL",
      "https://slack-bot.example.com/callbacks",
    );
    vi.stubEnv("INTERNAL_CALLBACK_SECRET", "secret");
    vi.stubEnv(
      "NEXT_PUBLIC_RETROGRADE_ADMIN_APP_URL",
      "https://admin.example.com/gsd",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postSupportTicketCreatedSlackAlert({
      eventId: "card-123",
      title: "Ticket created",
      ticket: {
        cardPublicId: "card-123",
        cardUrl: "https://gsd.example.com/cards/card-123",
      },
      ticketUrl: "https://gsd.example.com/cards/card-123",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));

    expect(body.ticketUrl).toBe("https://admin.example.com/gsd/cards/card-123");
    expect(body.ticket.cardUrl).toBe(
      "https://admin.example.com/gsd/cards/card-123",
    );
    expect(body.sessionUrl).toBe("");
  });

  it("accepts Slack callback URLs with a callbacks suffix", async () => {
    vi.stubEnv(
      "RETROGRADE_SLACK_BOT_CALLBACK_URL",
      "https://slack-bot.example.com/callbacks",
    );
    vi.stubEnv("INTERNAL_CALLBACK_SECRET", "secret");
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postSupportTicketStatusSlackUpdate({
      eventId: "card-123",
      status: "ready_for_review",
      title: "Ticket ready",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://slack-bot.example.com/callbacks/alerts/customer-support-ticket-update",
    );
  });

  it("rewrites Ari session Slack links to the admin domain", async () => {
    vi.stubEnv(
      "SLACK_BOT_CALLBACK_URL",
      "https://slack-bot.example.com/callbacks",
    );
    vi.stubEnv("INTERNAL_CALLBACK_SECRET", "secret");
    vi.stubEnv(
      "NEXT_PUBLIC_RETROGRADE_ADMIN_APP_URL",
      "https://admin.example.com",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postSupportTicketStatusSlackUpdate({
      eventId: "card-123",
      source: "email",
      status: "investigating",
      sessionUrl: "https://ari.example.com/session/session-123",
      parameters: {
        sourceSystem: "support_email_worker",
        sourceChannel: "nylas",
      },
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));

    expect(body.sessionUrl).toBe(
      "https://admin.example.com/ari-gold/session-123",
    );
    expect(body.source).toBe("email");
    expect(body.parameters).toMatchObject({
      sourceSystem: "support_email_worker",
      sourceChannel: "nylas",
    });
  });

  it("strips the GSD section suffix from admin Ari session links", async () => {
    vi.stubEnv(
      "SLACK_BOT_CALLBACK_URL",
      "https://slack-bot.example.com/callbacks",
    );
    vi.stubEnv("INTERNAL_CALLBACK_SECRET", "secret");
    vi.stubEnv(
      "NEXT_PUBLIC_RETROGRADE_ADMIN_APP_URL",
      "https://admin.example.com/gsd",
    );
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await postSupportTicketStatusSlackUpdate({
      eventId: "card-123",
      status: "ready_for_review",
      sessionUrl: "https://ari.example.com/session/session-123",
    });

    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect(body.sessionUrl).toBe(
      "https://admin.example.com/ari-gold/session-123",
    );
  });
});
