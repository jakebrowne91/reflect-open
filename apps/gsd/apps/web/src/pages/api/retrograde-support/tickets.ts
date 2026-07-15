import { createHmac, timingSafeEqual } from "node:crypto";
import type {
  GsdTicketStatus,
  SupportEmailAgentActionType,
  SupportMode,
} from "@retrograde/support-contracts";
import type { NextApiRequest, NextApiResponse } from "next";
import {
  ARI_CODING_AGENTS,
  ARI_SPAWN_SOURCES,
  SUPPORT_EMAIL_AGENT_ACTIONS,
} from "@retrograde/support-contracts";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { SupportTicketStatus } from "@kan/api/utils/retrogradeSupport";
import { withApiLogging } from "@kan/api/utils/apiLogging";
import {
  buildAriGoldSupportPrompt,
  getAriGoldRepo,
  launchAriGoldAgent,
  sendAriGoldFollowup,
} from "@kan/api/utils/ariGold";
import {
  buildRetrogradeAdminAriSessionUrl,
  buildRetrogradeGsdCardUrl,
  postSupportTicketCreatedSlackAlert,
  postSupportTicketStatusSlackUpdate,
  SUPPORT_LIST_NAMES,
  SUPPORT_STATUS_TO_LIST_NAME,
  supportStatusFromListName,
} from "@kan/api/utils/retrogradeSupport";
import { createDrizzleClient } from "@kan/db/client";
import * as boardRepo from "@kan/db/repository/board.repo";
import * as cardRepo from "@kan/db/repository/card.repo";
import * as cardActivityRepo from "@kan/db/repository/cardActivity.repo";
import * as cardAgentRunRepo from "@kan/db/repository/cardAgentRun.repo";
import * as listRepo from "@kan/db/repository/list.repo";
import * as supportTicketMetadataRepo from "@kan/db/repository/supportTicketMetadata.repo";
import * as workspaceRepo from "@kan/db/repository/workspace.repo";
import { boards, cards, lists, users, workspaces } from "@kan/db/schema";

import { env } from "~/env";
import {
  createSupportComment,
  escapeHtml,
  renderHtmlCodeBlock,
  renderHtmlFieldList,
  renderHtmlParagraphs,
} from "~/server/retrogradeSupportComments";
import {
  canonicalSupportSource,
  getSourceCaseKey,
  getSourceEventId,
  sourceLookupAliases,
} from "~/utils/retrogradeSupport";
import { ticketMarker } from "~/utils/supportEventKeys";

export const config = {
  api: {
    bodyParser: false,
  },
};

const DEFAULT_WORKSPACE_SLUG = "retrograde-support";
const DEFAULT_WORKSPACE_NAME = "Creator Compute Company Support";
const DEFAULT_BOARD_SLUG = "customer-support";
const DEFAULT_BOARD_NAME = "Customer Support";
const DEFAULT_LIST_NAMES = SUPPORT_LIST_NAMES;
const SUPPORT_BOT_EMAIL = "support-agent@getretrograde.ai";
const SIGNATURE_MAX_AGE_MS = 30 * 60 * 1000;
const SUPPORT_TITLE_MODEL = "gpt-5.5";
const SUPPORT_TITLE_TIMEOUT_MS = 8000;
const SUPPORT_TITLE_MAX_LENGTH = 90;

const statusToListName: Record<
  GsdTicketStatus,
  (typeof DEFAULT_LIST_NAMES)[number]
> = SUPPORT_STATUS_TO_LIST_NAME;

const SUPPORT_AGENT_ACTION_TYPES = new Set<SupportEmailAgentActionType>(
  SUPPORT_EMAIL_AGENT_ACTIONS,
);
const ARI_SUPPORT_AGENT_ACTION_TYPES = new Set<SupportEmailAgentActionType>([
  "launch_ari_investigation",
  "create_bug",
  "escalate_human",
]);

const ticketDateRangeSchema = z
  .object({
    from: z.string().trim().max(80).optional(),
    to: z.string().trim().max(80).optional(),
    timezone: z.string().trim().max(80).optional(),
  })
  .passthrough();

const ticketParametersSchema = z
  .object({
    eventId: z.string().trim().max(200).optional(),
    sourceEventId: z.string().trim().max(300).optional(),
    sourceCaseKey: z.string().trim().max(300).optional(),
    supportCaseId: z.string().trim().max(80).optional(),
    userId: z.string().trim().max(200).optional(),
    emmaUserId: z.string().trim().max(200).optional(),
    email: z.string().trim().max(320).optional(),
    customerName: z.string().trim().max(200).optional(),
    sourceSystem: z.string().trim().max(80).optional(),
    issueCategory: z.string().trim().max(80).optional(),
    dateRange: ticketDateRangeSchema.optional(),
    reportedAt: z.string().trim().max(120).optional(),
    sourceChannel: z.string().trim().max(80).optional(),
    component: z.string().trim().max(200).optional(),
    needsCustomerInput: z.boolean().optional(),
    needsEngineering: z.boolean().optional(),
    supportAgentActions: z
      .array(z.enum(SUPPORT_EMAIL_AGENT_ACTIONS))
      .optional(),
    provider: z.string().trim().max(80).optional(),
    providerMessageId: z.string().trim().max(300).optional(),
    providerThreadId: z.string().trim().max(300).optional(),
    latestProviderMessageId: z.string().trim().max(300).optional(),
    latestProviderThreadId: z.string().trim().max(300).optional(),
    replyToMessageId: z.string().trim().max(300).optional(),
    subject: z.string().trim().max(1000).optional(),
    mailbox: z.string().trim().max(320).optional(),
    ariSessionId: z.string().trim().max(200).optional(),
    ariSessionUrl: z.string().trim().url().max(2048).optional(),
    repoFullName: z.string().trim().max(300).optional(),
  })
  .passthrough();

const ticketRequestSchema = z.object({
  externalId: z.string().trim().min(1).max(200),
  sourceEventId: z.string().trim().min(1).max(300).optional(),
  sourceCaseKey: z.string().trim().min(1).max(300).optional(),
  eventType: z.string().trim().min(1).max(80).default("inbound"),
  source: z.string().trim().min(1).max(80).default("ari_gold"),
  title: z.string().trim().min(1).max(500),
  summary: z.string().trim().max(4000).optional(),
  details: z.string().trim().max(12000).optional(),
  sanitizedAnswer: z.string().trim().max(4000).optional(),
  priority: z.enum(["urgent", "high", "medium", "low"]).nullable().optional(),
  status: z
    .enum([
      "new",
      "investigating",
      "needs_input",
      "bug_raised",
      "ready_for_review",
      "resolved",
      "failed",
    ])
    .default("new"),
  // Append a note to an existing card without moving it, launching or
  // following up with Ari, or posting Slack status updates. Never creates a
  // new card.
  commentOnly: z.boolean().optional(),
  customer: z
    .object({
      userId: z.string().trim().max(200).optional(),
      emmaUserId: z.string().trim().max(200).optional(),
      email: z.string().trim().max(320).optional(),
      name: z.string().trim().max(200).optional(),
    })
    .optional(),
  sourceCallback: z
    .object({
      url: z.string().trim().url().max(2048),
      delivery: z.record(z.unknown()).optional(),
    })
    .optional(),
  parameters: ticketParametersSchema.optional(),
  ari: z
    .object({
      sessionId: z.string().trim().max(200).optional(),
      sessionUrl: z.string().trim().url().max(2048).optional(),
      repo: z.string().trim().max(300).optional(),
      mode: z.string().trim().max(80).optional(),
      model: z.string().trim().max(120).optional(),
      reasoningEffort: z.string().trim().max(40).optional(),
      codingAgent: z.enum(ARI_CODING_AGENTS).optional(),
      spawnSource: z.enum(ARI_SPAWN_SOURCES).optional(),
    })
    .optional(),
  metadata: z.record(z.unknown()).optional(),
});

type TicketRequest = z.infer<typeof ticketRequestSchema>;
type DbClient = ReturnType<typeof createDrizzleClient>;
interface SupportList {
  id: number;
  publicId: string;
  name: string;
}

class DuplicateSupportTicketEventError extends Error {
  constructor(readonly sourceEventId: string) {
    super(`Support ticket event already exists: ${sourceEventId}`);
    this.name = "DuplicateSupportTicketEventError";
  }
}

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

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getDisplayName(email: string): string {
  const localPart = email.split("@")[0] ?? email;
  const words = localPart
    .replace(/[._-]+/g, " ")
    .split(" ")
    .filter(Boolean);

  return words.length
    ? words
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ")
    : email;
}

async function ensureSupportUser(db: DbClient) {
  const email = normalizeEmail(SUPPORT_BOT_EMAIL);
  const existingUser = await db.query.users.findFirst({
    columns: {
      id: true,
      email: true,
      name: true,
    },
    where: eq(users.email, email),
  });

  if (existingUser) return existingUser;

  const [createdUser] = await db
    .insert(users)
    .values({
      email,
      name: getDisplayName(email),
      emailVerified: true,
    })
    .onConflictDoNothing()
    .returning({
      id: users.id,
      email: users.email,
      name: users.name,
    });

  const user =
    createdUser ??
    (await db.query.users.findFirst({
      columns: {
        id: true,
        email: true,
        name: true,
      },
      where: eq(users.email, email),
    }));

  if (!user) throw new Error("Failed to create support ticket user");

  return user;
}

