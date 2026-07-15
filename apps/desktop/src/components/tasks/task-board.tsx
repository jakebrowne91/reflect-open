import { useCallback, useMemo, useState, type ReactElement } from 'react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { type OpenTask } from '@reflect/core'
import { cn } from '@/lib/utils'
import { taskContent } from '@/lib/tasks/task-content'
import { taskKey } from '@/lib/tasks/task-identity'
import type { TaskActions } from '@/lib/tasks/use-task-actions'
import type { NewWindowClickEvent } from '@/lib/windows/open-in-new-window'

/**
 * The Tasks board (the GSD-style alternative to the grouped list): three
 * columns whose membership is stored in the markdown itself, so the board
 * survives any editor and syncs like everything else.
 *
 * - **Inbox** — open tasks.
 * - **Doing** — open tasks whose line carries a `#doing` tag. Dragging in
 *   and out of this column writes/removes the tag via the same task-edit
 *   path as the inline editor.
 * - **Done** — checked tasks (this session's completions plus the stored
 *   history). Dragging a card out reopens it (`editAndToggle`, so the tag
 *   change and the un-check land as one sequenced write).
 *
 * Ordering within a column is the projection's order (due date, then note
 * recency) — deliberately not draggable in V1: a manual order would need a
 * home outside the markdown, and files are the source of truth.
 */

export type BoardColumnId = 'inbox' | 'doing' | 'done'

interface BoardColumn {
  id: BoardColumnId
  title: string
  tasks: OpenTask[]
}

const DOING_TAG_RE = /(?:^|\s)#doing(?=\s|$)/

export function hasDoingTag(task: OpenTask): boolean {
  return DOING_TAG_RE.test(taskContent(task.raw))
}

export function withoutDoingTag(content: string): string {
  return content.replace(new RegExp(DOING_TAG_RE, 'g'), ' ').replace(/\s+/g, ' ').trim()
}

export function withDoingTag(content: string): string {
  return DOING_TAG_RE.test(content) ? content : `${content.trimEnd()} #doing`
}

/** Card title: the task text with the board-machinery tag hidden. */
function displayText(task: OpenTask): string {
  return withoutDoingTag(taskContent(task.raw)) || 'Untitled task'
}

interface TaskBoardProps {
  open: OpenTask[]
  done: OpenTask[]
  needle: string
  today: string
  actions: TaskActions
  onOpen: (path: string, event?: NewWindowClickEvent) => void
}

