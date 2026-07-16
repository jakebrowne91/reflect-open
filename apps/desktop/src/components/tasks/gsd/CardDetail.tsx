import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { HiArrowLeft, HiOutlinePaperClip, HiXMark } from 'react-icons/hi2'
import { LabelEditor } from './LabelEditor'
import LabelIcon from './LabelIcon'
import {
  useBoard,
  useBoardId,
  useCard,
  useCardActivities,
  useCardMutations,
  type BoardCard,
} from './board-api'

const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/**
 * The GSD card detail, ported to match Kan's layout: a two-panel view over the
 * board — the main column (breadcrumb, title, description, activity, comments)
 * and a right metadata sidebar (list, labels, members, due date, priority).
 * Wired to the board API; Members and the CCC-only Project/Agent rows render to
 * match but stay inert on a personal instance.
 */
export function CardDetail({
  cardPublicId,
  onClose,
}: {
  cardPublicId: string
  onClose: () => void
}): ReactElement {
  const { card, isPending } = useCard(cardPublicId)
  const boardId = useBoardId()
  const { board } = useBoard(boardId)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const currentList = useMemo(
    () => board?.lists.find((l) => l.cards.some((c) => c.publicId === cardPublicId)),
    [board, cardPublicId],
  )

  return (
    <div
      className="absolute inset-0 z-50 flex flex-col bg-light-50 duration-200 animate-in fade-in slide-in-from-bottom-2 ease-out-strong dark:bg-dark-100"
      role="dialog"
    >
      <div className="flex flex-none items-center gap-2 border-b border-light-300 px-4 py-3 text-sm dark:border-dark-300">
        <button
          type="button"
          onClick={onClose}
          aria-label="Back to board"
          className="rounded-md p-1 text-light-800 transition-[background-color,transform] duration-150 hover:bg-light-200 active:scale-90 dark:text-dark-800 dark:hover:bg-dark-200"
        >
          <HiArrowLeft size={16} />
        </button>
        <button
          type="button"
          onClick={onClose}
          className="text-light-800 transition-colors hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000"
        >
          {board?.name ?? 'Board'}
        </button>
        <span className="text-light-600 dark:text-dark-600">›</span>
        <button
          type="button"
          onClick={onClose}
          className="text-light-800 transition-colors hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000"
        >
          {currentList?.name ?? ''}
        </button>
        <span className="text-light-600 dark:text-dark-600">›</span>
        <span className="font-medium text-light-1000 dark:text-dark-1000">
          {card?.cardNumber != null ? `#${card.cardNumber}` : 'Card'}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="ml-auto rounded-md p-1 text-light-800 transition-[background-color,transform] duration-150 hover:bg-light-200 active:scale-90 dark:text-dark-800 dark:hover:bg-dark-200"
        >
          <HiXMark size={18} />
        </button>
      </div>
      {isPending || card === undefined ? (
        <div className="p-8 text-sm text-light-900 dark:text-dark-900">Loading…</div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <CardMain card={card} cardPublicId={cardPublicId} />
          <CardSidebar card={card} cardPublicId={cardPublicId} listName={currentList?.name ?? '—'} />
        </div>
      )}
    </div>
  )
}

