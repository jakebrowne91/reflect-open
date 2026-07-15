import { createHmac } from "node:crypto";
import type { SupportPriority } from "@retrograde/support-contracts";

export type SupportTicketStatus =
  | "new"
  | "bug_raised"
  | "investigating"
  | "ready_for_review"
  | "resolved"
  | "needs_input"
  | "failed";

// Single source of truth for status <-> board list mapping. Declared in board
// column order; the reverse map and default list names are derived from it.
export const SUPPORT_STATUS_TO_LIST_NAME = {
  new: "New",
  investigating: "Investigating",
  needs_input: "Needs Customer",
  bug_raised: "Bug Raised",
  ready_for_review: "Ready for Review",
  resolved: "Resolved",
  failed: "Failed",
} as const satisfies Record<SupportTicketStatus, string>;

export type SupportListName =
  (typeof SUPPORT_STATUS_TO_LIST_NAME)[SupportTicketStatus];

export const SUPPORT_LIST_NAMES = Object.values(
  SUPPORT_STATUS_TO_LIST_NAME,
) as SupportListName[];

export const SUPPORT_LIST_STATUS = Object.fromEntries(
  Object.entries(SUPPORT_STATUS_TO_LIST_NAME).map(([status, listName]) => [
    listName,
    status,
  ]),
) as Record<SupportListName, SupportTicketStatus>;

export function supportStatusFromListName(
  listName: string | null | undefined,
): SupportTicketStatus | null {
  if (!listName) return null;
  if (Object.prototype.hasOwnProperty.call(SUPPORT_LIST_STATUS, listName)) {
    return SUPPORT_LIST_STATUS[listName as keyof typeof SUPPORT_LIST_STATUS];
  }
  return null;
}

function optionalEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) return undefined;
  return value;
}

const DEFAULT_RETROGRADE_ADMIN_APP_URL =
  "https://admin.creatorcomputecompany.com/gsd";

function getRetrogradeAdminAppUrl() {
  return (
    optionalEnv("NEXT_PUBLIC_RETROGRADE_ADMIN_APP_URL") ??
    optionalEnv("RETROGRADE_ADMIN_APP_URL") ??
    DEFAULT_RETROGRADE_ADMIN_APP_URL
  ).replace(/\/+$/, "");
}

function getRetrogradeAdminRootUrl() {
  return getRetrogradeAdminAppUrl().replace(/\/gsd$/, "");
}

export function buildRetrogradeGsdCardUrl(cardPublicId: string) {
  return `${getRetrogradeAdminAppUrl()}/cards/${encodeURIComponent(cardPublicId)}`;
}

function getPathSegmentFromUrl(url: string, prefix: string) {
  try {
    const parsed = new URL(url);
    const prefixWithSlash = prefix.endsWith("/") ? prefix : `${prefix}/`;

    if (!parsed.pathname.startsWith(prefixWithSlash)) return null;

    return decodeURIComponent(
      parsed.pathname.slice(prefixWithSlash.length).split("/")[0] ?? "",
    );
  } catch {
    return null;
  }
}

export function buildRetrogradeAdminAriSessionUrl(input: {
  sessionId?: string | null;
  sessionUrl?: string | null;
}) {
  const rawSessionId =
    input.sessionId?.trim() ||
    (input.sessionUrl
      ? getPathSegmentFromUrl(input.sessionUrl, "/session")
      : null);
  const sessionId =
    rawSessionId && rawSessionId !== "pending" ? rawSessionId : null;

  return sessionId
    ? `${getRetrogradeAdminRootUrl()}/ari-gold/${encodeURIComponent(sessionId)}`
    : null;
}

function rewriteTicketRecordForGsd(ticket: Record<string, unknown> | null) {
  if (!ticket) return null;

  const cardPublicId =
    typeof ticket.cardPublicId === "string" ? ticket.cardPublicId : null;
  const cardUrl =
    cardPublicId != null
      ? buildRetrogradeGsdCardUrl(cardPublicId)
      : typeof ticket.cardUrl === "string"
        ? rewriteCardUrlForGsd(ticket.cardUrl)
        : undefined;

  return cardUrl ? { ...ticket, cardUrl } : ticket;
}

function rewriteCardUrlForGsd(cardUrl: string | null | undefined) {
  if (!cardUrl) return undefined;
  const cardPublicId = getPathSegmentFromUrl(cardUrl, "/cards");

  return cardPublicId ? buildRetrogradeGsdCardUrl(cardPublicId) : cardUrl;
}

