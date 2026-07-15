import { t } from "@lingui/core/macro";
import { HiBars3BottomLeft, HiOutlineSquare3Stack3D } from "react-icons/hi2";
import { twMerge } from "tailwind-merge";

import type { BoardViewMode } from "../boardView";

const viewOptions: {
  mode: BoardViewMode;
  icon: JSX.Element;
}[] = [
  {
    mode: "board",
    icon: <HiOutlineSquare3Stack3D className="h-4 w-4" />,
  },
  {
    mode: "list",
    icon: <HiBars3BottomLeft className="h-4 w-4" />,
  },
];

export function BoardViewToggle({
  mode,
  isLoading,
  onChange,
}: {
  mode: BoardViewMode;
  isLoading: boolean;
  onChange: (mode: BoardViewMode) => void;
}) {
  return (
    <div className="inline-flex rounded-md border border-light-300 bg-light-50 p-0.5 shadow-sm dark:border-dark-300 dark:bg-dark-50">
      {viewOptions.map((option) => {
        const isActive = mode === option.mode;
        const label = option.mode === "board" ? t`Board` : t`List`;

        return (
          <button
            key={option.mode}
            type="button"
            aria-pressed={isActive}
            disabled={isLoading}
            onClick={() => onChange(option.mode)}
            className={twMerge(
              "inline-flex h-8 items-center justify-center gap-1.5 rounded-[5px] px-2.5 text-sm font-semibold text-light-950 transition disabled:cursor-not-allowed disabled:opacity-60 dark:text-dark-950",
              isActive
                ? "bg-light-1000 text-light-50 shadow-sm dark:bg-dark-1000 dark:text-dark-50"
                : "hover:bg-light-200 dark:hover:bg-dark-300",
            )}
          >
            {option.icon}
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
