import { GlassCard } from "@/components/shared/GlassCard";
import { EmptyState } from "@/components/shared/EmptyState";
import { cn } from "@/lib/utils";

/**
 * Presentational transaction table and the single swap point for a data-grid
 * library later. Keep the props generic:
 *   columns: [{ key, header, align?: "right", render?: (row) => node }]
 *   rows:    array of objects with an `id`
 * A grid integration only needs to replace this file.
 */
export function TransactionsTable({
  caption,
  columns,
  rows,
  emptyTitle,
  emptyDescription,
}) {
  return (
    <GlassCard hover={false} className="overflow-hidden">
      {rows.length === 0 ? (
        <EmptyState
          title={emptyTitle ?? "Nothing here yet"}
          description={emptyDescription}
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <caption className="sr-only">{caption}</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wider text-muted-foreground">
                {columns.map((col) => (
                  <th
                    key={col.key}
                    scope="col"
                    className={cn(
                      "px-5 py-4 font-medium",
                      col.align === "right" && "text-right",
                    )}
                  >
                    {col.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.id}
                  className={
                    i !== rows.length - 1
                      ? "border-b border-border/60"
                      : undefined
                  }
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={cn(
                        "px-5 py-4",
                        col.align === "right" && "text-right font-tabular",
                      )}
                    >
                      {col.render ? col.render(row) : row[col.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </GlassCard>
  );
}
