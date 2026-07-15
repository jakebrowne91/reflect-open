export const ARI_CODING_AGENTS = ["opencode", "pi"];
export const ARI_SPAWN_SOURCES = ["sentry", "emma", "support-email"];
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
};
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
];
export const SUPPORT_EMAIL_ACTIONS = [
  "draft_reply",
  "ask_clarification",
  "investigate",
  "code_fix",
  "close_non_issue",
  "human_review",
];
export const SUPPORT_EMAIL_AGENT_ACTIONS = [
  "reply_to_customer",
  "ask_customer",
  "launch_ari_investigation",
  "create_bug",
  "update_existing_case",
  "escalate_human",
  "set_followup",
  "close_case",
];
export function resolveAriLaunchRequest(input, fallbacks) {
  if (!input || typeof input !== "object") {
    throw new Error("Ari launch request must be an object");
  }
  const requestedSpawnSource =
    input.spawnSource ?? input.supportContext?.spawnSource;
  const sourceDefaults = requestedSpawnSource
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
  const supportContext = {
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
function hashCaseKey(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(6, "0").slice(-6);
}
export function buildSupportCaseId(sourceCaseKey) {
  return `EMMA-${hashCaseKey(sourceCaseKey?.trim() || "unknown-support-case")}`;
}
export function supportPriorityToGsdPriority(priority) {
  return priority === "urgent" ||
    priority === "high" ||
    priority === "medium" ||
    priority === "low"
    ? priority
    : "medium";
}
export function defaultGsdStatusForSupportAction(action) {
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
export function shouldCreateTicketForSupportAction() {
  return true;
}
export function shouldCreateTicketForSupportCategory(category) {
  return category !== "spam";
}
export function shouldHandoffSupportActionToAri(action) {
  return (
    action === "investigate" ||
    action === "code_fix" ||
    action === "human_review"
  );
}
