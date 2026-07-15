import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  AriCompletionCallbackPayload,
  AriSpawnSource,
  CodingAgent,
  GsdTicketStatus,
  GsdTicketUpdate,
} from "@retrograde/support-contracts";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  ARI_CODING_AGENTS,
  ARI_SPAWN_SOURCES,
} from "@retrograde/support-contracts";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { withApiLogging } from "@kan/api/utils/apiLogging";
import { getAriGoldRepo, launchAriGoldAgent } from "@kan/api/utils/ariGold";
import {
  buildRetrogradeAdminAriSessionUrl,
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
import { cardAgentRuns, lists, users } from "@kan/db/schema";

import { env } from "~/env";
import {
  createSupportComment,
  renderHtmlFieldList,
  renderHtmlParagraphs,
} from "~/server/retrogradeSupportComments";
import { validateReadyForReviewHandoff } from "~/utils/agentReviewHandoff";

export const config = {
  api: {
    bodyParser: false,
  },
};

const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;
const ticketUpdateStatusSchema = z.enum([
  "ready_for_review",
  "resolved",
  "needs_input",
  "failed",
]);
const ticketUpdateResolutionTypeSchema = z.enum([
  "bug",
  "not_bug",
  "product_improvement",
  "data_or_state_issue",
  "needs_input",
  "failed",
]);
const ticketUpdateEngineeringActionSchema = z.enum([
  "none",
  "opened_pr",
  "recommended_change",
  "runbook",
  "human_review",
]);
const callbackStatusSchema = z.enum([
  "completed",
  "failed",
  "needs_input",
  "ready_for_review",
  "resolved",
]);

const ticketUpdateSchema = z
  .object({
    status: ticketUpdateStatusSchema.optional(),
    resolutionType: ticketUpdateResolutionTypeSchema.optional(),
    engineeringAction: ticketUpdateEngineeringActionSchema.optional(),
    summary: z.string().trim().max(12000).optional(),
    rootCause: z.string().trim().max(4000).optional(),
    userImpact: z.string().trim().max(4000).optional(),
    fix: z.string().trim().max(4000).optional(),
    verification: z.string().trim().max(4000).optional(),
    reviewNotes: z.string().trim().max(4000).optional(),
    prUrl: z.string().trim().url().max(2048).optional(),
    branch: z.string().trim().max(300).optional(),
    question: z.string().trim().max(2000).optional(),
    needsInputQuestion: z.string().trim().max(2000).optional(),
    staffHandoff: z
      .object({
        whatAriFound: z.string().trim().min(12).max(4000),
        evidenceChecked: z.string().trim().min(12).max(4000),
        proposedNextStep: z.string().trim().min(12).max(4000),
        customerResponseRecommendation: z.string().trim().max(4000).optional(),
      })
      .optional(),
  })
  .passthrough();

const callbackSchema = z.object({
  eventId: z.string().trim().min(1).max(300),
  sourceEventId: z.string().trim().max(300).optional(),
  sourceCaseKey: z.string().trim().max(300).optional(),
  sessionId: z.string().trim().max(200).optional(),
  status: callbackStatusSchema,
  sessionUrl: z.string().trim().url().max(2048).optional(),
  answer: z.string().trim().max(12000).optional(),
  question: z.string().trim().max(2000).optional(),
  summary: z.string().trim().max(12000).optional(),
  artifacts: z.array(z.unknown()).optional(),
  ticketUpdate: ticketUpdateSchema.nullable().optional(),
  ticket: z.record(z.unknown()).nullable().optional(),
  ticketParameters: z.record(z.unknown()).optional(),
  supportContext: z.record(z.unknown()).optional(),
  gsdTicket: z.record(z.unknown()).optional(),
});

type CallbackPayload = z.infer<typeof callbackSchema> &
  AriCompletionCallbackPayload;
type TicketUpdate = z.infer<typeof ticketUpdateSchema> &
  Partial<GsdTicketUpdate>;
type TicketStatus = NonNullable<GsdTicketUpdate["status"]>;
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
  const secret = env.ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET;
  if (!secret) return false;

  const timestamp = getHeader(req, "x-ari-callback-timestamp");
  const signature = getHeader(req, "x-ari-callback-signature");

  if (!timestamp || !signature?.startsWith("sha256=")) return false;

  const timestampNumber = Number(timestamp);
  if (!Number.isFinite(timestampNumber)) return false;

  const timestampMs =
    timestampNumber > 1_000_000_000_000
      ? timestampNumber
      : timestampNumber * 1000;

  if (Math.abs(Date.now() - timestampMs) > SIGNATURE_MAX_AGE_MS) {
    return false;
  }

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

function getAdminAriSessionUrl(input: {
  sessionId?: string | null;
  sessionUrl?: string | null;
}) {
  return buildRetrogradeAdminAriSessionUrl(input) ?? input.sessionUrl ?? null;
}

const SUPPORT_BOT_EMAIL = "support-agent@getretrograde.ai";

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function normalizeCodingAgent(value: unknown): CodingAgent | undefined {
  return ARI_CODING_AGENTS.includes(value as CodingAgent)
    ? (value as CodingAgent)
    : undefined;
}

function normalizeAriGoldSpawnSource(
  value: unknown,
): AriSpawnSource | undefined {
  return ARI_SPAWN_SOURCES.includes(value as AriSpawnSource)
    ? (value as AriSpawnSource)
    : undefined;
}

async function getSupportBotUserId(db: DbClient): Promise<string | null> {
  const user = await db.query.users.findFirst({
    columns: { id: true },
    where: eq(users.email, SUPPORT_BOT_EMAIL),
  });
  return user?.id ?? null;
}

function getCallbackBaseUrl(req: NextApiRequest): string {
  if (env.NEXT_PUBLIC_BASE_URL) return env.NEXT_PUBLIC_BASE_URL;
  const proto = req.headers["x-forwarded-proto"] ?? "http";
  const host = req.headers.host;
  return host ? `${String(proto)}://${String(host)}` : "";
}

/**
 * One automatic retry for a failed run. Transient failures (sandbox death,
 * provider blips) used to sit in Failed until someone clicked Retry Ari; a
 * single fresh relaunch absorbs those. A second failure stays failed for a
 * human — no retry loops.
 */
async function maybeAutoRetryFailedRun(args: {
  db: DbClient;
  req: NextApiRequest;
  run: {
    publicId: string;
    prompt: string;
    agent: string;
    createdBy: string | null;
    card: {
      id: number;
      publicId: string;
      title: string;
      listId: number;
      list: { id: number; name: string; boardId: number };
    };
  };
  response: CallbackPayload;
  failureReason: string;
}): Promise<{ retried: boolean; runPublicId?: string }> {
  const runs = await cardAgentRunRepo.listByCardId(args.db, args.run.card.id);
  // The current run is already marked failed, so >1 means this card has
  // failed before — never retry more than once.
  const failedRuns = runs.filter((existing) => existing.status === "failed");
  if (failedRuns.length > 1) return { retried: false };

  const createdBy = args.run.createdBy ?? (await getSupportBotUserId(args.db));
  if (!createdBy) return { retried: false };

  const retryPrompt = `${args.run.prompt}

Note: the previous Ari run for this ticket failed (${args.failureReason.slice(0, 500)}). This is the single automatic retry — start fresh, and if the same failure recurs, finish with status "failed" and a clear handoff describing the blocker.`;

  const newRun = await cardAgentRunRepo.create(args.db, {
    cardId: args.run.card.id,
    createdBy,
    agent: args.run.agent,
    prompt: retryPrompt,
  });

  try {
    const supportContext = recordOrNull(args.response.supportContext) ?? {};
    const retryMode = firstNonEmptyString(supportContext.mode);
    const retrySpawnSource = normalizeAriGoldSpawnSource(
      supportContext.spawnSource,
    );
    const retryCodingAgent =
      retrySpawnSource === "sentry"
        ? undefined
        : normalizeCodingAgent(supportContext.codingAgent);
    const baseUrl = getCallbackBaseUrl(args.req);
    const result = await launchAriGoldAgent({
      eventId: `gsd-card:${args.run.card.publicId}:${newRun.publicId}`,
      title: `Retry: ${args.run.card.title}`.slice(0, 200),
      repo: getAriGoldRepo(firstNonEmptyString(supportContext.repoFullName)),
      prompt: retryPrompt,
      mode:
        retryMode === "customer_debug" || retryMode === "production_query"
          ? retryMode
          : "coding",
      codingAgent: retryCodingAgent,
      spawnSource: retrySpawnSource,
      callbackUrl: baseUrl.startsWith("https://")
        ? `${baseUrl}/api/retrograde-support/agent-callback`
        : undefined,
      supportContext: {
        ...supportContext,
        cardPublicId: args.run.card.publicId,
        cardAgentRunPublicId: newRun.publicId,
        autoRetryOfRun: args.run.publicId,
        codingAgent: retryCodingAgent,
        spawnSource: retrySpawnSource,
      },
      gsdTicket: {
        create: false,
        title: args.run.card.title,
      },
    });
    await cardAgentRunRepo.markRunning(args.db, {
      publicId: newRun.publicId,
      supersetWorkspaceId: null,
      supersetSessionId: result.sessionId,
      supersetUrl: result.url,
      response: result.response,
    });
    await createSupportComment(args.db, {
      cardId: args.run.card.id,
      createdBy,
      html: [
        "<p><strong>Automatic retry</strong></p>",
        renderHtmlParagraphs(
          `Run ${args.run.publicId} failed (${args.failureReason.slice(0, 300)}). Started one automatic retry as run ${newRun.publicId}. A second failure will stay failed for a human.`,
        ),
      ].join(""),
    });
    await moveCardForStatus(args.db, {
      cardId: args.run.card.id,
      currentListId: args.run.card.listId,
      boardId: args.run.card.list.boardId,
      createdBy,
      status: "investigating",
    });
    return { retried: true, runPublicId: newRun.publicId };
  } catch (error) {
    await cardAgentRunRepo.markFailed(args.db, {
      publicId: newRun.publicId,
      error: error instanceof Error ? error.message : String(error),
    });
    console.warn(
      JSON.stringify({
        service: "gsd",
        event: "support.auto_retry_failed",
        card_public_id: args.run.card.publicId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return { retried: false };
  }
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compact(value: string | undefined, maxLength: number) {
  if (!value) return "";
  return value.length <= maxLength
    ? value
    : `${value.slice(0, maxLength - 15).trimEnd()}\n[truncated]`;
}

function parseEventId(eventId: string) {
  const match = /^gsd-card:([^:]+):([^:]+)$/.exec(eventId);
  if (!match?.[1] || !match[2]) return null;
  return {
    cardPublicId: match[1],
    runPublicId: match[2],
  };
}

function normaliseListName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function extractTicketUpdateFromText(text: string | undefined): TicketUpdate {
  const match =
    /<gsd_ticket_update>\s*([\s\S]*?)\s*<\/gsd_ticket_update>/i.exec(
      text ?? "",
    );
  if (!match?.[1]) return {};

  try {
    const parsed = JSON.parse(match[1]) as unknown;
    const result = ticketUpdateSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

function stripMachineBlocks(text: string | undefined) {
  return (text ?? "")
    .replace(/<gsd_ticket_update>[\s\S]*?<\/gsd_ticket_update>/gi, "")
    .replace(
      /<customer_support_result>[\s\S]*?<\/customer_support_result>/gi,
      "",
    )
    .trim();
}

function findPrUrl(payload: CallbackPayload, update: TicketUpdate) {
  if (update.prUrl) return update.prUrl;

  const text = [payload.summary, payload.answer]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const match = /https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i.exec(text);
  return match?.[0];
}

function inferCompletedStatus(
  payload: CallbackPayload,
  update: TicketUpdate,
): TicketStatus {
  if (findPrUrl(payload, update)) return "ready_for_review";

  const text =
    `${payload.summary ?? ""}\n${payload.answer ?? ""}`.toLowerCase();
  if (
    /\b(no code change|no code changes|no implementation bug|no bug|smoke succeeded|smoke test only|not a bug|working as designed)\b/.test(
      text,
    )
  ) {
    return "resolved";
  }

  return "ready_for_review";
}

function resolveTicketStatus(
  payload: CallbackPayload,
  update: TicketUpdate,
): TicketStatus {
  if (payload.status === "failed") return "failed";
  if (update.status) return update.status;
  if (payload.status === "needs_input") return "needs_input";
  if (payload.status === "ready_for_review") return "ready_for_review";
  if (payload.status === "resolved") return "resolved";
  return inferCompletedStatus(payload, update);
}

function getReviewListName(status: GsdTicketStatus) {
  return SUPPORT_STATUS_TO_LIST_NAME[status];
}

function statusLabel(status: TicketStatus) {
  switch (status) {
    case "ready_for_review":
      return "Ready for Review";
    case "resolved":
      return "Resolved";
    case "needs_input":
      return "Needs Input";
    case "failed":
      return "Failed";
  }
}

function renderAgentReview(
  payload: CallbackPayload,
  update: TicketUpdate,
  runPublicId: string,
  ticketStatus: TicketStatus,
) {
  const summary = update.summary ?? stripMachineBlocks(payload.summary);
  const question =
    update.needsInputQuestion ?? update.question ?? payload.question ?? "";
  const prUrl = findPrUrl(payload, update);

  return [
    "<p><strong>Agent update</strong></p>",
    renderHtmlFieldList([
      { label: "Status", value: statusLabel(ticketStatus) },
      { label: "Run ID", value: runPublicId },
      {
        label: "Ari session",
        value: payload.sessionUrl ?? payload.sessionId ?? "Not linked",
      },
      { label: "Updated at", value: new Date().toISOString() },
      { label: "Pull request", value: prUrl },
      { label: "Branch", value: update.branch },
      { label: "Resolution type", value: update.resolutionType },
      { label: "Engineering action", value: update.engineeringAction },
    ]),
    summary
      ? `<p><strong>Summary</strong></p>${renderHtmlParagraphs(compact(summary, 6000))}`
      : "",
    update.rootCause
      ? `<p><strong>Root cause</strong></p>${renderHtmlParagraphs(compact(update.rootCause, 4000))}`
      : "",
    update.userImpact
      ? `<p><strong>User impact</strong></p>${renderHtmlParagraphs(compact(update.userImpact, 4000))}`
      : "",
    update.fix
      ? `<p><strong>Fix / action</strong></p>${renderHtmlParagraphs(compact(update.fix, 4000))}`
      : "",
    update.verification
      ? `<p><strong>Verification</strong></p>${renderHtmlParagraphs(compact(update.verification, 4000))}`
      : "",
    update.reviewNotes
      ? `<p><strong>Review notes</strong></p>${renderHtmlParagraphs(compact(update.reviewNotes, 4000))}`
      : "",
    update.staffHandoff
      ? [
          "<p><strong>Staff handoff</strong></p>",
          renderHtmlFieldList([
            {
              label: "What Ari found",
              value: update.staffHandoff.whatAriFound,
            },
            {
              label: "Evidence checked",
              value: update.staffHandoff.evidenceChecked,
            },
            {
              label: "Proposed next step",
              value: update.staffHandoff.proposedNextStep,
            },
            {
              label: "Customer response recommendation",
              value: update.staffHandoff.customerResponseRecommendation,
            },
          ]),
        ].join("")
      : "",
    payload.answer && payload.answer !== payload.summary
      ? `<p><strong>Answer</strong></p>${renderHtmlParagraphs(
          compact(stripMachineBlocks(payload.answer), 4000),
        )}`
      : "",
    question
      ? `<p><strong>Question</strong></p>${renderHtmlParagraphs(compact(question, 2000))}`
      : "",
  ]
    .filter(Boolean)
    .join("");
}

async function getRunWithCard(db: DbClient, runPublicId: string) {
  return db.query.cardAgentRuns.findFirst({
    where: eq(cardAgentRuns.publicId, runPublicId),
    with: {
      card: {
        columns: {
          id: true,
          publicId: true,
          title: true,
          cardNumber: true,
          description: true,
          listId: true,
        },
        with: {
          list: {
            columns: {
              id: true,
              name: true,
              boardId: true,
            },
          },
          supportTicketMetadata: true,
        },
      },
    },
  });
}

async function moveCardForStatus(
  db: DbClient,
  args: {
    cardId: number;
    currentListId: number;
    boardId: number;
    createdBy: string | null;
    status: GsdTicketStatus;
  },
) {
  const targetListName = getReviewListName(args.status);
  const boardLists = await db.query.lists.findMany({
    columns: {
      id: true,
      name: true,
    },
    where: and(eq(lists.boardId, args.boardId), isNull(lists.deletedAt)),
  });
  let targetList = boardLists.find(
    (list) =>
      normaliseListName(list.name) === normaliseListName(targetListName),
  );

  if (!targetList && args.createdBy) {
    await listRepo.create(db, {
      name: targetListName,
      createdBy: args.createdBy,
      boardId: args.boardId,
    });
    targetList = await db.query.lists.findFirst({
      columns: {
        id: true,
        name: true,
      },
      where: and(
        eq(lists.boardId, args.boardId),
        eq(lists.name, targetListName),
        isNull(lists.deletedAt),
      ),
    });
  }

  if (!targetList || targetList.id === args.currentListId) return targetList;

  await cardRepo.reorder(db, {
    cardId: args.cardId,
    newListId: targetList.id,
    newIndex: undefined,
  });

  if (args.createdBy) {
    await cardActivityRepo.create(db, {
      type: "card.updated.list",
      cardId: args.cardId,
      createdBy: args.createdBy,
      fromListId: args.currentListId,
      toListId: targetList.id,
    });
  }

  return targetList;
}

async function notifyStatusTransition(args: {
  db: DbClient;
  cardId: number;
  cardPublicId: string;
  sourceCaseKey?: string | null;
  source?: string | null;
  fromStatus: string | null;
  toStatus: TicketStatus;
  title: string;
  summary?: string | null;
  ticketUrl?: string | null;
  sessionUrl?: string | null;
  prUrl?: string | null;
  parameters?: Record<string, unknown> | null;
  traceId?: string | null;
  runPublicId: string;
}) {
  if (args.fromStatus === args.toStatus) return;

  const event = await supportTicketMetadataRepo.createEventIfNew(args.db, {
    cardId: args.cardId,
    source: "gsd",
    sourceEventId: `status:${args.cardPublicId}:${args.runPublicId}:${args.toStatus}`,
    sourceCaseKey: args.sourceCaseKey,
    eventType: "status_changed",
    status: args.toStatus,
    summary: args.summary ?? null,
    payload: {
      cardPublicId: args.cardPublicId,
      runPublicId: args.runPublicId,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
    },
  });

  if (!event) return;

  await postSupportTicketStatusSlackUpdate({
    eventId: args.cardPublicId,
    source: args.source,
    status: args.toStatus,
    title: args.title,
    summary: args.summary,
    triggerText:
      typeof args.parameters?.triggerText === "string"
        ? args.parameters.triggerText
        : args.summary,
    ticketUrl: args.ticketUrl,
    sessionUrl: args.sessionUrl,
    prUrl: args.prUrl,
    parameters: {
      ...(args.parameters ?? {}),
      cardPublicId: args.cardPublicId,
    },
    traceId: args.traceId,
  });
}

function getSourceCallback(response: CallbackPayload) {
  const supportContext = recordOrNull(response.supportContext);
  const fromContext = recordOrNull(supportContext?.sourceCallback);
  if (typeof fromContext?.url === "string") return fromContext;
  return null;
}

async function postSourceCallback(input: {
  callback: Record<string, unknown> | null;
  payload: Record<string, unknown>;
}) {
  const url =
    typeof input.callback?.url === "string" ? input.callback.url : null;
  const secret = env.ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET;
  if (!url || !secret) return;

  const body = JSON.stringify(input.payload);
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = `sha256=${createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")}`;

  await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ari-callback-timestamp": timestamp,
      "x-ari-callback-signature": signature,
    },
    body,
  }).catch((error) => {
    console.warn(
      JSON.stringify({
        service: "gsd",
        event: "support.source_callback_failed",
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  });
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

  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) {
    jsonError(res, 400, parsed.error.issues[0]?.message ?? "Invalid payload");
    return;
  }

  const event = parseEventId(parsed.data.eventId);
  if (!event) {
    jsonError(res, 400, "Unsupported eventId");
    return;
  }

  const db = getDb();
  const run = await getRunWithCard(db, event.runPublicId);
  const traceId = getHeader(req, "x-trace-id");

  if (!run?.card || run.card.publicId !== event.cardPublicId) {
    jsonError(res, 404, "Agent run not found");
    return;
  }

  const response = parsed.data;
  const update =
    response.ticketUpdate ?? extractTicketUpdateFromText(response.summary);
  const ticketStatus = resolveTicketStatus(response, update);
  const previousStatus = supportStatusFromListName(run.card.list.name);

  if (ticketStatus === "ready_for_review") {
    const handoffValidation = validateReadyForReviewHandoff(response, {
      ...update,
      prUrl: findPrUrl(response, update),
    });
    if (!handoffValidation.ok) {
      await cardAgentRunRepo.markFailed(db, {
        publicId: event.runPublicId,
        error: handoffValidation.error,
        response: {
          ...response,
          ticketUpdate: update,
          ticketStatus: "failed",
          handoffValidation,
        },
      });
      await createSupportComment(db, {
        cardId: run.card.id,
        createdBy: run.createdBy,
        html: renderAgentReview(
          {
            ...response,
            summary: handoffValidation.error,
          },
          {
            ...update,
            summary: handoffValidation.error,
            reviewNotes:
              "Ari attempted to mark this ticket ready for review without the required staff handoff JSON. Re-run Ari or ask it to provide staffHandoff.whatAriFound, staffHandoff.evidenceChecked, and staffHandoff.proposedNextStep.",
          },
          event.runPublicId,
          "failed",
        ),
      });
      res.status(200).json({
        ok: true,
        cardPublicId: run.card.publicId,
        runPublicId: event.runPublicId,
        status: "failed",
        movedTo: null,
        error: handoffValidation.error,
      });
      return;
    }
  }

  if (ticketStatus === "ready_for_review") {
    await cardAgentRunRepo.markReadyForReview(db, {
      publicId: event.runPublicId,
      response: { ...response, ticketUpdate: update, ticketStatus },
    });
  } else if (ticketStatus === "resolved") {
    await cardAgentRunRepo.markReadyForReview(db, {
      publicId: event.runPublicId,
      response: { ...response, ticketUpdate: update, ticketStatus },
    });
  } else if (ticketStatus === "needs_input") {
    await cardAgentRunRepo.markNeedsInput(db, {
      publicId: event.runPublicId,
      response: { ...response, ticketUpdate: update, ticketStatus },
    });
  } else {
    await cardAgentRunRepo.markFailed(db, {
      publicId: event.runPublicId,
      error:
        update.summary ??
        response.summary ??
        response.answer ??
        "Ari Gold run failed",
      response: { ...response, ticketUpdate: update, ticketStatus },
    });
  }

  const agentUpdateEvent = await supportTicketMetadataRepo.createEventIfNew(
    db,
    {
      cardId: run.card.id,
      source: "ari",
      sourceEventId: `agent:${run.card.publicId}:${event.runPublicId}:${ticketStatus}:${response.eventId}`,
      sourceCaseKey: run.card.supportTicketMetadata?.sourceCaseKey ?? null,
      eventType: "agent_update",
      status: ticketStatus,
      summary: update.summary ?? response.summary ?? null,
      payload: { ...response, ticketUpdate: update, ticketStatus },
    },
  );

  if (agentUpdateEvent) {
    await createSupportComment(db, {
      cardId: run.card.id,
      createdBy: run.createdBy,
      html: renderAgentReview(
        response,
        update,
        event.runPublicId,
        ticketStatus,
      ),
    });
  }

  const movedTo = await moveCardForStatus(db, {
    cardId: run.card.id,
    currentListId: run.card.listId,
    boardId: run.card.list.boardId,
    createdBy: run.createdBy,
    status: ticketStatus,
  });

  const supportContext = recordOrNull(response.supportContext);
  const gsdTicket = recordOrNull(response.gsdTicket);
  const gsdParameters = recordOrNull(gsdTicket?.parameters);

  await notifyStatusTransition({
    db,
    cardId: run.card.id,
    cardPublicId: run.card.publicId,
    sourceCaseKey: run.card.supportTicketMetadata?.sourceCaseKey ?? null,
    source: run.card.supportTicketMetadata?.source ?? null,
    fromStatus: previousStatus,
    toStatus: ticketStatus,
    title: run.card.title,
    summary: update.summary ?? response.summary ?? null,
    ticketUrl: buildRetrogradeGsdCardUrl(run.card.publicId),
    sessionUrl: getAdminAriSessionUrl({
      sessionId: response.sessionId,
      sessionUrl: response.sessionUrl,
    }),
    prUrl: update.prUrl,
    parameters: {
      ...(gsdParameters ?? {}),
      ...(supportContext ?? {}),
    },
    traceId,
    runPublicId: event.runPublicId,
  });

  let autoRetry: { retried: boolean; runPublicId?: string } = {
    retried: false,
  };
  if (ticketStatus === "failed") {
    autoRetry = await maybeAutoRetryFailedRun({
      db,
      req,
      run,
      response,
      failureReason:
        update.summary ??
        response.summary ??
        response.answer ??
        "Ari Gold run failed",
    });
  }

  const sourceCallback = getSourceCallback(response);
  if (sourceCallback && ticketStatus === "needs_input") {
    await postSourceCallback({
      callback: sourceCallback,
      payload: {
        eventId: response.sourceEventId ?? response.eventId,
        sourceEventId: response.sourceEventId,
        sourceCaseKey: response.sourceCaseKey,
        sessionId: response.sessionId,
        status: "needs_input",
        emmaAction: "ask_user",
        sessionUrl: response.sessionUrl,
        question:
          update.needsInputQuestion ??
          update.question ??
          response.question ??
          "Could you send a little more detail so Ari can continue?",
        summary: update.summary ?? response.summary,
        delivery: sourceCallback.delivery,
      },
    });
  } else if (sourceCallback && ticketStatus === "resolved") {
    await postSourceCallback({
      callback: sourceCallback,
      payload: {
        eventId: response.sourceEventId ?? response.eventId,
        sourceEventId: response.sourceEventId,
        sourceCaseKey: response.sourceCaseKey,
        sessionId: response.sessionId,
        status: "completed",
        emmaAction: "send_final_answer",
        sessionUrl: response.sessionUrl,
        answer:
          response.answer ??
          update.userImpact ??
          update.summary ??
          response.summary ??
          "The support investigation has been resolved.",
        summary: update.summary ?? response.summary,
        delivery: sourceCallback.delivery,
      },
    });
  }

  res.status(200).json({
    ok: true,
    cardPublicId: run.card.publicId,
    runPublicId: event.runPublicId,
    status: ticketStatus,
    movedTo: movedTo?.name ?? null,
    autoRetryRunPublicId: autoRetry.runPublicId ?? null,
  });
}

export default withApiLogging(handler);
