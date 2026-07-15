import { z } from 'zod'

/**
 * Typed client for the native board, talking to the headless GSD (Kan)
 * instance through the Reflect server's `/api/board/*` proxy. Same-origin with
 * the Reflect session, so the browser never holds the Kan API key — the proxy
 * injects it. Every response is validated at this boundary, the same contract
 * `@reflect/core`'s `call()` enforces for bridge commands.
 */

const labelSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable().optional(),
})
export type BoardLabel = z.infer<typeof labelSchema>

const checklistItemSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  completed: z.boolean().optional().default(false),
})
const checklistSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  items: z.array(checklistItemSchema).default([]),
})

const commentSchema = z.object({
  publicId: z.string(),
  comment: z.string().nullable().optional(),
  createdAt: z.string().nullable().optional(),
})

export const cardSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable().optional(),
  index: z.number().optional().default(0),
  cardNumber: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  labels: z.array(labelSchema).default([]),
  members: z.array(z.object({ publicId: z.string() })).default([]),
  attachments: z.array(z.object({ publicId: z.string() })).default([]),
  checklists: z.array(checklistSchema).default([]),
  comments: z.array(commentSchema).default([]),
})
export type BoardCard = z.infer<typeof cardSchema>

export const listSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  index: z.number().optional().default(0),
  cards: z.array(cardSchema).default([]),
})
export type BoardList = z.infer<typeof listSchema>

export const boardSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  lists: z.array(listSchema).default([]),
  labels: z.array(labelSchema).default([]),
})
export type Board = z.infer<typeof boardSchema>

const workspacesSchema = z.array(
  z.object({ workspace: z.object({ publicId: z.string(), name: z.string() }) }),
)
const boardsListSchema = z.array(z.object({ publicId: z.string(), name: z.string() }))
const createdSchema = z.object({ publicId: z.string() })

/** The board a Reflect graph mirrors its tasks onto (matches the sync bridge). */
const DEFAULT_BOARD_NAME = 'Reflect'

async function boardFetch<T>(
  path: string,
  schema: z.ZodType<T, unknown>,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`/api/board${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
    credentials: 'same-origin',
    // The board is live data, not an index projection — never serve it from
    // the HTTP cache.
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`board ${init?.method ?? 'GET'} ${path} failed with ${response.status}`)
  }
  return schema.parse(await response.json())
}

/**
 * Resolve the board to show: the first workspace's `Reflect` board (the sync
 * target), falling back to its first board. Stable across a session — cache it
 * with a long staleTime so this three-hop resolve runs once, not per render.
 */
export async function resolveBoardId(): Promise<string> {
  const memberships = await boardFetch('/workspaces', workspacesSchema)
  const workspace = memberships.at(0)?.workspace
  if (workspace === undefined) {
    throw new Error('no GSD workspace is available')
  }
  const boards = await boardFetch(
    `/workspaces/${workspace.publicId}/boards`,
    boardsListSchema,
  )
  const preferred = boards.find((board) => board.name === DEFAULT_BOARD_NAME) ?? boards.at(0)
  if (preferred === undefined) {
    throw new Error('the GSD workspace has no boards')
  }
  return preferred.publicId
}

export function fetchBoard(boardId: string): Promise<Board> {
  return boardFetch(`/boards/${boardId}`, boardSchema)
}

export function createCard(input: {
  title: string
  listPublicId: string
  description?: string
}): Promise<{ publicId: string }> {
  return boardFetch('/cards', createdSchema, {
    method: 'POST',
    body: JSON.stringify({
      title: input.title,
      description: input.description ?? '',
      listPublicId: input.listPublicId,
      labelPublicIds: [],
      memberPublicIds: [],
      position: 'end',
    }),
  })
}

/** Move/reorder a card: its new list and 0-based index within it. */
export function moveCard(cardPublicId: string, listPublicId: string, index: number): Promise<unknown> {
  return boardFetch(`/cards/${cardPublicId}`, z.unknown(), {
    method: 'PUT',
    body: JSON.stringify({ listPublicId, index }),
  })
}

export function updateCard(
  cardPublicId: string,
  patch: { title?: string; description?: string; dueDate?: string | null },
): Promise<unknown> {
  return boardFetch(`/cards/${cardPublicId}`, z.unknown(), {
    method: 'PUT',
    body: JSON.stringify(patch),
  })
}

export function deleteCard(cardPublicId: string): Promise<unknown> {
  return boardFetch(`/cards/${cardPublicId}`, z.unknown(), { method: 'DELETE' })
}

export function createList(boardPublicId: string, name: string): Promise<{ publicId: string }> {
  return boardFetch('/lists', createdSchema, {
    method: 'POST',
    body: JSON.stringify({ name, boardPublicId }),
  })
}

export function fetchCard(cardPublicId: string): Promise<BoardCard> {
  return boardFetch(`/cards/${cardPublicId}`, cardSchema)
}

export function addComment(cardPublicId: string, comment: string): Promise<unknown> {
  return boardFetch(`/cards/${cardPublicId}/comments`, z.unknown(), {
    method: 'POST',
    body: JSON.stringify({ comment }),
  })
}

export function addChecklist(cardPublicId: string, name: string): Promise<unknown> {
  return boardFetch(`/cards/${cardPublicId}/checklists`, z.unknown(), {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function addChecklistItem(checklistPublicId: string, title: string): Promise<unknown> {
  return boardFetch(`/checklists/${checklistPublicId}/items`, z.unknown(), {
    method: 'POST',
    body: JSON.stringify({ title }),
  })
}

export function setChecklistItem(
  itemPublicId: string,
  patch: { completed?: boolean; title?: string },
): Promise<unknown> {
  return boardFetch(`/checklists/items/${itemPublicId}`, z.unknown(), {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}
