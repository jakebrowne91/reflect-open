import { useEffect, useState, type ReactElement } from 'react'
import { HiXMark } from 'react-icons/hi2'
import CircularProgress from './CircularProgress'
import LabelIcon from './LabelIcon'
import { useCard, useCardMutations, type BoardCard } from './board-api'

/**
 * The GSD card detail, ported from Kan's views/card into Reflect: a modal over
 * the board showing the card's title, description, priority, labels, due date,
 * checklists (toggle/add items, add checklist) and comments — wired to the
 * board API. Kan's light-/dark- palette keeps it visually matched.
 */
export function CardDetail({
  cardPublicId,
  onClose,
}: {
  cardPublicId: string
  onClose: () => void
}): ReactElement {
  const { card, isPending } = useCard(cardPublicId)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 md:p-10">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />
      <div className="relative z-10 w-full max-w-2xl rounded-lg border border-light-300 bg-light-50 shadow-3xl-light dark:border-dark-300 dark:bg-dark-100 dark:shadow-3xl-dark">
        <div className="flex items-center justify-between border-b border-light-300 px-5 py-3 dark:border-dark-300">
          <span className="text-xs text-light-800 dark:text-dark-800">
            {card?.cardNumber != null ? `#${card.cardNumber}` : 'Card'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-light-900 hover:bg-light-200 dark:text-dark-800 dark:hover:bg-dark-200"
          >
            <HiXMark size={18} />
          </button>
        </div>
        {isPending || card === undefined ? (
          <div className="p-6 text-sm text-light-900 dark:text-dark-900">Loading…</div>
        ) : (
          <CardBody card={card} cardPublicId={cardPublicId} />
        )}
      </div>
    </div>
  )
}

function CardBody({ card, cardPublicId }: { card: BoardCard; cardPublicId: string }): ReactElement {
  const m = useCardMutations(cardPublicId)
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')
  const [newChecklist, setNewChecklist] = useState('')
  const [newItem, setNewItem] = useState<Record<string, string>>({})
  const [comment, setComment] = useState('')

  return (
    <div className="flex flex-col gap-6 p-5">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => title.trim() && title !== card.title && m.update({ title: title.trim() })}
        className="rounded-md border border-transparent bg-transparent text-lg font-semibold text-light-1000 outline-none hover:border-light-400 focus:border-light-700 dark:text-dark-1000 dark:hover:border-dark-400 dark:focus:border-dark-700"
      />

      {card.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {card.labels.map((label) => (
            <span
              key={label.publicId}
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-medium text-neutral-600 ring-1 ring-inset ring-light-600 dark:text-dark-1000 dark:ring-dark-800"
            >
              <LabelIcon colourCode={label.colourCode} />
              {label.name}
            </span>
          ))}
        </div>
      ) : null}

      {card.dueDate ? (
        <div className="text-sm text-light-900 dark:text-dark-900">
          Due {card.dueDate.slice(0, 10)}
        </div>
      ) : null}

      <section>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-light-800 dark:text-dark-800">
          Description
        </h4>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => description !== (card.description ?? '') && m.update({ description })}
          rows={4}
          placeholder="Add a description…"
          className="w-full resize-y rounded-md border border-light-400 bg-light-50 p-2.5 text-sm text-light-1000 outline-none focus:border-light-700 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-700"
        />
      </section>

      <section>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-light-800 dark:text-dark-800">
          Checklists
        </h4>
        <div className="flex flex-col gap-4">
          {card.checklists.map((checklist) => {
            const done = checklist.items.filter((i) => i.completed).length
            const total = checklist.items.length
            return (
              <div key={checklist.publicId}>
                <div className="mb-2 flex items-center justify-between font-medium text-light-1000 dark:text-dark-1000">
                  <span className="text-sm">{checklist.name}</span>
                  <div className="flex items-center gap-1 rounded-full border-[1px] border-light-300 px-2 py-1 dark:border-dark-300">
                    <CircularProgress
                      progress={total > 0 ? Math.round((done / total) * 100) : 0}
                      size="sm"
                      className="flex-shrink-0"
                    />
                    <span className="text-[11px] text-light-900 dark:text-dark-700">
                      {done}/{total}
                    </span>
                  </div>
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
            placeholder="Add a checklist…"
            className="w-full rounded-md border border-dashed border-light-400 bg-transparent px-2 py-1 text-sm text-light-900 outline-none focus:border-light-700 dark:border-dark-400 dark:text-dark-900"
          />
        </div>
      </section>

      <section>
        <h4 className="mb-2 text-xs font-medium uppercase tracking-wide text-light-800 dark:text-dark-800">
          Comments
        </h4>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (comment.trim()) {
              m.addComment(comment.trim())
              setComment('')
            }
          }}
        >
          <textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            rows={2}
            placeholder="Write a comment…"
            className="w-full resize-none rounded-md border border-light-400 bg-light-50 p-2.5 text-sm text-light-1000 outline-none focus:border-light-700 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000"
          />
        </form>
      </section>
    </div>
  )
}
