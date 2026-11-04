import { cn } from "@/lib/utils";

const controlClass =
  "w-full rounded-xl border border-border bg-muted/40 px-4 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-brand-mid focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-brand-mid/40 aria-invalid:border-danger";

export function Field({ label, htmlFor, error, hint, children }) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="text-xs text-muted-foreground">{hint}</p>
      )}
      {error && (
        <p id={`${htmlFor}-error`} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function Input({ className, id, error, ...props }) {
  return (
    <input
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={cn(controlClass, "h-11", className)}
      {...props}
    />
  );
}

export function Textarea({ className, id, error, ...props }) {
  return (
    <textarea
      id={id}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${id}-error` : undefined}
      className={cn(controlClass, "min-h-28 py-3", className)}
      {...props}
    />
  );
}
