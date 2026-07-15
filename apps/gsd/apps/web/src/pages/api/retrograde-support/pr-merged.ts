import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextApiRequest, NextApiResponse } from "next";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import {
  buildRetrogradeGsdCardUrl,
  postSupportTicketStatusSlackUpdate,
  SUPPORT_STATUS_TO_LIST_NAME,
  supportStatusFromListName,
} from "@kan/api/utils/retrogradeSupport";
import { createDrizzleClient } from "@kan/db/client";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardAgentRunRepo from "@kan/db/repository/cardAgentRun.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import { lists, users } from "@kan/db/schema";

import { env } from "~/env";
import {
  createSupportComment,
  escapeHtml,
  renderHtmlParagraphs,
} from "~/server/retrogradeSupportComments";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;
const SUPPORT_BOT_EMAIL = "support-agent@getretrograde.ai";

const requestSchema = z.object({
  prUrl: z.string().trim().url().max(2048),
  repoFullName: z.string().trim().max(300).optional(),
  prNumber: z.number().int().positive().optional(),
  prTitle: z.string().trim().max(500).optional(),
  mergedAt: z.string().trim().max(120).optional(),
  mergedBy: z.string().trim().max(200).optional(),
});

type DbClient = ReturnType<typeof createDrizzleClient>;

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

async function getSupportBotUserId(db: DbClient): Promise<string | null> {
  const user = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, SUPPORT_BOT_EMAIL),
  });
  return user?.id ?? null;
}

function optionalEnvValue(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value || undefined;
}

function getAgentWebhookInternalUrl(): string | null {
  const launchUrl = optionalEnvValue("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_URL");
  if (!launchUrl) return null;
  try {
    return `${new URL(launchUrl).origin}/internal/support-email/process`;
  } catch {
    return null;
  }
}

const EMAIL_SOURCES = new Set(["email", "support_email"]);

/**
 * Close the loop with the customer: for email-originated cards, hand a
 * resolved-status update to the Ari support-email DO so the customer who
 * reported the bug hears the fix shipped. Reuses the full email guardrail
 * stack (case-state match, delivery policy, sanitizer, humanizer, dry-run).
 */
