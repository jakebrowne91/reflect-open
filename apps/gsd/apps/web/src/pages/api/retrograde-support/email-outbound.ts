import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { createDrizzleClient } from "@kan/db/client";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";

import { env } from "~/env";
import {
  createSupportComment,
  renderHtmlCodeBlock,
  renderHtmlFieldList,
  renderHtmlParagraphs,
} from "~/server/retrogradeSupportComments";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;

const requestSchema = z.object({
  idempotencyKey: z.string().trim().min(1).max(500),
  sourceEventId: z.string().trim().max(300).optional(),
  sourceCaseKey: z.string().trim().max(300).optional(),
  supportCaseId: z.string().trim().max(80).optional(),
  cardPublicId: z.string().trim().max(80).optional(),
  purpose: z.string().trim().max(80).optional(),
  dryRun: z.boolean().default(false),
  provider: z.string().trim().max(80).default("nylas"),
  providerMessageId: z.string().trim().max(300).optional(),
  providerThreadId: z.string().trim().max(300).optional(),
  replyToMessageId: z.string().trim().max(300).optional(),
  nylasMessageId: z.string().trim().max(300).optional(),
  nylasThreadId: z.string().trim().max(300).optional(),
  to: z
    .array(
      z.object({
        email: z.string().trim().max(320),
        name: z.string().trim().max(200).nullable().optional(),
      }),
    )
    .default([]),
  subject: z.string().max(1000).optional(),
  bodyText: z.string().max(120000).optional(),
  response: z.record(z.unknown()).optional(),
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

function compactSourceEventId(prefix: string, value: string, maxLength = 300) {
  const candidate = `${prefix}${value}`;
  if (candidate.length <= maxLength) return candidate;

  const digest = createHash("sha256")
    .update(candidate)
    .digest("hex")
    .slice(0, 16);
  const headLength = Math.max(0, maxLength - prefix.length - digest.length - 1);
  return `${prefix}${value.slice(0, headLength)}:${digest}`;
}

function compact(value: string | undefined, maxLength: number) {
  if (!value) return "";
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 15).trimEnd()}\n[truncated]`;
}

function renderOutboundEmailComment(
  input: z.infer<typeof requestSchema>,
  sourceEventId: string,
) {
  const recipients = input.to
    .map((recipient) =>
      recipient.name
        ? `${recipient.name} <${recipient.email}>`
        : recipient.email,
    )
    .join(", ");

  return [
    "<p><strong>Outbound email</strong></p>",
    renderHtmlFieldList([
      { label: "To", value: recipients },
      { label: "Subject", value: input.subject },
      { label: "Purpose", value: input.purpose ?? "customer_reply" },
      { label: "Provider", value: input.provider },
      { label: "Source event ID", value: sourceEventId },
      { label: "Dry run", value: input.dryRun ? "yes" : undefined },
    ]),
    input.bodyText ? renderHtmlParagraphs(input.bodyText) : "",
  ]
    .filter(Boolean)
    .join("");
}

function renderOutboundRawMetadataComment(
  input: z.infer<typeof requestSchema>,
) {
  if (!input.response || Object.keys(input.response).length === 0) return null;

  return [
    "<p><strong>Outbound email raw metadata</strong></p>",
    renderHtmlCodeBlock(
      compact(JSON.stringify(input.response, null, 2), 12000),
    ),
  ].join("");
}

async function findMetadata(
  db: DbClient,
  input: z.infer<typeof requestSchema>,
) {
  if (input.supportCaseId) {
    const byCase = await supportTicketMetadataRepo.getBySupportCaseId(db, {
      supportCaseId: input.supportCaseId,
    });
    if (byCase) return byCase;
  }
  if (input.sourceCaseKey) {
    return supportTicketMetadataRepo.getBySourceCaseKey(db, {
      source: "email",
      sourceCaseKey: input.sourceCaseKey,
    });
  }
  return null;
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
    const input = parsed.data;
    const db = getDb();
    const metadata = await findMetadata(db, input);
    const providerMessageId =
      input.nylasMessageId ??
      (input.dryRun ? null : (input.providerMessageId ?? null));
    const providerThreadId = input.nylasThreadId ?? input.providerThreadId;
    const sourceEventId = compactSourceEventId(
      `outbound:${input.dryRun ? "dry-run:" : ""}`,
      input.idempotencyKey,
    );
    const recipient = input.to[0];

    await supportTicketMetadataRepo.upsertEmailMessage(db, {
      cardId: metadata?.card.id ?? null,
      source: "email",
      sourceEventId,
      sourceCaseKey: input.sourceCaseKey ?? metadata?.sourceCaseKey ?? null,
      supportCaseId: input.supportCaseId ?? metadata?.supportCaseId ?? null,
      direction: "outbound",
      eventType: "outbound_email",
      provider: input.provider,
      providerMessageId,
      providerThreadId: providerThreadId ?? null,
      replyToMessageId: input.replyToMessageId ?? null,
      customerEmail: recipient?.email ?? metadata?.email ?? null,
      customerName: recipient?.name ?? metadata?.customerName ?? null,
      subject: input.subject ?? null,
      bodyText: input.bodyText ?? null,
      summary: `${input.purpose ?? "customer_reply"}${input.dryRun ? " dry-run" : " sent"}`,
      raw: input.response ?? null,
      processingStatus: input.dryRun ? "dry_run" : "sent",
    });

    if (metadata?.card && providerThreadId) {
      await supportTicketMetadataRepo.upsertThreadForCard(db, {
        cardId: metadata.card.id,
        supportCaseId: input.supportCaseId ?? metadata.supportCaseId,
        sourceCaseKey: input.sourceCaseKey ?? metadata.sourceCaseKey,
        provider: input.provider,
        providerThreadId,
        providerMessageId,
      });
    }

    if (metadata?.card) {
      const event = await supportTicketMetadataRepo.createEventIfNew(db, {
        cardId: metadata.card.id,
        source: "email",
        sourceEventId,
        sourceCaseKey: input.sourceCaseKey ?? metadata.sourceCaseKey,
        eventType: "outbound_email",
        status: null,
        summary: input.bodyText?.slice(0, 1000) ?? null,
        payload: input,
      });
      if (event) {
        await createSupportComment(db, {
          cardId: metadata.card.id,
          createdBy: metadata.card.createdBy,
          html: renderOutboundEmailComment(input, sourceEventId),
        });
        await createSupportComment(db, {
          cardId: metadata.card.id,
          createdBy: metadata.card.createdBy,
          html: renderOutboundRawMetadataComment(input),
        });
      }
    }

    res.status(200).json({ ok: true, sourceEventId });
  } catch (error) {
    console.error("Failed to mirror outbound support email", error);
    jsonError(res, 500, "Unable to mirror outbound support email");
  }
}

export default withApiLogging(handler);
