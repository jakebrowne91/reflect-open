import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { z } from 'zod'

/**
 * The board data layer for the ported GSD board — the Reflect-native
 * replacement for Kan's tRPC `api.board/card/list/label` calls. Everything
 * goes through the Reflect server's `/api/board/*` proxy (same origin, the Kan
 * key injected server-side), so the ported Kan components render inside Reflect
 * against live GSD data with no second login.
 */

const labelSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  colourCode: z.string().nullable().default(null),
})
export type Label = z.infer<typeof labelSchema>

const memberSchema = z.object({
  publicId: z.string(),
  email: z.string().default(''),
  user: z
    .object({
      name: z.string().nullable().default(null),
      email: z.string().default(''),
      image: z.string().nullable().default(null),
    })
    .nullable()
    .default(null),
})

const checklistItemSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  completed: z.boolean().default(false),
  index: z.number().default(0),
})
const checklistSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  items: z.array(checklistItemSchema).default([]),
})

export const cardSchema = z.object({
  publicId: z.string(),
  title: z.string(),
  description: z.string().nullable().default(null),
  index: z.number().default(0),
  cardNumber: z.number().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  priority: z.enum(['urgent', 'high', 'medium', 'low']).nullable().optional(),
  labels: z.array(labelSchema).default([]),
  members: z.array(memberSchema).default([]),
  attachments: z.array(z.object({ publicId: z.string() })).default([]),
  checklists: z.array(checklistSchema).default([]),
  comments: z.array(z.object({ publicId: z.string() })).default([]),
})
export type BoardCard = z.infer<typeof cardSchema>

export const listSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  index: z.number().default(0),
  createdBy: z.string().nullable().optional(),
  cards: z.array(cardSchema).default([]),
})
export type BoardList = z.infer<typeof listSchema>

export const boardSchema = z.object({
  publicId: z.string(),
  name: z.string(),
  slug: z.string().optional(),
  lists: z.array(listSchema).default([]),
  labels: z.array(labelSchema).default([]),
})
export type Board = z.infer<typeof boardSchema>

const workspacesSchema = z.array(
  z.object({ workspace: z.object({ publicId: z.string(), name: z.string() }) }),
)
const boardsListSchema = z.array(z.object({ publicId: z.string(), name: z.string() }))
const createdSchema = z.object({ publicId: z.string() })

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
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`board ${init?.method ?? 'GET'} ${path} failed with ${response.status}`)
  }
  return schema.parse(await response.json())
}

export async function resolveBoardId(): Promise<string> {
  const memberships = await boardFetch('/workspaces', workspacesSchema)
  const workspace = memberships.at(0)?.workspace
  if (workspace === undefined) {
    throw new Error('no GSD workspace is available')
  }
  const boards = await boardFetch(`/workspaces/${workspace.publicId}/boards`, boardsListSchema)
  const preferred = boards.find((board) => board.name === DEFAULT_BOARD_NAME) ?? boards.at(0)
  if (preferred === undefined) {
    throw new Error('the GSD workspace has no boards')
  }
  return preferred.publicId
}

const boardIdKey = ['gsd', 'boardId']
const boardKey = (id: string): [string, string, string] => ['gsd', 'board', id]
const cardKey = (id: string): [string, string, string] => ['gsd', 'card', id]

export function fetchCard(cardPublicId: string): Promise<BoardCard> {
  return boardFetch(`/cards/${cardPublicId}`, cardSchema)
}

const activitySchema = z.object({
  publicId: z.string(),
  type: z.string().optional(),
  createdAt: z.string().nullable().optional(),
  user: z.object({ name: z.string().nullable().optional(), email: z.string().optional() }).nullable().optional(),
})
export type CardActivity = z.infer<typeof activitySchema>

export function useCardActivities(cardPublicId: string): CardActivity[] {
  const activitiesSchema = z.union([
    z.array(activitySchema),
    z.object({ activities: z.array(activitySchema).default([]) }).transform((v) => v.activities),
  ])
  return (
    useQuery({
      queryKey: ['gsd', 'card-activity', cardPublicId],
      queryFn: () => boardFetch(`/cards/${cardPublicId}/activities`, activitiesSchema),
      staleTime: 0,
    }).data ?? []
  )
}

