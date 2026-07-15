import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import type { KeyboardEvent, MouseEvent } from "react";
import { t } from "@lingui/core/macro";
import {
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { format } from "date-fns";
import { useCallback, useMemo, useState } from "react";
import { HiOutlinePaperClip } from "react-icons/hi";
import {
  HiChatBubbleLeft,
  HiEllipsisHorizontal,
  HiOutlineArrowTopRightOnSquare,
  HiOutlineClipboard,
  HiOutlineClock,
} from "react-icons/hi2";

import type {
  BoardCardDisplayField,
  BoardCardDisplayItem,
  BoardCardSupportMetadata,
} from "../cardDisplay";
import type { BoardSortCriterion } from "../sort";
import type { CardPriority } from "./Card";
import {
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
} from "~/components/data-table";
import Dropdown from "~/components/Dropdown";
import LabelIcon from "~/components/LabelIcon";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useLocalisation } from "~/hooks/useLocalisation";
import { cn } from "~/utils/cn";
import {
  cleanSupportTitle,
  getCardDescriptionPreview,
} from "~/utils/supportText";
import { getBoardCardDisplayItems } from "../cardDisplay";
import { sortBoardListItems } from "../sort";

interface BoardListViewCard {
  publicId: string;
  index: number;
  title: string;
  description: string | null;
  createdAt: Date | string;
  updatedAt?: Date | string | null;
  dueDate?: Date | string | null;
  priority: CardPriority | null;
  cardNumber: number | null;
  supportTicketMetadata?: BoardCardSupportMetadata | null;
  labels: { publicId?: string; name: string; colourCode: string | null }[];
  members: {
    publicId: string;
    email: string;
    user: { name: string | null; email: string; image: string | null } | null;
  }[];
  checklists: {
    publicId: string;
    items: {
      publicId: string;
      completed: boolean;
    }[];
  }[];
  comments: { publicId: string }[];
  attachments?: { publicId: string }[];
}

export interface BoardListViewItem {
  card: BoardListViewCard;
  list: {
    publicId: string;
    name: string;
  };
  listIndex: number;
  cardIndex: number;
}

const priorityStyles: Record<CardPriority, string> = {
  urgent:
    "border-red-500/40 bg-red-100 text-red-700 dark:border-red-400/40 dark:bg-red-400/15 dark:text-red-200",
  high: "border-orange-500/40 bg-orange-100 text-orange-700 dark:border-orange-300/40 dark:bg-orange-300/15 dark:text-orange-100",
  medium:
    "border-blue-500/40 bg-blue-100 text-blue-700 dark:border-blue-300/40 dark:bg-blue-300/15 dark:text-blue-100",
  low: "border-emerald-500/40 bg-emerald-100 text-emerald-700 dark:border-emerald-300/40 dark:bg-emerald-300/15 dark:text-emerald-100",
};

const tableHeaderClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";
const tableCellClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";

type BoardTableRow = BoardListViewItem & {
  ticketNumber: string;
  displayItems: BoardCardDisplayItem[];
  typeLabel: string;
  sourceLabel: string;
  externalId?: BoardCardDisplayItem;
  customerLabel: string;
  customerSecondaryLabel?: string;
  reportedAt: string;
  updatedAt: Date | string | null | undefined;
  descriptionPreview: string | null;
  displayTitle: string;
  checklistSummary: string | null;
};

const toDate = (value: Date | string | null | undefined) => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const getChecklistSummary = (checklists: BoardListViewCard["checklists"]) => {
  const total = checklists.reduce(
    (count, checklist) => count + checklist.items.length,
    0,
  );
  if (total === 0) return null;

  const completed = checklists.reduce(
    (count, checklist) =>
      count + checklist.items.filter((item) => item.completed).length,
    0,
  );

  return `${completed}/${total}`;
};

const getDisplayItem = (
  items: BoardCardDisplayItem[],
  key: BoardCardDisplayField,
) => items.find((item) => item.key === key);

