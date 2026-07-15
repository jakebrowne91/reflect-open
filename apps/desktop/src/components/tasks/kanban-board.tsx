import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ExternalLink, Plus } from 'lucide-react'
import {
  createCard,
  createList,
  fetchBoard,
  moveCard,
  resolveBoardId,
  type BoardCard,
  type BoardList,
} from '@/lib/board/board-api'
import { cn } from '@/lib/utils'

const BOARD_ID_KEY = ['board', 'id']
const boardDetailKey = (id: string): [string, string, string] => ['board', 'detail', id]

/**
 * The native GSD board: Kan's board, rebuilt with Reflect's design system and
 * @dnd-kit, reading and writing the same Kan data through the server proxy.
 * No iframe, no second login — the Reflect session authorizes every call.
 */
export function KanbanBoard({
  gsdUrl,
  onOpenCard,
}: {
  gsdUrl: string
  onOpenCard: (cardPublicId: string) => void
}): ReactElement {
  const queryClient = useQueryClient()

  const { data: boardId } = useQuery({
    queryKey: BOARD_ID_KEY,
    queryFn: resolveBoardId,
    staleTime: Infinity,
  })

  const {
    data: board,
    isError,
    isPending,
  } = useQuery({
    queryKey: boardId !== undefined ? boardDetailKey(boardId) : ['board', 'detail', 'none'],
    queryFn: () => fetchBoard(boardId as string),
    enabled: boardId !== undefined,
    // Override the app-wide staleTime: Infinity default — the board is remote
    // live data, not an invalidation-driven index read, so it must refetch on
    // mount and window focus rather than sit on a cached snapshot.
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })

  // A local, drag-mutable copy of the columns; the server data reseeds it
  // whenever it changes and no drag is in flight.
  const [columns, setColumns] = useState<BoardList[]>([])
  const draggingRef = useRef(false)
  useEffect(() => {
    if (board !== undefined && !draggingRef.current) {
      setColumns(board.lists)
    }
  }, [board])

  const cardsById = useMemo(() => {
    const map = new Map<string, BoardCard>()
    for (const list of columns) {
      for (const card of list.cards) {
        map.set(card.publicId, card)
      }
    }
    return map
  }, [columns])

  const [activeId, setActiveId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const listOf = useCallback(
    (cardId: string): string | undefined =>
      columns.find((list) => list.cards.some((card) => card.publicId === cardId))?.publicId,
    [columns],
  )

  const move = useMutation({
    mutationFn: ({ cardId, listId, index }: { cardId: string; listId: string; index: number }) =>
      moveCard(cardId, listId, index),
    onSettled: () => {
      if (boardId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: boardDetailKey(boardId) })
      }
    },
  })

  const onDragStart = useCallback((event: DragStartEvent) => {
    draggingRef.current = true
    setActiveId(String(event.active.id))
  }, [])

  // Cross-column feedback while dragging: relocate the card into the column
  // it's hovering so the drop preview reads true.
  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const activeCard = String(event.active.id)
      const over = event.over
      if (over === null) {
        return
      }
      const overId = String(over.id)
      const sourceList = listOf(activeCard)
      // The droppable is either a card or a column container id.
      const targetList = listOf(overId) ?? columns.find((l) => l.publicId === overId)?.publicId
      if (sourceList === undefined || targetList === undefined || sourceList === targetList) {
        return
      }
      setColumns((prev) => {
        const card = prev
          .find((l) => l.publicId === sourceList)
          ?.cards.find((c) => c.publicId === activeCard)
        if (card === undefined) {
          return prev
        }
        return prev.map((list) => {
          if (list.publicId === sourceList) {
            return { ...list, cards: list.cards.filter((c) => c.publicId !== activeCard) }
          }
          if (list.publicId === targetList) {
            const overIndex = list.cards.findIndex((c) => c.publicId === overId)
            const at = overIndex >= 0 ? overIndex : list.cards.length
            const next = [...list.cards]
            next.splice(at, 0, card)
            return { ...list, cards: next }
          }
          return list
        })
      })
    },
    [columns, listOf],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      draggingRef.current = false
      const cardId = String(event.active.id)
      setActiveId(null)
      const overId = event.over === null ? null : String(event.over.id)
      if (overId === null) {
        return
      }
      // onDragOver has already relocated the card across columns, so its final
      // home is whichever column it now sits in; the drop target only decides
      // its order within that column.
      const targetList = listOf(cardId)
      if (targetList === undefined) {
        return
      }
      const target = columns.find((list) => list.publicId === targetList)
      if (target === undefined) {
        return
      }
      const currentIndex = target.cards.findIndex((card) => card.publicId === cardId)
      const overIndex = target.cards.findIndex((card) => card.publicId === overId)
      // Compute the final index explicitly (never inside a setState updater —
      // those run during render, after this handler, so the mutation would
      // otherwise send a stale index).
      const finalIndex = overIndex >= 0 ? overIndex : Math.max(currentIndex, 0)
      if (currentIndex >= 0 && overIndex >= 0 && currentIndex !== overIndex) {
        setColumns((prev) =>
          prev.map((list) =>
            list.publicId === targetList
              ? { ...list, cards: arrayMove(list.cards, currentIndex, overIndex) }
              : list,
          ),
        )
      }
      move.mutate({ cardId, listId: targetList, index: finalIndex })
    },
    [columns, listOf, move],
  )

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="text-sm text-text-secondary">Couldn’t reach your board.</p>
        <a
          href={gsdUrl}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--accent)] px-3 py-2 text-sm font-medium text-[color:var(--text-on-brand)]"
        >
          <ExternalLink aria-hidden className="size-4" />
          Open GSD directly
        </a>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 py-1.5 lg:px-10">
        <span className="text-xs text-text-muted">
          {isPending ? 'Loading board…' : `${board?.name ?? 'Board'} — synced with your notes`}
        </span>
        <a
          href={gsdUrl}
          target="_blank"
          rel="noreferrer"
          className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-text-muted hover:text-text"
        >
          <ExternalLink aria-hidden className="size-3.5" />
          Open in GSD
        </a>
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          draggingRef.current = false
          setActiveId(null)
          if (board !== undefined) {
            setColumns(board.lists)
          }
        }}
      >
        <div className="flex h-full min-h-0 gap-3 overflow-x-auto px-4 py-4 lg:px-10">
          {columns.map((list) => (
            <Column
              key={list.publicId}
              list={list}
              boardId={boardId}
              onOpenCard={onOpenCard}
            />
          ))}
          {board !== undefined && boardId !== undefined ? (
            <NewListButton boardId={boardId} />
          ) : null}
        </div>
        <DragOverlay dropAnimation={null}>
          {activeId !== null && cardsById.has(activeId) ? (
            <CardView card={cardsById.get(activeId) as BoardCard} overlay />
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}

function Column({
  list,
  boardId,
  onOpenCard,
}: {
  list: BoardList
  boardId: string | undefined
  onOpenCard: (id: string) => void
}): ReactElement {
  const queryClient = useQueryClient()
  const { setNodeRef, isOver } = useSortableColumn(list.publicId)
  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')

  const add = useMutation({
    mutationFn: () => createCard({ title: title.trim(), listPublicId: list.publicId }),
    onSuccess: () => {
      setTitle('')
      setAdding(false)
      if (boardId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: boardDetailKey(boardId) })
      }
    },
  })

  return (
    <section
      ref={setNodeRef}
      aria-label={`${list.name} column`}
      className={cn(
        'flex max-h-full w-72 flex-none flex-col rounded-xl bg-[color:var(--surface-sunken)]',
        isOver && 'ring-2 ring-[color:var(--focus-ring)]',
      )}
    >
      <header className="flex flex-none items-center gap-2 px-3 pb-1 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {list.name}
        </h3>
        <span className="rounded-full bg-[color:var(--surface-hover)] px-1.5 text-[11px] tabular-nums text-text-muted">
          {list.cards.length}
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        <SortableContext
          items={list.cards.map((card) => card.publicId)}
          strategy={verticalListSortingStrategy}
        >
          {list.cards.map((card) => (
            <SortableCard key={card.publicId} card={card} onOpen={onOpenCard} />
          ))}
        </SortableContext>
        {adding ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (title.trim() !== '') {
                add.mutate()
              }
            }}
          >
            <textarea
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              onBlur={() => title.trim() === '' && setAdding(false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  if (title.trim() !== '') {
                    add.mutate()
                  }
                } else if (event.key === 'Escape') {
                  setAdding(false)
                  setTitle('')
                }
              }}
              placeholder="Card title…"
              rows={2}
              className="w-full resize-none rounded-lg border border-border bg-[color:var(--surface)] p-2 text-sm text-text outline-none focus:border-[color:var(--focus-ring)]"
            />
          </form>
        ) : null}
      </div>
      {!adding ? (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="flex flex-none items-center gap-1 px-3 pb-3 pt-1 text-xs text-text-muted hover:text-text"
        >
          <Plus aria-hidden className="size-3.5" />
          Add card
        </button>
      ) : null}
    </section>
  )
}

