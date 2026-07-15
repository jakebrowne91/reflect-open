import type * as React from "react";
import { useEffect, useRef } from "react";

import { cn } from "~/utils/cn";

type CheckboxChecked = boolean | "indeterminate";

function Checkbox({
  className,
  checked,
  onCheckedChange,
  ...props
}: Omit<React.ComponentProps<"input">, "checked" | "onChange" | "type"> & {
  checked?: CheckboxChecked;
  onCheckedChange?: (checked: CheckboxChecked) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.indeterminate = checked === "indeterminate";
    }
  }, [checked]);

  return (
    <input
      ref={inputRef}
      type="checkbox"
      data-slot="checkbox"
      checked={checked === "indeterminate" ? false : checked}
      onChange={(event) => onCheckedChange?.(event.target.checked)}
      className={cn(
        "focus-visible:ring-ring/30 peer size-4 shrink-0 rounded border border-input bg-background shadow-sm outline-none transition-shadow checked:border-primary checked:bg-primary focus-visible:border-ring focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Checkbox };
