import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { makeOpenTask as task } from '@/lib/tasks/open-task-fixture'
import type { TaskActions } from '@/lib/tasks/use-task-actions'
import { hasDoingTag, TaskBoard, withDoingTag, withoutDoingTag } from './task-board'

function makeActions(): TaskActions {
  return {
    complete: vi.fn(),
    toggle: vi.fn(),
    remove: vi.fn(),
    edit: vi.fn(),
    checkboxToggle: vi.fn(),
    insert: vi.fn().mockResolvedValue(null),
    insertAfter: vi.fn().mockResolvedValue(null),
    editAndToggle: vi.fn(),
    schedule: vi.fn(),
    convertToBullet: vi.fn(),
    editAndConvertToBullet: vi.fn(),
    archive: vi.fn(),
    isPending: false,
  }
}

function renderBoard(props: Partial<Parameters<typeof TaskBoard>[0]> = {}) {
  const actions = makeActions()
  const onOpen = vi.fn()
  render(
    <TaskBoard
      open={props.open ?? []}
      done={props.done ?? []}
      needle={props.needle ?? ''}
      today={props.today ?? '2026-07-15'}
      actions={props.actions ?? actions}
      onOpen={props.onOpen ?? onOpen}
    />,
  )
  return { actions, onOpen }
}

afterEach(cleanup)

describe('the #doing tag helpers', () => {
  it('detects the tag anywhere in the line, not inside words', () => {
    expect(hasDoingTag(task({ text: 'ship it #doing' }))).toBe(true)
    expect(hasDoingTag(task({ text: '#doing ship it' }))).toBe(true)
    expect(hasDoingTag(task({ text: 'undoing the thing' }))).toBe(false)
    expect(hasDoingTag(task({ text: 'ship #doingish things' }))).toBe(false)
  })

  it('adds the tag once and strips it cleanly', () => {
    expect(withDoingTag('ship it')).toBe('ship it #doing')
    expect(withDoingTag('ship it #doing')).toBe('ship it #doing')
    expect(withoutDoingTag('ship it #doing')).toBe('ship it')
    expect(withoutDoingTag('#doing ship it')).toBe('ship it')
    expect(withoutDoingTag('ship #doing it')).toBe('ship it')
  })
})

describe('TaskBoard columns', () => {
  it('buckets open tasks by the #doing tag and shows done separately', () => {
    renderBoard({
      open: [
        task({ text: 'inbox thing', notePath: 'notes/a.md' }),
        task({ text: 'active thing #doing', notePath: 'notes/b.md' }),
      ],
      done: [task({ text: 'finished thing', checked: true, notePath: 'notes/c.md' })],
    })
    const inbox = screen.getByRole('region', { name: 'Inbox column' })
    const doing = screen.getByRole('region', { name: 'Doing column' })
    const done = screen.getByRole('region', { name: 'Done column' })
    expect(inbox.textContent).toContain('inbox thing')
    expect(doing.textContent).toContain('active thing')
    // The machinery tag is hidden from the card title.
    expect(doing.textContent).not.toContain('#doing')
    expect(done.textContent).toContain('finished thing')
  })

  it('filters every column by the search needle', () => {
    renderBoard({
      open: [task({ text: 'alpha' }), task({ text: 'beta' })],
      needle: 'alpha',
    })
    const inbox = screen.getByRole('region', { name: 'Inbox column' })
    expect(inbox.textContent).toContain('alpha')
    expect(inbox.textContent).not.toContain('beta')
  })

  it('opens the source note on card click', async () => {
    const { onOpen } = renderBoard({
      open: [task({ text: 'click me', notePath: 'notes/target.md' })],
    })
    await userEvent.click(screen.getByText('click me'))
    expect(onOpen).toHaveBeenCalledWith('notes/target.md', expect.anything())
  })
})
