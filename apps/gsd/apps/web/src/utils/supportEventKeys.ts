/**
 * Key-construction helpers for support event identity and dedup.
 *
 * These produce the canonical key strings shared across the support pipeline:
 *  - `sourceEventId` / `sourceCaseKey` for email cases (support-email-worker)
 *  - GSD-side source identity keys and ticket markers (mirrored into apps/gsd —
 *    see apps/gsd/apps/web/src/utils/supportEventKeys.ts, which must stay in
 *    sync; both copies are pinned by fixtures/support-event-keys.json)
 *  - agent-webhook KV session reservation keys
 *
 * IMPORTANT: every output must remain byte-identical — these strings are
 * persisted in KV, D1, and GSD card descriptions and are used for dedup.
 * Do not change any algorithm here without a migration plan.
 */

const SOURCE_CASE_KEY_MAX_LENGTH = 300;

/**
 * Normalize a free-form value into a key segment: lowercase, allowed charset
 * `a-z0-9@._:-`, runs of other characters collapsed to single hyphens.
 * Returns `fallback` when nothing survives normalization.
 */
export function normalizeKeyPart(
  value: string | undefined | null,
  fallback = "unknown",
): string {
  let normalized = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9@._:-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (normalized === "") normalized = undefined;

  return normalized ?? fallback;
}

/** Strip a single leading Re:/Fw:/Fwd: prefix and normalize for case keys. */
export function normalizeSubjectForCaseKey(subject: string): string {
  return normalizeKeyPart(
    subject
      .replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "")
      .replace(/\s+/g, " ")
      .slice(0, 120),
    "no-subject",
  );
}

/** FNV-1a 32-bit hash rendered in base36 (lowercase). Used by limitSourceCaseKey. */
export function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** Cap a sourceCaseKey at 300 chars, appending a stable hash suffix when truncated. */
export function limitSourceCaseKey(value: string): string {
  if (value.length <= SOURCE_CASE_KEY_MAX_LENGTH) return value;

  const suffix = `:${stableHash(value)}`;
  return `${value.slice(0, SOURCE_CASE_KEY_MAX_LENGTH - suffix.length)}${suffix}`;
}

/**
 * FNV-1a 32-bit hash rendered as a 6-char uppercase base36 code.
 * Note: distinct from stableHash — buildSupportCaseId depends on this exact format.
 */
function hashCaseKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

/**
 * Human-facing support case id derived from a sourceCaseKey.
 * Identical algorithm to the copy in @retrograde/support-contracts.
 */
export function buildSupportCaseId(sourceCaseKey: string | undefined): string {
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall back
  return `EMMA-${hashCaseKey(sourceCaseKey?.trim() || "unknown-support-case")}`;
}

/** Minimal structural input for buildEmailCaseIdentity (subset of SupportEmailMessage). */
export interface EmailCaseIdentityInput {
  externalId: string;
  provider?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  mailbox?: string;
  subject: string;
  from: { email: string };
}

export interface EmailCaseIdentity {
  sourceEventId: string;
  sourceCaseKey: string;
  supportCaseId: string;
  provider?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  mailbox?: string;
}

/**
 * Canonical email case identity:
 *  - sourceEventId: `email:{provider}:{messageId}`
 *  - sourceCaseKey: `email:{mailbox}:{provider}:thread:{threadId}` when a
 *    provider thread id exists, otherwise
 *    `email:{mailbox}:{provider}:subject:{from}:{subject}`
 */
export function buildEmailCaseIdentity(
  email: EmailCaseIdentityInput,
): EmailCaseIdentity {
  const provider = normalizeKeyPart(email.provider, "email");
  const mailbox = normalizeKeyPart(email.mailbox, "support");
  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty string must fall back
  const providerMessageId = email.providerMessageId || email.externalId;
  const sourceEventId = `email:${provider}:${normalizeKeyPart(providerMessageId)}`;
  const providerThreadId = email.providerThreadId?.trim();
  const sourceCaseKey = providerThreadId
    ? `email:${mailbox}:${provider}:thread:${normalizeKeyPart(providerThreadId)}`
    : `email:${mailbox}:${provider}:subject:${normalizeKeyPart(email.from.email)}:${normalizeSubjectForCaseKey(
        email.subject,
      )}`;
  const supportCaseId = buildSupportCaseId(sourceCaseKey);

  return {
    sourceEventId,
    sourceCaseKey,
    supportCaseId,
    provider: email.provider,
    providerMessageId,
    providerThreadId,
    mailbox: email.mailbox,
  };
}