export function useLabelMutations(): {
  createAndAssignLabel: (input: {
    cardPublicId: string
    boardPublicId: string
    name: string
    colourCode: string
  }) => void
  toggleCardLabel: (cardPublicId: string, labelPublicId: string) => void
} {
  const queryClient = useQueryClient()
  const onSettled = (): void => {
    void queryClient.invalidateQueries({ queryKey: ['gsd', 'board'] })
    void queryClient.invalidateQueries({ queryKey: ['gsd', 'card'] })
  }
  // Create the board label, then immediately put it on the card — so creating
  // a label from a card shows it on that card, not just in the board palette.
  const createAndAssign = useMutation({
    mutationFn: async (input: {
      cardPublicId: string
      boardPublicId: string
      name: string
      colourCode: string
    }) => {
      const created = await boardFetch('/labels', createdSchema, {
        method: 'POST',
        body: JSON.stringify({
          name: input.name,
          colourCode: input.colourCode,
          boardPublicId: input.boardPublicId,
        }),
      })
      await boardFetch(`/cards/${input.cardPublicId}/labels/${created.publicId}`, z.unknown(), {
        method: 'PUT',
      })
    },
    onSettled,
  })
  const toggle = useMutation({
    mutationFn: (input: { cardPublicId: string; labelPublicId: string }) =>
      boardFetch(`/cards/${input.cardPublicId}/labels/${input.labelPublicId}`, z.unknown(), {
        method: 'PUT',
      }),
    onSettled,
  })
  return {
    createAndAssignLabel: (input) => createAndAssign.mutate(input),
    toggleCardLabel: (cardPublicId, labelPublicId) =>
      toggle.mutate({ cardPublicId, labelPublicId }),
  }
}

export function useCard(cardPublicId: string): { card: BoardCard | undefined; isPending: boolean } {
  const query = useQuery({
    queryKey: cardKey(cardPublicId),
    queryFn: () => fetchCard(cardPublicId),
    staleTime: 0,
    refetchOnMount: 'always',
  })
  return { card: query.data, isPending: query.isPending }
}

