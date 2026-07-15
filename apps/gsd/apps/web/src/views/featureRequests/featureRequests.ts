export interface FeatureRequestListItem {
  cardPublicId: string;
  cardNumber: number | null;
  title: string;
  listName: string | null;
  source: string;
  sourceSystem: string | null;
  sourceChannel: string | null;
  email: string | null;
  customerName: string | null;
  reportedAt: Date | string | null;
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

export const getFeatureRequestCustomerLabel = (
  item: Pick<FeatureRequestListItem, "customerName" | "email">,
) => toTrimmed(item.customerName) ?? toTrimmed(item.email) ?? "Unknown";

export const getFeatureRequestCustomerSecondaryLabel = (
  item: Pick<FeatureRequestListItem, "customerName" | "email">,
) => {
  const email = toTrimmed(item.email);
  if (!email) return null;
  const primaryLabel = getFeatureRequestCustomerLabel(item);
  return email.toLowerCase() === primaryLabel.toLowerCase() ? null : email;
};

export const getFeatureRequestSourceLabel = (
  item: Pick<
    FeatureRequestListItem,
    "source" | "sourceSystem" | "sourceChannel"
  >,
) => {
  const values = [item.sourceChannel, item.sourceSystem, item.source]
    .map(toTrimmed)
    .filter((value): value is string => Boolean(value));

  return Array.from(new Set(values)).join(" / ") || "-";
};

export const getFeatureRequestReportedAt = (
  item: Pick<FeatureRequestListItem, "reportedAt" | "createdAt">,
) => toDate(item.reportedAt) ?? toDate(item.createdAt);
