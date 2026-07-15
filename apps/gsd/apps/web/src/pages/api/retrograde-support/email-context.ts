import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  SupportEmailCaseCandidate,
  SupportEmailCaseContext,
  SupportEmailCaseMessage,
  SupportEmailKnownIssue,
  SupportEmailMessage,
  SupportEmailWorkflowSnapshot,
} from "@retrograde/support-contracts";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { createDrizzleClient } from "@kan/db/client";
import * as cardAgentRunRepo from "@kan/db/repository/cardAgentRun.repo";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";

import { env } from "~/env";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;

const emailAddressSchema = z.object({
  email: z.string().trim().max(320),
  name: z.string().trim().max(200).nullable().optional(),
});

const emailMessageSchema = z
  .object({
    externalId: z.string().trim().min(1).max(300),
    provider: z.string().trim().max(80).optional(),
    providerMessageId: z.string().trim().max(300).optional(),
    providerThreadId: z.string().trim().max(300).optional(),
    mailbox: z.string().trim().max(320).optional(),
    from: emailAddressSchema,
    to: z.array(emailAddressSchema).default([]),
    cc: z.array(emailAddressSchema).optional(),
    subject: z.string().max(1000).default(""),
    bodyText: z.string().max(120000).nullable().optional(),
    bodyHtml: z.string().max(250000).nullable().optional(),
    receivedAt: z.string().trim().max(120).optional(),
    attachments: z.array(z.record(z.unknown())).optional(),
    raw: z.record(z.unknown()).optional(),
  })
  .passthrough();

const requestSchema = z.object({
  sourceEventId: z.string().trim().min(1).max(300),
  sourceCaseKey: z.string().trim().min(1).max(300),
  supportCaseId: z.string().trim().max(80).optional(),
  email: emailMessageSchema,
  customer: z
    .object({
      email: z.string().trim().max(320).nullable().optional(),
      name: z.string().trim().max(200).nullable().optional(),
    })
    .nullable()
    .optional(),
});

type DbClient = ReturnType<typeof createDrizzleClient>;

function getDb() {
  return createDrizzleClient();
}

