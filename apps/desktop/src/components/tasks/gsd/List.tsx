import { useState, type ReactNode } from 'react'
import { useDroppable } from '@dnd-kit/core'
import {
  HiEllipsisHorizontal,
  HiOutlinePlusSmall,
  HiOutlineSquaresPlus,
  HiOutlineTrash,
} from 'react-icons/hi2'
import Dropdown from './Dropdown'
import { Tooltip } from './Tooltip'

interface ListModel {
  publicId: string
  name: string
  createdBy?: string | null
}

/**
 * Ported from Kan apps/web/src/views/board/components/List.tsx. The header JSX
 * (name input, count badge, add button, overflow menu) is verbatim; the
 * react-beautiful-dnd Draggable wrapper becomes a dnd-kit droppable column, and
 * tRPC/permissions/modal are replaced by props + the board API. The single
 * owner has full permissions, so the permission gates collapse to true.
 */
export default function List({
  list,
  cardCount,
  children,
  onAddCard,
  onRename,
  onDelete,
}: {
  list: ListModel
  cardCount: number
  children: ReactNode
  onAddCard: (listPublicId: string) => void
  onRename: (listPublicId: string, name: string) => void
  onDelete: (listPublicId: string) => void
}) {
  const { setNodeRef } = useDroppable({ id: list.publicId, data: { column: true } })
  const [name, setName] = useState(list.name)

  const commitName = (): void => {
    if (name.trim() && name !== list.name) {
      onRename(list.publicId, name.trim())
    }
  }

  const dropdownItems = [
    {
      label: 'Add a card',
      action: () => onAddCard(list.publicId),
      icon: <HiOutlineSquaresPlus className="h-[18px] w-[18px] text-dark-900" />,
    },
    {
      label: 'Delete list',
      action: () => onDelete(list.publicId),
      icon: <HiOutlineTrash className="h-[18px] w-[18px] text-dark-900" />,
    },
  ]

  return (
    <div className="dark-text-dark-1000 mr-3 h-fit min-w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] snap-center rounded-md border border-light-400 bg-light-300 py-2 pl-2 pr-1 text-neutral-900 dark:border-dark-300 dark:bg-dark-100 sm:min-w-[22rem] sm:max-w-[22rem] md:mr-5 md:min-w-[18rem] md:max-w-[18rem]">
      <div className="mb-2 flex min-h-10 justify-between">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            commitName()
          }}
          className="min-w-0 flex-1 focus-visible:outline-none"
        >
          <div className="flex min-w-0 items-center gap-2 px-3 pt-1 md:px-4">
            <input
              id="name"
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={commitName}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm font-medium text-neutral-900 focus:ring-0 focus-visible:outline-none dark:text-dark-1000"
            />
            <span className="inline-flex min-w-5 justify-center rounded-full border border-light-600 bg-light-100 px-1.5 py-0.5 text-[11px] font-semibold leading-none text-light-950 dark:border-dark-500 dark:bg-dark-300 dark:text-dark-950">
              {cardCount}
            </span>
          </div>
        </form>
        <div className="flex items-center">
          <Tooltip>
            <button
              className="mx-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-sm font-semibold text-dark-50 transition-[background-color,transform] duration-150 ease-out-strong hover:bg-light-400 active:scale-90 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-dark-200 md:h-fit md:w-auto md:p-1 md:px-1"
              onClick={() => onAddCard(list.publicId)}
            >
              <HiOutlinePlusSmall className="h-5 w-5 text-dark-900" aria-hidden="true" />
            </button>
          </Tooltip>
          <div className="relative mr-1 inline-block">
            <Dropdown items={dropdownItems}>
              <HiEllipsisHorizontal className="h-5 w-5 text-dark-900" />
            </Dropdown>
          </div>
        </div>
      </div>
      <div ref={setNodeRef} className="flex min-h-2 flex-col gap-2 px-1">
        {children}
      </div>
    </div>
  )
}
