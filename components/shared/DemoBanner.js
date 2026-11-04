import { FlaskConical } from "lucide-react";
import { DEMO_NOTICE } from "@/lib/config";

export function DemoBanner() {
  return (
    <div
      role="note"
      className="border-b border-warning/25 bg-warning-soft px-6 py-2 text-center text-xs text-warning"
    >
      <FlaskConical
        className="mr-1.5 inline h-3.5 w-3.5 align-[-2px]"
        aria-hidden="true"
      />
      {DEMO_NOTICE}
    </div>
  );
}