async function findWorkspaceBySlug(db: DbClient, slug: string) {
  return db.query.workspaces.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
      cardPrefix: true,
    },
    where: and(eq(workspaces.slug, slug), isNull(workspaces.deletedAt)),
  });
}

async function ensureSupportWorkspace(
  db: DbClient,
  user: { id: string; email: string },
) {
  const slug = env.RETROGRADE_SUPPORT_WORKSPACE_SLUG ?? DEFAULT_WORKSPACE_SLUG;
  const name = env.RETROGRADE_SUPPORT_WORKSPACE_NAME ?? DEFAULT_WORKSPACE_NAME;
  const existingWorkspace = await findWorkspaceBySlug(db, slug);

  if (existingWorkspace) return existingWorkspace;

  await workspaceRepo
    .create(db, {
      name,
      slug,
      createdBy: user.id,
      createdByEmail: user.email,
      description: "Retrograde customer support workspace",
      plan: "team",
    })
    .catch(async (error) => {
      const workspace = await findWorkspaceBySlug(db, slug);
      if (workspace) return;
      throw error;
    });

  const workspace = await findWorkspaceBySlug(db, slug);
  if (!workspace) throw new Error(`Failed to create workspace ${slug}`);

  return workspace;
}

async function findBoardBySlug(
  db: DbClient,
  workspaceId: number,
  slug: string,
) {
  return db.query.boards.findFirst({
    columns: {
      id: true,
      publicId: true,
      name: true,
      slug: true,
    },
    where: and(
      eq(boards.workspaceId, workspaceId),
      eq(boards.slug, slug),
      isNull(boards.deletedAt),
    ),
  });
}

async function ensureSupportBoard(
  db: DbClient,
  userId: string,
  workspace: { id: number },
) {
  const slug = env.RETROGRADE_SUPPORT_BOARD_SLUG ?? DEFAULT_BOARD_SLUG;
  const name = env.RETROGRADE_SUPPORT_BOARD_NAME ?? DEFAULT_BOARD_NAME;
  const existingBoard = await findBoardBySlug(db, workspace.id, slug);

  if (existingBoard) return existingBoard;

  await boardRepo
    .create(db, {
      name,
      slug,
      createdBy: userId,
      workspaceId: workspace.id,
    })
    .catch(async (error) => {
      const board = await findBoardBySlug(db, workspace.id, slug);
      if (board) return;
      throw error;
    });

  const board = await findBoardBySlug(db, workspace.id, slug);
  if (!board) throw new Error(`Failed to create board ${slug}`);

  return board;
}

async function ensureSupportLists(
  db: DbClient,
  userId: string,
  board: { id: number },
) {
  const existingLists = await db.query.lists.findMany({
    columns: {
      id: true,
      publicId: true,
      name: true,
    },
    where: and(eq(lists.boardId, board.id), isNull(lists.deletedAt)),
  });
  const byName = new Map(existingLists.map((list) => [list.name, list]));

  for (const name of DEFAULT_LIST_NAMES) {
    if (!byName.has(name)) {
      await listRepo.create(db, {
        name,
        createdBy: userId,
        boardId: board.id,
      });
    }
  }

  return db.query.lists.findMany({
    columns: {
      id: true,
      publicId: true,
      name: true,
    },
    where: and(eq(lists.boardId, board.id), isNull(lists.deletedAt)),
  });
}

