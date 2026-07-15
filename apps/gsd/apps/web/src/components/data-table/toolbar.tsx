import type { Table } from "@tanstack/react-table";
import type * as React from "react";
import { HiXMark } from "react-icons/hi2";

import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { DataTableFacetedFilter } from "./faceted-filter";
import { DataTableViewOptions } from "./view-options";

interface DataTableToolbarProps<TData> {
  table: Table<TData>;
  searchPlaceholder?: string;
  searchKey?: string;
  filters?: {
    columnId: string;
    title: string;
    options: {
      label: string;
      value: string;
      icon?: React.ComponentType<{ className?: string }>;
    }[];
  }[];
}

export function DataTableToolbar<TData>({
  table,
  searchPlaceholder = "Filter...",
  searchKey,
  filters = [],
}: DataTableToolbarProps<TData>) {
  const globalFilterValue = String(table.getState().globalFilter ?? "");
  const searchColumn = searchKey ? table.getColumn(searchKey) : undefined;
  const searchColumnFilterValue = searchColumn?.getFilterValue();
  const isFiltered =
    table.getState().columnFilters.length > 0 || globalFilterValue.length > 0;

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-1 flex-col-reverse items-start gap-y-2 sm:flex-row sm:items-center sm:space-x-2">
        {searchKey ? (
          <Input
            placeholder={searchPlaceholder}
            value={
              typeof searchColumnFilterValue === "string"
                ? searchColumnFilterValue
                : ""
            }
            onChange={(event) =>
              searchColumn?.setFilterValue(event.target.value)
            }
            className="h-8 w-[9.375rem] lg:w-[15.625rem]"
          />
        ) : (
          <Input
            placeholder={searchPlaceholder}
            value={globalFilterValue}
            onChange={(event) => table.setGlobalFilter(event.target.value)}
            className="h-8 w-[9.375rem] lg:w-[15.625rem]"
          />
        )}
        <div className="flex flex-wrap gap-2">
          {filters.map((filter) => {
            const column = table.getColumn(filter.columnId);
            if (!column) return null;
            return (
              <DataTableFacetedFilter
                key={filter.columnId}
                column={column}
                title={filter.title}
                options={filter.options}
              />
            );
          })}
        </div>
        {isFiltered && (
          <Button
            variant="ghost"
            onClick={() => {
              table.resetColumnFilters();
              table.setGlobalFilter("");
            }}
            className="h-8 px-2 lg:px-3"
          >
            Reset
            <HiXMark className="ms-2 size-4" />
          </Button>
        )}
      </div>
      <DataTableViewOptions table={table} />
    </div>
  );
}