async function notifyCustomerOfMergedFix(args: {
  db: DbClient;
  cardId: number;
  cardPublicId: string;
  prUrl: string;
}): Promise<{ triggered: boolean; reason?: string }> {
  const url = getAgentWebhookInternalUrl();
  const secret = optionalEnvValue("INTERNAL_CALLBACK_SECRET");
  if (!url || !secret) return { triggered: false, reason: "not_configured" };

  const metadata = await supportTicketMetadataRepo.getByCardId(
    args.db,
    args.cardId,
  );
  const source = metadata?.source?.trim().toLowerCase() ?? "";
  if (!metadata?.sourceCaseKey || !EMAIL_SOURCES.has(source)) {
    return { triggered: false, reason: "not_email_originated" };
  }

  const summary =
    "The fix for the issue you reported has been merged and is rolling out now.";
  const payload = {
    kind: "gsd_ticket_update",
    idempotencyKey: `gsd-ticket-update:github:pr-merged:${args.prUrl}`,
    input: {
      eventId: `gsd-card:${args.cardPublicId}:pr-merged`,
      sourceEventId: `github:pr-merged:${args.prUrl}`,
      sourceCaseKey: metadata.sourceCaseKey,
      supportCaseId: metadata.supportCaseId ?? undefined,
      sessionId: "pr-merged",
      sessionUrl: "",
      status: "resolved",
      summary,
      gsdTicketUpdate: {
        status: "resolved",
        summary,
      },
      customer: {
        email: metadata.email ?? undefined,
        name: metadata.customerName ?? undefined,
      },
      email: {
        customerEmail: metadata.email ?? undefined,
        customerName: metadata.customerName ?? undefined,
        mailbox: metadata.mailbox ?? undefined,
        provider: metadata.provider ?? undefined,
        providerMessageId: metadata.providerMessageId ?? undefined,
        providerThreadId: metadata.providerThreadId ?? undefined,
        sourceChannel: metadata.sourceChannel ?? undefined,
        sourceSystem: "github_pr_merged",
      },
    },
  };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          service: "gsd",
          event: "support.pr_merged_customer_email_failed",
          card_public_id: args.cardPublicId,
          status: response.status,
        }),
      );
      return { triggered: false, reason: `http_${response.status}` };
    }
    return { triggered: true };
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "gsd",
        event: "support.pr_merged_customer_email_failed",
        card_public_id: args.cardPublicId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { triggered: false, reason: "transport_error" };
  }
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
    const db = createDrizzleClient();

    const run = await cardAgentRunRepo.findLatestByPrUrl(db, input.prUrl);
    const card = run?.card;
    if (!run || !card?.list) {
      res.status(200).json({ ok: true, matched: false });
      return;
    }

    const currentStatus = supportStatusFromListName(card.list.name);
    if (currentStatus !== "ready_for_review") {
      res.status(200).json({
        ok: true,
        matched: true,
        moved: false,
        reason: "card_not_ready_for_review",
        cardPublicId: card.publicId,
        currentStatus,
      });
      return;
    }

    // Idempotency: GitHub redeliveries of the same merge must not repeat the
    // move, comment, or Slack ping.
    const event = await supportTicketMetadataRepo.createEventIfNew(db, {
      cardId: card.id,
      source: "github",
      sourceEventId: `github:pr-merged:${input.prUrl}`,
      sourceCaseKey: `github:pr:${input.prUrl}`,
      eventType: "pr_merged",
      status: "resolved",
      summary: `PR merged: ${input.prUrl}`,
      payload: input,
    });
    if (!event) {
      res.status(200).json({
        ok: true,
        matched: true,
        moved: false,
        duplicate: true,
        cardPublicId: card.publicId,
      });
      return;
    }

    const botUserId = (await getSupportBotUserId(db)) ?? run.createdBy ?? null;
    const resolvedListName = SUPPORT_STATUS_TO_LIST_NAME.resolved;
    let targetList = await db.query.lists.findFirst({
      columns: { id: true, name: true },
      where: and(
        eq(lists.boardId, card.list.boardId),
        eq(lists.name, resolvedListName),
        isNull(lists.deletedAt),
      ),
    });
    if (!targetList && botUserId) {
      await listRepo.create(db, {
        name: resolvedListName,
        createdBy: botUserId,
        boardId: card.list.boardId,
      });
      targetList = await db.query.lists.findFirst({
        columns: { id: true, name: true },
        where: and(
          eq(lists.boardId, card.list.boardId),
          eq(lists.name, resolvedListName),
          isNull(lists.deletedAt),
        ),
      });
    }
    if (!targetList) {
      jsonError(res, 500, `Support list ${resolvedListName} was not created`);
      return;
    }

    await cardRepo.reorder(db, {
      cardId: card.id,
      newListId: targetList.id,
      newIndex: undefined,
    });
    if (botUserId) {
      await cardActivityRepo.create(db, {
        type: "card.updated.list",
        cardId: card.id,
        createdBy: botUserId,
        fromListId: card.list.id,
        toListId: targetList.id,
      });
      await createSupportComment(db, {
        cardId: card.id,
        createdBy: botUserId,
        html: [
          "<p><strong>PR merged</strong></p>",
          renderHtmlParagraphs(
            [
              `Pull request ${input.prUrl} was merged${input.mergedBy ? ` by ${input.mergedBy}` : ""}.`,
              "Card auto-resolved.",
            ].join("\n"),
          ),
          input.prTitle ? `<p>${escapeHtml(input.prTitle)}</p>` : "",
        ]
          .filter(Boolean)
          .join(""),
      });
    }

    const cardUrl = buildRetrogradeGsdCardUrl(card.publicId);
    // eventId matches the original creation alert (card.publicId) so the
    // resolution pings into the existing Slack thread.
    await postSupportTicketStatusSlackUpdate({
      eventId: card.publicId,
      source: "github",
      status: "resolved",
      title: card.title,
      summary: `PR merged${input.prTitle ? `: ${input.prTitle}` : ""} — card auto-resolved.`,
      ticketUrl: cardUrl,
      prUrl: input.prUrl,
      parameters: {
        cardPublicId: card.publicId,
        repoFullName: input.repoFullName,
        sourceSystem: "github",
        sourceChannel: "github",
      },
    });

    const customerEmail = await notifyCustomerOfMergedFix({
      db,
      cardId: card.id,
      cardPublicId: card.publicId,
      prUrl: input.prUrl,
    });

    res.status(200).json({
      ok: true,
      matched: true,
      moved: true,
      cardPublicId: card.publicId,
      cardUrl,
      customerEmailTriggered: customerEmail.triggered,
      customerEmailReason: customerEmail.reason,
    });
  } catch (error) {
    console.error("Failed to process PR merged event", error);
    jsonError(res, 500, "Unable to process PR merged event");
  }
}

export default withApiLogging(handler);