const getCustomerLabel = (
  metadata: BoardCardSupportMetadata | null | undefined,
  members: BoardListViewCard["members"],
) => {
  const label = [
    metadata?.customerName,
    metadata?.email,
    metadata?.userId,
    members[0]?.user?.name,
    members[0]?.user?.email,
    members[0]?.email,
  ].find((value) => value?.trim());

  return label ?? t`Unassigned`;
};

const getCustomerSecondaryLabel = (
  primaryLabel: string,
  displayItems: BoardCardDisplayItem[],
) => {
  const candidates = [
    getDisplayItem(displayItems, "email")?.title,
    getDisplayItem(displayItems, "userId")?.value,
    getDisplayItem(displayItems, "emmaUserId")?.value,
  ];
  return candidates.find(
    (value) =>
      value?.trim() &&
      value.trim().toLowerCase() !== primaryLabel.toLowerCase(),
  );
};

const getSourceLabel = (displayItems: BoardCardDisplayItem[]) => {
  const values = [
    getDisplayItem(displayItems, "sourceChannel")?.value,
    getDisplayItem(displayItems, "sourceSystem")?.value,
    getDisplayItem(displayItems, "source")?.value,
  ].filter((value): value is string => Boolean(value?.trim()));

  return Array.from(new Set(values)).join(" / ");
};

const isRowControlTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest("a, button, input, select, textarea"));
};

