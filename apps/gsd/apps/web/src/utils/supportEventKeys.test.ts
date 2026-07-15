import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type {
  EmailCaseIdentityInput,
  SupportSourceIdentityInput,
} from "./supportEventKeys";
import {
  buildEmailCaseIdentity,
  buildSupportCaseId,
  canonicalSupportSource,
  externalAgentSessionEventKey,
  getSourceCaseKey,
  getSourceEventId,
  limitSourceCaseKey,
  normalizeKeyPart,
  normalizeSubjectForCaseKey,
  sourceLookupAliases,
  stableHash,
  ticketMarker,
} from "./supportEventKeys";

// Characterization fixture generated from the pre-consolidation implementations.
// A mirrored copy of this module lives in the apps/gsd workspace and runs the
// same assertions, so the two copies cannot drift silently.
interface Fixture {
  normalizeKeyPart: {
    value: string | null;
    fallback?: string;
    expected: string;
  }[];
  normalizeSubjectForCaseKey: { subject: string; expected: string }[];
  stableHash: { value: string; expected: string }[];
  limitSourceCaseKey: { value: string; expected: string }[];
  buildSupportCaseId: { sourceCaseKey: string | null; expected: string }[];
  buildEmailCaseIdentity: {
    input: EmailCaseIdentityInput;
    expected: {
      sourceEventId: string;
      sourceCaseKey: string;
      supportCaseId: string;
      providerMessageId: string;
      providerThreadId: string | null;
    };
  }[];
  canonicalSupportSource: { source: string; expected: string }[];
  sourceLookupAliases: {
    source: string;
    inputSource: string;
    expected: string[];
  }[];
  getSourceEventId: { input: SupportSourceIdentityInput; expected: string }[];
  getSourceCaseKey: {
    source: string;
    input: SupportSourceIdentityInput;
    expected: string;
  }[];
  ticketMarker: { sourceAlias: string; externalId: string; expected: string }[];
  externalAgentSessionEventKey: { eventId: string; expected: string }[];
}

const fixture = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        "../../../../../../fixtures/support-event-keys.json",
        import.meta.url,
      ),
    ),
    "utf8",
  ),
) as Fixture;

describe("support-event-keys characterization (fixtures/support-event-keys.json)", () => {
  it("normalizeKeyPart", () => {
    for (const c of fixture.normalizeKeyPart) {
      expect(normalizeKeyPart(c.value, c.fallback), JSON.stringify(c)).toBe(
        c.expected,
      );
    }
  });

  it("normalizeSubjectForCaseKey", () => {
    for (const c of fixture.normalizeSubjectForCaseKey) {
      expect(normalizeSubjectForCaseKey(c.subject), JSON.stringify(c)).toBe(
        c.expected,
      );
    }
  });

  it("stableHash", () => {
    for (const c of fixture.stableHash) {
      expect(stableHash(c.value), JSON.stringify(c)).toBe(c.expected);
    }
  });

  it("limitSourceCaseKey", () => {
    for (const c of fixture.limitSourceCaseKey) {
      expect(limitSourceCaseKey(c.value), JSON.stringify(c)).toBe(c.expected);
    }
  });

  it("buildSupportCaseId", () => {
    for (const c of fixture.buildSupportCaseId) {
      expect(
        buildSupportCaseId(c.sourceCaseKey ?? undefined),
        JSON.stringify(c),
      ).toBe(c.expected);
    }
  });

  it("buildEmailCaseIdentity", () => {
    for (const c of fixture.buildEmailCaseIdentity) {
      const result = buildEmailCaseIdentity(c.input);
      expect(result.sourceEventId, JSON.stringify(c.input)).toBe(
        c.expected.sourceEventId,
      );
      expect(result.sourceCaseKey, JSON.stringify(c.input)).toBe(
        c.expected.sourceCaseKey,
      );
      expect(result.supportCaseId, JSON.stringify(c.input)).toBe(
        c.expected.supportCaseId,
      );
      expect(result.providerMessageId, JSON.stringify(c.input)).toBe(
        c.expected.providerMessageId,
      );
      expect(result.providerThreadId ?? null, JSON.stringify(c.input)).toBe(
        c.expected.providerThreadId,
      );
    }
  });

  it("canonicalSupportSource", () => {
    for (const c of fixture.canonicalSupportSource) {
      expect(canonicalSupportSource(c.source), JSON.stringify(c)).toBe(
        c.expected,
      );
    }
  });

  it("sourceLookupAliases", () => {
    for (const c of fixture.sourceLookupAliases) {
      expect(
        sourceLookupAliases(c.source, c.inputSource),
        JSON.stringify(c),
      ).toEqual(c.expected);
    }
  });

  it("getSourceEventId", () => {
    for (const c of fixture.getSourceEventId) {
      expect(getSourceEventId(c.input), JSON.stringify(c.input)).toBe(
        c.expected,
      );
    }
  });

  it("getSourceCaseKey", () => {
    for (const c of fixture.getSourceCaseKey) {
      expect(getSourceCaseKey(c.input, c.source), JSON.stringify(c)).toBe(
        c.expected,
      );
    }
  });

  it("ticketMarker", () => {
    for (const c of fixture.ticketMarker) {
      expect(ticketMarker(c.sourceAlias, c.externalId), JSON.stringify(c)).toBe(
        c.expected,
      );
    }
  });

  it("externalAgentSessionEventKey", () => {
    for (const c of fixture.externalAgentSessionEventKey) {
      expect(externalAgentSessionEventKey(c.eventId), JSON.stringify(c)).toBe(
        c.expected,
      );
    }
  });
});
