import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { HiOutlinePlusSmall } from 'react-icons/hi2'
import Card, { type CardPriority } from './Card'
import List from './List'
import { LabelEditor } from './LabelEditor'
import { useBoard, useBoardId, useBoardMutations, type BoardCard, type BoardList } from './board-api'

const priorityCycle = [null, 'urgent', 'high', 'medium', 'low'] as const
function getNextPriority(priority: string | null | undefined): string | null {
  const currentIndex = priorityCycle.indexOf((priority ?? null) as (typeof priorityCycle)[number])
  return priorityCycle[(currentIndex + 1) % priorityCycle.length] ?? null
}

/** Shortcuts are suppressed while typing in a field or with a modal open. */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return Boolean(
    target.closest('input, textarea, select, a, [contenteditable="true"], [role="dialog"]'),
  )
}

/** Map an API card to the ported Card component's props. */
function cardProps(card: BoardCard): Parameters<typeof Card>[0] {
  return {
    title: card.title,
    ticketNumber: card.cardNumber != null ? `#${card.cardNumber}` : null,
    labels: card.labels.map((l) => ({ publicId: l.publicId, name: l.name, colourCode: l.colourCode })),
    members: card.members.map((m) => ({ publicId: m.publicId, email: m.email, user: m.user })),
    checklists: card.checklists,
    description: card.description,
    comments: card.comments,
    attachments: card.attachments,
    dueDate: card.dueDate ? new Date(card.dueDate) : null,
    priority: (card.priority ?? null) as CardPriority | null,
    isSelected: false,
    canEdit: true,
    onSelect: () => {},
    onUpdate: () => {},
  }
}

/**
 * The GSD board, ported from Kan's views/board/index.tsx into Reflect: a
 * horizontal row of List columns of Cards, backed by the board API through the
 * server proxy, with dnd-kit drag (Kan uses react-beautiful-dnd). Kan's Card
 * and List JSX are verbatim, so this renders pixel-for-pixel.
 */
