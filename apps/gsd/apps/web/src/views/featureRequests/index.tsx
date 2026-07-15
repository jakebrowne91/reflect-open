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

import type { FeatureRequestListItem } from "./featureRequests";
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
import { cleanSupportTitle } from "~/utils/supportText";
import {
  getFeatureRequestCustomerLabel,
  getFeatureRequestCustomerSecondaryLabel,
  getFeatureRequestReportedAt,
  getFeatureRequestSourceLabel,
} from "./featureRequests";

const tableHeaderClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";
const tableCellClass =
  "bg-background group-hover/row:bg-muted group-data-[state=selected]/row:bg-muted";

type FeatureRequestTableRow = FeatureRequestListItem & {
  displayTitle: string;
  customerLabel: string;
  customerSecondaryLabel: string | null;
  sourceLabel: string;
  reportedDate: Date | null;
};

export default function FeatureRequestsView() {
  const { workspace } = useWorkspace();
  const { dateLocale } = useLocalisation();
  const [sorting, setSorting] = useState<SortingState>([
    { id: "reportedAt", desc: true },
  ]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 20,
  });

  const { data, isLoading } = api.card.listFeatureRequests.useQuery(
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

  const tableData = useMemo<FeatureRequestTableRow[]>(
    () =>
      (data ?? []).map((item) => ({
        ...item,
        displayTitle: cleanSupportTitle(item.title),
        customerLabel: getFeatureRequestCustomerLabel(item),
        customerSecondaryLabel: getFeatureRequestCustomerSecondaryLabel(item),
        sourceLabel: getFeatureRequestSourceLabel(item),
        reportedDate: getFeatureRequestReportedAt(item),
      })),
    [data],
  );

  const statusOptions = useMemo(
    () =>
      Array.from(
        new Set(
          tableData
            .map((row) => row.listName)
            .filter((value): value is string => Boolean(value)),
        ),
      ).sort(),
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

  const columns = useMemo<ColumnDef<FeatureRequestTableRow>[]>(
    () => [
      {
        accessorKey: "displayTitle",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Title`} />
        ),
        cell: ({ row }) => (
          <Link
            href={`/cards/${row.original.cardPublicId}`}
            className="block min-w-0 truncate font-medium hover:underline"
          >
            {row.original.displayTitle}
          </Link>
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
        accessorKey: "sourceLabel",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Source`} />
        ),
        cell: ({ row }) => (
          <span className="block truncate">{row.original.sourceLabel}</span>
        ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        accessorFn: (row) => row.reportedDate?.getTime() ?? 0,
        id: "reportedAt",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Reported`} />
        ),
        cell: ({ row }) => (
          <span className="block truncate text-xs text-light-950 dark:text-dark-950">
            {formatDateTime(row.original.reportedDate)}
          </span>
        ),
      },
      {
        accessorFn: (row) => row.listName ?? "",
        id: "status",
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={t`Status`} />
        ),
        cell: ({ row }) =>
          row.original.listName ? (
            <span className="inline-flex max-w-full rounded-sm border border-light-300 bg-light-100 px-2 py-0.5 text-xs font-medium text-light-950 dark:border-dark-300 dark:bg-dark-100 dark:text-dark-950">
              <span className="truncate">{row.original.listName}</span>
            </span>
          ) : (
            <span className="text-light-800 dark:text-dark-800">-</span>
          ),
        filterFn: (row, id, value) =>
          Array.isArray(value) && value.includes(row.getValue(id)),
      },
      {
        id: "cardLink",
        header: () => (
          <div className="font-semibold text-foreground">{t`Card`}</div>
        ),
        cell: ({ row }) => (
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
        item.displayTitle,
        item.customerLabel,
        item.customerSecondaryLabel,
        item.sourceLabel,
        item.listName,
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
      <PageHead
        title={t`Feature Requests | ${workspace.name ?? t`Workspace`}`}
      />
      <div className="m-auto flex h-full w-full max-w-[1400px] flex-col p-8 px-5 md:px-12 md:py-12">
        <div className="mb-8 flex w-full items-center justify-between">
          <h1 className="font-bold tracking-tight text-neutral-900 dark:text-dark-1000 sm:text-[1.2rem]">
            {t`Feature Requests`}
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
              {t`No feature requests yet`}
            </p>
            <p className="text-[14px] text-light-900 dark:text-dark-900">
              {t`Support tickets categorised as feature requests will appear here.`}
            </p>
          </div>
        ) : (
          <div className="flex w-full flex-col gap-4">
            <DataTableToolbar
              table={table}
              searchPlaceholder={t`Search requests, customers, sources...`}
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
              <Table className="min-w-[960px] table-fixed">
                <colgroup>
                  <col className="w-[24rem]" />
                  <col className="w-[14rem]" />
                  <col className="w-[10rem]" />
                  <col className="w-[10rem]" />
                  <col className="w-[10rem]" />
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
                      <TableRow
                        key={row.original.cardPublicId}
                        className="group/row"
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
