import type { Column } from "@tanstack/react-table";
import type * as React from "react";
import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { HiCheck, HiMiniPlusCircle } from "react-icons/hi2";

import { Badge } from "~/components/ui/badge";
import { cn } from "~/utils/cn";

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>;
  title?: string;
  options: {
    label: string;
    value: string;
    icon?: React.ComponentType<{ className?: string }>;
  }[];
}

export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues();
  const selectedValues = new Set(column?.getFilterValue() as string[]);

  const toggleValue = (value: string) => {
    const nextValues = new Set(selectedValues);
    if (nextValues.has(value)) {
      nextValues.delete(value);
    } else {
      nextValues.add(value);
    }

    const filterValues = Array.from(nextValues);
    column?.setFilterValue(filterValues.length ? filterValues : undefined);
  };

  return (
    <Menu as="div" className="relative inline-block text-start">
      <Menu.Button className="inline-flex h-8 items-center justify-center gap-2 whitespace-nowrap rounded-md border border-dashed border-border bg-background px-3 text-sm font-medium text-foreground shadow-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground">
        <HiMiniPlusCircle className="size-4" />
        {title}
        {selectedValues.size > 0 && (
          <>
            <span className="mx-1 h-4 w-px bg-border" />
            <Badge
              variant="secondary"
              className="rounded-sm px-1 font-normal lg:hidden"
            >
              {selectedValues.size}
            </Badge>
            <span className="hidden space-x-1 lg:flex">
              {selectedValues.size > 2 ? (
                <Badge
                  variant="secondary"
                  className="rounded-sm px-1 font-normal"
                >
                  {selectedValues.size} selected
                </Badge>
              ) : (
                options
                  .filter((option) => selectedValues.has(option.value))
                  .map((option) => (
                    <Badge
                      variant="secondary"
                      key={option.value}
                      className="rounded-sm px-1 font-normal"
                    >
                      {option.label}
                    </Badge>
                  ))
              )}
            </span>
          </>
        )}
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
        <Menu.Items className="absolute left-0 z-50 mt-2 w-[12.5rem] origin-top-left overflow-hidden rounded-md border border-border bg-popover p-1 text-popover-foreground shadow-md outline-none">
          <div className="max-h-72 overflow-y-auto">
            {options.length ? (
              options.map((option) => {
                const isSelected = selectedValues.has(option.value);
                return (
                  <Menu.Item key={option.value}>
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-start text-sm text-foreground outline-none hover:bg-accent hover:text-accent-foreground"
                      onClick={(event) => {
                        event.preventDefault();
                        toggleValue(option.value);
                      }}
                    >
                      <span
                        className={cn(
                          "flex size-4 items-center justify-center rounded-sm border border-primary",
                          isSelected
                            ? "bg-primary text-primary-foreground"
                            : "opacity-50",
                        )}
                      >
                        {isSelected && <HiCheck className="size-3" />}
                      </span>
                      {option.icon && (
                        <option.icon className="size-4 text-muted-foreground" />
                      )}
                      <span>{option.label}</span>
                      {facets?.get(option.value) && (
                        <span className="ms-auto flex size-4 items-center justify-center font-mono text-xs">
                          {facets.get(option.value)}
                        </span>
                      )}
                    </button>
                  </Menu.Item>
                );
              })
            ) : (
              <div className="px-2 py-6 text-center text-sm text-muted-foreground">
                No results found.
              </div>
            )}
          </div>
          {selectedValues.size > 0 && (
            <div className="border-t border-border pt-1">
              <Menu.Item>
                <button
                  type="button"
                  className="flex w-full justify-center rounded-sm px-2 py-1.5 text-center text-sm text-foreground outline-none hover:bg-accent hover:text-accent-foreground"
                  onClick={(event) => {
                    event.preventDefault();
                    column?.setFilterValue(undefined);
                  }}
                >
                  Clear filters
                </button>
              </Menu.Item>
            </div>
          )}
        </Menu.Items>
      </Transition>
    </Menu>
  );
}
