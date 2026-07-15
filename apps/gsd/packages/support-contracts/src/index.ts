export type SupportPriority = "urgent" | "high" | "medium" | "low";

export type SupportMode = "coding" | "customer_debug" | "production_query";

export const ARI_CODING_AGENTS = ["opencode", "pi"] as const;

export type CodingAgent = (typeof ARI_CODING_AGENTS)[number];

export const ARI_SPAWN_SOURCES = ["sentry", "emma", "support-email"] as const;

export type AriSpawnSource = (typeof ARI_SPAWN_SOURCES)[number];

export type AriLaunchSourceDefaults = Partial<
  Pick<
    AriLaunchRequest,
    "mode" | "model" | "reasoningEffort" | "codingAgent" | "spawnSource"
  >
>;

export const ARI_LAUNCH_SOURCE_DEFAULTS = {
  sentry: {
    mode: "coding",
    model: "openai/gpt-5.5",
    reasoningEffort: "low",
    codingAgent: "opencode",
    spawnSource: "sentry",
  },
  emma: {
    codingAgent: "opencode",
    spawnSource: "emma",
  },
  "support-email": {
    codingAgent: "opencode",
    spawnSource: "support-email",
  },
} as const satisfies Record<AriSpawnSource, AriLaunchSourceDefaults>;

export interface AriRunContext extends Record<string, unknown> {
  cardPublicId?: string;
  cardAgentRunPublicId?: string;
  cardUrl?: string | null;
  ticketNumber?: string | null;
  boardName?: string;
  listName?: string;
  autoRetryOfRun?: string;
  mode?: SupportMode;
  codingAgent?: CodingAgent;
  spawnSource?: AriSpawnSource;
  repoFullName?: string;
}

export interface AriLaunchRequest {
  eventId: string;
  sourceEventId?: string;
  sourceCaseKey?: string;
  repo: string;
  prompt: string;
  title?: string;
  mode?: SupportMode;
  model?: string;
  reasoningEffort?: string;
  codingAgent?: CodingAgent;
  spawnSource?: AriSpawnSource;
  callbackUrl?: string;
  customer?: {
    userId?: string;
    emmaUserId?: string;
    email?: string;
    name?: string;
    igHandle?: string;
    instagramHandle?: string;
    creatorHandle?: string;
    socialHandle?: string;
  };
  delivery?: Record<string, unknown>;
  sourceCallback?: {
    url: string;
    delivery?: Record<string, unknown>;
  };
  supportContext?: AriRunContext;
  gsdTicket?: {
    create?: boolean;
    title?: string;
    summary?: string;
    priority?: SupportPriority;
    parameters?: Partial<SupportHardParameters> & Record<string, unknown>;
  };
}

export interface AriLaunchFallbacks {
  mode: SupportMode;
  model: string;
  reasoningEffort: string;
  codingAgent: CodingAgent;
}

export function resolveAriLaunchRequest(
  input: AriLaunchRequest,
  fallbacks: AriLaunchFallbacks,
): AriLaunchRequest {
  if (!input || typeof input !== "object") {
    throw new Error("Ari launch request must be an object");
  }

  const requestedSpawnSource =
    input.spawnSource ?? input.supportContext?.spawnSource;
  const sourceDefaults: AriLaunchSourceDefaults | undefined =
    requestedSpawnSource
      ? ARI_LAUNCH_SOURCE_DEFAULTS[requestedSpawnSource]
      : undefined;
  const mode =
    input.mode ??
    sourceDefaults?.mode ??
    input.supportContext?.mode ??
    fallbacks.mode;
  const codingAgent =
    input.codingAgent ??
    sourceDefaults?.codingAgent ??
    input.supportContext?.codingAgent ??
    fallbacks.codingAgent;
  const spawnSource = requestedSpawnSource ?? sourceDefaults?.spawnSource;
  const supportContext: AriRunContext = {
    ...input.supportContext,
    mode,
    codingAgent,
    ...(spawnSource ? { spawnSource } : {}),
    repoFullName: input.supportContext?.repoFullName ?? input.repo,
  };

  return {
    ...input,
    mode,
    model: input.model ?? sourceDefaults?.model ?? fallbacks.model,
    reasoningEffort:
      input.reasoningEffort ??
      sourceDefaults?.reasoningEffort ??
      fallbacks.reasoningEffort,
    codingAgent,
    ...(spawnSource ? { spawnSource } : {}),
    supportContext,
  };
}

