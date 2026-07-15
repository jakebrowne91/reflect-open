import { useEffect, useState, type ReactElement } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import {
  addChecklist,
  addChecklistItem,
  addComment,
  fetchCard,
  setChecklistItem,
  updateCard,
  type BoardCard,
} from '@/lib/board/board-api'

const cardKey = (id: string): [string, string, string] => ['board', 'card', id]

/**
 * The card detail: Kan's card view, native. A right-hand slide-over that reads
 * one card through the server proxy and edits its title, description, due
 * date, checklists, and comments — the rich half of the board that a markdown
 * task line can't hold. Every mutation invalidates both this card and the
 * board list so the column card reflects the change.
 */
export function CardDetailPanel({
  cardPublicId,
  onClose,
}: {
  cardPublicId: string
  onClose: () => void
}): ReactElement {
  const queryClient = useQueryClient()
  const { data: card, isPending } = useQuery({
    queryKey: cardKey(cardPublicId),
    queryFn: () => fetchCard(cardPublicId),
    // Live remote data — refetch rather than inherit staleTime: Infinity.
    staleTime: 0,
    refetchOnMount: 'always',
  })

  const invalidate = (): void => {
    void queryClient.invalidateQueries({ queryKey: cardKey(cardPublicId) })
    void queryClient.invalidateQueries({ queryKey: ['board', 'detail'] })
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="flex-1 bg-black/30"
      />
      <div className="flex h-full w-full max-w-lg flex-col overflow-y-auto border-l border-border bg-[color:var(--surface-app)] shadow-[var(--shadow-pop)]">
        <div className="flex flex-none items-center justify-between border-b border-border px-4 py-3">
          <span className="text-xs text-text-muted">
            {card?.cardNumber !== null && card?.cardNumber !== undefined ? `#${card.cardNumber}` : 'Card'}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close card"
            className="rounded-md p-1 text-text-muted hover:bg-[color:var(--surface-hover)] hover:text-text"
          >
            <X aria-hidden className="size-4" />
          </button>
        </div>
        {isPending || card === undefined ? (
          <p className="p-6 text-sm text-text-muted">Loading…</p>
        ) : (
          <CardBody card={card} onChanged={invalidate} />
        )}
      </div>
    </div>
  )
}

function CardBody({ card, onChanged }: { card: BoardCard; onChanged: () => void }): ReactElement {
  const [title, setTitle] = useState(card.title)
  const [description, setDescription] = useState(card.description ?? '')

  const saveTitle = useMutation({
    mutationFn: () => updateCard(card.publicId, { title: title.trim() || card.title }),
    onSuccess: onChanged,
  })
  const saveDescription = useMutation({
    mutationFn: () => updateCard(card.publicId, { description }),
    onSuccess: onChanged,
  })

  return (
    <div className="flex flex-col gap-5 p-5">
      <input
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onBlur={() => title.trim() !== '' && title !== card.title && saveTitle.mutate()}
        className="rounded-md border border-transparent bg-transparent text-lg font-semibold text-text outline-none hover:border-border focus:border-[color:var(--focus-ring)]"
      />

      {card.labels.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {card.labels.map((label) => (
            <span
              key={label.publicId}
              className="rounded px-2 py-0.5 text-xs font-medium"
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

      {card.dueDate !== null && card.dueDate !== undefined ? (
        <div className="text-sm text-text-secondary">Due {card.dueDate.slice(0, 10)}</div>
      ) : null}

      <section>
        <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
          Description
        </h4>
        <textarea
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          onBlur={() => description !== (card.description ?? '') && saveDescription.mutate()}
          rows={4}
          placeholder="Add a description…"
          className="w-full resize-y rounded-lg border border-border bg-[color:var(--surface)] p-2.5 text-sm text-text outline-none focus:border-[color:var(--focus-ring)]"
        />
      </section>

      <Checklists card={card} onChanged={onChanged} />
      <Comments card={card} onChanged={onChanged} />
    </div>
  )
}

function Checklists({ card, onChanged }: { card: BoardCard; onChanged: () => void }): ReactElement {
  const [newItem, setNewItem] = useState<Record<string, string>>({})
  const [newChecklist, setNewChecklist] = useState('')

  const toggle = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      setChecklistItem(itemId, { completed }),
    onSuccess: onChanged,
  })
  const addItem = useMutation({
    mutationFn: ({ checklistId, title }: { checklistId: string; title: string }) =>
      addChecklistItem(checklistId, title),
    onSuccess: onChanged,
  })
  const addList = useMutation({
    mutationFn: () => addChecklist(card.publicId, newChecklist.trim()),
    onSuccess: () => {
      setNewChecklist('')
      onChanged()
    },
  })

  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Checklists
      </h4>
      <div className="flex flex-col gap-3">
        {card.checklists.map((checklist) => (
          <div key={checklist.publicId}>
            <div className="mb-1 text-sm font-medium text-text-secondary">{checklist.name}</div>
            <ul className="flex flex-col gap-1">
              {checklist.items.map((item) => (
                <li key={item.publicId} className="flex items-center gap-2 text-sm text-text">
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={(event) =>
                      toggle.mutate({ itemId: item.publicId, completed: event.target.checked })
                    }
                  />
                  <span className={item.completed ? 'text-text-muted line-through' : ''}>
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
                if (event.key === 'Enter' && value !== '') {
                  addItem.mutate({ checklistId: checklist.publicId, title: value })
                  setNewItem((prev) => ({ ...prev, [checklist.publicId]: '' }))
                }
              }}
              placeholder="Add item…"
              className="mt-1 w-full rounded-md border border-border bg-[color:var(--surface)] px-2 py-1 text-sm text-text outline-none focus:border-[color:var(--focus-ring)]"
            />
          </div>
        ))}
        <input
          value={newChecklist}
          onChange={(event) => setNewChecklist(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && newChecklist.trim() !== '') {
              addList.mutate()
            }
          }}
          placeholder="Add a checklist…"
          className="w-full rounded-md border border-dashed border-border bg-transparent px-2 py-1 text-sm text-text-muted outline-none focus:border-[color:var(--focus-ring)]"
        />
      </div>
    </section>
  )
}

function Comments({ card, onChanged }: { card: BoardCard; onChanged: () => void }): ReactElement {
  const [text, setText] = useState('')
  const add = useMutation({
    mutationFn: () => addComment(card.publicId, text.trim()),
    onSuccess: () => {
      setText('')
      onChanged()
    },
  })
  return (
    <section>
      <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-text-muted">
        Comments
      </h4>
      <div className="flex flex-col gap-2">
        {card.comments.map((comment) => (
          <div
            key={comment.publicId}
            className="rounded-lg bg-[color:var(--surface)] p-2.5 text-sm text-text"
          >
            {comment.comment ?? ''}
          </div>
        ))}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (text.trim() !== '') {
              add.mutate()
            }
          }}
        >
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={2}
            placeholder="Write a comment…"
            className="w-full resize-none rounded-lg border border-border bg-[color:var(--surface)] p-2.5 text-sm text-text outline-none focus:border-[color:var(--focus-ring)]"
          />
        </form>
      </div>
    </section>
  )
}