function compact(value: string | undefined, maxLength: number) {
  if (!value) return "";
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength - 15).trimEnd()}\n[truncated]`;
}

function stripSupportTitlePrefix(title: string) {
  return title.replace(/^\s*support\s+email\s*:\s*/i, "").trim();
}

function sanitizeSupportCardTitle(
  value: string | null | undefined,
  fallback: string,
) {
  const stripped = stripSupportTitlePrefix(value ?? "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.?!:;,\s]+$/g, "")
    .trim();
  const title =
    stripped ||
    stripSupportTitlePrefix(fallback) ||
    fallback ||
    "Support request";

  return title.length <= SUPPORT_TITLE_MAX_LENGTH
    ? title
    : title.slice(0, SUPPORT_TITLE_MAX_LENGTH - 1).trimEnd();
}

function parseJsonObjectText(content: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    const objectMatch = /\{[\s\S]*\}/.exec(content);
    if (!objectMatch) return {};
    try {
      const parsed = JSON.parse(objectMatch[0]);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    } catch {
      return {};
    }
  }
}

async function generateSupportCardTitle(input: TicketRequest) {
  const fallback = sanitizeSupportCardTitle(input.title, input.title);
  const apiKey = env.OPENAI_API_KEY?.trim();
  if (!apiKey) return fallback;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    SUPPORT_TITLE_TIMEOUT_MS,
  );

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.GSD_TICKET_TITLE_MODEL?.trim() || SUPPORT_TITLE_MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You name internal customer support engineering cards. Return strict JSON only. Create a title that is descriptive, unique, and terse. Do not include the prefix Support Email. Do not include raw IDs, ticket numbers, email addresses, or customer names unless the name is the product/entity at issue. Use 4 to 8 words when possible.",
          },
          {
            role: "user",
            content: JSON.stringify({
              currentTitle: input.title,
              subject:
                getMetadataEmailField(input, "subject") ??
                getParameterField(input, "subject"),
              summary: compact(input.summary, 1200),
              details: compact(stripEmailBodyFromDetails(input.details), 1600),
              emailBody: compact(getMetadataEmailBody(input), 1600),
              category: getParameterField(input, "issueCategory"),
              source: input.source,
              status: input.status,
            }),
          },
        ],
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`${response.status} ${text.slice(0, 200)}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const parsed = parseJsonObjectText(
      data.choices?.[0]?.message?.content ?? "",
    );
    return sanitizeSupportCardTitle(firstString(parsed.title), fallback);
  } catch (error) {
    console.warn("Failed to generate support card title", {
      sourceEventId: input.sourceEventId,
      externalId: input.externalId,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function renderMetadata(metadata: Record<string, unknown> | undefined) {
  if (!metadata || Object.keys(metadata).length === 0) return "";

  return `\n## Metadata\n\n\`\`\`json\n${JSON.stringify(metadata, null, 2)}\n\`\`\`\n`;
}

type SupportWorkflowMetadata = {
  classification: Record<string, unknown> | null;
  extracted: Record<string, unknown> | null;
  decision: Record<string, unknown> | null;
  customerResolution: Record<string, unknown> | null;
  caseMatch: Record<string, unknown> | null;
  reconciliation: Record<string, unknown> | null;
  agent: Record<string, unknown> | null;
};

type SupportAgentActionRecord = {
  type: SupportEmailAgentActionType;
  target?: string;
  reasoning?: string;
  body?: string | null;
  question?: string | null;
  summary?: string | null;
  severity?: string;
  scheduledFor?: string | null;
  parameters?: Record<string, unknown>;
};

function stringOrUnknown(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "Unknown";
}

function firstBoolean(...values: unknown[]): boolean | undefined {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function booleanLabel(value: unknown): string | undefined {
  if (typeof value !== "boolean") return undefined;
  return value ? "yes" : "no";
}

function renderParameterValue(value: unknown): string {
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) {
    const values = value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter(Boolean);
    return values.length > 0 ? values.join(", ") : "Unknown";
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return stringOrUnknown(value);
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return undefined;
}

function getSupportWorkflowMetadata(
  input: TicketRequest,
): SupportWorkflowMetadata {
  const metadata = recordOrNull(input.metadata);
  return {
    classification: recordOrNull(metadata?.classification),
    extracted: recordOrNull(metadata?.extracted),
    decision: recordOrNull(metadata?.decision),
    customerResolution: recordOrNull(metadata?.customerResolution),
    caseMatch: recordOrNull(metadata?.caseMatch),
    reconciliation: recordOrNull(metadata?.reconciliation),
    agent: recordOrNull(metadata?.agent),
  };
}

function normalizeSupportAgentActionType(
  value: unknown,
): SupportEmailAgentActionType | null {
  return typeof value === "string" &&
    SUPPORT_AGENT_ACTION_TYPES.has(value as SupportEmailAgentActionType)
    ? (value as SupportEmailAgentActionType)
    : null;
}

function getSupportAgentActions(
  input: TicketRequest,
): SupportAgentActionRecord[] {
  const workflow = getSupportWorkflowMetadata(input);
  const rawActions = Array.isArray(workflow.agent?.actions)
    ? workflow.agent.actions
    : [];
  const actions = rawActions
    .map((item): SupportAgentActionRecord | null => {
      const record = recordOrNull(item);
      const type = normalizeSupportAgentActionType(record?.type);
      if (!record || !type) return null;
      return {
        type,
        target: firstString(record.target),
        reasoning: firstString(record.reasoning),
        body: firstString(record.body) ?? null,
        question: firstString(record.question) ?? null,
        summary: firstString(record.summary) ?? null,
        severity: firstString(record.severity),
        scheduledFor: firstString(record.scheduledFor) ?? null,
        parameters: recordOrNull(record.parameters) ?? undefined,
      };
    })
    .filter((item): item is SupportAgentActionRecord => Boolean(item));

  for (const type of input.parameters?.supportAgentActions ?? []) {
    if (!actions.some((action) => action.type === type)) actions.push({ type });
  }

  return actions;
}

function hasSupportAgentAction(
  input: TicketRequest,
  ...types: SupportEmailAgentActionType[]
) {
  return getSupportAgentActions(input).some((action) =>
    types.includes(action.type),
  );
}

function renderDateRange(range: unknown) {
  if (!range || typeof range !== "object") return "Unknown";
  const record = range as Record<string, unknown>;
  const from = stringOrUnknown(record.from);
  const to = stringOrUnknown(record.to);
  const timezone = stringOrUnknown(record.timezone);
  const window =
    from !== "Unknown" && to !== "Unknown"
      ? `${from} to ${to}`
      : from !== "Unknown"
        ? from
        : to !== "Unknown"
          ? to
          : "Unknown";

  return timezone !== "Unknown" ? `${window} (${timezone})` : window;
}

function getHardParameters(input: TicketRequest) {
  const workflow = getSupportWorkflowMetadata(input);
  const supportAgentActions = getSupportAgentActions(input).map(
    (action) => action.type,
  );
  return {
    eventId:
      input.parameters?.eventId ??
      input.parameters?.sourceEventId ??
      input.sourceEventId ??
      input.externalId,
    sourceEventId: input.parameters?.sourceEventId ?? input.sourceEventId,
    sourceCaseKey: input.parameters?.sourceCaseKey ?? input.sourceCaseKey,
    supportCaseId: input.parameters?.supportCaseId,
    userId: input.parameters?.userId ?? input.customer?.userId,
    emmaUserId: input.parameters?.emmaUserId ?? input.customer?.emmaUserId,
    email: input.parameters?.email ?? input.customer?.email,
    customerName: input.parameters?.customerName ?? input.customer?.name,
    senderEmail: input.parameters?.senderEmail,
    accountEmail:
      input.parameters?.accountEmail ??
      firstString(
        workflow.customerResolution?.accountEmail,
        workflow.extracted?.accountEmail,
      ),
    issueCategory: input.parameters?.issueCategory,
    dateRange: input.parameters?.dateRange,
    reportedAt: input.parameters?.reportedAt,
    sourceSystem: input.parameters?.sourceSystem ?? input.source,
    sourceChannel: input.parameters?.sourceChannel,
    component:
      input.parameters?.component ??
      firstString(
        workflow.reconciliation?.component,
        workflow.extracted?.affectedFeature,
      ),
    needsCustomerInput: firstBoolean(
      input.parameters?.needsCustomerInput,
      workflow.reconciliation?.needsCustomerInput,
    ),
    needsEngineering: firstBoolean(
      input.parameters?.needsEngineering,
      workflow.reconciliation?.needsEngineering,
    ),
    supportAgentActions:
      input.parameters?.supportAgentActions ??
      (supportAgentActions.length > 0 ? supportAgentActions : undefined),
    provider: input.parameters?.provider,
    providerMessageId: input.parameters?.providerMessageId,
    providerThreadId: input.parameters?.providerThreadId,
    latestProviderMessageId: input.parameters?.latestProviderMessageId,
    latestProviderThreadId: input.parameters?.latestProviderThreadId,
    replyToMessageId: input.parameters?.replyToMessageId,
    subject: input.parameters?.subject,
    mailbox: input.parameters?.mailbox,
    ariSessionId: input.parameters?.ariSessionId ?? input.ari?.sessionId,
    ariSessionUrl: input.parameters?.ariSessionUrl ?? input.ari?.sessionUrl,
    repoFullName: input.parameters?.repoFullName ?? input.ari?.repo,
    triggerText: getTicketTriggerText(input),
  };
}

function parseOptionalDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function renderHardParameters(input: TicketRequest) {
  const params = getHardParameters(input);

  return [
    "## Hard Parameters",
    "",
    `- Event ID: ${renderParameterValue(params.eventId)}`,
    `- Source event ID: ${renderParameterValue(params.sourceEventId)}`,
    `- Source case key: ${renderParameterValue(params.sourceCaseKey)}`,
    `- Support case ID: ${renderParameterValue(params.supportCaseId)}`,
    `- User ID: ${renderParameterValue(params.userId)}`,
    `- Emma user ID: ${renderParameterValue(params.emmaUserId)}`,
    `- Email: ${renderParameterValue(params.email)}`,
    `- Customer name: ${renderParameterValue(params.customerName)}`,
    `- Sender email: ${renderParameterValue(params.senderEmail)}`,
    `- Account email: ${renderParameterValue(params.accountEmail)}`,
    `- Issue category: ${renderParameterValue(params.issueCategory)}`,
    `- Date range: ${renderDateRange(params.dateRange)}`,
    `- Reported at: ${renderParameterValue(params.reportedAt)}`,
    `- Source system: ${renderParameterValue(params.sourceSystem)}`,
    `- Source channel: ${renderParameterValue(params.sourceChannel)}`,
    `- Component: ${renderParameterValue(params.component)}`,
    `- Needs customer input: ${renderParameterValue(params.needsCustomerInput)}`,
    `- Needs engineering: ${renderParameterValue(params.needsEngineering)}`,
    `- Support agent actions: ${renderParameterValue(params.supportAgentActions)}`,
    `- Provider: ${renderParameterValue(params.provider)}`,
    `- Provider message ID: ${renderParameterValue(params.providerMessageId)}`,
    `- Provider thread ID: ${renderParameterValue(params.providerThreadId)}`,
    `- Latest provider message ID: ${renderParameterValue(params.latestProviderMessageId)}`,
    `- Latest provider thread ID: ${renderParameterValue(params.latestProviderThreadId)}`,
    `- Reply-to message ID: ${renderParameterValue(params.replyToMessageId)}`,
    `- Subject: ${renderParameterValue(params.subject)}`,
    `- Mailbox: ${renderParameterValue(params.mailbox)}`,
    `- Ari session ID: ${renderParameterValue(params.ariSessionId)}`,
    `- Ari session URL: ${renderParameterValue(params.ariSessionUrl)}`,
    `- Repo: ${renderParameterValue(params.repoFullName)}`,
  ];
}

function renderJsonForPrompt(value: unknown, maxLength = 5000) {
  return compact(JSON.stringify(value, null, 2), maxLength);
}

function formatSupportAgentActionForDisplay(action: SupportAgentActionRecord) {
  const label = [
    action.type,
    action.target ? `target=${action.target}` : null,
    action.severity ? `severity=${action.severity}` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const details = firstString(
    action.reasoning,
    action.summary,
    action.question,
    action.body,
  );
  return details ? `${label}: ${details}` : label;
}

function renderSupportWorkflowPromptContext(input: TicketRequest) {
  const workflow = getSupportWorkflowMetadata(input);
  const actions = getSupportAgentActions(input);
  if (!Object.values(workflow).some(Boolean) && actions.length === 0) return [];

  const lines = ["## Support Email Workflow", ""];
  const summaryFields = [
    [
      "Category",
      firstString(
        workflow.classification?.category,
        input.parameters?.issueCategory,
      ),
    ],
    [
      "Priority",
      firstString(
        workflow.reconciliation?.priority,
        workflow.classification?.urgency,
      ),
    ],
    [
      "Status",
      firstString(
        workflow.reconciliation?.status,
        workflow.decision?.gsdStatus,
      ),
    ],
    [
      "Component",
      firstString(
        workflow.reconciliation?.component,
        workflow.extracted?.affectedFeature,
      ),
    ],
    ["Case match", firstString(workflow.caseMatch?.matchMethod)],
    [
      "Customer account",
      firstString(
        workflow.customerResolution?.accountEmail,
        workflow.customerResolution?.emmaUserId,
        input.customer?.email,
      ),
    ],
    [
      "Needs customer input",
      booleanLabel(workflow.reconciliation?.needsCustomerInput),
    ],
    [
      "Needs engineering",
      booleanLabel(workflow.reconciliation?.needsEngineering),
    ],
    [
      "Safe to auto-reply",
      booleanLabel(workflow.reconciliation?.safeToAutoReply),
    ],
  ].filter((field): field is [string, string] => Boolean(field[1]));

  if (summaryFields.length > 0) {
    lines.push(
      ...summaryFields.map(([label, value]) => `- ${label}: ${value}`),
      "",
    );
  }

  const internalSummary = firstString(
    workflow.reconciliation?.internalSummary,
    workflow.classification?.summary,
  );
  if (internalSummary) {
    lines.push("Internal state:", compact(internalSummary, 1200), "");
  }

  const latestCustomerAsk = firstString(
    workflow.reconciliation?.latestCustomerAsk,
    workflow.decision?.clarificationQuestion,
  );
  if (latestCustomerAsk) {
    lines.push("Latest customer ask:", compact(latestCustomerAsk, 1200), "");
  }

  const agentNote = firstString(
    workflow.agent?.internalNote,
    workflow.decision?.internalNote,
  );
  if (agentNote) lines.push("Agent note:", compact(agentNote, 1600), "");

  if (actions.length > 0) {
    lines.push(
      "Support agent actions:",
      ...actions.map(
        (action) => `- ${formatSupportAgentActionForDisplay(action)}`,
      ),
      "",
    );
  }

  lines.push(
    "Structured workflow snapshot:",
    "```json",
    renderJsonForPrompt(
      {
        classification: workflow.classification,
        extracted: workflow.extracted,
        customerResolution: workflow.customerResolution,
        caseMatch: workflow.caseMatch,
        reconciliation: workflow.reconciliation,
        agent: workflow.agent,
        decision: workflow.decision,
      },
      10000,
    ),
    "```",
  );

  return lines;
}

function renderDescription(marker: string) {
  const lines = [`<!-- ${marker} -->`];

  return lines.join("\n");
}

function renderAgentPromptContext(input: TicketRequest) {
  const lines = [
    ...renderHardParameters(input),
    "",
    "## Summary",
    "",
    compact(input.summary ?? input.details ?? "No summary provided.", 4000),
    "",
    ...renderSupportWorkflowPromptContext(input),
    "",
    "## Customer",
    "",
    `- Name: ${input.customer?.name ?? "Unknown"}`,
    `- Email: ${input.customer?.email ?? "Unknown"}`,
    `- Emma user ID: ${
      input.customer?.emmaUserId ?? input.customer?.userId ?? "Unknown"
    }`,
    "",
    "## Ari",
    "",
    `- Session: ${input.ari?.sessionUrl ?? input.ari?.sessionId ?? "Not linked"}`,
    `- Repo: ${input.ari?.repo ?? "Not supplied"}`,
    `- Mode: ${input.ari?.mode ?? "Not supplied"}`,
  ];

  if (input.sanitizedAnswer) {
    lines.push(
      "",
      "## Safe User Answer",
      "",
      compact(input.sanitizedAnswer, 4000),
    );
  }

  if (input.details && input.details !== input.summary) {
    lines.push("", "## Details", "", compact(input.details, 8000));
  }

  const metadata = renderMetadata(input.metadata);
  if (metadata) lines.push(metadata.trimEnd());

  return lines.join("\n");
}

function getMetadataEmail(input: TicketRequest) {
  return recordOrNull(input.metadata?.email);
}

function getMetadataEmailBody(input: TicketRequest) {
  const email = getMetadataEmail(input);
  return firstString(email?.bodyText);
}

function getMetadataEmailField(input: TicketRequest, key: string) {
  const email = getMetadataEmail(input);
  return firstString(email?.[key]);
}

function getMetadataEmailSender(input: TicketRequest) {
  return recordOrNull(getMetadataEmail(input)?.from);
}

function getParameterField(input: TicketRequest, key: string) {
  return firstString(recordOrNull(input.parameters)?.[key]);
}

function extractEmailBodyFromDetails(details: string | undefined) {
  if (!details) return undefined;
  const match = /(?:^|\n)Email body:\s*\n([\s\S]*)$/i.exec(details);
  return match?.[1]?.trim() || undefined;
}

function getTicketTriggerText(input: TicketRequest) {
  return firstString(
    input.parameters?.triggerText,
    input.parameters?.sourceText,
    input.parameters?.customerMessage,
    input.parameters?.message,
    input.parameters?.bodyText,
    input.parameters?.errorText,
    getMetadataEmailBody(input),
    extractEmailBodyFromDetails(input.details),
    input.details,
    input.summary,
  );
}

function stripEmailBodyFromDetails(details: string | undefined) {
  return details?.replace(/\nEmail body:\s*\n[\s\S]*$/i, "").trim();
}

function renderCustomerEmailComment(
  input: TicketRequest,
  sourceEventId: string,
) {
  const email = getMetadataEmail(input);
  if (!email && canonicalSupportSource(input.source) !== "email") return null;

  const sender = getMetadataEmailSender(input);
  const body =
    getMetadataEmailBody(input) ?? extractEmailBodyFromDetails(input.details);
  const subject =
    getMetadataEmailField(input, "subject") ??
    getParameterField(input, "subject") ??
    input.title;

  if (!body && !subject && !sender) return null;

  const fields = renderHtmlFieldList([
    {
      label: "From",
      value:
        firstString(sender?.name) && firstString(sender?.email)
          ? `${firstString(sender?.name)} <${firstString(sender?.email)}>`
          : firstString(sender?.email, input.customer?.email),
    },
    { label: "Mailbox", value: getMetadataEmailField(input, "mailbox") },
    { label: "Subject", value: subject },
    {
      label: "Received",
      value:
        getMetadataEmailField(input, "receivedAt") ??
        getParameterField(input, "reportedAt"),
    },
    { label: "Source event ID", value: sourceEventId },
  ]);

  return [
    "<p><strong>Customer email</strong></p>",
    fields,
    body ? renderHtmlParagraphs(body) : "",
  ]
    .filter(Boolean)
    .join("");
}

function renderAgentNotesComment(input: TicketRequest) {
  const workflow = getSupportWorkflowMetadata(input);
  const {
    classification,
    extracted,
    decision,
    customerResolution,
    caseMatch,
    reconciliation,
    agent,
  } = workflow;
  const actions = getSupportAgentActions(input);
  const details = stripEmailBodyFromDetails(input.details);
  const summary = firstString(
    reconciliation?.internalSummary,
    classification?.summary,
    input.summary,
    details && details !== input.summary ? details : undefined,
  );
  const internalNote = firstString(agent?.internalNote, decision?.internalNote);
  const customerReplyDraft = firstString(
    agent?.customerReplyDraft,
    decision?.customerReplyDraft,
  );
  const clarificationQuestion = firstString(
    actions.find((action) => action.type === "ask_customer")?.question,
    reconciliation?.latestCustomerAsk,
    decision?.clarificationQuestion,
  );
  const sanitizedAnswer = firstString(input.sanitizedAnswer);
  const handoffToAri = hasAriHandoffRequested(input);
  const supportActions = actions
    .map((action) => action.type)
    .filter(Boolean)
    .join(", ");
  const actionSummary = actions
    .map(formatSupportAgentActionForDisplay)
    .filter(Boolean)
    .join("\n");

  if (
    !summary &&
    !internalNote &&
    !customerReplyDraft &&
    !clarificationQuestion &&
    !sanitizedAnswer &&
    !supportActions &&
    !reconciliation &&
    !customerResolution &&
    !caseMatch &&
    !extracted
  ) {
    return null;
  }

  const fields = renderHtmlFieldList([
    { label: "Category", value: firstString(classification?.category) },
    {
      label: "Urgency",
      value: firstString(reconciliation?.priority, classification?.urgency),
    },
    {
      label: "Status",
      value: firstString(reconciliation?.status, decision?.gsdStatus),
    },
    {
      label: "Component",
      value: firstString(reconciliation?.component, extracted?.affectedFeature),
    },
    { label: "Action", value: firstString(decision?.action) },
    { label: "Support actions", value: supportActions },
    { label: "Ari handoff", value: handoffToAri ? "yes" : "no" },
    {
      label: "Needs customer input",
      value: booleanLabel(reconciliation?.needsCustomerInput),
    },
    {
      label: "Needs engineering",
      value: booleanLabel(reconciliation?.needsEngineering),
    },
    { label: "Case match", value: firstString(caseMatch?.matchMethod) },
    {
      label: "Customer account",
      value: firstString(
        customerResolution?.accountEmail,
        customerResolution?.emmaUserId,
      ),
    },
    { label: "Confidence", value: firstString(classification?.confidence) },
  ]);

  return [
    "<p><strong>Agent notes</strong></p>",
    fields,
    summary
      ? `<p><strong>Summary</strong></p>${renderHtmlParagraphs(summary)}`
      : "",
    internalNote
      ? `<p><strong>Internal note</strong></p>${renderHtmlParagraphs(internalNote)}`
      : "",
    actionSummary
      ? `<p><strong>Support agent actions</strong></p>${renderHtmlParagraphs(actionSummary)}`
      : "",
    clarificationQuestion
      ? `<p><strong>Clarification question</strong></p>${renderHtmlParagraphs(clarificationQuestion)}`
      : "",
    customerReplyDraft
      ? `<p><strong>Customer reply draft</strong></p>${renderHtmlParagraphs(customerReplyDraft)}`
      : "",
    sanitizedAnswer
      ? `<p><strong>Safe user answer</strong></p>${renderHtmlParagraphs(sanitizedAnswer)}`
      : "",
  ]
    .filter(Boolean)
    .join("");
}

function renderCommentOnlyNoteComment(input: TicketRequest) {
  const summary = firstString(input.summary);
  const details = firstString(input.details);
  const body = [summary, details && details !== summary ? details : undefined]
    .filter(Boolean)
    .join("\n\n");

  if (!body) return null;

  return [
    `<p><strong>${escapeHtml(input.title)}</strong></p>`,
    renderHtmlParagraphs(body),
  ].join("");
}

function renderRawMetadataComment(input: TicketRequest) {
  if (!input.metadata || Object.keys(input.metadata).length === 0) return null;

  return [
    "<p><strong>Raw metadata</strong></p>",
    renderHtmlCodeBlock(
      compact(JSON.stringify(input.metadata, null, 2), 12000),
    ),
  ].join("");
}

async function createSupportTicketComments(args: {
  db: DbClient;
  cardId: number;
  createdBy: string;
  input: TicketRequest;
  sourceEventId: string;
}) {
  const comments = args.input.commentOnly
    ? [
        renderCommentOnlyNoteComment(args.input),
        renderRawMetadataComment(args.input),
      ]
    : [
        renderCustomerEmailComment(args.input, args.sourceEventId),
        renderAgentNotesComment(args.input),
        renderRawMetadataComment(args.input),
      ];

  for (const html of comments) {
    await createSupportComment(args.db, {
      cardId: args.cardId,
      createdBy: args.createdBy,
      html,
    });
  }
}

function getBaseUrl(req: NextApiRequest) {
  if (env.NEXT_PUBLIC_BASE_URL) return env.NEXT_PUBLIC_BASE_URL;

  const proto = getHeader(req, "x-forwarded-proto") ?? "http";
  const host = getHeader(req, "host");

  return host ? `${proto}://${host}` : "";
}

function getCardUrl(baseUrl: string, cardPublicId: string) {
  return baseUrl ? `${baseUrl}/cards/${cardPublicId}` : null;
}

function getAdminCardUrl(cardPublicId: string) {
  return buildRetrogradeGsdCardUrl(cardPublicId);
}

function getAdminAriSessionUrl(input: {
  sessionId?: string | null;
  sessionUrl?: string | null;
}) {
  return buildRetrogradeAdminAriSessionUrl(input) ?? input.sessionUrl ?? null;
}

const extractRepoFromTicket = (input: TicketRequest) => {
  const repo =
    input.parameters?.repoFullName?.trim() ??
    input.ari?.repo?.trim() ??
    input.metadata?.repoFullName;

  if (typeof repo !== "string") return null;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : null;
};

async function findExistingTicket(
  db: DbClient,
  boardId: number,
  marker: string,
) {
  const boardLists = await db.query.lists.findMany({
    columns: {
      id: true,
    },
    where: and(eq(lists.boardId, boardId), isNull(lists.deletedAt)),
  });
  const listIds = boardLists.map((list) => list.id);

  if (listIds.length === 0) return null;

  return db.query.cards.findFirst({
    columns: {
      id: true,
      publicId: true,
      cardNumber: true,
      title: true,
      description: true,
      listId: true,
    },
    with: {
      list: {
        columns: {
          id: true,
          publicId: true,
          name: true,
          boardId: true,
        },
      },
    },
    where: and(
      inArray(cards.listId, listIds),
      isNull(cards.deletedAt),
      sql`position(${marker} in coalesce(${cards.description}, '')) > 0`,
    ),
  });
}

async function findExistingEventByAliases(args: {
  db: DbClient;
  sources: string[];
  sourceEventId: string;
}) {
  for (const source of args.sources) {
    const event = await supportTicketMetadataRepo.getEventBySourceEventId(
      args.db,
      {
        source,
        sourceEventId: args.sourceEventId,
      },
    );
    if (event) return event;
  }

  return null;
}

async function findExistingMetadataByAliases(args: {
  db: DbClient;
  sources: string[];
  sourceCaseKey: string;
  externalId: string;
}) {
  for (const source of args.sources) {
    const metadata = await supportTicketMetadataRepo.getBySourceCaseKey(
      args.db,
      {
        source,
        sourceCaseKey: args.sourceCaseKey,
      },
    );
    if (metadata) return metadata;
  }

  for (const source of args.sources) {
    const metadata = await supportTicketMetadataRepo.getBySourceExternalId(
      args.db,
      {
        source,
        externalId: args.externalId,
      },
    );
    if (metadata) return metadata;
  }

  return null;
}

async function findExistingTicketByMarkers(args: {
  db: DbClient;
  boardId: number;
  markers: string[];
}) {
  for (const marker of args.markers) {
    const ticket = await findExistingTicket(args.db, args.boardId, marker);
    if (ticket) return ticket;
  }

  return null;
}

function jsonError(res: NextApiResponse, status: number, error: string) {
  return res.status(status).json({ ok: false, error });
}

function normalizeSupportMode(value: string | null | undefined): SupportMode {
  return value === "customer_debug" || value === "production_query"
    ? value
    : "coding";
}

function recordOrNull(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function hasAriHandoffRequested(input: TicketRequest) {
  const workflow = getSupportWorkflowMetadata(input);
  if (workflow.decision?.handoffToAri === true) return true;
  if (workflow.reconciliation?.needsEngineering === true) return true;
  return hasSupportAgentAction(
    input,
    ...Array.from(ARI_SUPPORT_AGENT_ACTION_TYPES),
  );
}

function needsHumanReviewNotification(input: TicketRequest) {
  const workflow = getSupportWorkflowMetadata(input);
  const action = firstString(workflow.decision?.action);
  if (action === "human_review") return true;
  if (workflow.reconciliation?.needsCustomerInput === true) return true;
  return hasSupportAgentAction(input, "escalate_human", "ask_customer");
}

function getSlackCallbackContext(input: TicketRequest) {
  const direct = recordOrNull(input.metadata?.slackCallbackContext);
  const slack = recordOrNull(input.metadata?.slack);
  const channel = firstString(direct?.channel, slack?.channel);
  const threadTs = firstString(direct?.threadTs, slack?.threadTs);
  const repoFullName = firstString(
    direct?.repoFullName,
    input.ari?.repo,
    input.parameters?.repoFullName,
  );
  const model = firstString(direct?.model, input.ari?.model);

  if (!channel || !threadTs || !repoFullName || !model) return undefined;

  return {
    source: "slack",
    channel,
    threadTs,
    repoFullName,
    model,
    reasoningEffort: firstString(
      direct?.reasoningEffort,
      input.ari?.reasoningEffort,
    ),
    reactionMessageTs: firstString(
      direct?.reactionMessageTs,
      slack?.reactionMessageTs,
    ),
  };
}

async function moveCardToSupportList(args: {
  db: DbClient;
  userId: string;
  cardId: number;
  cardPublicId: string;
  currentListId: number;
  supportLists: SupportList[];
  targetListName: (typeof DEFAULT_LIST_NAMES)[number];
  title?: string;
  summary?: string | null;
  source?: string | null;
  sourceCaseKey?: string | null;
  parameters?: Record<string, unknown> | null;
  ticketUrl?: string | null;
  sessionUrl?: string | null;
  traceId?: string | null;
  eventId?: string | null;
}) {
  const targetList = args.supportLists.find(
    (list) => list.name === args.targetListName,
  );

  if (!targetList || targetList.id === args.currentListId) return null;

  const fromList = args.supportLists.find(
    (list) => list.id === args.currentListId,
  );
  const fromStatus = supportStatusFromListName(fromList?.name);
  const toStatus = supportStatusFromListName(targetList.name);

  await cardRepo.reorder(args.db, {
    cardId: args.cardId,
    newListId: targetList.id,
    newIndex: undefined,
  });

  await cardActivityRepo.create(args.db, {
    type: "card.updated.list",
    cardId: args.cardId,
    createdBy: args.userId,
    fromListId: args.currentListId,
    toListId: targetList.id,
  });

  if (toStatus && fromStatus !== toStatus) {
    await notifySupportStatusTransition({
      db: args.db,
      cardId: args.cardId,
      cardPublicId: args.cardPublicId,
      sourceCaseKey: args.sourceCaseKey,
      fromStatus,
      toStatus,
      title: args.title,
      summary: args.summary,
      source: args.source,
      ticketUrl: args.ticketUrl,
      sessionUrl: args.sessionUrl,
      parameters: args.parameters,
      traceId: args.traceId,
      eventId:
        args.eventId ??
        `status:${args.cardPublicId}:${fromStatus ?? "unknown"}:${toStatus}`,
    });
  }

  return targetList;
}

async function notifySupportStatusTransition(args: {
  db: DbClient;
  cardId: number;
  cardPublicId: string;
  sourceCaseKey?: string | null;
  fromStatus?: SupportTicketStatus | null;
  toStatus: SupportTicketStatus;
  title?: string | null;
  summary?: string | null;
  source?: string | null;
  ticketUrl?: string | null;
  sessionUrl?: string | null;
  prUrl?: string | null;
  parameters?: Record<string, unknown> | null;
  traceId?: string | null;
  eventId: string;
}) {
  const event = await supportTicketMetadataRepo.createEventIfNew(args.db, {
    cardId: args.cardId,
    source: "gsd",
    sourceEventId: args.eventId,
    sourceCaseKey: args.sourceCaseKey,
    eventType: "status_changed",
    status: args.toStatus,
    summary: args.summary,
    payload: {
      cardPublicId: args.cardPublicId,
      fromStatus: args.fromStatus,
      toStatus: args.toStatus,
    },
  });

  if (!event) return;

  await postSupportTicketStatusSlackUpdate({
    eventId: args.cardPublicId,
    status: args.toStatus,
    title: args.title,
    summary: args.summary,
    triggerText:
      typeof args.parameters?.triggerText === "string"
        ? args.parameters.triggerText
        : args.summary,
    source: args.source,
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

const KNOWN_ISSUES_SECTION_MAX_CHARS = 800;
const KNOWN_ISSUE_ENTRY_FIELD_MAX_CHARS = 120;

function truncateInline(value: string, maxLength: number) {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * Short "Recently resolved related issues" section appended to the agent
 * prompt so Ari can link/duplicate against recently solved problems instead of
 * re-investigating them. Returns "" (and never throws) when nothing is
 * available.
 */
async function renderRecentKnownIssuesSection(
  db: DbClient,
  excludeCardId: number,
) {
  let issues: Awaited<
    ReturnType<typeof cardAgentRunRepo.listRecentKnownIssues>
  >;
  try {
    issues = await cardAgentRunRepo.listRecentKnownIssues(db, {
      excludeCardId,
    });
  } catch (error) {
    console.warn("Failed to load recent known issues for agent prompt", error);
    return "";
  }
  if (issues.length === 0) return "";

  const header =
    "## Recently resolved related issues\n\nIf this ticket matches one of these, say so and prefer linking/duplicating over re-investigating from scratch.";
  const lines: string[] = [];
  let totalChars = header.length;
  for (const issue of issues) {
    const parts = [
      truncateInline(issue.title, KNOWN_ISSUE_ENTRY_FIELD_MAX_CHARS),
      issue.issueCategory ? `category: ${issue.issueCategory}` : "",
      issue.rootCause
        ? `root cause: ${truncateInline(issue.rootCause, KNOWN_ISSUE_ENTRY_FIELD_MAX_CHARS)}`
        : "",
      issue.fix
        ? `fix: ${truncateInline(issue.fix, KNOWN_ISSUE_ENTRY_FIELD_MAX_CHARS)}`
        : "",
    ].filter(Boolean);
    const line = `- [${issue.cardPublicId}] ${parts.join("; ")}`;
    if (totalChars + line.length > KNOWN_ISSUES_SECTION_MAX_CHARS) break;
    lines.push(line);
    totalChars += line.length;
  }
  if (lines.length === 0) return "";

  return [header, "", ...lines].join("\n");
}

async function maybeLaunchSupportCodingAgent(args: {
  db: DbClient;
  input: TicketRequest;
  source: string;
  sourceEventId: string;
  sourceCaseKey: string;
  userId: string;
  card: {
    id: number;
    listId: number;
    publicId: string;
    cardNumber: number | null;
  };
  cardPrefix: string;
  description: string;
  board: { name: string };
  supportLists: SupportList[];
  baseUrl: string;
  traceId?: string | null;
}) {
  if (args.input.ari?.sessionId) {
    return null;
  }

  if (
    args.input.status !== "bug_raised" &&
    args.input.status !== "investigating" &&
    !hasAriHandoffRequested(args.input)
  ) {
    return null;
  }

  const cardUrl = getCardUrl(args.baseUrl, args.card.publicId);
  const ticketNumber =
    args.card.cardNumber != null && args.cardPrefix
      ? `${args.cardPrefix}-${args.card.cardNumber}`
      : args.card.cardNumber != null
        ? String(args.card.cardNumber)
        : null;
  const startingListName =
    args.input.status === "bug_raised" ? "Bug Raised" : "Investigating";
  const agent = "ari-gold";
  const knownIssuesSection = await renderRecentKnownIssuesSection(
    args.db,
    args.card.id,
  );
  const prompt = buildAriGoldSupportPrompt({
    title: args.input.title,
    description: knownIssuesSection
      ? `${args.description}\n\n${knownIssuesSection}`
      : args.description,
    boardName: args.board.name,
    listName: startingListName,
    ticketNumber,
    cardUrl,
  });
  const run = await cardAgentRunRepo.create(args.db, {
    cardId: args.card.id,
    createdBy: args.userId,
    agent,
    prompt,
  });

  try {
    const callbackUrl = args.baseUrl.startsWith("https://")
      ? `${args.baseUrl}/api/retrograde-support/agent-callback`
      : undefined;
    const slackCallbackContext = getSlackCallbackContext(args.input);
    const ariMode = normalizeSupportMode(args.input.ari?.mode);
    const ariCodingAgent = args.input.ari?.codingAgent;
    const ariSpawnSource = args.input.ari?.spawnSource;
    const result = await launchAriGoldAgent({
      eventId: `gsd-card:${args.card.publicId}:${run.publicId}`,
      title: ticketNumber
        ? `${ticketNumber} ${args.input.title}`
        : `GSD ${args.card.publicId} ${args.input.title}`,
      repo: getAriGoldRepo(extractRepoFromTicket(args.input)),
      prompt,
      mode: ariMode,
      model: args.input.ari?.model,
      reasoningEffort: args.input.ari?.reasoningEffort,
      codingAgent: ariCodingAgent,
      spawnSource: ariSpawnSource,
      callbackUrl,
      supportContext: {
        cardPublicId: args.card.publicId,
        cardAgentRunPublicId: run.publicId,
        cardUrl,
        ticketNumber,
        boardName: args.board.name,
        listName: startingListName,
        mode: ariMode,
        codingAgent: ariCodingAgent,
        spawnSource: ariSpawnSource,
        ...getHardParameters(args.input),
        sourceEventId: args.sourceEventId,
        sourceCaseKey: args.sourceCaseKey,
        sourceCallback: args.input.sourceCallback,
        ...(slackCallbackContext ? { slackCallbackContext } : {}),
      },
      gsdTicket: {
        create: false,
        title: args.input.title,
        summary: args.input.summary ?? args.input.details,
        priority: args.input.priority ?? "medium",
        parameters: getHardParameters(args.input),
      },
    });
    const updatedRun = await cardAgentRunRepo.markRunning(args.db, {
      publicId: run.publicId,
      supersetWorkspaceId: null,
      supersetSessionId: result.sessionId,
      supersetUrl: result.url,
      response: result.response,
    });
    const adminSessionUrl = getAdminAriSessionUrl({
      sessionId: result.sessionId,
      sessionUrl: result.url,
    });
    const investigatingList = await moveCardToSupportList({
      db: args.db,
      userId: args.userId,
      cardId: args.card.id,
      cardPublicId: args.card.publicId,
      currentListId: args.card.listId,
      supportLists: args.supportLists,
      targetListName: "Investigating",
      title: args.input.title,
      summary: "Ari started working this GSD support card.",
      source: args.source,
      sourceCaseKey: args.sourceCaseKey,
      ticketUrl: getAdminCardUrl(args.card.publicId),
      sessionUrl: adminSessionUrl,
      parameters: getHardParameters(args.input),
      traceId: args.traceId,
      eventId: args.card.publicId,
    });

    const hardParameters = getHardParameters(args.input);
    await supportTicketMetadataRepo.upsertForCard(args.db, {
      cardId: args.card.id,
      externalId: args.input.externalId,
      source: args.source,
      sourceCaseKey: args.sourceCaseKey,
      supportCaseId: hardParameters.supportCaseId ?? null,
      sourceEventId: args.sourceEventId,
      sourceSystem: hardParameters.sourceSystem,
      userId: hardParameters.userId ?? null,
      emmaUserId: hardParameters.emmaUserId ?? null,
      email: hardParameters.email ?? null,
      customerName:
        args.input.parameters?.customerName ??
        args.input.customer?.name ??
        null,
      issueCategory: hardParameters.issueCategory ?? null,
      reportedAt: parseOptionalDate(hardParameters.reportedAt),
      sourceChannel: hardParameters.sourceChannel ?? null,
      provider: hardParameters.provider ?? null,
      providerThreadId: hardParameters.providerThreadId ?? null,
      providerMessageId: hardParameters.providerMessageId ?? null,
      mailbox: hardParameters.mailbox ?? null,
      ariSessionId: result.sessionId,
      ariSessionUrl: result.url,
      repoFullName: hardParameters.repoFullName ?? null,
      metadata: {
        ...(args.input.metadata ?? {}),
        sourceCallback: args.input.sourceCallback,
      },
    });
    if (hardParameters.provider && hardParameters.providerThreadId) {
      await supportTicketMetadataRepo.upsertThreadForCard(args.db, {
        cardId: args.card.id,
        supportCaseId: hardParameters.supportCaseId ?? null,
        sourceCaseKey: args.sourceCaseKey,
        provider: hardParameters.provider,
        mailbox: hardParameters.mailbox ?? null,
        providerThreadId: hardParameters.providerThreadId,
        providerMessageId: hardParameters.providerMessageId ?? null,
      });
    }

    return {
      publicId: updatedRun.publicId,
      agent: updatedRun.agent,
      status: updatedRun.status,
      supersetWorkspaceId: updatedRun.supersetWorkspaceId,
      supersetSessionId: updatedRun.supersetSessionId,
      supersetUrl: adminSessionUrl,
      error: updatedRun.error,
      listPublicId: investigatingList?.publicId ?? null,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unable to start Ari Gold";
    const failedRun = await cardAgentRunRepo.markFailed(args.db, {
      publicId: run.publicId,
      error: message,
    });

    return {
      publicId: failedRun.publicId,
      agent: failedRun.agent,
      status: failedRun.status,
      supersetWorkspaceId: failedRun.supersetWorkspaceId,
      supersetSessionId: failedRun.supersetSessionId,
      supersetUrl: failedRun.supersetUrl,
      error: failedRun.error ?? message,
      listPublicId: null,
    };
  }
}

async function maybeSendAriFollowup(args: {
  db: DbClient;
  input: TicketRequest;
  card: {
    id: number;
    publicId: string;
    title: string;
  };
  sourceEventId: string;
  sourceCaseKey: string;
}) {
  const [latestRun] = await cardAgentRunRepo.listByCardId(
    args.db,
    args.card.id,
  );
  if (
    !latestRun ||
    (latestRun.status !== "running" && latestRun.status !== "needs_input") ||
    !latestRun.supersetSessionId
  ) {
    return null;
  }

  const reply = [
    `New inbound support update for GSD card ${args.card.publicId}.`,
    `Source event ID: ${args.sourceEventId}`,
    `Source case key: ${args.sourceCaseKey}`,
    "",
    ...renderSupportWorkflowPromptContext(args.input),
    "",
    args.input.details ?? args.input.summary ?? "No update body supplied.",
  ].join("\n");

  try {
    const result = await sendAriGoldFollowup({
      eventId: `gsd-card:${args.card.publicId}:${latestRun.publicId}`,
      sessionId: latestRun.supersetSessionId,
      reply,
      customer: args.input.customer,
      delivery: args.input.sourceCallback?.delivery,
    });

    return {
      ok: true as const,
      runPublicId: latestRun.publicId,
      sessionId: result.sessionId ?? latestRun.supersetSessionId,
      sessionUrl: result.sessionUrl ?? latestRun.supersetUrl,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unable to enqueue Ari follow-up";
    console.warn("Failed to enqueue Ari follow-up for support ticket", {
      cardPublicId: args.card.publicId,
      runPublicId: latestRun.publicId,
      sourceEventId: args.sourceEventId,
      error: message,
    });

    return {
      ok: false as const,
      runPublicId: latestRun.publicId,
      sessionId: latestRun.supersetSessionId,
      sessionUrl: latestRun.supersetUrl,
      error: message,
    };
  }
}

async function upsertSupportMetadataForInput(args: {
  db: DbClient;
  cardId: number;
  input: TicketRequest;
  source: string;
  sourceEventId: string;
  sourceCaseKey: string;
}) {
  const hardParameters = getHardParameters(args.input);
  const metadata = await supportTicketMetadataRepo.upsertForCard(args.db, {
    cardId: args.cardId,
    externalId: args.input.externalId,
    source: args.source,
    sourceCaseKey: args.sourceCaseKey,
    supportCaseId: hardParameters.supportCaseId ?? null,
    sourceEventId: args.sourceEventId,
    sourceSystem: hardParameters.sourceSystem,
    userId: hardParameters.userId ?? null,
    emmaUserId: hardParameters.emmaUserId ?? null,
    email: hardParameters.email ?? null,
    customerName:
      args.input.parameters?.customerName ?? args.input.customer?.name ?? null,
    issueCategory: hardParameters.issueCategory ?? null,
    reportedAt: parseOptionalDate(hardParameters.reportedAt),
    sourceChannel: hardParameters.sourceChannel ?? null,
    provider: hardParameters.provider ?? null,
    providerThreadId: hardParameters.providerThreadId ?? null,
    providerMessageId: hardParameters.providerMessageId ?? null,
    mailbox: hardParameters.mailbox ?? null,
    ariSessionId: hardParameters.ariSessionId ?? null,
    ariSessionUrl: hardParameters.ariSessionUrl ?? null,
    repoFullName: hardParameters.repoFullName ?? null,
    metadata: {
      ...(args.input.metadata ?? {}),
      sourceCallback: args.input.sourceCallback,
    },
  });
  if (hardParameters.provider && hardParameters.providerThreadId) {
    await supportTicketMetadataRepo.upsertThreadForCard(args.db, {
      cardId: args.cardId,
      supportCaseId: hardParameters.supportCaseId ?? null,
      sourceCaseKey: args.sourceCaseKey,
      provider: hardParameters.provider,
      mailbox: hardParameters.mailbox ?? null,
      providerThreadId: hardParameters.providerThreadId,
      providerMessageId: hardParameters.providerMessageId ?? null,
    });
  }
  return metadata;
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

  const parsed = ticketRequestSchema.safeParse(body);
  if (!parsed.success) {
    jsonError(res, 400, parsed.error.issues[0]?.message ?? "Invalid payload");
    return;
  }

  try {
    const input = parsed.data;
    const db = getDb();
    const user = await ensureSupportUser(db);
    const workspace = await ensureSupportWorkspace(db, user);
    const board = await ensureSupportBoard(db, user.id, workspace);
    const supportLists = await ensureSupportLists(db, user.id, board);
    const source = canonicalSupportSource(input.source);
    const sourceEventId = getSourceEventId(input);
    const sourceCaseKey = getSourceCaseKey(input, source);
    const sourceAliases = sourceLookupAliases(source, input.source);
    const markers = sourceAliases.map((alias) =>
      ticketMarker(alias, input.externalId),
    );
    const marker = markers[0] ?? ticketMarker(source, input.externalId);
    const baseUrl = getBaseUrl(req);
    const traceId = getHeader(req, "x-trace-id");

    const existingEvent = await findExistingEventByAliases({
      db,
      sources: sourceAliases,
      sourceEventId,
    });

    if (existingEvent?.card) {
      res.status(200).json({
        ok: true,
        duplicate: true,
        cardPublicId: existingEvent.card.publicId,
        cardNumber: existingEvent.card.cardNumber,
        cardPrefix: workspace.cardPrefix,
        cardUrl: getAdminCardUrl(existingEvent.card.publicId),
        boardPublicId: board.publicId,
        workspacePublicId: workspace.publicId,
      });
      return;
    }

    const existingMetadata = await findExistingMetadataByAliases({
      db,
      sources: sourceAliases,
      sourceCaseKey,
      externalId: input.externalId,
    });
    const existingTicket =
      existingMetadata?.card ??
      (await findExistingTicketByMarkers({
        db,
        boardId: board.id,
        markers,
      }));

    if (existingTicket) {
      const eventClaimed = await db.transaction(async (tx) => {
        const txDb = tx as unknown as DbClient;
        const supportEvent = await supportTicketMetadataRepo.createEventIfNew(
          txDb,
          {
            cardId: existingTicket.id,
            source,
            sourceEventId,
            sourceCaseKey,
            eventType: input.eventType,
            status: input.status,
            summary: input.summary ?? input.details ?? null,
            payload: input,
          },
        );

        if (!supportEvent) return false;

        await upsertSupportMetadataForInput({
          db: txDb,
          cardId: existingTicket.id,
          input,
          source,
          sourceEventId,
          sourceCaseKey,
        });

        return true;
      });

      if (!eventClaimed) {
        res.status(200).json({
          ok: true,
          duplicate: true,
          updatedExisting: true,
          cardPublicId: existingTicket.publicId,
          cardNumber: existingTicket.cardNumber,
          cardPrefix: workspace.cardPrefix,
          cardUrl: getAdminCardUrl(existingTicket.publicId),
          boardPublicId: board.publicId,
          workspacePublicId: workspace.publicId,
          listPublicId: existingTicket.list.publicId,
        });
        return;
      }

      await createSupportTicketComments({
        db,
        cardId: existingTicket.id,
        createdBy: user.id,
        input,
        sourceEventId,
      });

      if (input.commentOnly) {
        res.status(200).json({
          ok: true,
          duplicate: false,
          updatedExisting: true,
          commentOnly: true,
          cardPublicId: existingTicket.publicId,
          cardNumber: existingTicket.cardNumber,
          cardPrefix: workspace.cardPrefix,
          cardUrl: getAdminCardUrl(existingTicket.publicId),
          boardPublicId: board.publicId,
          workspacePublicId: workspace.publicId,
          listPublicId: existingTicket.list.publicId,
        });
        return;
      }

      const followup = await maybeSendAriFollowup({
        db,
        input,
        card: {
          id: existingTicket.id,
          publicId: existingTicket.publicId,
          title: existingTicket.title,
        },
        sourceEventId,
        sourceCaseKey,
      });

      let movedTo: SupportList | null = null;
      if (followup?.ok) {
        movedTo = await moveCardToSupportList({
          db,
          userId: user.id,
          cardId: existingTicket.id,
          cardPublicId: existingTicket.publicId,
          currentListId: existingTicket.listId,
          supportLists,
          targetListName: "Investigating",
          title: existingTicket.title,
          summary: input.summary ?? "Inbound support update routed to Ari.",
          source,
          sourceCaseKey,
          ticketUrl: getAdminCardUrl(existingTicket.publicId),
          sessionUrl: getAdminAriSessionUrl({
            sessionId: followup.sessionId,
            sessionUrl: followup.sessionUrl,
          }),
          parameters: getHardParameters(input),
          traceId,
          eventId: existingTicket.publicId,
        });
      } else if (!followup) {
        const willLaunchAri =
          !input.ari?.sessionId &&
          (input.status === "bug_raised" ||
            input.status === "investigating" ||
            hasAriHandoffRequested(input));
        if (!willLaunchAri) {
          const targetListName = statusToListName[input.status];
          movedTo = await moveCardToSupportList({
            db,
            userId: user.id,
            cardId: existingTicket.id,
            cardPublicId: existingTicket.publicId,
            currentListId: existingTicket.listId,
            supportLists,
            targetListName,
            title: existingTicket.title,
            summary: input.summary ?? input.details ?? null,
            source,
            sourceCaseKey,
            ticketUrl: getAdminCardUrl(existingTicket.publicId),
            sessionUrl: getAdminAriSessionUrl({
              sessionId: input.ari?.sessionId,
              sessionUrl: input.ari?.sessionUrl,
            }),
            parameters: getHardParameters(input),
            traceId,
            eventId: existingTicket.publicId,
          });
        }
      }

      const launchedRun = followup
        ? null
        : await maybeLaunchSupportCodingAgent({
            db,
            input,
            source,
            sourceEventId,
            sourceCaseKey,
            userId: user.id,
            card: existingTicket,
            cardPrefix: workspace.cardPrefix,
            description: renderAgentPromptContext(input),
            board,
            supportLists,
            baseUrl,
            traceId,
          });

      if (!movedTo && needsHumanReviewNotification(input)) {
        await postSupportTicketStatusSlackUpdate({
          eventId: existingTicket.publicId,
          source,
          status: "needs_input",
          title: existingTicket.title,
          summary:
            input.summary ??
            input.details ??
            "Customer replied on an existing support case and needs human review.",
          triggerText: getTicketTriggerText(input),
          ticketUrl: getAdminCardUrl(existingTicket.publicId),
          sessionUrl: getAdminAriSessionUrl({
            sessionId: input.ari?.sessionId,
            sessionUrl: input.ari?.sessionUrl,
          }),
          parameters: {
            ...getHardParameters(input),
            cardPublicId: existingTicket.publicId,
            cardNumber: existingTicket.cardNumber,
            humanReviewNeeded: true,
          },
          traceId,
        });
      }

      res.status(200).json({
        ok: true,
        duplicate: false,
        updatedExisting: true,
        cardPublicId: existingTicket.publicId,
        cardNumber: existingTicket.cardNumber,
        cardPrefix: workspace.cardPrefix,
        cardUrl: getAdminCardUrl(existingTicket.publicId),
        boardPublicId: board.publicId,
        workspacePublicId: workspace.publicId,
        listPublicId:
          launchedRun?.listPublicId ??
          movedTo?.publicId ??
          existingTicket.list.publicId,
        agentRun: followup
          ? followup.ok
            ? {
                status: "followup_queued",
                sessionId: followup.sessionId,
                sessionUrl: getAdminAriSessionUrl({
                  sessionId: followup.sessionId,
                  sessionUrl: followup.sessionUrl,
                }),
                runPublicId: followup.runPublicId,
              }
            : {
                status: "followup_failed",
                sessionId: followup.sessionId,
                sessionUrl: getAdminAriSessionUrl({
                  sessionId: followup.sessionId,
                  sessionUrl: followup.sessionUrl,
                }),
                runPublicId: followup.runPublicId,
                error: followup.error,
              }
          : launchedRun,
      });
      return;
    }

    if (input.commentOnly) {
      // A comment-only note must never create a new card; without a matching
      // ticket there is nothing to annotate.
      res
        .status(200)
        .json({ ok: true, recorded: false, reason: "no_matching_ticket" });
      return;
    }

    const listName = statusToListName[input.status];
    const targetList = supportLists.find((list) => list.name === listName);

    if (!targetList) {
      jsonError(res, 500, `Support list ${listName} was not created`);
      return;
    }

    const description = renderDescription(marker);
    const cardTitle = await generateSupportCardTitle(input);
    const cardTicketInput = { ...input, title: cardTitle };
    const hardParameters = getHardParameters(input);

    let card: Awaited<ReturnType<typeof cardRepo.create>>;
    try {
      card = await db.transaction(async (tx) => {
        const txDb = tx as unknown as DbClient;
        const createdCard = await cardRepo.create(txDb, {
          title: cardTitle,
          description,
          createdBy: user.id,
          listId: targetList.id,
          workspaceId: workspace.id,
          position: "end",
          priority: input.priority ?? null,
        });
        const supportEvent = await supportTicketMetadataRepo.createEventIfNew(
          txDb,
          {
            cardId: createdCard.id,
            source,
            sourceEventId,
            sourceCaseKey,
            eventType: input.eventType,
            status: input.status,
            summary: input.summary ?? input.details ?? null,
            payload: input,
          },
        );

        if (!supportEvent) {
          throw new DuplicateSupportTicketEventError(sourceEventId);
        }

        await upsertSupportMetadataForInput({
          db: txDb,
          cardId: createdCard.id,
          input,
          source,
          sourceEventId,
          sourceCaseKey,
        });

        return createdCard;
      });
    } catch (error) {
      if (error instanceof DuplicateSupportTicketEventError) {
        const duplicateEvent = await findExistingEventByAliases({
          db,
          sources: sourceAliases,
          sourceEventId: error.sourceEventId,
        });

        if (duplicateEvent?.card) {
          res.status(200).json({
            ok: true,
            duplicate: true,
            cardPublicId: duplicateEvent.card.publicId,
            cardNumber: duplicateEvent.card.cardNumber,
            cardPrefix: workspace.cardPrefix,
            cardUrl: getAdminCardUrl(duplicateEvent.card.publicId),
            boardPublicId: board.publicId,
            workspacePublicId: workspace.publicId,
          });
          return;
        }
      }

      throw error;
    }

    await createSupportTicketComments({
      db,
      cardId: card.id,
      createdBy: user.id,
      input,
      sourceEventId,
    });
    // Launch the coding agent first so the Slack creation alert can deep-link to
    // the durable Issue (its id == the launched session id). Posting the alert
    // before the launch left every alert pointing at a "pending" session.
    const agentRun = await maybeLaunchSupportCodingAgent({
      db,
      input: cardTicketInput,
      source,
      sourceEventId,
      sourceCaseKey,
      userId: user.id,
      card,
      cardPrefix: workspace.cardPrefix,
      description: renderAgentPromptContext(cardTicketInput),
      board,
      supportLists,
      baseUrl,
      traceId,
    });
    await postSupportTicketCreatedSlackAlert({
      eventId: card.publicId,
      source,
      sessionId:
        agentRun?.supersetSessionId ?? hardParameters.ariSessionId ?? null,
      sessionUrl: agentRun?.supersetUrl ?? hardParameters.ariSessionUrl ?? null,
      title: cardTitle,
      summary: input.summary ?? input.details ?? null,
      triggerText: getTicketTriggerText(input),
      priority: input.priority ?? "medium",
      customer: input.customer,
      ticket: {
        cardPublicId: card.publicId,
        cardNumber: card.cardNumber,
        cardUrl: getAdminCardUrl(card.publicId),
      },
      ticketUrl: getAdminCardUrl(card.publicId),
      repoFullName: hardParameters.repoFullName ?? null,
      parameters: {
        ...hardParameters,
        cardPublicId: card.publicId,
        cardNumber: card.cardNumber,
      },
      traceId,
    });

    res.status(200).json({
      ok: true,
      duplicate: false,
      cardPublicId: card.publicId,
      cardNumber: card.cardNumber,
      cardPrefix: workspace.cardPrefix,
      cardUrl: getAdminCardUrl(card.publicId),
      boardPublicId: board.publicId,
      workspacePublicId: workspace.publicId,
      listPublicId: agentRun?.listPublicId ?? targetList.publicId,
      agentRun,
    });
  } catch (error) {
    console.error("Failed to create Retrograde support ticket", error);
    jsonError(res, 500, "Unable to create support ticket");
  }
}

export default withApiLogging(handler);