function CardMain({ card, cardPublicId }: { card: BoardCard; cardPublicId: string }): ReactElement {
  const m = useCardMutations(cardPublicId)
  const activities = useCardActivities(cardPublicId)
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [comment, setComment] = useState('')
  const [newChecklist, setNewChecklist] = useState('')
  const [newItem, setNewItem] = useState<Record<string, string>>({})

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => title.trim() && title !== card.title && m.update({ title: title.trim() })}
        className="w-full rounded-md border border-transparent bg-transparent text-xl font-bold text-light-1000 outline-none focus:border-light-400 dark:text-dark-1000 dark:focus:border-dark-400"
      />

      <textarea
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        onBlur={() => description !== (card.description ?? '') && m.update({ description })}
        rows={3}
        placeholder="Add description… (type '/' to open commands or '@' to mention)"
        className="mt-4 w-full resize-none rounded-md border border-transparent bg-transparent text-sm text-light-1000 outline-none placeholder:text-light-800 focus:border-light-400 dark:text-dark-1000 dark:placeholder:text-dark-800 dark:focus:border-dark-400"
      />

      <div className="mt-2 flex items-center justify-between text-light-800 dark:text-dark-800">
        <span className="rounded-full p-1 ring-1 ring-light-400 dark:ring-dark-400">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path
              fillRule="evenodd"
              d="M16.7 5.3a1 1 0 010 1.4l-8 8a1 1 0 01-1.4 0l-4-4a1 1 0 011.4-1.4L8 12.6l7.3-7.3a1 1 0 011.4 0z"
              clipRule="evenodd"
            />
          </svg>
        </span>
        <HiOutlinePaperClip className="h-4 w-4" />
      </div>

      <div className="mt-5">
        {card.checklists.map((checklist) => {
            const done = checklist.items.filter((it) => it.completed).length
            return (
              <div key={checklist.publicId} className="mb-4">
                <div className="mb-1 flex items-center justify-between text-sm font-medium text-light-1000 dark:text-dark-1000">
                  <span>{checklist.name}</span>
                  <span className="text-[11px] text-light-800 dark:text-dark-800">
                    {done}/{checklist.items.length}
                  </span>
                </div>
                <ul className="ml-1 flex flex-col gap-1">
                  {checklist.items.map((item) => (
                    <li key={item.publicId} className="flex items-center gap-2 text-sm text-light-1000 dark:text-dark-1000">
                      <input
                        type="checkbox"
                        checked={item.completed}
                        onChange={(event) => m.toggleChecklistItem(item.publicId, event.target.checked)}
                      />
                      <span className={item.completed ? 'text-light-800 line-through dark:text-dark-800' : ''}>
                        {item.title}
                      </span>
                    </li>
                  ))}
                </ul>
                <input
                  value={newItem[checklist.publicId] ?? ''}
                  onChange={(event) =>
                    setNewItem((prev) => ({ ...prev, [checklist.publicId]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    const value = (newItem[checklist.publicId] ?? '').trim()
                    if (event.key === 'Enter' && value) {
                      m.addChecklistItem(checklist.publicId, value)
                      setNewItem((prev) => ({ ...prev, [checklist.publicId]: '' }))
                    }
                  }}
                  placeholder="Add item…"
                  className="ml-1 mt-1 w-full rounded-md border border-light-400 bg-light-50 px-2 py-1 text-sm text-light-1000 outline-none focus:border-light-700 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000"
                />
              </div>
            )
          })}
          <input
            value={newChecklist}
            onChange={(event) => setNewChecklist(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && newChecklist.trim()) {
                m.addChecklist(newChecklist.trim())
                setNewChecklist('')
              }
            }}
            placeholder="+ Add checklist"
            className="w-full rounded-md border border-dashed border-light-400 bg-transparent px-2 py-1 text-sm text-light-800 outline-none focus:border-light-700 dark:border-dark-400 dark:text-dark-800"
          />
      </div>

      <hr className="my-5 border-light-300 dark:border-dark-300" />

      <h3 className="mb-3 text-base font-medium text-light-1000 dark:text-dark-1000">Activity</h3>
      <div className="flex flex-col gap-3">
        {activities.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-light-800 dark:text-dark-800">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-light-200 text-xs dark:bg-dark-300">
              +
            </span>
            Card created
          </div>
        ) : (
          activities.map((a) => (
            <div key={a.publicId} className="flex items-center gap-2 text-sm text-light-900 dark:text-dark-900">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-light-200 text-xs dark:bg-dark-300">
                +
              </span>
              <span className="font-medium text-light-1000 dark:text-dark-1000">
                {a.user?.name ?? a.user?.email ?? 'Someone'}
              </span>
              {a.type ?? 'updated the card'}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (comment.trim()) {
            m.addComment(comment.trim())
            setComment('')
          }
        }}
        className="mt-4"
      >
        <textarea
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          rows={3}
          placeholder="Add comment… (type '/' to open commands or '@' to mention)"
          className="w-full resize-none rounded-lg border border-light-300 bg-light-100 p-3 text-sm text-light-1000 outline-none placeholder:text-light-800 focus:border-light-500 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-800"
        />
      </form>
    </div>
  )
}

