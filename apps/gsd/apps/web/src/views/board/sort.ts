export type BoardSortBy =
  | "labels"
  | "createdAt"
  | "updatedAt"
  | "reportedAt"
  | "supportUserId"
  | "source"
  | "priority"
  | "list";
export type BoardSortDirection = "asc" | "desc";
export type BoardSortLevel = "primary" | "secondary";

type SortablePriority = "urgent" | "high" | "medium" | "low";

export interface BoardSortCriterion {
  sortBy: BoardSortBy;
  direction: BoardSortDirection;
}

export interface SortableBoardCard {
  index: number;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  priority?: SortablePriority | null;
  labels: { name: string }[];
  list?: {
    name?: string | null;
    index?: number | null;
  } | null;
  supportTicketMetadata?: {
    reportedAt?: Date | string | null;
    source?: string | null;
    sourceSystem?: string | null;
    sourceChannel?: string | null;
    userId?: string | null;
  } | null;
}

export interface SortableBoardListItem<TCard extends SortableBoardCard> {
  card: TCard;
  list: {
    name: string;
  };
  listIndex: number;
  cardIndex: number;
}

const sortablePriorityRank: Record<SortablePriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const toTimestamp = (value: Date | string | null | undefined) => {
  if (!value) return 0;
  const timestamp = new Date(value).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
};

const compareNullableTimestamp = (
  valueA: Date | string | null | undefined,
  valueB: Date | string | null | undefined,
  direction: number,
) => {
  const hasValueA = Boolean(valueA);
  const hasValueB = Boolean(valueB);

  if (hasValueA !== hasValueB) return hasValueA ? -1 : 1;

  const comparison = toTimestamp(valueA) - toTimestamp(valueB);
  return comparison === 0 ? 0 : comparison * direction;
};

const compareNullableString = (
  valueA: string | null | undefined,
  valueB: string | null | undefined,
  direction: number,
) => {
  const normalizedA = valueA?.trim().toLowerCase() ?? "";
  const normalizedB = valueB?.trim().toLowerCase() ?? "";

  if (Boolean(normalizedA) !== Boolean(normalizedB)) {
    return normalizedA ? -1 : 1;
  }

  const comparison = normalizedA.localeCompare(normalizedB);
  return comparison === 0 ? 0 : comparison * direction;
};

const getLabelsValue = (card: SortableBoardCard) =>
  card.labels
    .map((label) => label.name.toLowerCase())
    .sort((a, b) => a.localeCompare(b))
    .join(" ");

const getSourceValue = (card: SortableBoardCard) => {
  const metadata = card.supportTicketMetadata;
  return [metadata?.sourceChannel, metadata?.sourceSystem, metadata?.source]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .join(" ");
};

export const getBoardSortBy = (
  value: string | string[] | undefined,
): BoardSortBy | null => {
  const sortBy = Array.isArray(value) ? value[0] : value;
  if (
    sortBy === "labels" ||
    sortBy === "createdAt" ||
    sortBy === "updatedAt" ||
    sortBy === "reportedAt" ||
    sortBy === "supportUserId" ||
    sortBy === "source" ||
    sortBy === "priority" ||
    sortBy === "list"
  ) {
    return sortBy;
  }

  return null;
};

export const getBoardSortDirection = (
  value: string | string[] | undefined,
): BoardSortDirection => {
  const direction = Array.isArray(value) ? value[0] : value;
  return direction === "desc" ? "desc" : "asc";
};

const compareByCriterion = (
  cardA: SortableBoardCard,
  cardB: SortableBoardCard,
  criterion: BoardSortCriterion,
) => {
  const direction = criterion.direction === "asc" ? 1 : -1;

  if (criterion.sortBy === "labels") {
    const comparison = compareNullableString(
      getLabelsValue(cardA),
      getLabelsValue(cardB),
      direction,
    );
    if (comparison !== 0) return comparison;
  }

  if (criterion.sortBy === "createdAt") {
    const comparison =
      toTimestamp(cardA.createdAt) - toTimestamp(cardB.createdAt);
    if (comparison !== 0) return comparison * direction;
  }

  if (criterion.sortBy === "updatedAt") {
    const comparison =
      toTimestamp(cardA.updatedAt ?? cardA.createdAt) -
      toTimestamp(cardB.updatedAt ?? cardB.createdAt);
    if (comparison !== 0) return comparison * direction;
  }

  if (criterion.sortBy === "reportedAt") {
    const comparison = compareNullableTimestamp(
      cardA.supportTicketMetadata?.reportedAt,
      cardB.supportTicketMetadata?.reportedAt,
      direction,
    );
    if (comparison !== 0) return comparison;
  }

  if (criterion.sortBy === "supportUserId") {
    const comparison = compareNullableString(
      cardA.supportTicketMetadata?.userId,
      cardB.supportTicketMetadata?.userId,
      direction,
    );
    if (comparison !== 0) return comparison;
  }

  if (criterion.sortBy === "source") {
    const comparison = compareNullableString(
      getSourceValue(cardA),
      getSourceValue(cardB),
      direction,
    );
    if (comparison !== 0) return comparison;
  }

  if (criterion.sortBy === "priority") {
    const priorityA = cardA.priority ? sortablePriorityRank[cardA.priority] : 0;
    const priorityB = cardB.priority ? sortablePriorityRank[cardB.priority] : 0;
    const comparison = priorityA - priorityB;
    if (comparison !== 0) return comparison * direction;
  }

  if (criterion.sortBy === "list") {
    const indexA = cardA.list?.index;
    const indexB = cardB.list?.index;

    if (typeof indexA === "number" && typeof indexB === "number") {
      const comparison = indexA - indexB;
      if (comparison !== 0) return comparison * direction;
    }

    const comparison = compareNullableString(
      cardA.list?.name,
      cardB.list?.name,
      direction,
    );
    if (comparison !== 0) return comparison;
  }

  return 0;
};

export const sortBoardCards = <TCard extends SortableBoardCard>(
  cards: TCard[],
  criteria: BoardSortCriterion[],
) =>
  [...cards].sort((cardA, cardB) => {
    for (const criterion of criteria) {
      const comparison = compareByCriterion(cardA, cardB, criterion);
      if (comparison !== 0) return comparison;
    }

    return cardA.index - cardB.index;
  });

export const sortBoardListItems = <
  TCard extends SortableBoardCard,
  TItem extends SortableBoardListItem<TCard>,
>(
  items: TItem[],
  criteria: BoardSortCriterion[],
) =>
  [...items].sort((itemA, itemB) => {
    const cardA = {
      ...itemA.card,
      index: itemA.cardIndex,
      list: {
        name: itemA.list.name,
        index: itemA.listIndex,
      },
    };
    const cardB = {
      ...itemB.card,
      index: itemB.cardIndex,
      list: {
        name: itemB.list.name,
        index: itemB.listIndex,
      },
    };

    for (const criterion of criteria) {
      const comparison = compareByCriterion(cardA, cardB, criterion);
      if (comparison !== 0) return comparison;
    }

    const listComparison = itemA.listIndex - itemB.listIndex;
    if (listComparison !== 0) return listComparison;

    return itemA.cardIndex - itemB.cardIndex;
  });
