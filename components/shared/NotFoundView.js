import Link from "next/link";
import { Search } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { buttonVariants } from "@/components/ui/button";

export function NotFoundView({
  title = "Page not found",
  description,
  href = "/",
  linkLabel = "Back to home",
}) {
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <EmptyState
        icon={Search}
        title={title}
        description={
          description ??
          "We could not find what you were looking for. It may not exist in the sample data."
        }
      >
        <Link
          href={href}
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          {linkLabel}
        </Link>
      </EmptyState>
    </div>
  );
}
