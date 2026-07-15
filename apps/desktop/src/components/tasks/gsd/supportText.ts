/**
 * Ported from Kan's ~/utils/supportText and views/board/cardDisplay for the
 * board card. On a personal board there is no support-ticket metadata, so
 * `cleanSupportTitle` is a passthrough and `getBoardCardDisplayItems` is empty;
 * the HTML helpers behave exactly as Kan's.
 */

export function stripHtml(html: string | null): string {
  if (!html) {
    return ''
  }
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()
}

export function getCardDescriptionPreview(description: string | null): string {
  return stripHtml(description).split('\n')[0]?.trim() ?? ''
}

export function cleanSupportTitle(title: string): string {
  return title
}

export type BoardCardDisplayField =
  | 'updatedAt'
  | 'source'
  | 'sourceSystem'
  | 'sourceChannel'
  | 'userId'
  | 'emmaUserId'
  | 'email'
  | 'customerName'
  | 'issueCategory'
  | 'reportedAt'
  | 'externalId'
  | 'ariSession'

export interface BoardCardSupportMetadata {
  externalId: string
  source: string
}

export interface BoardCardDisplayItem {
  key: BoardCardDisplayField
  label: string
  value: string
  title: string
  isCode?: boolean
}

/** No support metadata on a personal card → nothing to display. */
export function getBoardCardDisplayItems(): BoardCardDisplayItem[] {
  return []
}
