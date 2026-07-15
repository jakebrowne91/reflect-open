import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import {
  HiCheck,
  HiMiniXMark,
  HiOutlineEye,
  HiOutlineSquares2X2,
} from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { BoardCardDisplayField } from "../cardDisplay";
import Button from "~/components/Button";
import {
  boardCardDisplayOptions,
  defaultBoardCardDisplayFields,
} from "../cardDisplay";

export function BoardCardFieldsDropdown({
  visibleFields,
  isLoading,
  onChange,
}: {
  visibleFields: BoardCardDisplayField[];
  isLoading: boolean;
  onChange: (fields: BoardCardDisplayField[]) => void;
}) {
  const isDefaultSelection =
    visibleFields.length === defaultBoardCardDisplayFields.length;

  return (
    <Menu as="div" className="relative inline-block text-left">
      <Menu.Button as="div" className="cursor-pointer">
        <Button
          type="button"
          variant={isDefaultSelection ? "secondary" : "primary"}
          disabled={isLoading}
          iconLeft={<HiOutlineEye />}
        >
          Fields
        </Button>
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
        <Menu.Items className="absolute left-0 z-[100] mt-2 w-72 origin-top-left rounded-md border border-light-200 bg-white p-2 shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none dark:border-dark-400 dark:bg-dark-300">
          <BoardCardFieldsMenuContent
            visibleFields={visibleFields}
            onChange={onChange}
          />
        </Menu.Items>
      </Transition>
    </Menu>
  );
}

export function BoardCardFieldsMenuContent({
  visibleFields,
  onChange,
}: {
  visibleFields: BoardCardDisplayField[];
  onChange: (fields: BoardCardDisplayField[]) => void;
}) {
  const visibleFieldSet = new Set(visibleFields);
  const isDefaultSelection =
    visibleFields.length === defaultBoardCardDisplayFields.length;

  const updateFields = (fields: BoardCardDisplayField[]) => {
    onChange(fields);
  };

  const toggleField = (field: BoardCardDisplayField) => {
    if (visibleFieldSet.has(field)) {
      updateFields(
        visibleFields.filter((visibleField) => visibleField !== field),
      );
      return;
    }

    updateFields(
      defaultBoardCardDisplayFields.filter(
        (defaultField) =>
          defaultField === field || visibleFieldSet.has(defaultField),
      ),
    );
  };

  return (
    <>
      <div className="flex items-center justify-between gap-2 px-1 pb-2">
        <div className="flex min-w-0 items-center gap-2 text-xs font-semibold uppercase text-dark-800">
          <HiOutlineSquares2X2 className="h-4 w-4 flex-shrink-0" />
          <span>Card fields</span>
        </div>
        <span className="text-xs text-dark-800">
          {visibleFields.length}/{defaultBoardCardDisplayFields.length}
        </span>
      </div>

      <div className="mb-2 grid grid-cols-2 gap-1">
        <button
          type="button"
          onClick={() => updateFields(defaultBoardCardDisplayFields)}
          className="rounded-[5px] px-2 py-1.5 text-xs font-medium text-dark-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-400"
          disabled={isDefaultSelection}
        >
          Show all
        </button>
        <button
          type="button"
          onClick={() => updateFields([])}
          className="flex items-center justify-center gap-1 rounded-[5px] px-2 py-1.5 text-xs font-medium text-dark-900 hover:bg-light-200 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-dark-400"
          disabled={visibleFields.length === 0}
        >
          <HiMiniXMark className="h-4 w-4" />
          Hide all
        </button>
      </div>

      <div className="flex flex-col gap-1">
        {boardCardDisplayOptions.map((option) => {
          const isSelected = visibleFieldSet.has(option.key);

          return (
            <label
              key={option.key}
              className="flex cursor-pointer items-center gap-2 rounded-[5px] px-2 py-1.5 text-sm text-neutral-900 hover:bg-light-200 dark:text-dark-950 dark:hover:bg-dark-400"
            >
              <input
                type="checkbox"
                className="h-[14px] w-[14px] rounded bg-transparent"
                checked={isSelected}
                onChange={() => toggleField(option.key)}
              />
              <span className="min-w-0 flex-1">{option.label}</span>
              <HiCheck
                className={twMerge(
                  "h-4 w-4 text-dark-900",
                  !isSelected && "invisible",
                )}
              />
            </label>
          );
        })}
      </div>
    </>
  );
}
