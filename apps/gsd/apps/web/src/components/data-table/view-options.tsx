import type { Table } from "@tanstack/react-table";
import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { HiAdjustmentsHorizontal } from "react-icons/hi2";

interface DataTableViewOptionsProps<TData> {
  table: Table<TData>;
}

export function DataTableViewOptions<TData>({
  table,
}: DataTableViewOptionsProps<TData>) {
  return (
    <Menu as="div" className="relative ms-auto hidden text-start lg:block">
      <Menu.Button className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground">
        <HiAdjustmentsHorizontal className="size-4" />
        View
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
        <Menu.Items className="absolute right-0 z-50 mt-2 w-[9.375rem] origin-top-right overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
          <div className="px-2 py-1.5 text-sm font-medium">Toggle columns</div>
          <div className="-mx-1 my-1 h-px bg-border" />
          {table
            .getAllColumns()
            .filter(
              (column) =>
                typeof column.accessorFn !== "undefined" && column.getCanHide(),
            )
            .map((column) => {
              const isVisible = column.getIsVisible();
              return (
                <Menu.Item key={column.id}>
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isVisible}
                    className="flex w-full cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm capitalize text-foreground hover:bg-accent hover:text-accent-foreground"
                    onClick={(event) => {
                      event.preventDefault();
                      column.toggleVisibility(!isVisible);
                    }}
                  >
                    <span
                      className={
                        isVisible
                          ? "size-4 rounded border border-primary bg-primary"
                          : "size-4 rounded border border-input bg-background"
                      }
                    />
                    {column.id}
                  </button>
                </Menu.Item>
              );
            })}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