export function Board({ onOpenCard }: { onOpenCard: (cardPublicId: string) => void }): ReactElement {
  const boardId = useBoardId()
  const { board, isPending, isError } = useBoard(boardId)
  const mutations = useBoardMutations()

  const [columns, setColumns] = useState<BoardList[]>([])
  const draggingRef = useRef(false)
  useEffect(() => {
    if (board !== undefined && !draggingRef.current) {
      setColumns(board.lists)
    }
  }, [board])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // The card the keyboard shortcuts act on: keyboard selection, else hover.
  const activeSelectionId = selectedId ?? hoverId

  const findPos = useCallback(
    (cardId: string | null): { li: number; ci: number } | null => {
      if (cardId === null) return null
      for (let li = 0; li < columns.length; li += 1) {
        const ci = (columns[li]?.cards ?? []).findIndex((c) => c.publicId === cardId)
        if (ci >= 0) return { li, ci }
      }
      return null
    },
    [columns],
  )

  const moveSelection = useCallback(
    (direction: 'up' | 'down' | 'left' | 'right') => {
      const pos = findPos(activeSelectionId) ?? { li: 0, ci: -1 }
      let { li, ci } = pos
      if (direction === 'up') ci = Math.max(0, ci - 1)
      else if (direction === 'down') ci = Math.min((columns[li]?.cards.length ?? 1) - 1, ci + 1)
      else if (direction === 'left') {
        li = Math.max(0, li - 1)
        ci = Math.min(ci < 0 ? 0 : ci, (columns[li]?.cards.length ?? 1) - 1)
      } else {
        li = Math.min(columns.length - 1, li + 1)
        ci = Math.min(ci < 0 ? 0 : ci, (columns[li]?.cards.length ?? 1) - 1)
      }
      const next = columns[li]?.cards[Math.max(0, ci)]
      if (next !== undefined) {
        setSelectedId(next.publicId)
        setHoverId(next.publicId)
      }
    },
    [activeSelectionId, columns, findPos],
  )

  const cardsById = useMemo(() => {
    const map = new Map<string, BoardCard>()
    for (const list of columns) for (const card of list.cards) map.set(card.publicId, card)
    return map
  }, [columns])

  const listOf = useCallback(
    (cardId: string) => columns.find((l) => l.cards.some((c) => c.publicId === cardId))?.publicId,
    [columns],
  )

  const [labelCardId, setLabelCardId] = useState<string | null>(null)

  // Kan's board keymap, ported verbatim: c new card · arrows navigate · Tab
  // move across lists · Enter open · l labels · p cycle priority · e to Done ·
  // Delete/Backspace remove.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (labelCardId !== null || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()

      if (key === 'c') {
        event.preventDefault()
        const firstList = columns[0]
        if (firstList !== undefined) mutations.createCard({ title: 'New card', listPublicId: firstList.publicId })
        return
      }
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault()
        moveSelection(
          event.key === 'ArrowUp'
            ? 'up'
            : event.key === 'ArrowDown'
              ? 'down'
              : event.key === 'ArrowLeft'
                ? 'left'
                : 'right',
        )
        return
      }
      const card = activeSelectionId === null ? undefined : cardsById.get(activeSelectionId)
      if (card === undefined) return

      if (event.key === 'Tab') {
        event.preventDefault()
        const pos = findPos(card.publicId)
        if (pos !== null) {
          const targetList = columns[pos.li + (event.shiftKey ? -1 : 1)]
          if (targetList !== undefined) mutations.moveCard(card.publicId, targetList.publicId, targetList.cards.length)
        }
        return
      }
      if (event.key === 'Enter') {
        event.preventDefault()
        onOpenCard(card.publicId)
        return
      }
      if (key === 'l') {
        event.preventDefault()
        setLabelCardId(card.publicId)
        return
      }
      if (key === 'p') {
        event.preventDefault()
        mutations.updateCard(card.publicId, { priority: getNextPriority(card.priority) })
        return
      }
      if (key === 'e') {
        event.preventDefault()
        const done = columns.find((l) => l.name.toLowerCase() === 'done') ?? columns[columns.length - 1]
        if (done !== undefined) mutations.moveCard(card.publicId, done.publicId, done.cards.length)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        mutations.deleteCard(card.publicId)
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [activeSelectionId, cardsById, columns, findPos, labelCardId, moveSelection, mutations, onOpenCard])

  const onDragStart = useCallback((event: DragStartEvent) => {
    draggingRef.current = true
    setActiveId(String(event.active.id))
  }, [])

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const active = String(event.active.id)
      if (event.over === null) return
      const overId = String(event.over.id)
      const from = listOf(active)
      const to = listOf(overId) ?? columns.find((l) => l.publicId === overId)?.publicId
      if (from === undefined || to === undefined || from === to) return
      setColumns((prev) => {
        const card = prev.find((l) => l.publicId === from)?.cards.find((c) => c.publicId === active)
        if (card === undefined) return prev
        return prev.map((list) => {
          if (list.publicId === from) {
            return { ...list, cards: list.cards.filter((c) => c.publicId !== active) }
          }
          if (list.publicId === to) {
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
      if (event.over === null) return
      const overId = String(event.over.id)
      const targetList = listOf(cardId)
      if (targetList === undefined) return
      const target = columns.find((l) => l.publicId === targetList)
      if (target === undefined) return
      const overIndex = target.cards.findIndex((c) => c.publicId === overId)
      const index = overIndex >= 0 ? overIndex : Math.max(target.cards.findIndex((c) => c.publicId === cardId), 0)
      mutations.moveCard(cardId, targetList, index)
    },
    [columns, listOf, mutations],
  )

  if (isError) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-light-900 dark:text-dark-900">
        Couldn’t reach your board.
      </div>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        draggingRef.current = false
        setActiveId(null)
        if (board !== undefined) setColumns(board.lists)
      }}
    >
      <div className="flex h-full min-h-0 snap-x snap-mandatory overflow-x-auto p-4 md:p-6">
        {isPending && columns.length === 0 ? (
          <div className="text-sm text-light-900 dark:text-dark-900">Loading board…</div>
        ) : (
          columns.map((list) => (
            <List
              key={list.publicId}
              list={{ publicId: list.publicId, name: list.name }}
              cardCount={list.cards.length}
              onAddCard={(listId) => mutations.createCard({ title: 'New card', listPublicId: listId })}
              onRename={(listId, name) => mutations.updateList(listId, name)}
              onDelete={(listId) => mutations.deleteList(listId)}
            >
              <SortableContext
                items={list.cards.map((c) => c.publicId)}
                strategy={verticalListSortingStrategy}
              >
                {list.cards.map((card) => (
                  <SortableCard
                    key={card.publicId}
                    card={card}
                    isSelected={activeSelectionId === card.publicId}
                    onSelect={() => {
                      setHoverId(card.publicId)
                      setSelectedId(card.publicId)
                    }}
                    onOpen={() => onOpenCard(card.publicId)}
                    onUpdate={(patch) => mutations.updateCard(card.publicId, patch)}
                  />
                ))}
              </SortableContext>
            </List>
          ))
        )}
        {board !== undefined && boardId !== undefined ? (
          <button
            type="button"
            onClick={() => mutations.createList(boardId, 'New list')}
            className="mr-3 flex h-10 min-w-[18rem] max-w-[18rem] items-center gap-1 rounded-md border border-dashed border-light-500 px-3 text-sm text-light-900 hover:bg-light-200 dark:border-dark-400 dark:text-dark-900 dark:hover:bg-dark-200"
          >
            <HiOutlinePlusSmall className="h-5 w-5" />
            Add list
          </button>
        ) : null}
      </div>
      <DragOverlay dropAnimation={null}>
        {activeId !== null && cardsById.has(activeId) ? (
          <Card {...cardProps(cardsById.get(activeId) as BoardCard)} isSelected />
        ) : null}
      </DragOverlay>
      {labelCardId !== null && boardId !== undefined ? (
        <LabelEditor
          cardPublicId={labelCardId}
          boardPublicId={boardId}
          boardLabels={board?.labels ?? []}
          onClose={() => setLabelCardId(null)}
        />
      ) : null}
    </DndContext>
  )
}

function SortableCard({
  card,
  isSelected,
  onSelect,
  onOpen,
  onUpdate,
}: {
  card: BoardCard
  isSelected: boolean
  onSelect: () => void
  onOpen: () => void
  onUpdate: (patch: { title?: string; description?: string; priority?: string | null }) => void
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
      onClick={onOpen}
      className={isDragging ? 'opacity-40' : ''}
    >
      <Card
        {...cardProps(card)}
        isSelected={isSelected}
        onSelect={onSelect}
        onUpdate={onUpdate}
      />
    </div>
  )
}