export type GsdSupportSource = "email" | "slack" | "emma" | "sentry";

export type GsdTicketStatus =
  | "new"
  | "bug_raised"
  | "investigating"
  | "ready_for_review"
  | "resolved"
  | "needs_input"
  | "failed";

export type AriEmmaAction =
  | "send_final_answer"
  | "send_progress_update"
  | "ask_user";

export type GsdTicketResolutionType =
  | "bug"
  | "not_bug"
  | "product_improvement"
  | "data_or_state_issue"
  | "needs_input"
  | "failed";

export type GsdTicketEngineeringAction =
  | "none"
  | "opened_pr"
  | "recommended_change"
  | "runbook"
  | "human_review";

export interface SupportHardParameters {
  eventId: string;
  sourceEventId?: string;
  sourceCaseKey?: string;
  supportCaseId?: string;
  userId?: string;
  emmaUserId?: string;
  email?: string;
  customerName?: string;
  igHandle?: string;
  instagramHandle?: string;
  creatorHandle?: string;
  socialHandle?: string;
  issueCategory?: string;
  dateRange?: {
    from?: string;
    to?: string;
    timezone?: string;
  };
  reportedAt?: string;
  sourceChannel?: string;
  provider?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  latestProviderMessageId?: string;
  latestProviderThreadId?: string;
  replyToMessageId?: string;
  mailbox?: string;
  ariSessionId?: string;
  ariSessionUrl?: string;
  repoFullName?: string;
  pullRequestUrl?: string;
}

export interface GsdTicketUpdate {
  status: Exclude<GsdTicketStatus, "bug_raised" | "investigating">;
  resolutionType?: GsdTicketResolutionType;
  engineeringAction?: GsdTicketEngineeringAction;
  summary?: string;
  rootCause?: string;
  userImpact?: string;
  fix?: string;
  verification?: string;
  reviewNotes?: string;
  staffHandoff?: {
    whatAriFound: string;
    evidenceChecked: string;
    proposedNextStep: string;
    customerResponseRecommendation?: string;
  };
  prUrl?: string;
  branch?: string;
  question?: string;
  needsInputQuestion?: string;
}

export type ExternalAgentWebhookPayload = AriLaunchRequest;

export interface AriCompletionCallbackPayload {
  eventId: string;
  sourceEventId?: string;
  sourceCaseKey?: string;
  sessionId?: string;
  status: GsdTicketStatus | "completed" | "awaiting_user";
  sessionUrl?: string;
  emmaAction?: AriEmmaAction;
  answer?: string;
  message?: string;
  question?: string;
  summary?: string;
  ticketParameters?: Partial<SupportHardParameters> & Record<string, unknown>;
  ticketUpdate?: Partial<GsdTicketUpdate> | null;
  customer?: ExternalAgentWebhookPayload["customer"];
  delivery?: ExternalAgentWebhookPayload["delivery"];
  supportContext?: ExternalAgentWebhookPayload["supportContext"];
  gsdTicket?: ExternalAgentWebhookPayload["gsdTicket"];
  artifacts?: unknown[];
}

export interface SlackSupportTicketAlertPayload {
  eventId: string;
  source?: string;
  title: string;
  status?: GsdTicketStatus;
  ticketUrl?: string;
  sessionUrl?: string;
  parameters?: Partial<SupportHardParameters> & Record<string, unknown>;
  timestamp: number;
}

export interface SlackSupportTicketUpdatePayload {
  eventId: string;
  source?: string;
  status: GsdTicketStatus;
  title?: string;
  summary?: string;
  ticketUrl?: string;
  sessionUrl?: string;
  prUrl?: string;
  parameters?: Partial<SupportHardParameters> & Record<string, unknown>;
  timestamp: number;
}

