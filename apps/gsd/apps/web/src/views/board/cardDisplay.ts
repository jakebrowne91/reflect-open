export type BoardCardDisplayField =
  | "updatedAt"
  | "source"
  | "sourceSystem"
  | "sourceChannel"
  | "userId"
  | "emmaUserId"
  | "email"
  | "customerName"
  | "issueCategory"
  | "reportedAt"
  | "externalId"
  | "ariSession";

export interface BoardCardSupportMetadata {
  externalId: string;
  source: string;
  sourceSystem?: string | null;
  userId?: string | null;
  emmaUserId?: string | null;
  email?: string | null;
  customerName?: string | null;
  issueCategory?: string | null;
  reportedAt?: Date | string | null;
  sourceChannel?: string | null;
  ariSessionId?: string | null;
  ariSessionUrl?: string | null;
}

export interface BoardCardDisplayOption {
  key: BoardCardDisplayField;
  label: string;
}

export interface BoardCardDisplayItem {
  key: BoardCardDisplayField;
  label: string;
  value: string;
  title: string;
  isCode?: boolean;
}

interface PersistedBoardCardDisplayPreference {
  version: 1 | 2;
  fields: BoardCardDisplayField[];
}

export const boardCardDisplayOptions: BoardCardDisplayOption[] = [
  { key: "sourceChannel", label: "Channel" },
  { key: "source", label: "Source" },
  { key: "sourceSystem", label: "System" },
  { key: "issueCategory", label: "Type" },
  { key: "reportedAt", label: "Reported" },
  { key: "updatedAt", label: "Updated" },
  { key: "ariSession", label: "Ari session" },
  { key: "customerName", label: "Customer" },
  { key: "email", label: "Email" },
  { key: "userId", label: "User ID" },
  { key: "emmaUserId", label: "Emma ID" },
  { key: "externalId", label: "External ID" },
];

export const defaultBoardCardDisplayFields = boardCardDisplayOptions.map(
  (option) => option.key,
);

const displayFieldSet = new Set<BoardCardDisplayField>(
  defaultBoardCardDisplayFields,
);

const codeFields = new Set<BoardCardDisplayField>([
  "externalId",
  "userId",
  "emmaUserId",
  "ariSession",
]);

const humanizedFields = new Set<BoardCardDisplayField>([
  "source",
  "sourceSystem",
  "sourceChannel",
  "issueCategory",
]);

const friendlyValues: Partial<
  Record<BoardCardDisplayField, Record<string, string>>
> = {
  source: {
    ari_gold: "Ari",
    slack_bot: "Slack",
  },
  sourceSystem: {
    ari_gold: "Ari",
    slack_bot: "Slack",
  },
  sourceChannel: {
    imessage: "iMessage",
    sentry: "Sentry",
    slack: "Slack",
    web: "Web",
    whatsapp: "WhatsApp",
  },
  issueCategory: {
    account: "Account",
    billing: "Billing",
    bug: "Bug",
    messages: "Messages",
    other: "Other",
    outreach: "Outreach",
    product_debug: "Product bug",
    staff_escalation: "Staff request",
    sync: "Sync",
  },
};

export const getBoardCardDisplayPreferenceKey = (boardPublicId: string) =>
  `gsd:board-card-fields:${boardPublicId}`;

export const getBoardCardDisplayField = (
  value: unknown,
): BoardCardDisplayField | null => {
  if (typeof value !== "string") return null;
  return displayFieldSet.has(value as BoardCardDisplayField)
    ? (value as BoardCardDisplayField)
    : null;
};

export const normaliseBoardCardDisplayFields = (
  value: unknown,
): BoardCardDisplayField[] => {
  if (!Array.isArray(value)) return defaultBoardCardDisplayFields;

  const fields: BoardCardDisplayField[] = [];
  const seen = new Set<BoardCardDisplayField>();

  value.forEach((item) => {
    const field = getBoardCardDisplayField(item);
    if (!field || seen.has(field)) return;
    fields.push(field);
    seen.add(field);
  });

  return fields;
};

const migrateLegacyBoardCardDisplayFields = (value: unknown) => {
  const fields = normaliseBoardCardDisplayFields(value);
  if (fields.includes("updatedAt")) return fields;
  return normaliseBoardCardDisplayFields([...fields, "updatedAt"]);
};