export function useCardMutations(cardPublicId: string): {
  update: (patch: Record<string, unknown>) => void
  addComment: (comment: string) => void
  addChecklist: (name: string) => void
  addChecklistItem: (checklistPublicId: string, title: string) => void
  toggleChecklistItem: (itemPublicId: string, completed: boolean) => void
} {
  const queryClient = useQueryClient()
  const onSettled = (): void => {
    void queryClient.invalidateQueries({ queryKey: cardKey(cardPublicId) })
    void queryClient.invalidateQueries({ queryKey: ['gsd', 'board'] })
  }
  const run = (path: string, method: string, body?: unknown): Promise<unknown> =>
    boardFetch(path, z.unknown(), {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
  const update = useMutation({ mutationFn: (patch: Record<string, unknown>) => run(`/cards/${cardPublicId}`, 'PUT', patch), onSettled })
  const addComment = useMutation({ mutationFn: (comment: string) => run(`/cards/${cardPublicId}/comments`, 'POST', { comment }), onSettled })
  const addChecklist = useMutation({ mutationFn: (name: string) => run(`/cards/${cardPublicId}/checklists`, 'POST', { name }), onSettled })
  const addItem = useMutation({ mutationFn: (input: { checklistPublicId: string; title: string }) => run(`/checklists/${input.checklistPublicId}/items`, 'POST', { title: input.title }), onSettled })
  const toggleItem = useMutation({ mutationFn: (input: { itemPublicId: string; completed: boolean }) => run(`/checklists/items/${input.itemPublicId}`, 'PATCH', { completed: input.completed }), onSettled })
  return {
    update: (patch) => update.mutate(patch),
    addComment: (comment) => addComment.mutate(comment),
    addChecklist: (name) => addChecklist.mutate(name),
    addChecklistItem: (checklistPublicId, title) => addItem.mutate({ checklistPublicId, title }),
    toggleChecklistItem: (itemPublicId, completed) => toggleItem.mutate({ itemPublicId, completed }),
  }
}

export function useBoardId(): string | undefined {
  return useQuery({ queryKey: boardIdKey, queryFn: resolveBoardId, staleTime: Infinity }).data
}

export function useBoard(boardId: string | undefined): {
  board: Board | undefined
  isPending: boolean
  isError: boolean
} {
  const query = useQuery({
    queryKey: boardId !== undefined ? boardKey(boardId) : ['gsd', 'board', 'none'],
    queryFn: () => boardFetch(`/boards/${boardId as string}`, boardSchema),
    enabled: boardId !== undefined,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
  return { board: query.data, isPending: query.isPending, isError: query.isError }
}

function invalidateBoard(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: ['gsd', 'board'] })
}

export interface NewCardInput {
  title: string
  description?: string
  listPublicId: string
  priority?: string | null
  dueDate?: string | null
  labelPublicIds?: string[]
  position?: 'start' | 'end'
}

export function useBoardMutations(): {
  createCard: (input: NewCardInput) => void
  updateCard: (
    cardPublicId: string,
    patch: { title?: string; description?: string; priority?: string | null; dueDate?: string | null },
  ) => void
  moveCard: (cardPublicId: string, listPublicId: string, index: number) => void
  createCardFull: (input: NewCardInput) => void
  deleteCard: (cardPublicId: string) => void
  createList: (boardPublicId: string, name: string) => void
  updateList: (listPublicId: string, name: string) => void
  deleteList: (listPublicId: string) => void
} {
  const queryClient = useQueryClient()
  const onSettled = (): void => invalidateBoard(queryClient)

  const createCard = useMutation({
    mutationFn: (input: NewCardInput) =>
      boardFetch('/cards', createdSchema, {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          description: input.description ?? '',
          listPublicId: input.listPublicId,
          labelPublicIds: input.labelPublicIds ?? [],
          memberPublicIds: [],
          position: input.position ?? 'end',
          ...(input.priority != null ? { priority: input.priority } : {}),
          ...(input.dueDate != null ? { dueDate: input.dueDate } : {}),
        }),
      }),
    onSettled,
  })
  const updateCard = useMutation({
    mutationFn: (input: { cardPublicId: string; patch: Record<string, unknown> }) =>
      boardFetch(`/cards/${input.cardPublicId}`, z.unknown(), {
        method: 'PUT',
        body: JSON.stringify(input.patch),
      }),
    onSettled,
  })
  const deleteCard = useMutation({
    mutationFn: (cardPublicId: string) =>
      boardFetch(`/cards/${cardPublicId}`, z.unknown(), { method: 'DELETE' }),
    onSettled,
  })
  const createList = useMutation({
    mutationFn: (input: { boardPublicId: string; name: string }) =>
      boardFetch('/lists', createdSchema, {
        method: 'POST',
        body: JSON.stringify({ name: input.name, boardPublicId: input.boardPublicId }),
      }),
    onSettled,
  })
  const updateList = useMutation({
    mutationFn: (input: { listPublicId: string; name: string }) =>
      boardFetch(`/lists/${input.listPublicId}`, z.unknown(), {
        method: 'PUT',
        body: JSON.stringify({ name: input.name }),
      }),
    onSettled,
  })
  const deleteList = useMutation({
    mutationFn: (listPublicId: string) =>
      boardFetch(`/lists/${listPublicId}`, z.unknown(), { method: 'DELETE' }),
    onSettled,
  })

  return {
    createCard: (input) => createCard.mutate(input),
    updateCard: (cardPublicId, patch) => updateCard.mutate({ cardPublicId, patch }),
    moveCard: (cardPublicId, listPublicId, index) =>
      updateCard.mutate({ cardPublicId, patch: { listPublicId, index } }),
    createCardFull: (input) => createCard.mutate(input),
    deleteCard: (cardPublicId) => deleteCard.mutate(cardPublicId),
    createList: (boardPublicId, name) => createList.mutate({ boardPublicId, name }),
    updateList: (listPublicId, name) => updateList.mutate({ listPublicId, name }),
    deleteList: (listPublicId) => deleteList.mutate(listPublicId),
  }
}
