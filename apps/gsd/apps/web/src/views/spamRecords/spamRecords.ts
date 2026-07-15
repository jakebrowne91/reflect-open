export interface SpamRecordListItem {
  id: number;
  customerEmail: string | null;
  customerName: string | null;
  subject: string | null;
  classification: Record<string, unknown> | null;
  processingStatus: string;
  receivedAt: Date | string | null;
  createdAt: Date | string;
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

const classificationString = (
  classification: Record<string, unknown> | null,
  key: string,
) => {
  const value = classification?.[key];
  return typeof value === "string" ? toTrimmed(value) : null;
};

export const getSpamRecordSenderLabel = (
  item: Pick<SpamRecordListItem, "customerName" | "customerEmail">,
) => toTrimmed(item.customerName) ?? toTrimmed(item.customerEmail) ?? "Unknown";

export const getSpamRecordSenderSecondaryLabel = (
  item: Pick<SpamRecordListItem, "customerName" | "customerEmail">,
) => {
  const email = toTrimmed(item.customerEmail);
  if (!email) return null;
  const primaryLabel = getSpamRecordSenderLabel(item);
  return email.toLowerCase() === primaryLabel.toLowerCase() ? null : email;
};

export const getSpamRecordSubjectLabel = (
  item: Pick<SpamRecordListItem, "subject">,
) => toTrimmed(item.subject) ?? "(no subject)";

export const getSpamRecordCategoryLabel = (
  item: Pick<SpamRecordListItem, "classification">,
) => {
  const category = classificationString(item.classification, "category");
  return category ? toTitleCase(category.replace(/_/g, " ")) : "-";
};

export const getSpamRecordReasoning = (
  item: Pick<SpamRecordListItem, "classification">,
) => classificationString(item.classification, "reasoning");

const STATUS_LABELS: Record<string, string> = {
  recorded_spam: "Spam",
  recorded_non_issue: "Non-issue",
  recorded_no_card: "No card",
};

export const getSpamRecordStatusLabel = (
  item: Pick<SpamRecordListItem, "processingStatus">,
) => {
  const status = toTrimmed(item.processingStatus);
  if (!status) return "-";
  return STATUS_LABELS[status] ?? toTitleCase(status.replace(/_/g, " "));
};

export const getSpamRecordReceivedAt = (
  item: Pick<SpamRecordListItem, "receivedAt" | "createdAt">,
) => toDate(item.receivedAt) ?? toDate(item.createdAt);