function getSlackCallbackBaseUrl() {
  const baseUrl = (
    optionalEnv("RETROGRADE_SLACK_BOT_CALLBACK_URL") ??
    optionalEnv("SLACK_BOT_CALLBACK_URL")
  )?.replace(/\/+$/, "");

  if (!baseUrl) return undefined;
  return baseUrl.endsWith("/callbacks")
    ? baseUrl.slice(0, -"/callbacks".length)
    : baseUrl;
}

function signPayload(data: object, secret: string) {
  return createHmac("sha256", secret)
    .update(JSON.stringify(data))
    .digest("hex");
}

async function postSignedSlackCallback(
  path: string,
  data: Record<string, unknown>,
  traceId?: string | null,
) {
  const baseUrl = getSlackCallbackBaseUrl();
  const secret = optionalEnv("INTERNAL_CALLBACK_SECRET");
  if (!baseUrl || !secret) {
    console.warn(
      JSON.stringify({
        service: "gsd",
        event: "support.slack_callback_skipped",
        path,
        reason: !baseUrl
          ? "missing_slack_callback_url"
          : "missing_internal_callback_secret",
      }),
    );
    return;
  }

  const signature = signPayload(data, secret);
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(traceId ? { "x-trace-id": traceId } : {}),
      },
      body: JSON.stringify({ ...data, signature }),
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        service: "gsd",
        event: "support.slack_callback_transport_failed",
        path,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    return;
  }

  if (!response.ok) {
    console.warn(
      JSON.stringify({
        service: "gsd",
        event: "support.slack_callback_failed",
        path,
        status: response.status,
        response_preview: (await response.text().catch(() => "")).slice(0, 500),
      }),
    );
  }
}

export async function postSupportTicketCreatedSlackAlert(input: {
  eventId: string;
  source?: string | null;
  sessionId?: string | null;
  sessionUrl?: string | null;
  title: string;
  summary?: string | null;
  triggerText?: string | null;
  priority?: SupportPriority | null;
  customer?: {
    userId?: string;
    emmaUserId?: string;
    email?: string;
    name?: string;
  };
  ticket?: Record<string, unknown> | null;
  ticketUrl?: string | null;
  repoFullName?: string | null;
  parameters?: Record<string, unknown> | null;
  traceId?: string | null;
}) {
  const ticket = rewriteTicketRecordForGsd(input.ticket ?? null);
  const ticketUrl =
    rewriteCardUrlForGsd(input.ticketUrl) ??
    (typeof ticket?.cardUrl === "string" ? ticket.cardUrl : undefined);
  const sessionUrl =
    buildRetrogradeAdminAriSessionUrl({
      sessionId: input.sessionId,
      sessionUrl: input.sessionUrl,
    }) ??
    input.sessionUrl ??
    "";
  const data = {
    eventId: input.eventId,
    source: input.source ?? undefined,
    sessionId: input.sessionId ?? "pending",
    sessionUrl,
    title: input.title,
    summary: input.summary ?? "",
    triggerText: input.triggerText ?? input.summary ?? "",
    safeAnswer: "GSD created a new support ticket.",
    priority: input.priority ?? "medium",
    customer: input.customer,
    ticket,
    ticketUrl,
    repoFullName: input.repoFullName ?? "unknown",
    parameters: input.parameters ?? undefined,
    timestamp: Date.now(),
  };

  await postSignedSlackCallback(
    "/callbacks/alerts/customer-support-ticket",
    data,
    input.traceId,
  );
}

export async function postSupportTicketStatusSlackUpdate(input: {
  eventId: string;
  source?: string | null;
  status: SupportTicketStatus;
  title?: string | null;
  summary?: string | null;
  triggerText?: string | null;
  ticketUrl?: string | null;
  sessionUrl?: string | null;
  prUrl?: string | null;
  parameters?: Record<string, unknown> | null;
  traceId?: string | null;
}) {
  const data = {
    eventId: input.eventId,
    source: input.source ?? undefined,
    status: input.status,
    title: input.title ?? undefined,
    summary: input.summary ?? undefined,
    triggerText: input.triggerText ?? input.summary ?? undefined,
    ticketUrl: rewriteCardUrlForGsd(input.ticketUrl),
    sessionUrl:
      buildRetrogradeAdminAriSessionUrl({ sessionUrl: input.sessionUrl }) ??
      input.sessionUrl ??
      undefined,
    prUrl: input.prUrl ?? undefined,
    parameters: input.parameters ?? undefined,
    timestamp: Date.now(),
  };

  await postSignedSlackCallback(
    "/callbacks/alerts/customer-support-ticket-update",
    data,
    input.traceId,
  );
}
