"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

export function SectionHeader({
  title,
  subtitle,
  actions,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
        {subtitle ? <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-none flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3 px-6 py-12 text-center", className)}>
      {icon ? <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-[color:var(--color-line)] bg-white/[0.025] text-muted">{icon}</span> : null}
      <div className="max-w-md">
        <p className="text-[13px] font-medium text-ink">{title}</p>
        {description ? <p className="mt-1 text-[12px] leading-relaxed text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "success" | "warn" | "danger";
}) {
  const color =
    tone === "accent"
      ? "text-[#b8c6ff]"
      : tone === "success"
        ? "text-[color:var(--color-success)]"
        : tone === "warn"
          ? "text-[color:var(--color-warn)]"
          : tone === "danger"
            ? "text-[color:var(--color-danger)]"
            : "text-ink";
  return (
    <div className="panel px-3.5 py-3">
      <p className="text-[10.5px] uppercase tracking-[0.08em] text-faint">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold leading-none tracking-tight", color)}>{value}</p>
      {hint ? <p className="mt-1.5 text-[11px] leading-snug text-muted">{hint}</p> : null}
    </div>
  );
}

export function ScoreRing({ score, size = 44, label }: { score: number; size?: number; label?: string }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  const stroke = clamped >= 80 ? "var(--color-success)" : clamped >= 60 ? "var(--color-warn)" : "var(--color-danger)";
  return (
    <span className="relative inline-flex flex-none items-center justify-center" style={{ width: size, height: size }} title={label ?? `Score ${clamped}/100`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3.5} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={3.5}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - clamped / 100)}
        />
      </svg>
      <span className="absolute font-mono text-[11px] font-semibold text-ink">{clamped}</span>
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, onClose]);

  if (!open) return null;
  const width = size === "sm" ? "max-w-md" : size === "lg" ? "max-w-3xl" : size === "xl" ? "max-w-5xl" : "max-w-xl";

  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto p-3 sm:p-6" role="dialog" aria-modal="true">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-[3px]" onClick={onClose} />
      <div ref={ref} className={cn("glass animate-fade-up relative z-[1] my-auto w-full rounded-2xl", width)}>
        <div className="flex items-start justify-between gap-4 border-b border-[color:var(--color-line)] px-4 py-3">
          <div className="min-w-0">
            <h3 className="truncate text-[14px] font-semibold text-ink">{title}</h3>
            {description ? <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted">{description}</p> : null}
          </div>
          <button className="btn btn-ghost btn-icon btn-sm -mr-1 -mt-0.5" onClick={onClose} aria-label="Close">
            <X size={14} />
          </button>
        </div>
        <div className="scroll-area max-h-[70vh] px-4 py-3.5">{children}</div>
        {footer ? <div className="flex flex-wrap items-center gap-2 border-t border-[color:var(--color-line)] px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      {label ? <span className="label">{label}</span> : null}
      {children}
      {hint ? <span className="mt-1 block text-[11px] leading-relaxed text-faint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: ReactNode; title?: string; count?: number }>;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex items-center gap-0.5 rounded-[10px] border border-[color:var(--color-line)] bg-white/[0.02] p-0.5", className)}>
      {options.map((option) => (
        <button
          key={option.value}
          title={option.title}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors",
            value === option.value ? "bg-white/[0.08] text-ink" : "text-muted hover:text-ink-soft",
          )}
        >
          {option.label}
          {option.count !== undefined ? <span className="ml-1 text-[10.5px] text-faint tabular-nums">{option.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn("spin inline-block h-3.5 w-3.5 flex-none rounded-full border-[1.5px] border-current border-t-transparent align-[-2px]", className)}
      aria-hidden
    />
  );
}

export function ProgressBar({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("block h-1.5 w-full overflow-hidden rounded-full bg-white/[0.07]", className)}>
      <span
        className="block h-full rounded-full bg-gradient-to-r from-[#7d97ff] to-[#a78bfa] transition-[width] duration-500"
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

export function Sparkline({ points, height = 32 }: { points: number[]; height?: number }) {
  if (points.length < 2) return <div className="skeleton" style={{ height }} />;
  const max = Math.max(...points, 1);
  const step = 100 / (points.length - 1);
  const path = points.map((value, index) => `${index * step},${100 - (value / max) * 92 - 4}`).join(" ");
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }} className="w-full">
      <polyline points={path} fill="none" stroke="var(--color-accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
