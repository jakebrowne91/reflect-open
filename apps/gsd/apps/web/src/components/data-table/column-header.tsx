import type { Column } from "@tanstack/react-table";
import type * as React from "react";
import { HiArrowDown, HiArrowsUpDown, HiArrowUp } from "react-icons/hi2";

import { Button } from "~/components/ui/button";
import { cn } from "~/utils/cn";

type DataTableColumnHeaderProps<TData, TValue> =
  React.HTMLAttributes<HTMLDivElement> & {
    column: Column<TData, TValue>;
    title: string;
  };

export function DataTableColumnHeader<TData, TValue>({
  column,
  title,
  className,
}: DataTableColumnHeaderProps<TData, TValue>) {
  if (!column.getCanSort()) {
    return (
      <div className={cn("font-semibold text-foreground", className)}>
        {title}
      </div>
    );
  }

  const sorted = column.getIsSorted();

  const toggleSorting = () => {
    if (sorted === "asc") {
      column.toggleSorting(true);
      return;
    }
    if (sorted === "desc") {
      column.clearSorting();
      return;
    }
    column.toggleSorting(false);
  };

  return (
    <div className={cn("flex items-center gap-2 text-foreground", className)}>
      <Button
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-sm font-semibold text-foreground hover:text-foreground"
        onClick={toggleSorting}
        aria-sort={
          sorted === "asc"
            ? "ascending"
            : sorted === "desc"
              ? "descending"
              : "none"
        }
      >
        <span>{title}</span>
        {sorted === "desc" ? (
          <HiArrowDown className="ms-2 size-4 text-muted-foreground" />
        ) : sorted === "asc" ? (
          <HiArrowUp className="ms-2 size-4 text-muted-foreground" />
        ) : (
          <HiArrowsUpDown className="ms-2 size-4 text-muted-foreground" />
        )}
      </Button>
    </div>
  );
}