function CardSidebar({
  card,
  cardPublicId,
  listName,
}: {
  card: BoardCard
  cardPublicId: string
  listName: string
}): ReactElement {
  const m = useCardMutations(cardPublicId)
  const boardId = useBoardId()
  const { board } = useBoard(boardId)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [dueOpen, setDueOpen] = useState(false)

  const Row = ({ label, children }: { label: string; children: ReactElement }): ReactElement => (
    <div className="flex items-start gap-3 py-2 text-sm">
      <span className="w-16 flex-none pt-1 text-light-800 dark:text-dark-800">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )

  return (
    <div className="w-72 flex-none border-l border-light-300 p-5 dark:border-dark-300">
      <div className="mb-4 flex items-center justify-center rounded-md bg-light-200 px-3 py-2 text-sm font-medium text-light-1000 dark:bg-dark-200 dark:text-dark-1000">
        {card.cardNumber != null ? `#${card.cardNumber}` : cardPublicId.slice(0, 6)}
      </div>

      <Row label="List">
        <div className="relative">
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className="text-light-1000 hover:underline dark:text-dark-1000"
          >
            {listName}
          </button>
          {listOpen ? (
            <div className="absolute z-10 mt-1 w-40 rounded-md border border-light-200 bg-white p-1 shadow-lg dark:border-dark-400 dark:bg-dark-300">
              {(board?.lists ?? []).map((l) => (
                <button
                  key={l.publicId}
                  type="button"
                  onClick={() => {
                    m.update({ listPublicId: l.publicId, index: 0 })
                    setListOpen(false)
                  }}
                  className="block w-full rounded px-2 py-1 text-left text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-950 dark:hover:bg-dark-400"
                >
                  {l.name}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </Row>

      <Row label="Priority">
        <div className="flex flex-wrap gap-1">
          {(['urgent', 'high', 'medium', 'low'] as const).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => m.update({ priority: card.priority === p ? null : p })}
              className={`rounded px-2 py-0.5 text-xs ${
                card.priority === p
                  ? 'bg-light-1000 text-white dark:bg-dark-400'
                  : 'bg-light-200 text-light-1000 dark:bg-dark-200 dark:text-dark-1000'
              }`}
            >
              {PRIORITY_LABEL[p]}
            </button>
          ))}
        </div>
      </Row>

      <Row label="Labels">
        <div>
          <div className="mb-1 flex flex-wrap gap-1">
            {card.labels.map((l) => (
              <span
                key={l.publicId}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] text-neutral-600 ring-1 ring-inset ring-light-600 dark:text-dark-1000 dark:ring-dark-800"
              >
                <LabelIcon colourCode={l.colourCode} />
                {l.name}
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setLabelsOpen(true)}
            className="text-light-800 hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000"
          >
            + Add label
          </button>
        </div>
      </Row>

      <Row label="Members">
        <button type="button" className="text-light-800 dark:text-dark-800" disabled>
          + Add member
        </button>
      </Row>

      <Row label="Due date">
        <div className="relative">
          <button
            type="button"
            onClick={() => setDueOpen((v) => !v)}
            className="text-light-800 hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000"
          >
            {card.dueDate ? card.dueDate.slice(0, 10) : '+ Set due date'}
          </button>
          {dueOpen ? (
            <input
              type="date"
              autoFocus
              defaultValue={card.dueDate?.slice(0, 10) ?? ''}
              onChange={(event) => {
                m.update({ dueDate: event.target.value ? new Date(event.target.value).toISOString() : null })
                setDueOpen(false)
              }}
              className="absolute z-10 mt-1 rounded-md border border-light-300 bg-white px-2 py-1 text-sm dark:border-dark-400 dark:bg-dark-300 dark:text-dark-1000"
            />
          ) : null}
        </div>
      </Row>

      {labelsOpen && boardId !== undefined ? (
        <LabelEditor
          cardPublicId={cardPublicId}
          boardPublicId={boardId}
          boardLabels={board?.labels ?? []}
          onClose={() => setLabelsOpen(false)}
        />
      ) : null}
    </div>
  )
}