export function TaskBoard({
  open,
  done,
  needle,
  today,
  actions,
  onOpen,
}: TaskBoardProps): ReactElement {
  const [dragging, setDragging] = useState<OpenTask | null>(null)

  const matches = useCallback(
    (task: OpenTask) =>
      needle === '' ||
      task.text.toLowerCase().includes(needle) ||
      task.noteTitle.toLowerCase().includes(needle),
    [needle],
  )

  const columns = useMemo<BoardColumn[]>(() => {
    const visibleOpen = open.filter(matches)
    return [
      { id: 'inbox', title: 'Inbox', tasks: visibleOpen.filter((task) => !hasDoingTag(task)) },
      { id: 'doing', title: 'Doing', tasks: visibleOpen.filter(hasDoingTag) },
      { id: 'done', title: 'Done', tasks: done.filter(matches).slice(0, 40) },
    ]
  }, [open, done, matches])

  const tasksByKey = useMemo(
    () => new Map([...open, ...done].map((task) => [taskKey(task), task])),
    [open, done],
  )

  // A small movement threshold keeps plain clicks (open the note) distinct
  // from drags.
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const onDragStart = useCallback(
    (event: DragStartEvent) => {
      setDragging(tasksByKey.get(String(event.active.id)) ?? null)
    },
    [tasksByKey],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragging(null)
      const target = event.over?.id as BoardColumnId | undefined
      const task = tasksByKey.get(String(event.active.id))
      if (target === undefined || task === undefined) {
        return
      }
      const content = taskContent(task.raw)
      const inDoing = DOING_TAG_RE.test(content)
      const from: BoardColumnId = task.checked ? 'done' : inDoing ? 'doing' : 'inbox'
      if (from === target) {
        return
      }
      if (target === 'done') {
        actions.complete([task])
        return
      }
      const nextContent = target === 'doing' ? withDoingTag(content) : withoutDoingTag(content)
      if (task.checked) {
        // Reopen + retag as one sequenced write (never two racing edits).
        if (nextContent === content) {
          actions.toggle([task])
        } else {
          actions.editAndToggle(task, nextContent)
        }
        return
      }
      actions.edit(task, nextContent)
    },
    [actions, tasksByKey],
  )

  return (
    <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex h-full min-h-0 gap-3 px-4 pt-4 lg:px-10">
        {columns.map((column) => (
          <BoardColumnView
            key={column.id}
            column={column}
            today={today}
            pending={actions.isPending}
            onOpen={onOpen}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {dragging !== null ? <BoardCard task={dragging} today={today} overlay /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function BoardColumnView({
  column,
  today,
  pending,
  onOpen,
}: {
  column: BoardColumn
  today: string
  pending: boolean
  onOpen: (path: string, event?: NewWindowClickEvent) => void
}): ReactElement {
  const { setNodeRef, isOver } = useDroppable({ id: column.id })
  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.title} column`}
      className={cn(
        'flex min-h-0 flex-1 flex-col rounded-xl bg-[color:var(--surface-sunken)] transition-shadow',
        isOver && 'ring-2 ring-[color:var(--focus-ring)]',
      )}
    >
      <header className="flex flex-none items-center gap-2 px-3 pb-1 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
          {column.title}
        </h3>
        <span className="rounded-full bg-[color:var(--surface-hover)] px-1.5 text-[11px] tabular-nums text-text-muted">
          {column.tasks.length}
        </span>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-2">
        {column.tasks.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-text-muted">
            {column.id === 'done' ? 'Nothing done yet.' : 'Drop tasks here.'}
          </p>
        ) : (
          column.tasks.map((task) => (
            <DraggableBoardCard
              key={taskKey(task)}
              task={task}
              today={today}
              disabled={pending}
              onOpen={onOpen}
            />
          ))
        )}
      </div>
    </section>
  )
}

function DraggableBoardCard({
  task,
  today,
  disabled,
  onOpen,
}: {
  task: OpenTask
  today: string
  disabled: boolean
  onOpen: (path: string, event?: NewWindowClickEvent) => void
}): ReactElement {
  const key = taskKey(task)
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: key,
    disabled,
  })
  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      onClick={(event) => onOpen(task.notePath, event)}
      className={cn(isDragging && 'opacity-40')}
    >
      <BoardCard task={task} today={today} />
    </div>
  )
}

function BoardCard({
  task,
  today,
  overlay = false,
}: {
  task: OpenTask
  today: string
  overlay?: boolean
}): ReactElement {
  const overdue = task.dueDate !== null && task.dueDate < today && !task.checked
  return (
    <article
      className={cn(
        'cursor-grab rounded-lg border border-border bg-[color:var(--surface)] p-3 shadow-[var(--shadow-sm)]',
        'hover:border-[color:var(--border-strong)]',
        overlay && 'rotate-2 shadow-[var(--shadow-pop)]',
      )}
    >
      <p
        className={cn(
          'text-sm leading-snug text-text',
          task.checked && 'text-text-muted line-through',
        )}
      >
        {displayText(task)}
      </p>
      <div className="mt-2 flex items-center gap-2 text-[11px] text-text-muted">
        <span className="truncate">{task.noteTitle}</span>
        {task.dueDate !== null ? (
          <span
            className={cn(
              'ml-auto flex-none rounded px-1 py-px',
              overdue
                ? 'bg-[color:var(--destructive)]/15 text-[color:var(--destructive)]'
                : task.dueDate === today
                  ? 'bg-[color:var(--accent-soft)] text-[color:var(--accent-soft-text)]'
                  : 'bg-[color:var(--surface-hover)]',
            )}
          >
            {task.dueDate === today ? 'Today' : task.dueDate}
          </span>
        ) : null}
      </div>
    </article>
  )
}