/** A column drop target: cards land on the list even when it's empty. */
function useSortableColumn(id: string): {
  setNodeRef: (el: HTMLElement | null) => void
  isOver: boolean
} {
  const { setNodeRef, isOver } = useDroppable({ id, data: { column: true } })
  return { setNodeRef, isOver }
}

function SortableCard({
  card,
  onOpen,
}: {
  card: BoardCard
  onOpen: (id: string) => void
}): ReactElement {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.publicId,
  })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(card.publicId)}
      className={cn(isDragging && 'opacity-40')}
    >
      <CardView card={card} />
    </div>
  )
}

function CardView({ card, overlay = false }: { card: BoardCard; overlay?: boolean }): ReactElement {
  const checklistItems = card.checklists.flatMap((cl) => cl.items)
  const doneItems = checklistItems.filter((item) => item.completed).length
  return (
    <article
      className={cn(
        'cursor-grab rounded-lg border border-border bg-[color:var(--surface)] p-3 shadow-[var(--shadow-sm)]',
        'hover:border-[color:var(--border-strong)]',
        overlay && 'rotate-2 shadow-[var(--shadow-pop)]',
      )}
    >
      {card.labels.length > 0 ? (
        <div className="mb-1.5 flex flex-wrap gap-1">
          {card.labels.map((label) => (
            <span
              key={label.publicId}
              className="rounded px-1.5 py-px text-[10px] font-medium"
              style={{
                backgroundColor: `${label.colourCode ?? '#7aa2f7'}22`,
                color: label.colourCode ?? 'var(--accent-soft-text)',
              }}
            >
              {label.name}
            </span>
          ))}
        </div>
      ) : null}
      <p className="text-sm leading-snug text-text">{card.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
        {card.cardNumber !== null && card.cardNumber !== undefined ? (
          <span className="tabular-nums opacity-70">#{card.cardNumber}</span>
        ) : null}
        {card.dueDate !== null && card.dueDate !== undefined ? (
          <span>{card.dueDate.slice(0, 10)}</span>
        ) : null}
        {checklistItems.length > 0 ? (
          <span>
            ☑ {doneItems}/{checklistItems.length}
          </span>
        ) : null}
        {card.comments.length > 0 ? <span>💬 {card.comments.length}</span> : null}
        {card.attachments.length > 0 ? <span>📎 {card.attachments.length}</span> : null}
      </div>
    </article>
  )
}

function NewListButton({ boardId }: { boardId: string }): ReactElement {
  const queryClient = useQueryClient()
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const add = useMutation({
    mutationFn: () => createList(boardId, name.trim()),
    onSuccess: () => {
      setName('')
      setAdding(false)
      void queryClient.invalidateQueries({ queryKey: boardDetailKey(boardId) })
    },
  })
  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="flex h-9 w-72 flex-none items-center gap-1 rounded-xl bg-[color:var(--surface-hover)] px-3 text-xs text-text-muted hover:text-text"
      >
        <Plus aria-hidden className="size-3.5" />
        Add list
      </button>
    )
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (name.trim() !== '') {
          add.mutate()
        }
      }}
      className="w-72 flex-none"
    >
      <input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => name.trim() === '' && setAdding(false)}
        placeholder="List name…"
        className="w-full rounded-xl border border-border bg-[color:var(--surface)] px-3 py-2 text-sm text-text outline-none focus:border-[color:var(--focus-ring)]"
      />
    </form>
  )
}
