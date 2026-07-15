import { createHmac } from "node:crypto";
import type {
  AriLaunchRequest,
  CodingAgent,
} from "@retrograde/support-contracts";
import {
  ARI_CODING_AGENTS,
  resolveAriLaunchRequest,
} from "@retrograde/support-contracts";

type LaunchAriGoldInput = AriLaunchRequest;

type SendAriGoldFollowupInput = {
  eventId: string;
  sessionId?: string | null;
  reply: string;
  customer?: {
    userId?: string;
    emmaUserId?: string;
    email?: string;
    name?: string;
  };
  delivery?: Record<string, unknown>;
};

export type LaunchAriGoldResult = {
  agent: "ari-gold";
  sessionId: string | null;
  url: string | null;
  response: unknown;
};

const DEFAULT_WEBHOOK_URL =
  "https://agent-webhook-ari-gold.retrogradeai.workers.dev/webhooks/external-agent";
const DEFAULT_REPO = "creatorcomputecompany/emma";
const DEFAULT_MODEL = "openai/gpt-5.5";
const DEFAULT_REASONING_EFFORT = "low";
const DEFAULT_CODING_AGENT: CodingAgent = "opencode";

const requireEnv = (key: string) => {
  const value = process.env[key]?.trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
};

const optionalEnv = (key: string) => process.env[key]?.trim() || undefined;

function signPayload(body: string, secret: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  return { timestamp, signature: `sha256=${signature}` };
}

function getCodingAgent(): CodingAgent {
  const value = optionalEnv("ARI_GOLD_DEFAULT_CODING_AGENT");
  return ARI_CODING_AGENTS.includes(value as CodingAgent)
    ? (value as CodingAgent)
    : DEFAULT_CODING_AGENT;
}

function getExternalAgentWebhookUrl(path: "launch" | "followup") {
  const launchUrl =
    optionalEnv("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_URL") ?? DEFAULT_WEBHOOK_URL;
  if (path === "launch") return launchUrl;
  if (launchUrl.endsWith("/followup")) return launchUrl;
  if (launchUrl.endsWith("/webhooks/external-agent")) {
    return `${launchUrl}/followup`;
  }
  return `${launchUrl.replace(/\/+$/, "")}/followup`;
}

export function getAriGoldRepo(fallback?: string | null) {
  return fallback ?? optionalEnv("ARI_GOLD_DEFAULT_REPO") ?? DEFAULT_REPO;
}

export function buildAriGoldSupportPrompt(input: {
  title: string;
  description: string | null;
  boardName: string;
  listName: string;
  ticketNumber: string | null;
  cardUrl: string | null;
}) {
  const cardReference = input.ticketNumber ?? input.cardUrl ?? input.title;

  return `Work this GSD support ticket through to human review.

Ticket: ${cardReference}
Title: ${input.title}
Board: ${input.boardName}
Current list: ${input.listName}
Card URL: ${input.cardUrl ?? "not available"}

Ticket description:
${input.description ?? "No description supplied."}

Outcome required:
- Diagnose the issue using the hard parameters in the ticket.
- When a Support Email Workflow section is present, use its classification, extracted facts, customer/case match, reconciliation state, and support-agent actions as the intake plan.
- If this is a product/code bug, make the smallest safe code change and leave evidence of the checks you ran.
- If this is expected behavior but creates a poor UX, do not call it a bug. Classify it as a product improvement. If the improvement is obvious, low-risk, and well-scoped, implement it, commit it, and open a PR for human review.
- If this needs a production data/state fix, do not mutate production directly. Prefer a reviewed data_repairs/ PR only when the current repo has data_repairs/README.md and a data-repair package script: add one timestamped repair directory with metadata.yaml, dry_run.sql, apply.sql, verify.sql, and rollback.sql; run that repo's data-repair validate, lint, and check-safety commands using its package manager; then open a PR for human review. If the current repo does not have that tooling, or a repair PR is not safe or possible, produce the exact reviewed action/runbook and evidence instead.
- If there is no bug and no product improvement or code change is needed, explain the genuine reason clearly and cite the evidence you used.
- If a code change is made, commit it and open a pull request — do not stop at a local diff. For a code bug or product improvement, "ready_for_review" requires an open PR (or an explicit reason a PR is impossible in this environment).
- Finish with a concise review summary: root cause, user impact, fix or recommended action, verification, and anything a human needs to review.

At the very end, include exactly one machine-readable ticket update block:

<gsd_ticket_update>
{"status":"ready_for_review","resolutionType":"product_improvement","engineeringAction":"opened_pr","summary":"short operator summary","rootCause":"what happened","userImpact":"customer/user impact","fix":"what changed or recommended action","verification":"checks/evidence","reviewNotes":"what a human should review","prUrl":"https://github.com/org/repo/pull/123"}
</gsd_ticket_update>

Set "resolutionType" to "bug" for real defects, "product_improvement" for expected behavior with a clear UX/product improvement, "not_bug" when the support issue is fully explained without product work, "data_or_state_issue" for data/state fixes, "needs_input" for customer clarification, or "failed" for blockers. Set "engineeringAction" to "opened_pr" when you opened a PR, "recommended_change" when the improvement is not safe or obvious enough to implement, "runbook" for reviewed data/state actions, "human_review" for non-PR human approval, or "none" when no engineering action remains.

Use "status":"ready_for_review" when there is a PR, code diff, migration, SQL/runbook, or other human review action, including product-improvement PRs. Use "status":"resolved" when no code/data/product action is needed and the ticket is fully answered by evidence. Use "status":"needs_input" only when an operator-owned clarification is required to continue. Use "status":"failed" only if the run could not complete.

This is an internal engineering/support run. Do not send a creator-facing message and do not create another GSD ticket for this card.`;
}