export const SUPPORT_EMAIL_CATEGORIES = [
  "product_question",
  "account_access",
  "billing",
  "bug_report",
  "data_issue",
  "integration_issue",
  "deliverability",
  "onboarding_help",
  "feature_request",
  "feedback",
  "non_issue",
  "spam",
  "other",
] as const;

export type SupportEmailCategory = (typeof SUPPORT_EMAIL_CATEGORIES)[number];

export const SUPPORT_EMAIL_ACTIONS = [
  "draft_reply",
  "ask_clarification",
  "investigate",
  "code_fix",
  "close_non_issue",
  "human_review",
] as const;

export type SupportEmailAction = (typeof SUPPORT_EMAIL_ACTIONS)[number];

export const SUPPORT_EMAIL_AGENT_ACTIONS = [
  "reply_to_customer",
  "ask_customer",
  "launch_ari_investigation",
  "create_bug",
  "update_existing_case",
  "escalate_human",
  "set_followup",
  "close_case",
] as const;

export type SupportEmailAgentActionType =
  (typeof SUPPORT_EMAIL_AGENT_ACTIONS)[number];

export interface SupportEmailAddress {
  email: string;
  name?: string | null;
}

export interface SupportEmailAttachment {
  id?: string;
  filename?: string;
  contentType?: string;
  size?: number;
}

export interface SupportEmailMessage {
  externalId: string;
  provider?: "gmail" | "nylas" | "cloudflare" | "manual" | string;
  providerMessageId?: string;
  providerThreadId?: string;
  mailbox?: string;
  from: SupportEmailAddress;
  to: SupportEmailAddress[];
  cc?: SupportEmailAddress[];
  subject: string;
  bodyText?: string | null;
  bodyHtml?: string | null;
  receivedAt?: string;
  attachments?: SupportEmailAttachment[];
  raw?: Record<string, unknown>;
}

export interface SupportEmailCaseIdentity {
  sourceEventId: string;
  sourceCaseKey: string;
  supportCaseId: string;
  provider?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  mailbox?: string;
}

function hashCaseKey(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}

export function buildSupportCaseId(sourceCaseKey: string | undefined): string {
  return `EMMA-${hashCaseKey(sourceCaseKey?.trim() || "unknown-support-case")}`;
}

export interface SupportEmailCustomerMatch {
  userId?: string | null;
  emmaUserId?: string | null;
  email?: string | null;
  name?: string | null;
  userType?: string | null;
  confidence?: number;
}

export interface SupportEmailClassification {
  category: SupportEmailCategory;
  urgency: SupportPriority;
  confidence: number;
  summary: string;
  reasoning: string;
  isRealSupportRequest: boolean;
}

export interface SupportEmailExtractedData {
  affectedFeature?: string | null;
  userVisibleProblem?: string | null;
  expectedBehavior?: string | null;
  actualBehavior?: string | null;
  reproductionSteps?: string[];
  dateRange?: SupportHardParameters["dateRange"];
  identifiers?: Record<string, string>;
  links?: string[];
  accountEmail?: string | null;
  workspace?: string | null;
  creatorHandle?: string | null;
  integration?: string | null;
  errorText?: string | null;
  businessImpact?: string | null;
  attachmentSummary?: string | null;
}

export interface SupportEmailCaseMessage {
  direction: "inbound" | "outbound";
  eventType?: string;
  sourceEventId?: string;
  providerMessageId?: string;
  providerThreadId?: string;
  subject?: string | null;
  bodyText?: string | null;
  summary?: string | null;
  createdAt?: string;
}

export interface SupportEmailCaseCandidate {
  cardPublicId: string;
  cardNumber?: number | null;
  title?: string | null;
  sourceCaseKey?: string | null;
  supportCaseId?: string | null;
  email?: string | null;
  customerName?: string | null;
  issueCategory?: string | null;
  status?: GsdTicketStatus | string | null;
  summary?: string | null;
  lastUpdatedAt?: string | null;
  recentMessages?: SupportEmailCaseMessage[];
  workflow?: SupportEmailWorkflowSnapshot | null;
}

