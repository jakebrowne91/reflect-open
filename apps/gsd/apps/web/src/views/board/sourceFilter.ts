export const boardSourceFilterOptions = [
  { key: "slack", label: "Slack / staff" },
  { key: "emma", label: "Emma" },
  { key: "sentry", label: "Sentry" },
  { key: "email", label: "Email support" },
] as const;

export type BoardSourceFilter = (typeof boardSourceFilterOptions)[number]["key"];

const boardSourceFilterSet = new Set<string>(
  boardSourceFilterOptions.map((option) => option.key),
);

export const getBoardSourceFilter = (
  value: unknown,
): BoardSourceFilter | null => {
  if (typeof value !== "string") return null;
  return boardSourceFilterSet.has(value) ? (value as BoardSourceFilter) : null;
};

export const normaliseBoardSourceFilters = (
  values: unknown[],
): BoardSourceFilter[] => {
  const filters: BoardSourceFilter[] = [];
  const seen = new Set<BoardSourceFilter>();

  values.forEach((value) => {
    const filter = getBoardSourceFilter(value);
    if (!filter || seen.has(filter)) return;
    filters.push(filter);
    seen.add(filter);
  });

  return filters;
};