/** Minimal structural input for the GSD-side source identity helpers. */
export interface SupportSourceIdentityInput {
  externalId: string;
  sourceEventId?: string;
  sourceCaseKey?: string;
  title: string;
  customer?: {
    userId?: string;
    emmaUserId?: string;
    email?: string;
  };
  parameters?: {
    eventId?: string;
    sourceEventId?: string;
    sourceCaseKey?: string;
    userId?: string;
    emmaUserId?: string;
    email?: string;
    provider?: string;
    providerMessageId?: string;
    providerThreadId?: string;
    latestProviderMessageId?: string;
    latestProviderThreadId?: string;
    replyToMessageId?: string;
    subject?: string;
    mailbox?: string;
    sourceChannel?: string;
  };
  metadata?: Record<string, unknown>;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function getNestedRecord(value: unknown, key: string) {
  return recordOrNull(recordOrNull(value)?.[key]);
}

/** Map legacy source names (support_email, slack_bot, ari_gold, external_agent) to canonical ones. */
export function canonicalSupportSource(source: string): string {
  const normalized = source.trim().toLowerCase();
  if (normalized === "support_email") return "email";
  if (normalized === "slack_bot") return "slack";
  if (normalized === "ari_gold" || normalized === "external_agent")
    return "emma";
  if (
    normalized === "email" ||
    normalized === "slack" ||
    normalized === "emma" ||
    normalized === "sentry"
  ) {
    return normalized;
  }
  return normalized;
}

/** Canonical source plus its legacy aliases, for looking up previously stored events. */
export function sourceLookupAliases(
  source: string,
  inputSource: string,
): string[] {
  const aliases = new Set<string>([source, inputSource.trim().toLowerCase()]);

  if (source === "email") aliases.add("support_email");
  if (source === "slack") aliases.add("slack_bot");
  if (source === "emma") {
    aliases.add("ari_gold");
    aliases.add("external_agent");
  }

  return [...aliases].filter(Boolean);
}

export function getSourceEventId(input: SupportSourceIdentityInput): string {
  return (
    input.sourceEventId ??
    input.parameters?.sourceEventId ??
    input.parameters?.eventId ??
    input.externalId
  );
}

export function getSourceCaseKey(
  input: SupportSourceIdentityInput,
  source: string,
): string {
  if (input.sourceCaseKey) return limitSourceCaseKey(input.sourceCaseKey);
  if (input.parameters?.sourceCaseKey)
    return limitSourceCaseKey(input.parameters.sourceCaseKey);

  const metadata = recordOrNull(input.metadata) ?? {};
  const email = getNestedRecord(metadata, "email");
  const slack = getNestedRecord(metadata, "slack");
  const params = input.parameters;
  const eventId = getSourceEventId(input);

  if (source === "email") {
    const provider = normalizeKeyPart(
      firstString(params?.provider, email?.provider),
      "email",
    );
    const mailbox = normalizeKeyPart(
      firstString(params?.mailbox, email?.mailbox),
      "support",
    );
    const threadId = firstString(
      params?.providerThreadId,
      email?.providerThreadId,
    );
    if (threadId) {
      return limitSourceCaseKey(
        `email:${mailbox}:${provider}:thread:${normalizeKeyPart(threadId)}`,
      );
    }
    const emailFrom = recordOrNull(email?.from);
    const from = normalizeKeyPart(
      firstString(input.customer?.email, emailFrom?.email, params?.email),
      "unknown",
    );
    return limitSourceCaseKey(
      `email:${mailbox}:${provider}:message:${from}:${normalizeKeyPart(input.title)}`,
    );
  }

  if (source === "slack") {
    const channel = normalizeKeyPart(
      firstString(slack?.channel, params?.sourceChannel),
      "unknown",
    );
    const threadTs = normalizeKeyPart(
      firstString(slack?.threadTs, metadata.threadTs),
      eventId,
    );
    return limitSourceCaseKey(`slack:${channel}:${threadTs}`);
  }

  if (source === "emma") {
    return limitSourceCaseKey(
      `emma:${normalizeKeyPart(
        firstString(
          params?.emmaUserId,
          input.customer?.emmaUserId,
          params?.userId,
          input.customer?.userId,
          eventId,
        ),
      )}:${normalizeKeyPart(eventId)}`,
    );
  }

  if (source === "sentry")
    return limitSourceCaseKey(`sentry:${normalizeKeyPart(input.externalId)}`);

  return limitSourceCaseKey(`${source}:${normalizeKeyPart(input.externalId)}`);
}

/** Marker string embedded in GSD card descriptions to find tickets for a source event. */
export function ticketMarker(sourceAlias: string, externalId: string): string {
  return `retrograde-support-ticket:${sourceAlias}:${externalId}`;
}

/** agent-webhook KV key reserving/recording the session created for an external event. */
export function externalAgentSessionEventKey(eventId: string): string {
  return `external-agent:event:${eventId}`;
}
