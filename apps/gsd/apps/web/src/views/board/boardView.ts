export type BoardViewMode = "board" | "list";

export const defaultBoardViewMode: BoardViewMode = "board";

const boardViewModes = new Set<BoardViewMode>(["board", "list"]);

interface PersistedBoardViewPreference {
  version: 1;
  mode: BoardViewMode;
}

export const getBoardViewPreferenceKey = (boardPublicId: string) =>
  `gsd:board-view:${boardPublicId}`;

export const getBoardViewMode = (value: unknown): BoardViewMode | null => {
  if (typeof value !== "string") return null;
  return boardViewModes.has(value as BoardViewMode)
    ? (value as BoardViewMode)
    : null;
};

export const readBoardViewPreference = (
  boardPublicId: string,
): BoardViewMode => {
  if (typeof window === "undefined") return defaultBoardViewMode;

  try {
    const rawPreference = window.localStorage.getItem(
      getBoardViewPreferenceKey(boardPublicId),
    );
    if (!rawPreference) return defaultBoardViewMode;

    const preference = JSON.parse(
      rawPreference,
    ) as Partial<PersistedBoardViewPreference>;

    if (preference.version !== 1) return defaultBoardViewMode;
    return getBoardViewMode(preference.mode) ?? defaultBoardViewMode;
  } catch {
    return defaultBoardViewMode;
  }
};

export const persistBoardViewPreference = (
  boardPublicId: string,
  mode: BoardViewMode,
) => {
  if (typeof window === "undefined") return;

  try {
    const preference: PersistedBoardViewPreference = {
      version: 1,
      mode,
    };

    window.localStorage.setItem(
      getBoardViewPreferenceKey(boardPublicId),
      JSON.stringify(preference),
    );
  } catch {
    // localStorage can be unavailable in private/locked-down browser contexts.
  }
};
