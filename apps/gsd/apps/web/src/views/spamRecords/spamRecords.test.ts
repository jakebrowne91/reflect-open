import { describe, expect, it } from "vitest";

import {
  getSpamRecordCategoryLabel,
  getSpamRecordReasoning,
  getSpamRecordReceivedAt,
  getSpamRecordSenderLabel,
  getSpamRecordSenderSecondaryLabel,
  getSpamRecordStatusLabel,
  getSpamRecordSubjectLabel,
} from "./spamRecords";

describe("spam record sender labels", () => {
  it("prefers the sender name over the email", () => {
    expect(
      getSpamRecordSenderLabel({
        customerName: "Spam Bot",
        customerEmail: "bot@example.com",
      }),
    ).toBe("Spam Bot");
  });

  it("falls back to the email and then to Unknown", () => {
    expect(
      getSpamRecordSenderLabel({
        customerName: "  ",
        customerEmail: "bot@example.com",
      }),
    ).toBe("bot@example.com");
    expect(
      getSpamRecordSenderLabel({ customerName: null, customerEmail: null }),
    ).toBe("Unknown");
  });

  it("shows the email as a secondary label only when it differs", () => {
    expect(
      getSpamRecordSenderSecondaryLabel({
        customerName: "Spam Bot",
        customerEmail: "bot@example.com",
      }),
    ).toBe("bot@example.com");
    expect(
      getSpamRecordSenderSecondaryLabel({
        customerName: null,
        customerEmail: "bot@example.com",
      }),
    ).toBeNull();
  });
});

describe("spam record subject labels", () => {
  it("returns the trimmed subject or a placeholder", () => {
    expect(getSpamRecordSubjectLabel({ subject: " You won! " })).toBe(
      "You won!",
    );
    expect(getSpamRecordSubjectLabel({ subject: null })).toBe("(no subject)");
  });
});

describe("spam record classification", () => {
  it("extracts and prettifies the category", () => {
    expect(
      getSpamRecordCategoryLabel({ classification: { category: "spam" } }),
    ).toBe("Spam");
    expect(
      getSpamRecordCategoryLabel({
        classification: { category: "non_issue" },
      }),
    ).toBe("Non issue");
  });

  it("returns a dash for missing or malformed categories", () => {
    expect(getSpamRecordCategoryLabel({ classification: null })).toBe("-");
    expect(getSpamRecordCategoryLabel({ classification: {} })).toBe("-");
    expect(
      getSpamRecordCategoryLabel({ classification: { category: 42 } }),
    ).toBe("-");
  });

  it("extracts the reasoning when present", () => {
    expect(
      getSpamRecordReasoning({
        classification: { reasoning: " Bulk marketing email. " },
      }),
    ).toBe("Bulk marketing email.");
    expect(getSpamRecordReasoning({ classification: null })).toBeNull();
    expect(
      getSpamRecordReasoning({ classification: { reasoning: 42 } }),
    ).toBeNull();
  });
});

describe("spam record status labels", () => {
  it("maps the recorded statuses", () => {
    expect(
      getSpamRecordStatusLabel({ processingStatus: "recorded_spam" }),
    ).toBe("Spam");
    expect(
      getSpamRecordStatusLabel({ processingStatus: "recorded_non_issue" }),
    ).toBe("Non-issue");
    expect(
      getSpamRecordStatusLabel({ processingStatus: "recorded_no_card" }),
    ).toBe("No card");
  });

  it("prettifies unknown statuses", () => {
    expect(getSpamRecordStatusLabel({ processingStatus: "received" })).toBe(
      "Received",
    );
    expect(getSpamRecordStatusLabel({ processingStatus: " " })).toBe("-");
  });
});

describe("spam record received dates", () => {
  it("prefers the received date", () => {
    expect(
      getSpamRecordReceivedAt({
        receivedAt: new Date("2026-06-01T10:00:00Z"),
        createdAt: new Date("2026-06-02T10:00:00Z"),
      }),
    ).toEqual(new Date("2026-06-01T10:00:00Z"));
  });

  it("falls back to the created date and parses strings", () => {
    expect(
      getSpamRecordReceivedAt({
        receivedAt: null,
        createdAt: "2026-06-02T10:00:00Z",
      }),
    ).toEqual(new Date("2026-06-02T10:00:00Z"));
  });

  it("returns null for invalid dates", () => {
    expect(
      getSpamRecordReceivedAt({
        receivedAt: "not-a-date",
        createdAt: "also-not-a-date",
      }),
    ).toBeNull();
  });
});
