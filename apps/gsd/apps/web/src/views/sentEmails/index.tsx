import type {
  ColumnDef,
  ColumnFiltersState,
  PaginationState,
  SortingState,
  VisibilityState,
} from "@tanstack/react-table";
import Link from "next/link";
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
import { HiOutlineArrowTopRightOnSquare } from "react-icons/hi2";

import type { SentEmailListItem } from "./sentEmails";
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
  getSentEmailCustomerLabel,
  getSentEmailCustomerSecondaryLabel,
  getSentEmailPurposeLabel,
  getSentEmailSentAt,
  getSentEmailStatusLabel,
  getSentEmailSubjectLabel,
} from "./sentEmails";

const tableHeaderClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";
const tableCellClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";

type SentEmailTableRow = SentEmailListItem & {
  subjectLabel: string;
  customerLabel: string;
  customerSecondaryLabel: string | null;
  purposeLabel: string;
  statusLabel: string;
  sentDate: Date | null;
};

export default function SentEmailsView() {
  const { workspace } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "sentAt", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = api.card.listSentEmails.useQuery(
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

  const tableData = useMemo<SentEmailTableRow[]>(
    () =>
      (data ?? []).map((item) => ({
        ...item,
        subjectLabel: getSentEmailSubjectLabel(item),
        customerLabel: getSentEmailCustomerLabel(item),
        customerSecondaryLabel: getSentEmailCustomerSecondaryLabel(item),
        purposeLabel: getSentEmailPurposeLabel(item),
        statusLabel: getSentEmailStatusLabel(item),
        sentDate: getSentEmailSentAt(item),
      })),
    [data],
  );

  const purposeOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tableData
            .map((row) => row.purposeLabel)
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

  const columns = useMemo<ColumnDef<SentEmailTableRow>[]>(
    () => [
      {
        accessorKey: "subjectLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Subject`} />
        ),
        cell: ({ row }) =>
          row.original.cardPublicId ? (
            <Link
              href={`/cards/${row.original.cardPublicId}`}
              className="block min-w-0 truncate font-medium hover:underline"
            >
              {row.original.subjectLabel}
            </Link>
          ) : (
            <span className="block min-w-0 truncate font-medium">
              {row.original.subjectLabel}
            </span>
          ),
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
        accessorKey: "purposeLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Purpose`} />
        ),
        cell: ({ row }) => (
          <span className="block truncate">{row.original.purposeLabel}</span>
        ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        accessorFn: (row) => row.sentDate?.getTime() ?? 0,
        id: "sentAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Sent`} />
        ),
        cell: ({ row }) => (
          <span className="block truncate text-xs text-light-950 dark:text-dark-950">
            {formatDateTime(row.original.sentDate)}
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
      {
        id: "cardLink",
        header: () => (
          <div className="font-semibold text-foreground">{t`Card`}</div>
        ),
        cell: ({ row }) =>
          row.original.cardPublicId ? (
            <Link
              href={`/cards/${row.original.cardPublicId}`}
              target="_blank"
              rel="noreferrer"
              aria-label={t`Open card in a new tab`}
              className="inline-flex items-center gap-1 text-xs text-light-900 hover:text-light-1000 dark:text-dark-900 dark:hover:text-dark-1000"
            >
              <HiOutlineArrowTopRightOnSquare className="size-4" />
              {t`Open`}
            </Link>
          ) : (
            <span className="text-light-800 dark:text-dark-800">-</span>
          ),
        enableSorting: false,
        enableHiding: false,
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
        item.customerLabel,
        item.customerSecondaryLabel,
        item.purposeLabel,
        item.statusLabel,
        item.cardTitle,
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
      <PageHead title={t`Sent Emails | ${workspace.name ?? t`Workspace`}`} />
      <div className="m-auto flex h-full w-full max-w-[1400px] flex-col p-8 px-5 md:px-12 md:py-12">
        <div className="mb-8 flex w-full items-center justify-between">
          <h1 className="font-bold tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
            {t`Sent Emails`}
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
              {t`No sent emails yet`}
            </p>
            <p className="text-[14px] text-light-900 dark:text-dark-900">
              {t`Customer-facing emails sent by the support agent will appear here.`}
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-4">
            <DataTableToolbar
              table={table}
              searchPlaceholder={t`Search subjects, customers, purposes...`}
              filters={[
                {
                  columnId: "purposeLabel",
                  title: t`Purpose`,
                  options: purposeOptions.map((option) => ({
                    label: option,
                    value: option,
                  })),
                },
                {
                  columnId: "statusLabel",
                  title: t`Status`,
                  options: statusOptions.map((option) => ({
                    label: option,
                    value: option,
                  })),
                },
              ]}
            />
            <div className="overflow-hidden rounded-md border border-border">
              <Table className="min-w-[960px] table-fixed">
                <colgroup>
                  <col className="w-[24rem]" />
                  <col className="w-[14rem]" />
                  <col className="w-[10rem]" />
                  <col className="w-[10rem]" />
                  <col className="w-[8rem]" />
                  <col className="w-[6rem]" />
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
