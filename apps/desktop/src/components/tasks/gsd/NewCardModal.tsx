import { useEffect, useState, type ReactElement } from 'react'
import { HiOutlineBarsArrowDown, HiXMark } from 'react-icons/hi2'
import LabelIcon from './LabelIcon'
import { useBoardMutations, type BoardList, type Label } from './board-api'

const PRIORITIES = ['urgent', 'high', 'medium', 'low'] as const
const PRIORITY_LABEL: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

/**
 * The GSD new-card modal, ported to match Kan's NewCardForm: title, description,
 * priority pills, a list / members / labels / due-date row, "Create another"
 * toggle, and the Create card button. Wired to the board API. The rich "/"
 * editor and Members selector are stand-ins (a textarea; members disabled) —
 * members need workspace data absent on a personal board.
 */
export function NewCardModal({
  lists,
  defaultListPublicId,
  boardLabels,
  onClose,
}: {
  lists: BoardList[]
  defaultListPublicId: string
  boardLabels: Label[]
  onClose: () => void
}): ReactElement {
  const { createCardFull } = useBoardMutations()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState<string | null>(null)
  const [listId, setListId] = useState(defaultListPublicId)
  const [labelIds, setLabelIds] = useState<string[]>([])
  const [dueDate, setDueDate] = useState('')
  const [createAnother, setCreateAnother] = useState(false)
  const [listOpen, setListOpen] = useState(false)
  const [labelsOpen, setLabelsOpen] = useState(false)
  const [dueOpen, setDueOpen] = useState(false)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  const listName = lists.find((l) => l.publicId === listId)?.name ?? 'List'

  const submit = (): void => {
    if (!title.trim()) return
    createCardFull({
      title: title.trim(),
      description,
      listPublicId: listId,
      priority,
      dueDate: dueDate ? new Date(dueDate).toISOString() : null,
      labelPublicIds: labelIds,
      position: 'start',
    })
    if (createAnother) {
      setTitle('')
      setDescription('')
      setPriority(null)
      setLabelIds([])
      setDueDate('')
    } else {
      onClose()
    }
  }

  const chip =
    'rounded-md bg-light-200 px-3 py-1.5 text-sm text-light-1000 transition-[background-color,transform] duration-150 ease-out-strong hover:bg-light-300 active:scale-[0.97] dark:bg-dark-200 dark:text-dark-1000 dark:hover:bg-dark-300'

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-150"
      role="dialog"
    >
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />
      <div className="relative z-10 w-full max-w-xl rounded-xl border border-light-300 bg-light-100 shadow-3xl-light duration-200 animate-in fade-in zoom-in-95 ease-out-strong dark:border-dark-300 dark:bg-dark-100 dark:shadow-3xl-dark">
        <div className="flex items-center justify-between border-b border-light-300 px-5 py-3 dark:border-dark-300">
          <h2 className="text-sm font-semibold text-light-1000 dark:text-dark-1000">New card</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-light-800 hover:text-light-1000 dark:text-dark-800 dark:hover:text-dark-1000">
            <HiXMark size={18} />
          </button>
        </div>
        <div className="p-5">
          <input
            autoFocus
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') submit()
            }}
            placeholder="Task title"
            className="w-full rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 outline-none focus:border-light-700 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:focus:border-dark-600"
          />
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={4}
            placeholder="Add description… (type '/' to open commands or '@' to mention)"
            className="mt-3 w-full resize-none rounded-md border border-light-400 bg-light-50 px-3 py-2 text-sm text-light-1000 outline-none placeholder:text-light-800 focus:border-light-700 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:placeholder:text-dark-800 dark:focus:border-dark-600"
          />

          <div className="mt-4 flex flex-wrap gap-1.5">
            {PRIORITIES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPriority(priority === p ? null : p)}
                className={`rounded-md px-3 py-1.5 text-sm transition-[background-color,transform] duration-150 ease-out-strong active:scale-[0.97] ${
                  priority === p
                    ? 'bg-light-1000 text-white dark:bg-dark-500'
                    : 'bg-light-200 text-light-1000 hover:bg-light-300 dark:bg-dark-200 dark:text-dark-1000 dark:hover:bg-dark-300'
                }`}
              >
                {PRIORITY_LABEL[p]}
              </button>
            ))}
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <div className="relative">
              <button type="button" className={chip} onClick={() => setListOpen((v) => !v)}>
                {listName}
              </button>
              {listOpen ? (
                <div className="absolute z-10 mt-1 w-40 rounded-md border border-light-200 bg-white p-1 shadow-lg dark:border-dark-400 dark:bg-dark-300">
                  {lists.map((l) => (
                    <button
                      key={l.publicId}
                      type="button"
                      onClick={() => {
                        setListId(l.publicId)
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
            <button type="button" className={`${chip} opacity-60`} disabled>
              Members
            </button>
            <div className="relative">
              <button type="button" className={chip} onClick={() => setLabelsOpen((v) => !v)}>
                Labels{labelIds.length > 0 ? ` (${labelIds.length})` : ''}
              </button>
              {labelsOpen ? (
                <div className="absolute z-10 mt-1 w-48 rounded-md border border-light-200 bg-white p-1 shadow-lg dark:border-dark-400 dark:bg-dark-300">
                  {boardLabels.length === 0 ? (
                    <p className="px-2 py-1 text-xs text-light-800 dark:text-dark-800">No labels yet</p>
                  ) : (
                    boardLabels.map((l) => (
                      <button
                        key={l.publicId}
                        type="button"
                        onClick={() =>
                          setLabelIds((prev) =>
                            prev.includes(l.publicId)
                              ? prev.filter((id) => id !== l.publicId)
                              : [...prev, l.publicId],
                          )
                        }
                        className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-950 dark:hover:bg-dark-400"
                      >
                        <input type="checkbox" readOnly checked={labelIds.includes(l.publicId)} />
                        <LabelIcon colourCode={l.colourCode} />
                        {l.name}
                      </button>
                    ))
                  )}
                </div>
              ) : null}
            </div>
            <div className="relative">
              <button type="button" className={chip} onClick={() => setDueOpen((v) => !v)}>
                {dueDate || 'Due date'}
              </button>
              {dueOpen ? (
                <input
                  type="date"
                  autoFocus
                  value={dueDate}
                  onChange={(event) => {
                    setDueDate(event.target.value)
                    setDueOpen(false)
                  }}
                  className="absolute z-10 mt-1 rounded-md border border-light-300 bg-white px-2 py-1 text-sm dark:border-dark-400 dark:bg-dark-300 dark:text-dark-1000"
                />
              ) : null}
            </div>
            <button type="button" className={`${chip} px-2`} aria-label="Position" disabled>
              <HiOutlineBarsArrowDown className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 border-t border-light-300 px-5 py-3 dark:border-dark-300">
          <label className="flex items-center gap-2 text-sm text-light-900 dark:text-dark-900">
            Create another
            <button
              type="button"
              onClick={() => setCreateAnother((v) => !v)}
              className={`relative h-5 w-9 rounded-full transition-colors ${createAnother ? 'bg-light-1000 dark:bg-dark-500' : 'bg-light-400 dark:bg-dark-300'}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${createAnother ? 'left-4' : 'left-0.5'}`}
              />
            </button>
          </label>
          <button
            type="button"
            onClick={submit}
            disabled={!title.trim()}
            className="rounded-md bg-light-1000 px-4 py-1.5 text-sm font-medium text-white transition-transform duration-150 ease-out-strong active:scale-[0.97] disabled:opacity-50 dark:bg-dark-500"
          >
            Create card
          </button>
        </div>
      </div>
    </div>
  )
}
