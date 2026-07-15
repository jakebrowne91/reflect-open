import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
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

import type { SpamRecordListItem } from "./spamRecords";
import {
  DataTableColumnHeader,
  DataTablePagination,
  DataTableToolbar,
} from "~/components/data-table";
import { PageHead } from "~/components/PageHead";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "~/components/ui/table";
import { useLocalisation } from "~/hooks/useLocalisation";
import { useWorkspace } from "~/providers/workspace";
import { api } from "~/utils/api";
import {
  getSpamRecordCategoryLabel,
  getSpamRecordReasoning,
  getSpamRecordReceivedAt,
  getSpamRecordSenderLabel,
  getSpamRecordSenderSecondaryLabel,
  getSpamRecordStatusLabel,
  getSpamRecordSubjectLabel,
} from "./spamRecords";

const tableHeaderClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";
const tableCellClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";

type SpamRecordTableRow = SpamRecordListItem & {
  subjectLabel: string;
  senderLabel: string;
  senderSecondaryLabel: string | null;
  categoryLabel: string;
  reasoning: string | null;
  statusLabel: string;
  receivedDate: Date | null;
};

export default function SpamRecordsView() {
  const { workspace } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "receivedAt", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = api.card.listSpamRecords.useQuery(
    { workspacePublicId: workspace.publicId },
    { enabled: workspace.publicId ? true : false },
  );

  const formatDateTime = useCallback(
    (value: Date | null) => {
      if (!value) return t`Unknown`;
      return format(value, "yyyy-MM-dd HH:mm", { locale: dateLocale });
    },
    [dateLocale],
  );

  const tableData = useMemo<SpamRecordTableRow[]>(
    () =>
      (data ?? []).map((item) => ({
        ...item,
        subjectLabel: getSpamRecordSubjectLabel(item),
        senderLabel: getSpamRecordSenderLabel(item),
        senderSecondaryLabel: getSpamRecordSenderSecondaryLabel(item),
        categoryLabel: getSpamRecordCategoryLabel(item),
        reasoning: getSpamRecordReasoning(item),
        statusLabel: getSpamRecordStatusLabel(item),
        receivedDate: getSpamRecordReceivedAt(item),
      })),
    [data],
  );

  const categoryOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tableData
            .map((row) => row.categoryLabel)
            .filter((value) => value && value !== "-"),
        ),
      ).sort(),
    [tableData],
  );
  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tableData
            .map((row) => row.statusLabel)
            .filter((value) => value && value !== "-"),
        ),
      ).sort(),
    [tableData],
  );

  const columns = useMemo<ColumnDef<SpamRecordTableRow>[]>(
    () => [
      {
        accessorKey: "senderLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Sender`} />
        ),
        cell: ({ row }) => (
          <div className="min-w-0">
            <div className="truncate font-medium">
              {row.original.senderLabel}
            </div>
            {row.original.senderSecondaryLabel && (
              <div className="truncate font-mono text-xs text-light-800 dark:text-dark-800">
                {row.original.senderSecondaryLabel}
              </div>
            )}
          </div>
        ),
      },
      {
        accessorKey: "subjectLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Subject`} />
        ),
        cell: ({ row }) => (
          <span className="block min-w-0 truncate font-medium">
            {row.original.subjectLabel}
          </span>
        ),
      },
      {
        accessorKey: "categoryLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Category`} />
        ),
        cell: ({ row }) => (
          <span className="inline-flex max-w-full rounded-sm border border-light-300 bg-light-100 px-2 py-0.5 text-xs font-medium text-light-950 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-950">
            <span className="truncate">{row.original.categoryLabel}</span>
          </span>
        ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        accessorKey: "reasoning",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Reasoning`} />
        ),
        cell: ({ row }) => (
          <span
            className="block truncate text-xs text-light-950 dark:text-dark-950"
            title={row.original.reasoning ?? undefined}
          >
            {row.original.reasoning ?? "-"}
          </span>
        ),
        enableSorting: false,
      },
      {
        accessorFn: (row) => row.receivedDate?.getTime() ?? 0,
        id: "receivedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Received`} />
        ),
        cell: ({ row }) => (
          <span className="block truncate text-xs text-light-950 dark:text-dark-950">
            {formatDateTime(row.original.receivedDate)}
          </span>
        ),
      },
      {
        accessorKey: "statusLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Status`} />
        ),
        cell: ({ row }) => (
          <span className="inline-flex max-w-full rounded-sm border border-light-300 bg-light-100 px-2 py-0.5 text-xs font-medium text-light-950 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-950">
            <span className="truncate">{row.original.statusLabel}</span>
          </span>
        ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
    ],
    [formatDateTime],
  );

  const table = useReactTable({
    data: tableData,
    columns,
    state: {
      sorting,
      pagination,
      columnFilters,
      columnVisibility,
      globalFilter,
    },
    onPaginationChange: setPagination,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    globalFilterFn: (row, _columnId, value) => {
      const search = String(value).toLowerCase();
      const item = row.original;
      return [
        item.subjectLabel,
        item.senderLabel,
        item.senderSecondaryLabel,
        item.categoryLabel,
        item.reasoning,
        item.statusLabel,
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

  return (
    <>
      <PageHead title={t`Spam Records | ${workspace.name ?? t`Workspace`}`} />
      <div className="m-auto flex h-full w-full max-w-[1400px] flex-col p-8 px-5 md:px-12 md:py-12">
        <div className="mb-8 flex w-full items-center justify-between">
          <h1 className="font-bold tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
            {t`Spam Records`}
          </h1>
        </div>
        {isLoading ? (
          <div className="flex w-full flex-col gap-2">
            <div className="flex h-[40px] w-full animate-pulse rounded-md bg-light-200 dark:bg-dark-100" />
            <div className="flex h-[40px] w-full animate-pulse rounded-md bg-light-200 dark:bg-dark-100" />
            <div className="flex h-[40px] w-full animate-pulse rounded-md bg-light-200 dark:bg-dark-100" />
          </div>
        ) : tableData.length === 0 ? (
          <div className="z-10 flex h-full w-full flex-col items-center justify-center pb-[150px] text-center">
            <p className="mb-2 text-[14px] font-bold text-light-1000 dark:text-dark-950">
              {t`No spam records yet`}
            </p>
            <p className="text-[14px] text-light-900 dark:text-dark-900">
              {t`Emails classified as spam or non-issues will appear here.`}
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-4">
            <DataTableToolbar
              table={table}
              searchPlaceholder={t`Search senders, subjects, categories...`}
              filters={[
                {
                  columnId: "statusLabel",
                  title: t`Status`,
                  options: statusOptions.map((option) => ({
                    label: option,
                    value: option,
                  })),
                },
                {
                  columnId: "categoryLabel",
                  title: t`Category`,
                  options: categoryOptions.map((option) => ({
                    label: option,
                    value: option,
                  })),
                },
              ]}
            />
            <div className="overflow-hidden rounded-md border border-border">
              <Table className="min-w-[960px] table-fixed">
                <colgroup>
                  <col className="w-[14rem]" />
                  <col className="w-[20rem]" />
                  <col className="w-[8rem]" />
                  <col className="w-[18rem]" />
                  <col className="w-[10rem]" />
                  <col className="w-[8rem]" />
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
                    table.getRowModel().rows.map((row) => (
                      <TableRow key={row.original.id} className="group/row">
                        {row.getVisibleCells().map((cell) => (
                          <TableCell key={cell.id} className={tableCellClass}>
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
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
        )}
      </div>
    </>
  );
}
