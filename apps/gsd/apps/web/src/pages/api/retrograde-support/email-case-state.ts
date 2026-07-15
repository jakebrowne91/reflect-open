import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  SupportEmailCaseCandidate,
  SupportEmailCaseContext,
  SupportEmailCaseMessage,
  SupportEmailCaseState,
  SupportEmailWorkflowSnapshot,
} from "@retrograde/support-contracts";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { createDrizzleClient } from "@kan/db/client";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";

import { env } from "~/env";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;

const requestSchema = z.object({
  eventId: z.string().trim().max(300).optional(),
  sourceEventId: z.string().trim().max(300).optional(),
  sourceCaseKey: z.string().trim().max(300).optional(),
  supportCaseId: z.string().trim().max(80).optional(),
  cardPublicId: z.string().trim().max(80).optional(),
  provider: z.string().trim().max(80).optional(),
  providerThreadId: z.string().trim().max(300).optional(),
  mailbox: z.string().trim().max(320).optional(),
});

type DbClient = ReturnType<typeof createDrizzleClient>;
type RequestInput = z.infer<typeof requestSchema>;
type MetadataWithCard = NonNullable<
  Awaited<ReturnType<typeof supportTicketMetadataRepo.getBySupportCaseId>>
>;

let dbSingleton: DbClient | null = null;

function getDb() {
  dbSingleton ??= createDrizzleClient();
  return dbSingleton;
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
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

function gsdCardPublicIdFromEventId(eventId: string | undefined) {
  return /^gsd-card:([^:]+):/.exec(eventId ?? "")?.[1];
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
  metadata: MetadataWithCard,
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
    recentMessages: [...recentMessages].reverse().map(toCaseMessage),
    workflow: workflowSnapshotFromMetadata(metadata.metadata),
  };
}

async function findMetadata(
  db: DbClient,
  input: RequestInput,
): Promise<{
  metadata: MetadataWithCard | null;
  matchMethod: SupportEmailCaseContext["matchMethod"];
}> {
  const cardPublicId =
    input.cardPublicId ?? gsdCardPublicIdFromEventId(input.eventId);
  if (cardPublicId) {
    const metadata = await supportTicketMetadataRepo.getByCardPublicId(db, {
      cardPublicId,
    });
    if (metadata) return { metadata, matchMethod: "card" };
  }

  if (input.providerThreadId) {
    const thread = await supportTicketMetadataRepo.getByProviderThread(db, {
      provider: input.provider ?? "nylas",
      providerThreadId: input.providerThreadId,
      mailbox: input.mailbox,
    });
    if (thread?.card?.supportTicketMetadata) {
      return {
        metadata: {
          ...thread.card.supportTicketMetadata,
          card: thread.card,
        },
        matchMethod: "thread",
      };
    }
  }

  if (input.supportCaseId) {
    const metadata = await supportTicketMetadataRepo.getBySupportCaseId(db, {
      supportCaseId: input.supportCaseId,
    });
    if (metadata) return { metadata, matchMethod: "case_id" };
  }

  if (input.sourceCaseKey) {
    const metadata = await supportTicketMetadataRepo.getBySourceCaseKey(db, {
      source: "email",
      sourceCaseKey: input.sourceCaseKey,
    });
    if (metadata) return { metadata, matchMethod: "source_case_key" };
  }

  if (input.sourceEventId) {
    const event = await supportTicketMetadataRepo.getEventBySourceEventId(db, {
      source: "email",
      sourceEventId: input.sourceEventId,
    });
    if (event?.card?.publicId) {
      const metadata = await supportTicketMetadataRepo.getByCardPublicId(db, {
        cardPublicId: event.card.publicId,
      });
      if (metadata) return { metadata, matchMethod: "card" };
    }
  }

  return { metadata: null, matchMethod: "none" };
}

