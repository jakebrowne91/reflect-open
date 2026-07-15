import { useEffect, useState, type ReactElement } from 'react'
import LabelIcon from './LabelIcon'
import { useCard, useLabelMutations, type Label } from './board-api'

/** Kan's label palette (the colours the label form offers). */
const LABEL_COLOURS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#3b82f6',
  '#6366f1',
  '#a855f7',
  '#ec4899',
]

/**
 * Ported from Kan's CardContextLabelsModal + LabelSelector: toggle a card's
 * labels and create new board labels. Opened with `l` on the selected card.
 */
export function LabelEditor({
  cardPublicId,
  boardPublicId,
  boardLabels,
  onClose,
}: {
  cardPublicId: string
  boardPublicId: string
  boardLabels: Label[]
  onClose: () => void
}): ReactElement {
  const { card } = useCard(cardPublicId)
  const { createAndAssignLabel, toggleCardLabel } = useLabelMutations()
  const [name, setName] = useState('')
  const [colour, setColour] = useState(LABEL_COLOURS[0] as string)

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const selected = new Set((card?.labels ?? []).map((l) => l.publicId))

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4" role="dialog">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0" />
      <div className="relative z-10 w-full max-w-sm rounded-lg border border-light-300 bg-light-50 p-4 shadow-3xl-light dark:border-dark-300 dark:bg-dark-100 dark:shadow-3xl-dark">
        <h2 className="mb-4 text-lg font-semibold text-light-1000 dark:text-dark-1000">Labels</h2>
        <div className="flex flex-col gap-1">
          {boardLabels.map((label) => (
            <button
              key={label.publicId}
              type="button"
              onClick={() => toggleCardLabel(cardPublicId, label.publicId)}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-light-1000 hover:bg-light-200 dark:text-dark-1000 dark:hover:bg-dark-300"
            >
              <input type="checkbox" readOnly checked={selected.has(label.publicId)} />
              <LabelIcon colourCode={label.colourCode} />
              {label.name}
            </button>
          ))}
          {boardLabels.length === 0 ? (
            <p className="px-2 py-1 text-xs text-light-800 dark:text-dark-800">
              No labels yet — create one below.
            </p>
          ) : null}
        </div>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            if (name.trim()) {
              createAndAssignLabel({ cardPublicId, boardPublicId, name: name.trim(), colourCode: colour })
              setName('')
            }
          }}
          className="mt-4 border-t border-light-300 pt-3 dark:border-dark-300"
        >
          <div className="mb-2 flex flex-wrap gap-1.5">
            {LABEL_COLOURS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColour(c)}
                style={{ backgroundColor: c }}
                className={`h-5 w-5 rounded-full ${colour === c ? 'ring-2 ring-offset-1 ring-light-900 dark:ring-dark-800' : ''}`}
                aria-label={`Colour ${c}`}
              />
            ))}
          </div>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Create new label…"
            className="w-full rounded-md border border-light-400 bg-light-50 px-2 py-1.5 text-sm text-light-1000 outline-none focus:border-light-700 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000"
          />
        </form>
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-light-300 bg-light-50 px-3 py-1.5 text-sm font-medium text-light-1000 hover:bg-light-200 dark:border-dark-400 dark:bg-dark-200 dark:text-dark-1000 dark:hover:bg-dark-300"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  )
}