export const readBoardCardDisplayPreference = (
  boardPublicId: string,
): BoardCardDisplayField[] => {
  if (typeof window === "undefined") return defaultBoardCardDisplayFields;

  try {
    const rawPreference = window.localStorage.getItem(
      getBoardCardDisplayPreferenceKey(boardPublicId),
    );
    if (!rawPreference) return defaultBoardCardDisplayFields;

    const preference = JSON.parse(rawPreference) as
      | Partial<PersistedBoardCardDisplayPreference>
      | BoardCardDisplayField[];

    if (Array.isArray(preference)) {
      return migrateLegacyBoardCardDisplayFields(preference);
    }

    if (preference.version === 1) {
      return migrateLegacyBoardCardDisplayFields(preference.fields);
    }

    if (preference.version !== 2) return defaultBoardCardDisplayFields;
    return normaliseBoardCardDisplayFields(preference.fields);
  } catch {
    return defaultBoardCardDisplayFields;
  }
};

export const persistBoardCardDisplayPreference = (
  boardPublicId: string,
  fields: BoardCardDisplayField[],
) => {
  if (typeof window === "undefined") return;

  try {
    const preference: PersistedBoardCardDisplayPreference = {
      version: 2,
      fields: normaliseBoardCardDisplayFields(fields),
    };

    window.localStorage.setItem(
      getBoardCardDisplayPreferenceKey(boardPublicId),
      JSON.stringify(preference),
    );
  } catch {
    // localStorage can be unavailable in private/locked-down browser contexts.
  }
};

const humanizeValue = (value: string) =>
  value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (character) => character.toUpperCase());

const formatHumanValue = (field: BoardCardDisplayField, value: string) => {
  const normalizedValue = value.trim().toLowerCase();
  return friendlyValues[field]?.[normalizedValue] ?? humanizeValue(value);
};

const compactValue = (value: string) => {
  const trimmedValue = value.trim();
  if (trimmedValue.length <= 32) return trimmedValue;
  return `${trimmedValue.slice(0, 12)}...${trimmedValue.slice(-8)}`;
};

const getMetadataValue = (
  metadata: BoardCardSupportMetadata,
  field: BoardCardDisplayField,
) => {
  switch (field) {
    case "updatedAt":
      return null;
    case "ariSession":
      return metadata.ariSessionUrl ?? metadata.ariSessionId;
    case "externalId":
      return metadata.externalId;
    case "source":
      return metadata.source;
    case "sourceSystem":
      return metadata.sourceSystem;
    case "userId":
      return metadata.userId;
    case "emmaUserId":
      return metadata.emmaUserId;
    case "email":
      return metadata.email;
    case "customerName":
      return metadata.customerName;
    case "issueCategory":
      return metadata.issueCategory;
    case "reportedAt":
      return metadata.reportedAt;
    case "sourceChannel":
      return metadata.sourceChannel;
  }
};

export const getBoardCardDisplayItems = (
  metadata: BoardCardSupportMetadata | null | undefined,
  visibleFields: BoardCardDisplayField[],
  formatDateTime: (value: Date | string) => string,
): BoardCardDisplayItem[] => {
  if (!metadata) return [];

  const visibleFieldSet = new Set(visibleFields);
  const seenHumanValues = new Set<string>();

  return boardCardDisplayOptions.flatMap((option): BoardCardDisplayItem[] => {
    if (!visibleFieldSet.has(option.key)) return [];

    const rawValue = getMetadataValue(metadata, option.key);
    if (!rawValue) return [];

    if (option.key === "reportedAt") {
      const formattedDate = formatDateTime(rawValue);
      if (!formattedDate) return [];

      const title =
        rawValue instanceof Date ? rawValue.toISOString() : String(rawValue);

      return [
        {
          key: option.key,
          label: option.label,
          value: formattedDate,
          title,
        },
      ];
    }

    const stringValue = String(rawValue).trim();
    if (!stringValue) return [];
    const value = humanizedFields.has(option.key)
      ? formatHumanValue(option.key, stringValue)
      : compactValue(stringValue);

    if (humanizedFields.has(option.key)) {
      const normalizedValue = value.toLowerCase();
      if (seenHumanValues.has(normalizedValue)) return [];
      seenHumanValues.add(normalizedValue);
    }

    return [
      {
        key: option.key,
        label: option.label,
        value,
        title: stringValue,
        isCode: codeFields.has(option.key),
      },
    ];
  });
};