export async function launchAriGoldAgent(
  input: LaunchAriGoldInput,
): Promise<LaunchAriGoldResult> {
  const webhookUrl = getExternalAgentWebhookUrl("launch");
  const secret = requireEnv("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET");
  const payload = resolveAriLaunchRequest(input, {
    mode: "coding",
    model: optionalEnv("ARI_GOLD_DEFAULT_MODEL") ?? DEFAULT_MODEL,
    reasoningEffort:
      optionalEnv("ARI_GOLD_DEFAULT_REASONING_EFFORT") ??
      DEFAULT_REASONING_EFFORT,
    codingAgent: getCodingAgent(),
  });
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signPayload(body, secret);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ari-Webhook-Event-Id": input.eventId,
      "X-Ari-Webhook-Timestamp": timestamp,
      "X-Ari-Webhook-Signature": signature,
    },
    body,
  });

  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    sessionId?: string;
    sessionUrl?: string;
    error?: string;
  } | null;

  if (!response.ok || !result?.ok) {
    throw new Error(
      result?.error ?? `Ari Gold webhook failed with ${response.status}`,
    );
  }

  return {
    agent: "ari-gold",
    sessionId: result.sessionId ?? null,
    url: result.sessionUrl ?? null,
    response: result,
  };
}

export async function sendAriGoldFollowup(
  input: SendAriGoldFollowupInput,
): Promise<{ ok: boolean; sessionId?: string; sessionUrl?: string }> {
  const webhookUrl = getExternalAgentWebhookUrl("followup");
  const secret = requireEnv("ARI_GOLD_EXTERNAL_AGENT_WEBHOOK_SECRET");
  const payload = {
    eventId: input.eventId,
    sessionId: input.sessionId ?? undefined,
    reply: input.reply,
    customer: input.customer,
    delivery: input.delivery,
  };
  const body = JSON.stringify(payload);
  const { timestamp, signature } = signPayload(body, secret);

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Ari-Webhook-Event-Id": input.eventId,
      "X-Ari-Webhook-Timestamp": timestamp,
      "X-Ari-Webhook-Signature": signature,
    },
    body,
  });

  const result = (await response.json().catch(() => null)) as {
    ok?: boolean;
    sessionId?: string;
    sessionUrl?: string;
    error?: string;
  } | null;

  if (!response.ok || !result?.ok) {
    throw new Error(
      result?.error ?? `Ari Gold followup failed with ${response.status}`,
    );
  }

  return {
    ok: true,
    sessionId: result.sessionId,
    sessionUrl: result.sessionUrl,
  };
}
