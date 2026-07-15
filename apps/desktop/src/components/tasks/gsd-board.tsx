/**
 * The board feature's on/off signal. A build with `VITE_REFLECT_GSD_URL` set
 * points at a headless GSD (Kan) instance; the Tasks screen then shows the
 * native board (`KanbanBoard`, backed by the server's `/api/board` proxy)
 * instead of the markdown-only fallback. The URL itself is used only for the
 * "Open in GSD" links — all board data flows through the same-origin proxy.
 */
export function gsdBoardUrl(): string | null {
  const url = import.meta.env['VITE_REFLECT_GSD_URL']
  return typeof url === 'string' && url !== '' ? url : null
}
