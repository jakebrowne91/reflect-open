import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { z } from "zod";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { createDrizzleClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";

import { env } from "~/env";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;

const requestSchema = z.object({
  sourceEventId: z.string().trim().min(1).max(300),
  sourceCaseKey: z.string().trim().min(1).max(300),
  supportCaseId: z.string().trim().max(80).optional(),
  cardPublicId: z.string().trim().max(80).optional(),
  ticket: z.record(z.unknown()).nullable().optional(),
  email: z
    .object({
      provider: z.string().trim().max(80).optional(),
      providerMessageId: z.string().trim().max(300).optional(),
      providerThreadId: z.string().trim().max(300).optional(),
      externalId: z.string().trim().max(300).optional(),
      mailbox: z.string().trim().max(320).optional(),
      subject: z.string().max(1000).optional(),
      bodyText: z.string().max(120000).nullable().optional(),
      bodyHtml: z.string().max(250000).nullable().optional(),
      receivedAt: z.string().trim().max(120).optional(),
      from: z
        .object({
          email: z.string().trim().max(320),
          name: z.string().trim().max(200).nullable().optional(),
        })
        .optional(),
      raw: z.record(z.unknown()).optional(),
    })
    .passthrough(),
  classification: z.record(z.unknown()).optional(),
  extracted: z.record(z.unknown()).optional(),
  decision: z.record(z.unknown()).optional(),
  customerResolution: z.record(z.unknown()).optional(),
  caseMatch: z.record(z.unknown()).optional(),
  reconciliation: z.record(z.unknown()).optional(),
  facetSnapshot: z.record(z.unknown()).optional(),
  facetDiff: z.record(z.unknown()).optional(),
  agent: z.record(z.unknown()).optional(),
  execution: z.record(z.unknown()).optional(),
  summary: z.string().max(4000).optional(),
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

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function cardlessProcessingStatus(input: z.infer<typeof requestSchema>) {
  const category = firstString(input.classification?.category)?.toLowerCase();
  if (category === "spam") return "recorded_spam";
  if (category === "non_issue") return "recorded_non_issue";
  return "recorded_no_card";
}

async function findCard(db: DbClient, input: z.infer<typeof requestSchema>) {
  const cardPublicId = firstString(
    input.cardPublicId,
    input.ticket?.cardPublicId,
  );
  if (cardPublicId) {
    const card = await cardRepo.getByPublicId(db, cardPublicId);
    if (card) return card;
  }

  if (input.supportCaseId) {
    const metadata = await supportTicketMetadataRepo.getBySupportCaseId(db, {
      supportCaseId: input.supportCaseId,
    });
    if (metadata?.card) return metadata.card;
  }

  const metadata = await supportTicketMetadataRepo.getBySourceCaseKey(db, {
    source: "email",
    sourceCaseKey: input.sourceCaseKey,
  });
  return metadata?.card ?? null;
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
    const card = await findCard(db, input);
    if (!card) {
      // No card exists for this workflow result (spam/non-issue emails never
      // create one). Persist the classified message as a card-less record so
      // false-positive spam classifications stay auditable, instead of
      // dropping the email with a 404.
      const processingStatus = cardlessProcessingStatus(input);
      await supportTicketMetadataRepo.upsertEmailMessage(db, {
        cardId: null,
        source: "email",
        sourceEventId: input.sourceEventId,
        sourceCaseKey: input.sourceCaseKey,
        supportCaseId: input.supportCaseId ?? null,
        direction: "inbound",
        eventType: "inbound_email",
        provider: input.email.provider ?? null,
        mailbox: input.email.mailbox ?? null,
        providerMessageId:
          input.email.providerMessageId ?? input.email.externalId ?? null,
        providerThreadId: input.email.providerThreadId ?? null,
        customerEmail: input.email.from?.email ?? null,
        customerName: input.email.from?.name ?? null,
        subject: input.email.subject ?? null,
        bodyText: input.email.bodyText ?? null,
        bodyHtml: input.email.bodyHtml ?? null,
        summary: input.summary ?? null,
        classification: input.classification ?? null,
        extraction: {
          ...(input.extracted ?? {}),
          customerResolution: input.customerResolution ?? null,
          caseMatch: input.caseMatch ?? null,
          reconciliation: input.reconciliation ?? null,
          facetSnapshot: input.facetSnapshot ?? null,
          facetDiff: input.facetDiff ?? null,
        },
        decision: {
          ...(input.decision ?? {}),
          agent: input.agent ?? null,
          execution: input.execution ?? null,
        },
        raw: input.email.raw ?? null,
        processingStatus,
        receivedAt: parseOptionalDate(input.email.receivedAt),
      });

      res.status(200).json({
        ok: true,
        recordedWithoutCard: true,
        processingStatus,
        sourceCaseKey: input.sourceCaseKey,
        supportCaseId: input.supportCaseId,
      });
      return;
    }

    await supportTicketMetadataRepo.attachEmailMessageToCard(db, {
      source: "email",
      sourceEventId: input.sourceEventId,
      cardId: card.id,
      sourceCaseKey: input.sourceCaseKey,
      supportCaseId: input.supportCaseId,
      processingStatus: "processed",
    });

    if (input.email.provider && input.email.providerThreadId) {
      await supportTicketMetadataRepo.upsertThreadForCard(db, {
        cardId: card.id,
        supportCaseId: input.supportCaseId ?? null,
        sourceCaseKey: input.sourceCaseKey,
        provider: input.email.provider,
        mailbox: input.email.mailbox ?? null,
        providerThreadId: input.email.providerThreadId,
        providerMessageId:
          input.email.providerMessageId ?? input.email.externalId ?? null,
      });
    }

    await supportTicketMetadataRepo.upsertEmailMessage(db, {
      cardId: card.id,
      source: "email",
      sourceEventId: input.sourceEventId,
      sourceCaseKey: input.sourceCaseKey,
      supportCaseId: input.supportCaseId ?? null,
      direction: "inbound",
      eventType: "inbound_email",
      provider: input.email.provider ?? null,
      mailbox: input.email.mailbox ?? null,
      providerMessageId:
        input.email.providerMessageId ?? input.email.externalId ?? null,
      providerThreadId: input.email.providerThreadId ?? null,
      customerEmail: input.email.from?.email ?? null,
      customerName: input.email.from?.name ?? null,
      subject: input.email.subject ?? null,
      bodyText: input.email.bodyText ?? null,
      bodyHtml: input.email.bodyHtml ?? null,
      summary: input.summary ?? null,
      classification: input.classification ?? null,
      extraction: {
        ...(input.extracted ?? {}),
        customerResolution: input.customerResolution ?? null,
        caseMatch: input.caseMatch ?? null,
        reconciliation: input.reconciliation ?? null,
        facetSnapshot: input.facetSnapshot ?? null,
        facetDiff: input.facetDiff ?? null,
      },
      decision: {
        ...(input.decision ?? {}),
        agent: input.agent ?? null,
        execution: input.execution ?? null,
      },
      raw: input.email.raw ?? null,
      processingStatus: "processed",
      receivedAt: parseOptionalDate(input.email.receivedAt),
    });

    await supportTicketMetadataRepo.createEventIfNew(db, {
      cardId: card.id,
      source: "email_workflow",
      sourceEventId: `workflow:${input.sourceEventId}`,
      sourceCaseKey: input.sourceCaseKey,
      eventType: "workflow_result",
      status: firstString(
        input.reconciliation?.status,
        input.decision?.gsdStatus,
      ),
      summary: input.summary ?? null,
      payload: input,
    });

    res.status(200).json({
      ok: true,
      cardPublicId: card.publicId,
      sourceCaseKey: input.sourceCaseKey,
      supportCaseId: input.supportCaseId,
    });
  } catch (error) {
    console.error("Failed to store support email workflow result", error);
    jsonError(res, 500, "Unable to store support email workflow result");
  }
}

export default withApiLogging(handler);