function getHeader(req: NextApiRequest, name: string): string | null {
  const value = req.headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

async function readRawBody(req: NextApiRequest): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

function verifySignature(req: NextApiRequest, rawBody: string): boolean {
  const secret = env.RETROGRADE_GSD_API_SECRET;
  if (!secret) return false;

  const timestamp = getHeader(req, "x-retrograde-gsd-timestamp");
  const signature = getHeader(req, "x-retrograde-gsd-signature");
  if (!timestamp || !signature?.startsWith("sha256=")) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;
  const timestampMs =
    timestampNumber > 1_000_000_000_000
      ? timestampNumber
      : timestampNumber * 1000;
  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) return false;

  const actualHex = signature.slice("sha256=".length);
  if (!/^[a-f0-9]{64}$/i.test(actualHex)) return false;
  const expectedHex = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const actual = Buffer.from(actualHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function jsonError(res: NextApiResponse, status: number, error: string) {
  return res.status(status).json({ ok: false, error });
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeEmail(value: string | null | undefined) {
  const trimmed = value?.trim().toLowerCase();
  return trimmed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed) ? trimmed : null;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function workflowSnapshotFromMetadata(
  metadata: unknown,
): SupportEmailWorkflowSnapshot | null {
  const record = recordOrNull(metadata);
  if (!record) return null;

  const snapshot: SupportEmailWorkflowSnapshot = {
    classification: recordOrNull(record.classification),
    extracted: recordOrNull(record.extracted),
    decision: recordOrNull(record.decision),
    customerResolution: recordOrNull(record.customerResolution),
    caseMatch: recordOrNull(record.caseMatch),
    reconciliation: recordOrNull(record.reconciliation),
    agent: recordOrNull(record.agent),
  };

  return Object.values(snapshot).some(Boolean) ? snapshot : null;
}

function extractSupportCaseId(email: SupportEmailMessage) {
  const text = `${email.subject ?? ""}\n${email.bodyText ?? ""}\n${email.bodyHtml ?? ""}`;
  return /\bEMMA-[A-Z0-9]{6,}\b/i.exec(text)?.[0]?.toUpperCase();
}

function stripEmailHtml(value: string | null | undefined) {
  return (value ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripQuotedThread(value: string | null | undefined) {
  const body = stripEmailHtml(value);
  const lines = body.split(/\r?\n/);
  const result: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .+ wrote:\s*$/i.test(line)) break;
    if (/^\s*From:\s.+$/i.test(line) && result.length > 0) break;
    if (/^\s*-{2,}\s*Original Message\s*-{2,}\s*$/i.test(line)) break;
    result.push(line);
  }
  return result.join("\n").trim();
}

function toCaseMessage(row: {
  direction?: string | null;
  eventType?: string | null;
  sourceEventId?: string | null;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  subject?: string | null;
  bodyText?: string | null;
  summary?: string | null;
  createdAt?: Date | string | null;
}): SupportEmailCaseMessage {
  return {
    direction: row.direction === "outbound" ? "outbound" : "inbound",
    eventType: row.eventType ?? undefined,
    sourceEventId: row.sourceEventId ?? undefined,
    providerMessageId: row.providerMessageId ?? undefined,
    providerThreadId: row.providerThreadId ?? undefined,
    subject: row.subject ?? null,
    bodyText: row.bodyText ?? null,
    summary: row.summary ?? null,
    createdAt: row.createdAt
      ? new Date(row.createdAt).toISOString()
      : undefined,
  };
}

function statusFromListName(name: string | null | undefined) {
  const normalized = name?.trim().toLowerCase();
  if (normalized === "needs customer") return "needs_input";
  if (normalized === "ready for review") return "ready_for_review";
  if (normalized === "bug raised") return "bug_raised";
  if (normalized === "investigating") return "investigating";
  if (normalized === "resolved") return "resolved";
  if (normalized === "new") return "new";
  return normalized ?? null;
}

async function candidateFromMetadata(
  db: DbClient,
  metadata: NonNullable<
    Awaited<ReturnType<typeof supportTicketMetadataRepo.getBySourceCaseKey>>
  >,
): Promise<SupportEmailCaseCandidate> {
  const recentMessages = await supportTicketMetadataRepo.listMessagesForCard(
    db,
    {
      cardId: metadata.card.id,
      limit: 5,
    },
  );
  return {
    cardPublicId: metadata.card.publicId,
    cardNumber: metadata.card.cardNumber,
    title: metadata.card.title,
    sourceCaseKey: metadata.sourceCaseKey,
    supportCaseId: metadata.supportCaseId,
    email: metadata.email,
    customerName: metadata.customerName,
    issueCategory: metadata.issueCategory,
    status: statusFromListName(metadata.card.list?.name),
    summary: metadata.card.description?.slice(0, 1000) ?? null,
    recentMessages: recentMessages.reverse().map(toCaseMessage),
    workflow: workflowSnapshotFromMetadata(metadata.metadata),
  };
}

async function buildContext(
  db: DbClient,
  input: z.infer<typeof requestSchema>,
): Promise<SupportEmailCaseContext> {
  const email = input.email as SupportEmailMessage;
  const provider = firstString(email.provider, "email") ?? "email";
  const mailbox = firstString(email.mailbox);
  const threadId = firstString(email.providerThreadId);
  const explicitCaseId = input.supportCaseId ?? extractSupportCaseId(email);
  const currentBody = stripQuotedThread(email.bodyText ?? email.bodyHtml);

  await supportTicketMetadataRepo.upsertEmailMessage(db, {
    source: "email",
    sourceEventId: input.sourceEventId,
    sourceCaseKey: input.sourceCaseKey,
    supportCaseId: explicitCaseId ?? null,
    direction: "inbound",
    provider,
    mailbox,
    providerMessageId: email.providerMessageId ?? email.externalId,
    providerThreadId: threadId ?? null,
    customerEmail:
      normalizeEmail(input.customer?.email) ?? normalizeEmail(email.from.email),
    customerName: input.customer?.name ?? email.from.name ?? null,
    subject: email.subject,
    bodyText: currentBody,
    bodyHtml: email.bodyHtml ?? null,
    raw: email.raw ?? null,
    receivedAt: parseOptionalDate(email.receivedAt),
  });

  let matchedMetadata: NonNullable<
    Awaited<ReturnType<typeof supportTicketMetadataRepo.getBySourceCaseKey>>
  > | null = null;
  let matchMethod: SupportEmailCaseContext["matchMethod"] = "none";

  if (threadId) {
    const thread = await supportTicketMetadataRepo.getByProviderThread(db, {
      provider,
      providerThreadId: threadId,
      mailbox,
    });
    if (thread?.card?.supportTicketMetadata) {
      matchedMetadata = {
        ...thread.card.supportTicketMetadata,
        card: thread.card,
      };
      matchMethod = "thread";
    }
  }

  if (!matchedMetadata && explicitCaseId) {
    matchedMetadata =
      (await supportTicketMetadataRepo.getBySupportCaseId(db, {
        supportCaseId: explicitCaseId,
      })) ?? null;
    if (matchedMetadata) matchMethod = "case_id";
  }

  if (!matchedMetadata) {
    matchedMetadata =
      (await supportTicketMetadataRepo.getBySourceCaseKey(db, {
        source: "email",
        sourceCaseKey: input.sourceCaseKey,
      })) ?? null;
    if (matchedMetadata) matchMethod = "source_case_key";
  }

  // SECURITY: only match candidate cases on identities we can trust — the verified sender address
  // and the resolved customer record. Do NOT harvest email addresses from the message body: a
  // sender controls the body, so citing a victim's address must never surface or merge the victim's
  // case (cross-account leak). Legit account-recovery (sender references a different account) is
  // handled as an unverified claim + verification flow, not by auto-matching the other case.
  const candidateEmails = [
    normalizeEmail(email.from.email),
    normalizeEmail(input.customer?.email),
  ].filter((value): value is string => Boolean(value));

  const rawCandidates = await supportTicketMetadataRepo.listCandidateCases(db, {
    emails: [...new Set(candidateEmails)],
    limit: 8,
  });
  const candidates: SupportEmailCaseCandidate[] = [];
  for (const candidate of rawCandidates) {
    if (!candidate.card) continue;
    if (candidate.card.list?.name === "Resolved") continue;
    candidates.push(await candidateFromMetadata(db, candidate));
  }

  if (!matchedMetadata && candidates.length === 1) {
    const candidate = rawCandidates.find(
      (item) => item.card?.publicId === candidates[0]?.cardPublicId,
    );
    // Defense in depth: only adopt a candidate as THE matched case when it belongs to the verified
    // sender. An unverified sender must never inherit another customer's case.
    const senderEmail = normalizeEmail(email.from.email);
    if (
      candidate?.card &&
      senderEmail &&
      normalizeEmail(candidate.email) === senderEmail
    ) {
      matchedMetadata = candidate;
      matchMethod = "candidate";
    }
  }

  const matchedCase = matchedMetadata
    ? await candidateFromMetadata(db, matchedMetadata)
    : null;
  const threadMessages = matchedMetadata
    ? (
        await supportTicketMetadataRepo.listMessagesForCard(db, {
          cardId: matchedMetadata.card.id,
          limit: 12,
        })
      )
        .reverse()
        .map(toCaseMessage)
    : [];
  const supportEvents = matchedMetadata
    ? (
        await supportTicketMetadataRepo.listEventsForCard(db, {
          cardId: matchedMetadata.card.id,
          limit: 12,
        })
      )
        .reverse()
        .map((event) =>
          toCaseMessage({
            direction: "inbound",
            eventType: event.eventType,
            sourceEventId: event.sourceEventId,
            summary: event.summary,
            createdAt: event.createdAt,
          }),
        )
    : [];

  const recentKnownIssues: SupportEmailKnownIssue[] = (
    await cardAgentRunRepo.listRecentKnownIssues(db).catch((error) => {
      console.warn("Failed to load recent known issues", error);
      return [];
    })
  ).map((issue) => ({
    cardPublicId: issue.cardPublicId,
    title: issue.title,
    issueCategory: issue.issueCategory,
    rootCause: issue.rootCause,
    fix: issue.fix,
    resolvedAt: issue.resolvedAt ? issue.resolvedAt.toISOString() : null,
  }));

  return {
    matchedCase,
    matchMethod,
    threadMessages,
    supportEvents,
    candidates,
    recentKnownIssues,
  };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    jsonError(res, 405, "Method not allowed");
    return;
  }

  const rawBody = await readRawBody(req);
  if (!verifySignature(req, rawBody)) {
    jsonError(res, 401, "Invalid signature");
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    jsonError(res, 400, "Invalid JSON payload");
    return;
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    jsonError(res, 400, parsed.error.issues[0]?.message ?? "Invalid payload");
    return;
  }

  try {
    const context = await buildContext(getDb(), parsed.data);
    res.status(200).json({ ok: true, context });
  } catch (error) {
    console.error("Failed to load support email context", error);
    jsonError(res, 500, "Unable to load support email context");
  }
}

export default withApiLogging(handler);
