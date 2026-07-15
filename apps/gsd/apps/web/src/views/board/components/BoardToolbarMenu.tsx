import { useRouter } from "next/router";
import { Menu, Transition } from "@headlessui/react";
import { t } from "@lingui/core/macro";
import { Fragment, useState } from "react";
import {
  HiChevronDown,
  HiEllipsisHorizontal,
  HiOutlineDocumentDuplicate,
  HiOutlineEye,
  HiOutlinePlusSmall,
  HiOutlineStar,
  HiOutlineTrash,
  HiStar,
} from "react-icons/hi2";
import { IoArchiveOutline } from "react-icons/io5";
import { twMerge } from "tailwind-merge";

import type { BoardViewMode } from "../boardView";
import type { BoardCardDisplayField } from "../cardDisplay";
import Button from "~/components/Button";
import { usePermissions } from "~/hooks/usePermissions";
import { useModal } from "~/providers/modal";
import { usePopup } from "~/providers/popup";
import { api } from "~/utils/api";
import { defaultBoardViewMode } from "../boardView";
import { defaultBoardCardDisplayFields } from "../cardDisplay";
import { BoardCardFieldsMenuContent } from "./BoardCardFieldsDropdown";
import { BoardViewToggle } from "./BoardViewToggle";

interface BoardToolbarMenuProps {
  isTemplate: boolean;
  isLoading: boolean;
  boardPublicId: string;
  isArchived?: boolean;
  isFavorite?: boolean;
  boardName?: string;
  viewMode: BoardViewMode;
  visibleFields: BoardCardDisplayField[];
  canCreateList: boolean;
  onCreateList: () => void;
  onViewChange: (mode: BoardViewMode) => void;
  onFieldsChange: (fields: BoardCardDisplayField[]) => void;
}

interface ToolbarAction {
  label: string;
  action?: () => void;
  icon?: React.ReactNode;
  disabled?: boolean;
}

function SectionHeader({
  icon,
  children,
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1 text-xs font-semibold uppercase text-dark-800">
      {icon}
      <span>{children}</span>
    </div>
  );
}

function ToolbarActionButton({ action }: { action: ToolbarAction }) {
  return (
    <Menu.Item disabled={action.disabled}>
      <button
        type="button"
        onClick={action.action}
        disabled={action.disabled ?? !action.action}
        className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left text-sm text-neutral-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-60 dark:text-dark-950 dark:hover:bg-dark-400"
      >
        {action.icon}
        <span className="min-w-0 flex-1">{action.label}</span>
      </button>
    </Menu.Item>
  );
}

