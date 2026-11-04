import { GlassCard } from "@/components/shared/GlassCard";
import { AnimatedCounter } from "@/components/shared/AnimatedCounter";

export function StatCard({
  icon: Icon,
  label,
  value,
  currency = true,
  delay = 0,
  note,
}) {
  return (
    <GlassCard delay={delay} className="p-5">
      <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
        <Icon className="h-4 w-4 text-brand-mid" aria-hidden="true" />
      </div>
      <div className="font-display font-tabular text-2xl font-semibold">
        <AnimatedCounter value={value} currency={currency} />
      </div>
      <div className="text-sm text-muted-foreground">{label}</div>
      {note && (
        <div className="mt-1 text-xs text-muted-foreground/80">{note}</div>
      )}
    </GlassCard>
  );
}