export function BoardListView({
  cards,
  cardPrefix,
  selectedCardPublicId,
  visibleSupportFields,
  sortCriteria,
  isMobileBoard,
  isContextMenuDisabled,
  onSelectCard,
  onOpenCard,
  onOpenMobileCardMenu,
  onOpenContextMenu,
}: {
  cards: BoardListViewItem[];
  cardPrefix: string;
  selectedCardPublicId: string | null;
  visibleSupportFields: BoardCardDisplayField[];
  sortCriteria: BoardSortCriterion[];
  isMobileBoard: boolean;
  isContextMenuDisabled: boolean;
  onSelectCard: (cardPublicId: string, listPublicId: string) => void;
  onOpenCard: (cardPublicId: string) => void;
  onOpenMobileCardMenu: (cardPublicId: string) => void;
  onOpenContextMenu: (event: MouseEvent, cardPublicId: string) => void;
}) {
  const { dateLocale } = useLocalisation();
  const [rowSelection, setRowSelection] = useState({});
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const displayCards = useMemo(() => {
    const filteredCards = cards.filter(
      ({ card }) => !card.publicId.startsWith("PLACEHOLDER"),
    );

    if (sortCriteria.length === 0) return filteredCards;

    return sortBoardListItems(filteredCards, sortCriteria);
  }, [cards, sortCriteria]);

  const formatDateTime = useCallback(
    (value: Date | string | null | undefined) => {
      const date = toDate(value);
      if (!date) return t`Unknown`;
      return format(date, "yyyy-MM-dd HH:mm:ss", { locale: dateLocale });
    },
    [dateLocale],
  );

  const formatSupportDateTime = useCallback(
    (value: Date | string) => {
      const date = toDate(value);
      if (!date) return "";
      return format(date, "yyyy-MM-dd HH:mm:ss", { locale: dateLocale });
    },
    [dateLocale],
  );

  const tableData = useMemo<BoardTableRow[]>(
    () =>
      displayCards.map((item) => {
        const { card } = item;
        const ticketNumber =
          card.cardNumber != null ? `${cardPrefix}-${card.cardNumber}` : "-";
        const displayItems = getBoardCardDisplayItems(
          card.supportTicketMetadata,
          visibleSupportFields,
          formatSupportDateTime,
        );
        const customerLabel = getCustomerLabel(
          card.supportTicketMetadata,
          card.members,
        );
        const updatedAt = card.updatedAt ?? card.createdAt;

        return {
          ...item,
          ticketNumber,
          displayItems,
          typeLabel:
            getDisplayItem(displayItems, "issueCategory")?.value ?? "-",
          sourceLabel: getSourceLabel(displayItems) || "-",
          externalId: getDisplayItem(displayItems, "externalId"),
          customerLabel,
          customerSecondaryLabel: getCustomerSecondaryLabel(
            customerLabel,
            displayItems,
          ),
          reportedAt: getDisplayItem(displayItems, "reportedAt")?.value ?? "-",
          updatedAt,
          descriptionPreview: getCardDescriptionPreview(card.description),
          displayTitle: card.supportTicketMetadata
            ? cleanSupportTitle(card.title)
            : card.title,
          checklistSummary: getChecklistSummary(card.checklists),
        };
      }),
    [cardPrefix, displayCards, formatSupportDateTime, visibleSupportFields],
  );

  const openRow = useCallback(
    (card: BoardListViewCard, listPublicId: string) => {
      onSelectCard(card.publicId, listPublicId);
      if (isMobileBoard) {
        onOpenMobileCardMenu(card.publicId);
        return;
      }
      onOpenCard(card.publicId);
    },
    [isMobileBoard, onOpenCard, onOpenMobileCardMenu, onSelectCard],
  );

  const handleRowKeyDown = (
    event: KeyboardEvent<HTMLTableRowElement>,
    card: BoardListViewCard,
    listPublicId: string,
  ) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openRow(card, listPublicId);
  };

  const statusOptions = useMemo(
    () => Array.from(new Set(tableData.map((row) => row.list.name))).sort(),
    [tableData],
  );
  const urgencyOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tableData
            .map((row) => row.card.priority)
            .filter((value): value is CardPriority => Boolean(value)),
        ),
      ),
    [tableData],
  );
  const sourceOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tableData
            .map((row) => row.sourceLabel)
            .filter((value) => value && value !== "-"),
        ),
      ).sort(),
    [tableData],
  );

  const columns = useMemo<ColumnDef<BoardTableRow>[]>(
    () => [
      {
        id: "actions",
        cell: ({ row }) => (
          <div onClick={(event) => event.stopPropagation()}>
            <Dropdown
              items={[
                {
                  label: "Open card",
                  icon: <HiOutlineArrowTopRightOnSquare className="size-4" />,
                  action: () =>
                    openRow(row.original.card, row.original.list.publicId),
                },
                {
                  label: "Copy ticket ID",
                  icon: <HiOutlineClipboard className="size-4" />,
                  action: () =>
                    void navigator.clipboard.writeText(
                      row.original.ticketNumber,
                    ),
                },
              ]}
            >
              <HiEllipsisHorizontal className="size-4" />
              <span className="sr-only">Open row actions</span>
            </Dropdown>
          </div>
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        id: "select",
        header: ({ table }) => (
          <Checkbox
            checked={
              table.getIsAllPageRowsSelected() ||
              (table.getIsSomePageRowsSelected() && "indeterminate")
            }
            onCheckedChange={(value) =>
              table.toggleAllPageRowsSelected(!!value)
            }
            onClick={(event) => event.stopPropagation()}
            aria-label="Select all"
          />
        ),
        cell: ({ row }) => (
          <Checkbox
            checked={row.getIsSelected()}
            onCheckedChange={(value) => row.toggleSelected(!!value)}
            onClick={(event) => event.stopPropagation()}
            aria-label="Select row"
          />
        ),
        enableSorting: false,
        enableHiding: false,
      },
      {
        accessorKey: "ticketNumber",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Ticket`} />
        ),
        cell: ({ row }) => (
          <span className="font-mono text-xs font-semibold text-light-950 dark:text-dark-950">
            {row.original.ticketNumber}
          </span>
        ),
      },
      {
        accessorKey: "displayTitle",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Subject`} />
        ),
        cell: ({ row }) => {
          const { card, descriptionPreview, displayTitle } = row.original;
          return (
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <span className="min-w-0 truncate font-medium">
                  {displayTitle}
                </span>
                {card.labels.slice(0, 2).map((label) => (
                  <span
                    key={label.publicId ?? label.name}
                    className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-light-300 bg-light-100 px-1.5 py-0.5 text-[11px] font-medium text-light-950 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-950"
                  >
                    <LabelIcon colourCode={label.colourCode} />
                    <span className="max-w-[6rem] truncate">{label.name}</span>
                  </span>
                ))}
              </div>
              {descriptionPreview && (
                <p className="mt-1 truncate text-xs text-light-900 dark:text-dark-900">
                  {descriptionPreview}
                </p>
              )}
            </div>
          );
        },
      },
      {
        accessorKey: "customerLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Customer`} />
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">
              {row.original.customerLabel}
            </div>
            {row.original.customerSecondaryLabel && (
              <div className="truncate font-mono text-xs text-light-800 dark:text-dark-800">
                {row.original.customerSecondaryLabel}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "typeLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Type`} />
        ),
        cell: ({ row }) => (
          <span className="truncate text-light-950 dark:text-dark-950">
            {row.original.typeLabel}
          </span>
        ),
      },
      {
        accessorFn: (row) => row.card.priority ?? "",
        id: "urgency",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Urgency`} />
        ),
        cell: ({ row }) =>
          row.original.card.priority ? (
            <span
              className={cn(
                "inline-flex rounded border px-1.5 py-0.5 text-[11px] font-semibold capitalize leading-4",
                priorityStyles[row.original.card.priority],
              )}
            >
              {row.original.card.priority}
            </span>
          ) : (
            <span className="text-light-800 dark:text-dark-800">{t`None`}</span>
          ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        accessorFn: (row) => row.list.name,
        id: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Status`} />
        ),
        cell: ({ row }) => (
          <span className="inline-flex max-w-full rounded-sm border border-light-300 bg-light-100 px-2 py-0.5 text-xs font-medium text-light-950 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-950">
            <span className="truncate">{row.original.list.name}</span>
          </span>
        ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        accessorKey: "sourceLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Source`} />
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate">{row.original.sourceLabel}</div>
            {row.original.externalId && (
              <div
                className="truncate font-mono text-xs text-light-800 dark:text-dark-800"
                title={row.original.externalId.title}
              >
                {row.original.externalId.value}
              </div>
            )}
          </div>
        ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        accessorFn: (row) => toDate(row.updatedAt)?.getTime() ?? 0,
        id: "updatedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Updated`} />
        ),
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-1 text-xs text-light-950 dark:text-dark-950">
            <HiOutlineClock className="h-4 w-4 shrink-0 text-light-800 dark:text-dark-800" />
            <span className="truncate">
              {formatDateTime(row.original.updatedAt)}
            </span>
          </div>
        ),
      },
      {
        accessorKey: "reportedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Reported`} />
        ),
        cell: ({ row }) => (
          <span className="block truncate text-xs text-light-950 dark:text-dark-950">
            {row.original.reportedAt}
          </span>
        ),
      },
      {
        id: "activity",
        header: () => (
          <div className="font-semibold text-foreground">{t`Activity`}</div>
        ),
        cell: ({ row }) => (
          <div className="flex flex-wrap gap-2 text-xs text-light-800 dark:text-dark-800">
            {row.original.card.comments.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <HiChatBubbleLeft className="h-4 w-4" />
                {row.original.card.comments.length}
              </span>
            )}
            {row.original.card.attachments &&
              row.original.card.attachments.length > 0 && (
                <span className="inline-flex items-center gap-1">
                  <HiOutlinePaperClip className="h-4 w-4" />
                  {row.original.card.attachments.length}
                </span>
              )}
            {row.original.checklistSummary && (
              <span>{row.original.checklistSummary}</span>
            )}
            {!row.original.card.comments.length &&
              !row.original.card.attachments?.length &&
              !row.original.checklistSummary && <span>-</span>}
          </div>
        ),
        enableSorting: false,
      },
    ],
    [formatDateTime, openRow],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      sorting,
      pagination,
      rowSelection,
      columnFilters,
      columnVisibility,
      globalFilter,
    },
    enableRowSelection: true,
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _columnId, value) => {
      const search = String(value).toLowerCase();
      const item = row.original;
      return [
        item.ticketNumber,
        item.displayTitle,
        item.descriptionPreview,
        item.customerLabel,
        item.customerSecondaryLabel,
        item.typeLabel,
        item.sourceLabel,
        item.externalId?.value,
        item.list.name,
        item.card.priority,
      ].some((field) =>
        String(field ?? "")
          .toLowerCase()
          .includes(search),
      );
    },
    getPaginationRowModel: getPaginationRowModel(),
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  });

  if (tableData.length === 0) {
    return (
      <div className="z-10 mx-auto flex h-full w-full max-w-5xl flex-col items-center justify-center px-4 pb-[150px] text-center">
        <p className="mb-2 text-[14px] font-bold text-light-1000 dark:text-dark-950">
          {t`No cards match these filters`}
        </p>
        <p className="text-[14px] text-light-900 dark:text-dark-900">
          {t`Clear filters or add a card to this board.`}
        </p>
      </div>
    );
  }

  return (
    <div className="z-10 flex w-full flex-col gap-4 px-4 pb-28 md:px-8 md:pb-8">
      <DataTableToolbar
        table={table}
        searchPlaceholder={t`Search tickets, customers, sources...`}
        filters={[
          {
            columnId: "status",
            title: t`Status`,
            options: statusOptions.map((option) => ({
              label: option,
              value: option,
            })),
          },
          {
            columnId: "urgency",
            title: t`Urgency`,
            options: urgencyOptions.map((option) => ({
              label: option,
              value: option,
            })),
          },
          {
            columnId: "sourceLabel",
            title: t`Source`,
            options: sourceOptions.map((option) => ({
              label: option,
              value: option,
            })),
          },
        ]}
      />
      <div className="overflow-hidden rounded-md border border-border">
        <Table className="min-w-[1160px] table-fixed">
          <colgroup>
            <col className="w-[3rem]" />
            <col className="w-[3rem]" />
            <col className="w-[8rem]" />
            <col className="w-[25rem]" />
            <col className="w-[14rem]" />
            <col className="w-[8rem]" />
            <col className="w-[8rem]" />
            <col className="w-[9rem]" />
            <col className="w-[11rem]" />
            <col className="w-[11rem]" />
            <col className="w-[11rem]" />
            <col className="w-[7rem]" />
          </colgroup>
          <TableHeader className="sticky top-0 z-10">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id} className="group/row">
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                    className={tableHeaderClass}
                  >
                    {header.isPlaceholder
                      ? null
                      : flexRender(
                          header.column.columnDef.header,
                          header.getContext(),
                        )}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length ? (
              table.getRowModel().rows.map((row) => {
                const { card, list, displayTitle, ticketNumber } = row.original;
                const isSelected = selectedCardPublicId === card.publicId;
                const isRowSelected = row.getIsSelected();
                return (
                  <TableRow
                    key={card.publicId}
                    tabIndex={0}
                    role="button"
                    aria-label={`${ticketNumber} ${displayTitle}`}
                    onClickCapture={(event) => {
                      if (isRowControlTarget(event.target)) return;
                      openRow(card, list.publicId);
                    }}
                    onKeyDown={(event) =>
                      handleRowKeyDown(event, card, list.publicId)
                    }
                    onFocus={() => onSelectCard(card.publicId, list.publicId)}
                    onMouseEnter={() =>
                      onSelectCard(card.publicId, list.publicId)
                    }
                    onContextMenu={(event) => {
                      if (isContextMenuDisabled) return;
                      onOpenContextMenu(event, card.publicId);
                    }}
                    data-state={
                      isSelected || isRowSelected ? "selected" : undefined
                    }
                    className="group/row cursor-pointer focus:outline-none focus:ring-2 focus:ring-inset focus:ring-ring"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={tableCellClass}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext(),
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                );
              })
            ) : (
              <TableRow>
                <TableCell
                  colSpan={columns.length}
                  className="h-24 text-center"
                >
                  {t`No results found.`}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <DataTablePagination table={table} className="mt-auto" />
    </div>
  );
}
