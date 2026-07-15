export type SupportParameterKey =
  | "eventId"
  | "sourceEventId"
  | "sourceCaseKey"
  | "supportCaseId"
  | "customerName"
  | "userId"
  | "emmaUserId"
  | "email"
  | "issueCategory"
  | "dateRange"
  | "reportedAt"
  | "sourceSystem"
  | "sourceChannel"
  | "component"
  | "needsCustomerInput"
  | "needsEngineering"
  | "supportAgentActions"
  | "provider"
  | "providerMessageId"
  | "providerThreadId"
  | "latestProviderMessageId"
  | "latestProviderThreadId"
  | "replyToMessageId"
  | "subject"
  | "mailbox"
  | "ariSessionId"
  | "ariSessionUrl"
  | "repoFullName";

export interface SupportParameter {
  key: SupportParameterKey;
  label: string;
  value: string;
}

export interface SupportContext {
  parameters: SupportParameter[];
  byKey: Partial<Record<SupportParameterKey, string>>;
}

// Key-construction helpers live in the mirrored module (kept in sync with
// packages/shared/src/support-event-keys.ts in the root workspace); re-exported
// here to preserve this file's historical import surface.
export type { SupportSourceIdentityInput } from "./supportEventKeys";
export {
  canonicalSupportSource,
  getSourceCaseKey,
  getSourceEventId,
  sourceLookupAliases,
} from "./supportEventKeys";

const hardParameterLabels: Record<
  string,
  { key: SupportParameterKey; label: string }
> = {
  "event id": { key: "eventId", label: "Event ID" },
  "source event id": { key: "sourceEventId", label: "Source event ID" },
  "source case key": { key: "sourceCaseKey", label: "Source case key" },
  "support case id": { key: "supportCaseId", label: "Support case ID" },
  customer: { key: "customerName", label: "Customer" },
  "customer name": { key: "customerName", label: "Customer" },
  "user id": { key: "userId", label: "User ID" },
  "emma user id": { key: "emmaUserId", label: "Emma user ID" },
  email: { key: "email", label: "Email" },
  "issue category": { key: "issueCategory", label: "Issue category" },
  "date range": { key: "dateRange", label: "Date range" },
  "reported at": { key: "reportedAt", label: "Reported at" },
  "source system": { key: "sourceSystem", label: "Source system" },
  "source channel": { key: "sourceChannel", label: "Source channel" },
  component: { key: "component", label: "Component" },
  "needs customer input": {
    key: "needsCustomerInput",
    label: "Needs customer input",
  },
  "needs engineering": { key: "needsEngineering", label: "Needs engineering" },
  "support agent actions": {
    key: "supportAgentActions",
    label: "Support agent actions",
  },
  provider: { key: "provider", label: "Provider" },
  "provider message id": {
    key: "providerMessageId",
    label: "Provider message ID",
  },
  "provider thread id": {
    key: "providerThreadId",
    label: "Provider thread ID",
  },
  "latest provider message id": {
    key: "latestProviderMessageId",
    label: "Latest provider message ID",
  },
  "latest provider thread id": {
    key: "latestProviderThreadId",
    label: "Latest provider thread ID",
  },
  "reply-to message id": {
    key: "replyToMessageId",
    label: "Reply-to message ID",
  },
  subject: { key: "subject", label: "Subject" },
  mailbox: { key: "mailbox", label: "Mailbox" },
  "ari session id": { key: "ariSessionId", label: "Ari session ID" },
  "ari session url": { key: "ariSessionUrl", label: "Ari session URL" },
  repo: { key: "repoFullName", label: "Repo" },
};

function normalizeParameterLabel(label: string) {
  return label.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeParameterValue(value: string) {
  const trimmed = value.trim();
  return trimmed && trimmed !== "Unknown" ? trimmed : null;
}

export function parseRetrogradeSupportContext(
  description: string | null | undefined,
): SupportContext | null {
  if (!description?.includes("## Hard Parameters")) return null;

  const parameters: SupportParameter[] = [];
  const byKey: Partial<Record<SupportParameterKey, string>> = {};
  let inHardParameterSection = false;

  for (const line of description.split(/\r?\n/)) {
    if (/^##\s+Hard Parameters\s*$/i.test(line.trim())) {
      inHardParameterSection = true;
      continue;
    }

    if (inHardParameterSection && /^##\s+/.test(line.trim())) {
      break;
    }

    if (!inHardParameterSection) continue;

    const match = /^\s*[-*]\s+([^:]+):\s*(.+?)\s*$/.exec(line);
    if (!match) continue;

    const rawLabel = match[1];
    const rawValue = match[2];
    if (!rawLabel || !rawValue) continue;

    const labelInfo = hardParameterLabels[normalizeParameterLabel(rawLabel)];
    const value = normalizeParameterValue(rawValue);

    if (!labelInfo || !value) continue;

    parameters.push({
      key: labelInfo.key,
      label: labelInfo.label,
      value,
    });
    byKey[labelInfo.key] = value;
  }

  return parameters.length > 0 ? { parameters, byKey } : null;
}