export interface SupportEmailKnownIssue {
  cardPublicId: string;
  title?: string | null;
  issueCategory?: string | null;
  component?: string | null;
  rootCause?: string | null;
  fix?: string | null;
  resolvedAt?: string | null;
}

export interface SupportEmailCaseContext {
  matchedCase?: SupportEmailCaseCandidate | null;
  matchMethod?:
    | "thread"
    | "case_id"
    | "source_case_key"
    | "card"
    | "candidate"
    | "none";
  threadMessages: SupportEmailCaseMessage[];
  supportEvents: SupportEmailCaseMessage[];
  candidates: SupportEmailCaseCandidate[];
  /** Cards resolved/ready-for-review recently, so triage can link instead of re-deriving. */
  recentKnownIssues?: SupportEmailKnownIssue[];
}

export interface SupportEmailWorkflowSnapshot {
  classification?: SupportEmailClassification | Record<string, unknown> | null;
  extracted?: SupportEmailExtractedData | Record<string, unknown> | null;
  decision?: SupportEmailDecision | Record<string, unknown> | null;
  customerResolution?:
    | SupportEmailCustomerResolution
    | Record<string, unknown>
    | null;
  caseMatch?: SupportEmailCaseMatch | Record<string, unknown> | null;
  reconciliation?:
    | SupportEmailCaseReconciliation
    | Record<string, unknown>
    | null;
  agent?: SupportEmailAgentResult | Record<string, unknown> | null;
}

export interface SupportEmailCaseState {
  cardPublicId?: string | null;
  cardNumber?: number | null;
  sourceEventId?: string | null;
  sourceCaseKey?: string | null;
  supportCaseId?: string | null;
  customerEmail?: string | null;
  customerName?: string | null;
  provider?: string | null;
  mailbox?: string | null;
  providerMessageId?: string | null;
  providerThreadId?: string | null;
  latestProviderMessageId?: string | null;
  latestProviderThreadId?: string | null;
  latestInboundMessageId?: string | null;
  latestOutboundMessageId?: string | null;
  replyToMessageId?: string | null;
  subject?: string | null;
  status?: GsdTicketStatus | string | null;
  workflow?: SupportEmailWorkflowSnapshot | null;
}

export interface SupportEmailDecision {
  action: SupportEmailAction;
  gsdStatus: GsdTicketStatus;
  createTicket: boolean;
  handoffToAri: boolean;
  customerReplyDraft?: string | null;
  clarificationQuestion?: string | null;
  internalNote: string;
}

export interface SupportEmailCustomerResolution {
  matched: boolean;
  userId?: string | null;
  emmaUserId?: string | null;
  accountEmail?: string | null;
  customerName?: string | null;
  userType?: string | null;
  confidence: number;
  reasoning: string;
  identifiers?: Record<string, string>;
}

export interface SupportEmailCaseMatch {
  matchMethod: SupportEmailCaseContext["matchMethod"] | "new_case";
  supportCaseId?: string | null;
  sourceCaseKey?: string | null;
  confidence: number;
  shouldCreateNewCase: boolean;
  reasoning: string;
}

export interface SupportEmailCaseReconciliation {
  status: GsdTicketStatus;
  priority: SupportPriority;
  component?: string | null;
  customerVisibleSummary: string;
  internalSummary: string;
  latestCustomerAsk?: string | null;
  knownWorkaround?: string | null;
  needsCustomerInput: boolean;
  needsEngineering: boolean;
  safeToAutoReply: boolean;
}

export type SupportEmailFacetName =
  | "customer_identity"
  | "account_identity"
  | "problem_statement"
  | "affected_component"
  | "urgency"
  | "evidence"
  | "latest_customer_ask"
  | "prior_question"
  | "desired_action"
  | "outbound_response_state";

export type SupportEmailFacetDiffKind =
  | "new"
  | "changed"
  | "unchanged"
  | "removed"
  | "answered_previous_question"
  | "repeated_chaser";