function buildCaseState(params: {
  metadata: MetadataWithCard;
  messagesDesc: Awaited<
    ReturnType<typeof supportTicketMetadataRepo.listMessagesForCard>
  >;
}): SupportEmailCaseState {
  const latestMessage = params.messagesDesc[0];
  const latestInbound = params.messagesDesc.find(
    (message) => message.direction === "inbound",
  );
  const latestOutbound = params.messagesDesc.find(
    (message) => message.direction === "outbound",
  );

  return {
    cardPublicId: params.metadata.card.publicId,
    cardNumber: params.metadata.card.cardNumber,
    sourceEventId: params.metadata.sourceEventId,
    sourceCaseKey: params.metadata.sourceCaseKey,
    supportCaseId: params.metadata.supportCaseId,
    customerEmail: firstString(
      latestInbound?.customerEmail,
      params.metadata.email,
      latestMessage?.customerEmail,
    ),
    customerName: firstString(
      latestInbound?.customerName,
      params.metadata.customerName,
      latestMessage?.customerName,
    ),
    provider: firstString(
      latestInbound?.provider,
      latestMessage?.provider,
      params.metadata.provider,
    ),
    mailbox: firstString(
      latestInbound?.mailbox,
      latestMessage?.mailbox,
      params.metadata.mailbox,
    ),
    providerMessageId: firstString(
      latestInbound?.providerMessageId,
      params.metadata.providerMessageId,
      latestMessage?.providerMessageId,
    ),
    providerThreadId: firstString(
      latestInbound?.providerThreadId,
      latestMessage?.providerThreadId,
      params.metadata.providerThreadId,
    ),
    latestProviderMessageId: firstString(
      latestMessage?.providerMessageId,
      params.metadata.providerMessageId,
    ),
    latestProviderThreadId: firstString(
      latestMessage?.providerThreadId,
      latestInbound?.providerThreadId,
      params.metadata.providerThreadId,
    ),
    latestInboundMessageId: latestInbound?.providerMessageId ?? null,
    latestOutboundMessageId: latestOutbound?.providerMessageId ?? null,
    replyToMessageId: firstString(
      latestInbound?.providerMessageId,
      latestMessage?.replyToMessageId,
      params.metadata.providerMessageId,
    ),
    subject: firstString(
      latestInbound?.subject,
      latestMessage?.subject,
      recordOrNull(params.metadata.metadata)?.subject,
    ),
    status: statusFromListName(params.metadata.card.list?.name),
    workflow: workflowSnapshotFromMetadata(params.metadata.metadata),
  };
}

async function buildCaseStateResponse(db: DbClient, input: RequestInput) {
  const match = await findMetadata(db, input);
  if (!match.metadata) {
    return {
      context: {
        matchedCase: null,
        matchMethod: match.matchMethod,
        threadMessages: [],
        supportEvents: [],
        candidates: [],
      } satisfies SupportEmailCaseContext,
      caseState: null,
    };
  }

  const messagesDesc = await supportTicketMetadataRepo.listMessagesForCard(db, {
    cardId: match.metadata.card.id,
    limit: 20,
  });
  const eventsDesc = await supportTicketMetadataRepo.listEventsForCard(db, {
    cardId: match.metadata.card.id,
    limit: 12,
  });

  const context: SupportEmailCaseContext = {
    matchedCase: await candidateFromMetadata(db, match.metadata),
    matchMethod: match.matchMethod,
    threadMessages: [...messagesDesc].reverse().map(toCaseMessage),
    supportEvents: [...eventsDesc].reverse().map((event) =>
      toCaseMessage({
        direction: "inbound",
        eventType: event.eventType,
        sourceEventId: event.sourceEventId,
        summary: event.summary,
        createdAt: event.createdAt,
      }),
    ),
    candidates: [],
  };

  return {
    context,
    caseState: buildCaseState({ metadata: match.metadata, messagesDesc }),
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
    const result = await buildCaseStateResponse(getDb(), parsed.data);
    res.status(200).json({ ok: true, ...result });
  } catch (error) {
    console.error("Failed to load support email case state", error);
    jsonError(res, 500, "Unable to load support email case state");
  }
}

export default withApiLogging(handler);
