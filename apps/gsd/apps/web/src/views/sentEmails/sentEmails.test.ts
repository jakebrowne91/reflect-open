import { describe, expect, it } from "vitest";

import {
  getSentEmailCustomerLabel,
  getSentEmailCustomerSecondaryLabel,
  getSentEmailPurposeLabel,
  getSentEmailSentAt,
  getSentEmailStatusLabel,
  getSentEmailSubjectLabel,
} from "./sentEmails";

describe("sent email customer labels", () => {
  it("prefers the customer name over the email", () => {
    expect(
      getSentEmailCustomerLabel({
        customerName: "Ada Lovelace",
        customerEmail: "ada@example.com",
      }),
    ).toBe("Ada Lovelace");
  });

  it("falls back to the email and then to Unknown", () => {
    expect(
      getSentEmailCustomerLabel({
        customerName: "  ",
        customerEmail: "ada@example.com",
      }),
    ).toBe("ada@example.com");
    expect(
      getSentEmailCustomerLabel({ customerName: null, customerEmail: null }),
    ).toBe("Unknown");
  });

  it("shows the email as a secondary label only when it differs", () => {
    expect(
      getSentEmailCustomerSecondaryLabel({
        customerName: "Ada Lovelace",
        customerEmail: "ada@example.com",
      }),
    ).toBe("ada@example.com");
    expect(
      getSentEmailCustomerSecondaryLabel({
        customerName: null,
        customerEmail: "ada@example.com",
      }),
    ).toBeNull();
    expect(
      getSentEmailCustomerSecondaryLabel({
        customerName: "Ada Lovelace",
        customerEmail: null,
      }),
    ).toBeNull();
  });
});

describe("sent email subject labels", () => {
  it("returns the trimmed subject", () => {
    expect(getSentEmailSubjectLabel({ subject: " Re: My issue " })).toBe(
      "Re: My issue",
    );
  });

  it("falls back to a placeholder when missing", () => {
    expect(getSentEmailSubjectLabel({ subject: null })).toBe("(no subject)");
    expect(getSentEmailSubjectLabel({ subject: "  " })).toBe("(no subject)");
  });
});

describe("sent email purpose labels", () => {
  it("strips the sent suffix and prettifies the purpose", () => {
    expect(getSentEmailPurposeLabel({ summary: "customer_reply sent" })).toBe(
      "Customer reply",
    );
  });

  it("strips the dry-run suffix", () => {
    expect(
      getSentEmailPurposeLabel({ summary: "resolution_notice dry-run" }),
    ).toBe("Resolution notice");
  });

  it("handles a bare purpose and missing summaries", () => {
    expect(getSentEmailPurposeLabel({ summary: "acknowledgement" })).toBe(
      "Acknowledgement",
    );
    expect(getSentEmailPurposeLabel({ summary: null })).toBe("-");
    expect(getSentEmailPurposeLabel({ summary: "  " })).toBe("-");
  });
});

describe("sent email status labels", () => {
  it("maps known statuses", () => {
    expect(getSentEmailStatusLabel({ processingStatus: "sent" })).toBe("Sent");
    expect(getSentEmailStatusLabel({ processingStatus: "dry_run" })).toBe(
      "Dry run",
    );
  });

  it("prettifies unknown statuses", () => {
    expect(
      getSentEmailStatusLabel({ processingStatus: "some_other_status" }),
    ).toBe("Some other status");
    expect(getSentEmailStatusLabel({ processingStatus: " " })).toBe("-");
  });
});

describe("sent email dates", () => {
  it("parses dates and date strings", () => {
    expect(
      getSentEmailSentAt({ sentAt: new Date("2026-06-01T10:00:00Z") }),
    ).toEqual(new Date("2026-06-01T10:00:00Z"));
    expect(getSentEmailSentAt({ sentAt: "2026-06-02T10:00:00Z" })).toEqual(
      new Date("2026-06-02T10:00:00Z"),
    );
  });

  it("returns null for invalid dates", () => {
    expect(getSentEmailSentAt({ sentAt: "not-a-date" })).toBeNull();
  });
});
