"use client";

import * as React from "react";

/* ============================================================
   Outlight UI primitives — the uniform building blocks of the OS.
   All styled with design-system tokens (bg-surface, text-ink,
   border-line, text-brand, …). Prefer these over inline styling.
   ============================================================ */

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/* ---------------- Button ---------------- */
type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
type ButtonSize = "sm" | "md" | "lg";

const BTN_BASE =
  "inline-flex items-center justify-center gap-2 font-semibold rounded-lg transition disabled:opacity-50 disabled:pointer-events-none whitespace-nowrap select-none";

const BTN_VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-brand text-on-brand hover:bg-brand-hover shadow-sm",
  secondary:
    "bg-surface text-ink border border-line hover:border-line-strong hover:bg-surface-2",
  ghost: "text-ink-2 hover:text-ink hover:bg-canvas-2",
  subtle: "bg-canvas-2 text-ink hover:bg-line",
  danger: "bg-danger text-white hover:opacity-90 shadow-sm",
};

const BTN_SIZE: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-[15px]",
};

export const Button = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
  }
>(function Button({ variant = "primary", size = "md", className, ...props }, ref) {
  return (
    <button ref={ref} className={cn(BTN_BASE, BTN_VARIANT[variant], BTN_SIZE[size], className)} {...props} />
  );
});

/* ---------------- IconButton ---------------- */
export const IconButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }
>(function IconButton({ variant = "secondary", className, ...props }, ref) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-lg transition",
        BTN_VARIANT[variant],
        className
      )}
      {...props}
    />
  );
});

/* ---------------- Card ---------------- */
export function Card({
  className,
  children,
  as: Tag = "div",
  ...props
}: React.HTMLAttributes<HTMLElement> & { as?: any }) {
  return (
    <Tag className={cn("bg-surface border border-line rounded-xl shadow", className)} {...props}>
      {children}
    </Tag>
  );
}

/* ---------------- SectionLabel (eyebrow) ---------------- */
export function SectionLabel({
  children,
  icon,
  className,
  right,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  right?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center justify-between gap-2", className)}>
      <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.09em] text-ink-3">
        {icon ? (
          <span className="grid h-5 w-5 place-items-center rounded-md bg-brand-soft text-brand text-[11px]">
            {icon}
          </span>
        ) : null}
        {children}
      </div>
      {right}
    </div>
  );
}

/* ---------------- Badge ---------------- */
type BadgeTone = "neutral" | "brand" | "accent" | "danger";
const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: "bg-canvas-2 text-ink-2",
  brand: "bg-brand-soft text-brand",
  accent: "bg-accent-soft text-accent",
  danger: "bg-danger-soft text-danger",
};
export function Badge({
  tone = "neutral",
  className,
  children,
}: {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold",
        BADGE_TONE[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/* ---------------- Spinner ---------------- */
export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-accent/30 border-t-accent",
        className
      )}
      aria-hidden
    />
  );
}

/* ---------------- Field + controls ---------------- */
export function Field({
  label,
  children,
  className,
}: {
  label?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="mb-1.5 block text-xs font-semibold text-ink-2">{label}</span> : null}
      {children}
    </label>
  );
}

const CONTROL =
  "w-full rounded-lg border border-line bg-surface-2 text-ink text-sm font-medium px-3 transition hover:border-line-strong focus:border-brand focus:bg-surface focus:outline-none focus:ring-2 focus:ring-brand/25";

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, ...props }, ref) {
    return <select ref={ref} className={cn(CONTROL, "h-10 cursor-pointer", className)} {...props} />;
  }
);

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return <input ref={ref} className={cn(CONTROL, "h-10", className)} {...props} />;
  }
);

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} className={cn(CONTROL, "py-3 leading-relaxed resize-none", className)} {...props} />;
  }
);

/* ---------------- Segmented control ---------------- */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  className,
}: {
  options: Array<{ value: T; label: React.ReactNode }>;
  value: T;
  onChange: (v: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex rounded-full bg-canvas-2 p-0.5", className)}>
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "rounded-full px-3 py-1.5 text-xs font-semibold transition",
            value === o.value ? "bg-surface text-ink shadow-sm" : "text-ink-2 hover:text-ink"
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
