"use client";

import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> & {
    indeterminate?: boolean;
  }
>(({ className, indeterminate, checked, ...props }, ref) => {
  const internalRef = React.useRef<HTMLButtonElement>(null);
  const combinedRef = (ref || internalRef) as React.MutableRefObject<HTMLButtonElement | null>;

  React.useEffect(() => {
    const element = combinedRef?.current;
    if (element) {
      if (indeterminate) {
        element.setAttribute('data-state', 'indeterminate');
        element.setAttribute('aria-checked', 'mixed');
      } else {
        element.removeAttribute('data-state');
        element.removeAttribute('aria-checked');
      }
    }
  }, [indeterminate, combinedRef]);

  return (
    <CheckboxPrimitive.Root
      ref={combinedRef as any}
      className={cn(
        "peer h-4 w-4 shrink-0 rounded-sm border border-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=indeterminate]:bg-primary/50 data-[state=indeterminate]:border-primary relative",
        className,
      )}
      checked={indeterminate ? false : checked}
      {...props}
    >
      <CheckboxPrimitive.Indicator
        className={cn("flex items-center justify-center text-current")}
      >
        {!indeterminate && <Check className="h-4 w-4" />}
      </CheckboxPrimitive.Indicator>
      {indeterminate && (
        <span className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="h-0.5 w-2.5 bg-primary-foreground rounded" />
        </span>
      )}
    </CheckboxPrimitive.Root>
  );
});
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };
