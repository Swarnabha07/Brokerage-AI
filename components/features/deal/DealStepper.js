import { Check } from "lucide-react";
import {
  DEAL_STATUS_META,
  DEAL_STATUS_ORDER,
} from "@/lib/constants/deal-status";
import { cn } from "@/lib/utils";

export function DealStepper({ status }) {
  const current = DEAL_STATUS_ORDER.indexOf(status);
  const total = DEAL_STATUS_ORDER.length;

  return (
    <div>
      <ol aria-label="Deal progress" className="flex items-center">
        {DEAL_STATUS_ORDER.map((key, i) => {
          const done = i < current;
          const active = i === current;
          return (
            <li
              key={key}
              aria-current={active ? "step" : undefined}
              className={cn("flex items-center", i < total - 1 && "flex-1")}
            >
              <div className="flex flex-col items-center gap-2">
                <span
                  className={cn(
                    "flex h-8 w-8 items-center justify-center rounded-full border text-xs font-medium transition-colors duration-500",
                    done && "border-transparent bg-brand-gradient text-white",
                    active && "border-brand-mid bg-brand-mid/15 text-brand-mid",
                    !done &&
                      !active &&
                      "border-border bg-muted text-muted-foreground",
                  )}
                >
                  {done ? (
                    <Check className="h-4 w-4" aria-hidden="true" />
                  ) : (
                    i + 1
                  )}
                </span>
                <span
                  className={cn(
                    "hidden text-xs lg:block",
                    active
                      ? "font-medium text-foreground"
                      : "text-muted-foreground",
                  )}
                >
                  {DEAL_STATUS_META[key].step}
                </span>
              </div>
              {i < total - 1 && (
                <span
                  aria-hidden="true"
                  className="mx-2 h-0.5 flex-1 overflow-hidden rounded-full bg-border lg:-mt-6"
                >
                  <span
                    className="block h-full bg-brand-gradient transition-[width] duration-500"
                    style={{ width: done ? "100%" : "0%" }}
                  />
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-sm text-muted-foreground lg:hidden">
        Step {current + 1} of {total}: {DEAL_STATUS_META[status].step}
      </p>
    </div>
  );
}
