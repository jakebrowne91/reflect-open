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
import { NewCardModal } from './NewCardModal'
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
  const [newCardListId, setNewCardListId] = useState<string | null>(null)

  // Kan's board keymap, ported verbatim: c new card · arrows navigate · Tab
  // move across lists · Enter open · l labels · p cycle priority · e to Done ·
  // Delete/Backspace remove. Registered in the CAPTURE phase and stopping
  // propagation for the keys it owns, so Reflect's own Tasks keyboard handler
  // (a document listener that would otherwise swallow arrows/etc. in board
  // view) never sees them.
  useEffect(() => {
    const arrows = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']
    const singleKeys = ['c', 'l', 'p', 'e']
    const cardKeys = ['Tab', 'Enter', 'Delete', 'Backspace']
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (labelCardId !== null || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const handled =
        arrows.includes(event.key) || cardKeys.includes(event.key) || singleKeys.includes(key)
      if (!handled) return
      event.preventDefault()
      event.stopImmediatePropagation()

      if (key === 'c') {
        const firstList = columns[0]
        if (firstList !== undefined) setNewCardListId(firstList.publicId)
        return
      }
      if (arrows.includes(event.key)) {
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
        const pos = findPos(card.publicId)
        if (pos !== null) {
          const targetList = columns[pos.li + (event.shiftKey ? -1 : 1)]
          if (targetList !== undefined)
            mutations.moveCard(card.publicId, targetList.publicId, targetList.cards.length)
        }
        return
      }
      if (event.key === 'Enter') {
        onOpenCard(card.publicId)
        return
      }
      if (key === 'l') {
        setLabelCardId(card.publicId)
        return
      }
      if (key === 'p') {
        mutations.updateCard(card.publicId, { priority: getNextPriority(card.priority) })
        return
      }
      if (key === 'e') {
        const done =
          columns.find((l) => l.name.toLowerCase() === 'done') ?? columns[columns.length - 1]
        if (done !== undefined) mutations.moveCard(card.publicId, done.publicId, done.cards.length)
        return
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        mutations.deleteCard(card.publicId)
        setSelectedId(null)
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
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
    <div className="relative h-full min-h-0">
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
              onAddCard={(listId) => setNewCardListId(listId)}
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
                    onLabels={() => setLabelCardId(card.publicId)}
                    onDelete={() => mutations.deleteCard(card.publicId)}
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
            className="mr-3 flex h-10 min-w-[18rem] max-w-[18rem] items-center gap-1 rounded-md border border-dashed border-light-500 px-3 text-sm text-light-900 transition-[background-color,transform] duration-150 ease-out-strong hover:bg-light-200 active:scale-[0.99] dark:border-dark-400 dark:text-dark-900 dark:hover:bg-dark-200"
          >
            <HiOutlinePlusSmall className="h-5 w-5" />
            Add list
          </button>
        ) : null}
      </div>
      <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-light-400 bg-light-50/90 px-3 py-1 text-[11px] text-light-800 shadow-sm dark:border-dark-400 dark:bg-dark-100/90 dark:text-dark-800">
        hover a card · <b>C</b> new · <b>↑↓←→</b> move · <b>Tab</b> list · <b>P</b> priority ·{' '}
        <b>L</b> labels · <b>E</b> done · <b>⌫</b> delete
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
      {newCardListId !== null && boardId !== undefined ? (
        <NewCardModal
          lists={columns}
          defaultListPublicId={newCardListId}
          boardLabels={board?.labels ?? []}
          onClose={() => setNewCardListId(null)}
        />
      ) : null}
    </DndContext>
    </div>
  )
}

const PRIORITY_LABELS: { value: CardPriority | null; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: null, label: 'No priority' },
]

function SortableCard({
  card,
  isSelected,
  onSelect,
  onOpen,
  onUpdate,
  onLabels,
  onDelete,
}: {
  card: BoardCard
  isSelected: boolean
  onSelect: () => void
  onOpen: () => void
  onUpdate: (patch: { title?: string; description?: string; priority?: string | null }) => void
  onLabels: () => void
  onDelete: () => void
}): ReactElement {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: card.publicId,
  })
  const [menuOpen, setMenuOpen] = useState(false)
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onMouseEnter={onSelect}
      className={`group relative ${isDragging ? 'opacity-40' : ''}`}
    >
      {/* The card body carries the drag listeners and opens the detail. */}
      <div {...attributes} {...listeners} onClick={onOpen}>
        <Card {...cardProps(card)} isSelected={isSelected} onSelect={onSelect} onUpdate={onUpdate} />
      </div>
      {/* Clickable menu: priority, labels, delete — no keyboard needed. */}
      <div className="absolute right-1 top-1" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          aria-label="Card menu"
          onClick={(e) => {
            e.stopPropagation()
            setMenuOpen((v) => !v)
          }}
          className="rounded p-0.5 text-light-800 opacity-0 transition-opacity duration-150 hover:bg-light-200 group-hover:opacity-100 dark:text-dark-800 dark:hover:bg-dark-300"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M6 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM11.5 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0zM17 10a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
          </svg>
        </button>
        {menuOpen ? (
          <>
            <button
              type="button"
              aria-label="Close menu"
              className="fixed inset-0 z-[90] cursor-default"
              onClick={(e) => {
                e.stopPropagation()
                setMenuOpen(false)
              }}
            />
            <div className="absolute right-0 z-[100] mt-1 w-44 origin-top-right rounded-md border border-light-200 bg-white p-1 shadow-lg duration-150 animate-in fade-in zoom-in-95 ease-out-strong dark:border-dark-400 dark:bg-dark-300">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-light-800 dark:text-dark-800">
                Priority
              </div>
              {PRIORITY_LABELS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onUpdate({ priority: p.value })
                    setMenuOpen(false)
                  }}
                  className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-950 dark:hover:bg-dark-400"
                >
                  {p.label}
                  {(card.priority ?? null) === p.value ? <span className="ml-auto">✓</span> : null}
                </button>
              ))}
              <div className="my-1 border-t border-light-200 dark:border-dark-400" />
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onLabels()
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-950 dark:hover:bg-dark-400"
              >
                Add / edit labels
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                  setMenuOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded px-2.5 py-1.5 text-left text-sm text-red-600 hover:bg-light-200 dark:text-red-400 dark:hover:bg-dark-400"
              >
                Delete card
              </button>
            </div>
          </>
        ) : null}
      </div>
    </div>
  )
}