export interface SupportEmailFacetSnapshot {
  customerIdentity: {
    senderEmail?: string | null;
    matchedEmail?: string | null;
    accountEmail?: string | null;
    customerName?: string | null;
    userId?: string | null;
    emmaUserId?: string | null;
    matchMethod?: string | null;
  };
  accountIdentity: {
    accountEmail?: string | null;
    creatorHandle?: string | null;
    workspace?: string | null;
    identifiers?: Record<string, string>;
  };
  problemStatement: {
    category?: SupportEmailCategory | string | null;
    summary?: string | null;
    userVisibleProblem?: string | null;
    expectedBehavior?: string | null;
    actualBehavior?: string | null;
  };
  affectedComponent: {
    component?: string | null;
    affectedFeature?: string | null;
    integration?: string | null;
  };
  urgency: {
    urgency?: SupportPriority | string | null;
    priority?: SupportPriority | string | null;
    businessImpact?: string | null;
  };
  evidence: {
    links?: string[];
    errorText?: string | null;
    identifiers?: Record<string, string>;
    attachmentSummary?: string | null;
  };
  latestCustomerAsk: {
    value?: string | null;
  };
  priorQuestion: {
    lastQuestion?: string | null;
    answered?: boolean;
  };
  desiredAction: {
    decisionAction?: SupportEmailAction | string | null;
    agentActions?: SupportEmailAgentActionType[] | string[];
    needsCustomerInput?: boolean;
    needsEngineering?: boolean;
    safeToAutoReply?: boolean;
  };
  outboundResponseState: {
    hasPriorOutbound: boolean;
    lastOutboundAt?: string | null;
    lastOutboundSummary?: string | null;
    lastOutboundBody?: string | null;
  };
}

export interface SupportEmailFacetDiffItem {
  facet: SupportEmailFacetName;
  kind: SupportEmailFacetDiffKind;
  previous?: unknown;
  current?: unknown;
  reasoning: string;
}

export interface SupportEmailFacetDiff {
  items: SupportEmailFacetDiffItem[];
  hasMeaningfulChange: boolean;
  isRepeatedChaser: boolean;
  answeredPreviousQuestion: boolean;
  reasoning: string;
}

export interface SupportEmailAgentAction {
  type: SupportEmailAgentActionType;
  target?: "customer" | "ari" | "human" | "system";
  reasoning?: string;
  body?: string | null;
  question?: string | null;
  summary?: string | null;
  severity?: SupportPriority;
  scheduledFor?: string | null;
  parameters?: Record<string, unknown>;
}

export interface SupportEmailAgentResult {
  reasoning: string;
  actions: SupportEmailAgentAction[];
  customerReplyDraft?: string | null;
  internalNote?: string | null;
}

export interface SupportEmailWorkflowResult {
  classification: SupportEmailClassification;
  extracted: SupportEmailExtractedData;
  decision: SupportEmailDecision;
  customerResolution?: SupportEmailCustomerResolution;
  caseMatch?: SupportEmailCaseMatch;
  reconciliation?: SupportEmailCaseReconciliation;
  agent?: SupportEmailAgentResult;
  facetSnapshot?: SupportEmailFacetSnapshot;
  facetDiff?: SupportEmailFacetDiff;
}

export function supportPriorityToGsdPriority(
  priority: SupportPriority | null | undefined,
): SupportPriority {
  return priority === "urgent" ||
    priority === "high" ||
    priority === "medium" ||
    priority === "low"
    ? priority
    : "medium";
}

export function defaultGsdStatusForSupportAction(
  action: SupportEmailAction,
): GsdTicketStatus {
  switch (action) {
    case "draft_reply":
      return "resolved";
    case "ask_clarification":
      return "needs_input";
    case "investigate":
      return "investigating";
    case "code_fix":
      return "bug_raised";
    case "close_non_issue":
      return "resolved";
    case "human_review":
      return "investigating";
  }
}

export function shouldCreateTicketForSupportAction(): boolean {
  return true;
}

export function shouldCreateTicketForSupportCategory(
  category: SupportEmailCategory,
): boolean {
  return category !== "spam";
}

export function shouldHandoffSupportActionToAri(
  action: SupportEmailAction,
): boolean {
  return (
    action === "investigate" ||
    action === "code_fix" ||
    action === "human_review"
  );
}
