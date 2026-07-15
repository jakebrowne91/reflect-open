export interface SentEmailListItem {
  id: number;
  subject: string | null;
  customerEmail: string | null;
  customerName: string | null;
  summary: string | null;
  processingStatus: string;
  cardPublicId: string | null;
  cardTitle: string | null;
  sentAt: Date | string;
}

const toDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const toTrimmed = (value: string | null | undefined) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

const toTitleCase = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

export const getSentEmailCustomerLabel = (
  item: Pick<SentEmailListItem, "customerName" | "customerEmail">,
) => toTrimmed(item.customerName) ?? toTrimmed(item.customerEmail) ?? "Unknown";

export const getSentEmailCustomerSecondaryLabel = (
  item: Pick<SentEmailListItem, "customerName" | "customerEmail">,
) => {
  const email = toTrimmed(item.customerEmail);
  if (!email) return null;
  const primaryLabel = getSentEmailCustomerLabel(item);
  return email.toLowerCase() === primaryLabel.toLowerCase() ? null : email;
};

export const getSentEmailSubjectLabel = (
  item: Pick<SentEmailListItem, "subject">,
) => toTrimmed(item.subject) ?? "(no subject)";

/**
 * The outbound mirror stores `summary` as "<purpose> sent" or
 * "<purpose> dry-run" (e.g. "customer_reply sent"). Strip the outcome
 * suffix and prettify the snake_case purpose.
 */
export const getSentEmailPurposeLabel = (
  item: Pick<SentEmailListItem, "summary">,
) => {
  const summary = toTrimmed(item.summary);
  if (!summary) return "-";
  const purpose = summary.replace(/\s+(sent|dry-run)$/i, "");
  const cleaned = toTrimmed(purpose.replace(/_/g, " "));
  return cleaned ? toTitleCase(cleaned) : "-";
};

export const getSentEmailStatusLabel = (
  item: Pick<SentEmailListItem, "processingStatus">,
) => {
  const status = toTrimmed(item.processingStatus);
  if (!status) return "-";
  if (status === "sent") return "Sent";
  if (status === "dry_run") return "Dry run";
  return toTitleCase(status.replace(/_/g, " "));
};

export const getSentEmailSentAt = (item: Pick<SentEmailListItem, "sentAt">) =>
  toDate(item.sentAt);