export function BoardToolbarMenu({
  isTemplate,
  isLoading,
  boardPublicId,
  isArchived,
  isFavorite,
  boardName,
  viewMode,
  visibleFields,
  canCreateList,
  onCreateList,
  onViewChange,
  onFieldsChange,
}: BoardToolbarMenuProps) {
  const router = useRouter();
  const { openModal } = useModal();
  const { showPopup } = usePopup();
  const { canDeleteBoard, canCreateBoard, canArchiveBoard } = usePermissions();
  const utils = api.useUtils();
  const [isFieldsOpen, setIsFieldsOpen] = useState(false);

  const updateBoard = api.board.update.useMutation({
    onSuccess: (_data, variables) => {
      void utils.board.all.invalidate();
      void utils.board.byId.invalidate();
      if (variables.isArchived !== undefined) {
        showPopup({
          header: variables.isArchived
            ? t`Board archived`
            : t`Board unarchived`,
          message: variables.isArchived
            ? t`The board has been archived.`
            : t`The board has been unarchived.`,
          icon: "success",
        });
        void router.push(`/boards`);
      } else if (variables.favorite !== undefined) {
        showPopup({
          header: variables.favorite
            ? t`Added to favorites`
            : t`Removed from favorites`,
          message: variables.favorite
            ? t`${boardName ?? "Board"} has been added to your favorites.`
            : t`${boardName ?? "Board"} has been removed from your favorites.`,
          icon: "success",
        });
      }
    },
    onError: () => {
      showPopup({
        header: t`Unable to update board`,
        message: t`Please try again later, or contact customer support.`,
        icon: "error",
      });
    },
  });

  const hasActiveOverflowState =
    viewMode !== defaultBoardViewMode ||
    visibleFields.length !== defaultBoardCardDisplayFields.length;

  const isArchiveActionPending = updateBoard.isPending;
  const isActionDisabled = isLoading || isArchiveActionPending;

  const boardActions: ToolbarAction[] = [
    ...(isTemplate && canCreateBoard
      ? [
          {
            label: t`Make template`,
            action: () => openModal("CREATE_TEMPLATE"),
            icon: (
              <HiOutlineDocumentDuplicate className="h-4 w-4 text-dark-900" />
            ),
            disabled: isActionDisabled,
          },
        ]
      : []),
    ...(!isTemplate && canArchiveBoard
      ? [
          {
            label: isArchived ? t`Unarchive board` : t`Archive board`,
            action: () =>
              updateBoard.mutate({
                boardPublicId,
                isArchived: !isArchived,
              }),
            icon: <IoArchiveOutline className="h-4 w-4 text-dark-900" />,
            disabled: isActionDisabled,
          },
        ]
      : []),
    {
      label: isFavorite ? t`Remove from favorites` : t`Add to favorites`,
      action: () =>
        updateBoard.mutate({
          boardPublicId,
          favorite: !isFavorite,
        }),
      icon: isFavorite ? (
        <HiStar className="h-4 w-4 text-dark-900" />
      ) : (
        <HiOutlineStar className="h-4 w-4 text-dark-900" />
      ),
      disabled: isActionDisabled,
    },
    ...(canDeleteBoard
      ? [
          {
            label: isTemplate ? t`Delete template` : t`Delete board`,
            action: () => openModal("DELETE_BOARD"),
            icon: <HiOutlineTrash className="h-4 w-4 text-dark-900" />,
            disabled: isActionDisabled,
          },
        ]
      : []),
  ];

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button as="div" className="cursor-pointer">
        <Button
          type="button"
          size="sm"
          variant={hasActiveOverflowState ? "primary" : "secondary"}
          iconOnly
          disabled={isLoading}
          iconLeft={<HiEllipsisHorizontal className="h-5 w-5" />}
          aria-label="More board controls"
          title="More board controls"
        />
      </Menu.Button>

      <Transition
        as={Fragment}
        enter="transition ease-out duration-100"
        enterFrom="transform opacity-0 scale-95"
        enterTo="transform opacity-100 scale-100"
        leave="transition ease-in duration-75"
        leaveFrom="transform opacity-100 scale-100"
        leaveTo="transform opacity-0 scale-95"
      >
        <Menu.Items className="absolute right-0 z-[100] mt-2 max-h-[min(82vh,44rem)] w-[min(22rem,calc(100vw-2rem))] origin-top-right overflow-y-auto rounded-md border border-light-200 bg-white p-3 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-dark-400 dark:bg-dark-300">
          <div className="space-y-4">
            <section className="space-y-1">
              <SectionHeader
                icon={
                  <HiOutlinePlusSmall className="h-4 w-4 flex-shrink-0 text-dark-900" />
                }
              >
                Board actions
              </SectionHeader>
              <Menu.Item disabled={isLoading || !canCreateList}>
                <button
                  type="button"
                  onClick={onCreateList}
                  disabled={isLoading || !canCreateList}
                  className="flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left text-sm text-neutral-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-60 dark:text-dark-950 dark:hover:bg-dark-400"
                >
                  <HiOutlinePlusSmall className="h-4 w-4 text-dark-900" />
                  <span className="min-w-0 flex-1">{t`New list`}</span>
                  {!canCreateList && (
                    <span className="text-xs text-dark-800">
                      {t`No permission`}
                    </span>
                  )}
                </button>
              </Menu.Item>
              {boardActions.map((action) => (
                <ToolbarActionButton key={action.label} action={action} />
              ))}
            </section>

            {!isTemplate && (
              <section className="border-t border-light-200 pt-4 dark:border-dark-500">
                <SectionHeader
                  icon={
                    <HiOutlineEye className="h-4 w-4 flex-shrink-0 text-dark-900" />
                  }
                >
                  View
                </SectionHeader>
                <BoardViewToggle
                  mode={viewMode}
                  isLoading={isLoading}
                  onChange={onViewChange}
                />
              </section>
            )}

            {!isTemplate && (
              <section className="border-t border-light-200 pt-4 dark:border-dark-500">
                <button
                  type="button"
                  onClick={() => setIsFieldsOpen((isOpen) => !isOpen)}
                  className="flex w-full items-center gap-2 rounded-[5px] px-1 py-1.5 text-left text-xs font-semibold uppercase text-dark-800 hover:bg-light-200 dark:hover:bg-dark-400"
                  aria-expanded={isFieldsOpen}
                >
                  <HiOutlineEye className="h-4 w-4 flex-shrink-0 text-dark-900" />
                  <span className="min-w-0 flex-1">{t`Card fields`}</span>
                  <span className="text-xs normal-case text-dark-800">
                    {visibleFields.length}/
                    {defaultBoardCardDisplayFields.length}
                  </span>
                  <HiChevronDown
                    className={twMerge(
                      "h-4 w-4 flex-shrink-0 text-dark-900 transition-transform",
                      isFieldsOpen && "rotate-180",
                    )}
                  />
                </button>
                {isFieldsOpen && (
                  <div className="mt-2">
                    <BoardCardFieldsMenuContent
                      visibleFields={visibleFields}
                      onChange={onFieldsChange}
                    />
                  </div>
                )}
              </section>
            )}
          </div>
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
