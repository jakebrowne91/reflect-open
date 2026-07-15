import { describe, expect, it } from "vitest";

import {
  getFeatureRequestCustomerLabel,
  getFeatureRequestCustomerSecondaryLabel,
  getFeatureRequestReportedAt,
  getFeatureRequestSourceLabel,
} from "./featureRequests";

describe("feature request customer labels", () => {
  it("prefers the customer name over the email", () => {
    expect(
      getFeatureRequestCustomerLabel({
        customerName: "Ada Lovelace",
        email: "ada@example.com",
      }),
    ).toBe("Ada Lovelace");
  });

  it("falls back to the email and then to Unknown", () => {
    expect(
      getFeatureRequestCustomerLabel({
        customerName: "  ",
        email: "ada@example.com",
      }),
    ).toBe("ada@example.com");
    expect(
      getFeatureRequestCustomerLabel({ customerName: null, email: null }),
    ).toBe("Unknown");
  });

  it("shows the email as a secondary label only when it differs", () => {
    expect(
      getFeatureRequestCustomerSecondaryLabel({
        customerName: "Ada Lovelace",
        email: "ada@example.com",
      }),
    ).toBe("ada@example.com");
    expect(
      getFeatureRequestCustomerSecondaryLabel({
        customerName: null,
        email: "ada@example.com",
      }),
    ).toBeNull();
    expect(
      getFeatureRequestCustomerSecondaryLabel({
        customerName: "Ada Lovelace",
        email: null,
      }),
    ).toBeNull();
  });
});

describe("feature request source labels", () => {
  it("combines channel, system and source without duplicates", () => {
    expect(
      getFeatureRequestSourceLabel({
        source: "email",
        sourceSystem: "support-email",
        sourceChannel: "email",
      }),
    ).toBe("email / support-email");
  });

  it("falls back to the source alone", () => {
    expect(
      getFeatureRequestSourceLabel({
        source: "emma",
        sourceSystem: null,
        sourceChannel: null,
      }),
    ).toBe("emma");
  });

  it("returns a dash when nothing is set", () => {
    expect(
      getFeatureRequestSourceLabel({
        source: " ",
        sourceSystem: null,
        sourceChannel: null,
      }),
    ).toBe("-");
  });
});

describe("feature request reported dates", () => {
  it("prefers the reported date", () => {
    expect(
      getFeatureRequestReportedAt({
        reportedAt: new Date("2026-06-01T10:00:00Z"),
        createdAt: new Date("2026-06-02T10:00:00Z"),
      }),
    ).toEqual(new Date("2026-06-01T10:00:00Z"));
  });

  it("falls back to the created date and parses strings", () => {
    expect(
      getFeatureRequestReportedAt({
        reportedAt: null,
        createdAt: "2026-06-02T10:00:00Z",
      }),
    ).toEqual(new Date("2026-06-02T10:00:00Z"));
  });

  it("returns null for invalid dates", () => {
    expect(
      getFeatureRequestReportedAt({
        reportedAt: "not-a-date",
        createdAt: "also-not-a-date",
      }),
    ).toBeNull();
  });
});
