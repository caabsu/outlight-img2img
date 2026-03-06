"use client";

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { MODEL_LIST } from "@/lib/models";
import {
  DEFAULT_UGC_PROMPT_PACK,
  DEFAULT_UGC_WORKFLOW_SETTINGS,
  type UgcAgentPromptPack,
  type UgcBrollClipPlan,
  type UgcBrollImagePlan,
  type UgcDialogueClipPlan,
  type UgcPlanRequest,
  type UgcSafeMode,
  type UgcSceneVariation,
  type UgcScriptOption,
  type UgcStageId,
  type UgcWorkflowPlan,
} from "@/lib/ugc-types";

type Product = {
  id: string;
  name: string;
  slug: string;
  image_url: string;
  shopify_vendor?: string | null;
  shopify_product_type?: string | null;
};

type PlanSource = "heuristic" | "anthropic" | "gemini" | "openai";
type RenderStatus = "idle" | "running" | "done" | "error";
type ApprovalStatus = "pending" | "approved" | "rejected" | "skipped";
type UgcStageView = "setup" | "plan" | "scene" | "clips" | "broll";

type ActivityEntry = {
  id: string;
  stage: string;
  message: string;
  tone: "info" | "success" | "error";
  timestamp: number;
};

type SceneRender = {
  id: string;
  planId: string;
  title: string;
  avatarId: string;
  prompt: string;
  url: string | null;
  status: RenderStatus;
  error: string | null;
};

type VideoRender = {
  id: string;
  planId: string;
  title: string;
  prompt: string;
  url: string | null;
  status: RenderStatus;
  error: string | null;
};

type ApprovalState = Record<
  UgcStageId,
  {
    status: ApprovalStatus;
    note: string;
  }
>;

const UGC_PROFILE_ID = "00000000-0000-0000-0000-000000000000";
const VIDEO_MODEL_OPTIONS = [{ id: "kling-3.0", label: "Kling 3.0", note: "Current execution path" }] as const;
const PRESET_OPTIONS = [
  {
    id: "quick",
    name: "Quick Test",
    description: "Shorter run with fewer variations.",
    settings: {
      safeMode: "fast" as UgcSafeMode,
      dialogueSeconds: 15,
      clipDurationSeconds: 5,
      sceneVariationCount: 3,
      bRollClipCount: 3,
    },
    theme: "Quick product demo",
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Default setup for a clean first pass.",
    settings: {
      safeMode: "safe" as UgcSafeMode,
      dialogueSeconds: 20,
      clipDurationSeconds: 5,
      sceneVariationCount: 4,
      bRollClipCount: 4,
    },
    theme: "Creator testimonial",
  },
  {
    id: "review",
    name: "Review First",
    description: "More options with approval at each step.",
    settings: {
      safeMode: "safe" as UgcSafeMode,
      dialogueSeconds: 25,
      clipDurationSeconds: 5,
      sceneVariationCount: 5,
      bRollClipCount: 5,
    },
    theme: "Before and after",
  },
] as const;

const THEME_SUGGESTIONS = [
  "Creator testimonial",
  "Problem and solution",
  "Before and after",
  "Quick product demo",
  "Office walkthrough",
  "Lifestyle routine",
] as const;

function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function createApprovalState(safeMode: UgcSafeMode): ApprovalState {
  const status: ApprovalStatus = safeMode === "safe" ? "pending" : "approved";
  return {
    script: { status, note: "" },
    scene: { status, note: "" },
    dialogue: { status, note: "" },
    broll: { status, note: "" },
  };
}

function downloadText(filename: string, content: string, mimeType = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadUrl(url: string, filename?: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "";
  anchor.target = "_blank";
  anchor.rel = "noreferrer";
  anchor.click();
}

function buildImageOptions(modelId: string) {
  if (modelId === "seedream-4.5") {
    return { aspect_ratio: "9:16", quality: "high" };
  }
  if (modelId === "gpt-1.5") {
    return { gpt_size: "1024x1536", quality: "high", gpt_background: "opaque" };
  }
  if (modelId === "nanobanana-3-pro") {
    return { aspect_ratio: "9:16", image_size: "2K", output_format: "png" };
  }
  return { aspect_ratio: "9:16", image_size: "2K", output_format: "png" };
}

function applyOverride(prompt: string, override: string) {
  const trimmed = override.trim();
  return trimmed ? `${prompt}\n\nUser override instruction: ${trimmed}` : prompt;
}

function sectionPromptPack(promptPack: UgcAgentPromptPack, plan: UgcWorkflowPlan | null) {
  return {
    prompts: promptPack,
    architecture: plan?.architecture.agents || [],
  };
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
) {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (nextIndex < items.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await worker(items[current], current);
    }
  };

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

function StatusPill({ status }: { status: ApprovalStatus | RenderStatus }) {
  const label =
    status === "approved"
      ? "Approved"
      : status === "rejected"
        ? "Needs revision"
        : status === "skipped"
          ? "Skipped"
          : status === "done"
            ? "Done"
            : status === "running"
              ? "Running"
              : status === "error"
                ? "Error"
                : "Pending";

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em]",
        (status === "approved" || status === "done") &&
          "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300",
        status === "running" && "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300",
        status === "rejected" && "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
        status === "error" && "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
        (status === "pending" || status === "idle") &&
          "bg-slate-100 text-slate-600 dark:bg-slate-900 dark:text-slate-300",
        status === "skipped" && "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300"
      )}
    >
      {label}
    </span>
  );
}

function SectionCard({
  title,
  eyebrow,
  actions,
  children,
  className,
}: {
  title: string;
  eyebrow?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[32px] border border-stone-200/80 bg-white/92 p-6 shadow-[0_28px_70px_-42px_rgba(15,23,42,0.26)] dark:border-slate-800 dark:bg-slate-950/82",
        className
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-slate-400">
              {eyebrow}
            </div>
          ) : null}
          <h2 className="text-lg font-semibold tracking-tight text-slate-900 dark:text-white">{title}</h2>
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

function OverlaySheet({
  title,
  subtitle,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[30px] border border-slate-800 bg-white shadow-2xl dark:bg-slate-950">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h3 className="text-lg font-semibold text-slate-900 dark:text-white">{title}</h3>
            {subtitle ? <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-sm text-slate-700 transition hover:border-slate-400 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function StepButton({
  active,
  label,
  hint,
  status,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  status: ApprovalStatus | RenderStatus;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-w-[150px] flex-1 items-start justify-between rounded-[22px] border px-4 py-3 text-left transition",
        active
          ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950"
          : "border-slate-200 bg-white text-slate-900 hover:border-slate-300 dark:border-slate-800 dark:bg-slate-950/70 dark:text-white dark:hover:border-slate-700"
      )}
    >
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className={cn("mt-1 text-xs", active ? "text-slate-300 dark:text-slate-700" : "text-slate-500 dark:text-slate-400")}>
          {hint}
        </div>
      </div>
      <StatusPill status={status} />
    </button>
  );
}

function ProductSelectorModal({
  products,
  search,
  setSearch,
  onClose,
  onSelect,
}: {
  products: Product[];
  search: string;
  setSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (product: Product) => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.slug.toLowerCase().includes(q) ||
        product.shopify_vendor?.toLowerCase().includes(q) ||
        product.shopify_product_type?.toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-[28px] border border-slate-800 bg-slate-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-300">Catalog</div>
            <h3 className="text-lg font-semibold text-white">Pick a base product</h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="border-b border-slate-800 px-6 py-4">
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products, vendors, or types"
            className="w-full rounded-2xl border border-slate-700 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition focus:border-amber-400"
          />
        </div>
        <div className="grid flex-1 grid-cols-2 gap-4 overflow-y-auto p-6 md:grid-cols-4">
          {filtered.map((product) => (
            <button
              key={product.id}
              onClick={() => onSelect(product)}
              className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 text-left transition hover:-translate-y-0.5 hover:border-amber-400/70"
            >
              <div className="aspect-[4/5] bg-slate-800">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
              </div>
              <div className="space-y-1 p-4">
                <div className="text-sm font-semibold text-white">{product.name}</div>
                <div className="text-xs text-slate-400">
                  {product.shopify_vendor || "Manual"} {product.shopify_product_type ? `· ${product.shopify_product_type}` : ""}
                </div>
              </div>
            </button>
          ))}
          {filtered.length === 0 ? (
            <div className="col-span-full rounded-3xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-400">
              No products matched your search.
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function AgentLane({
  title,
  accent,
  steps,
}: {
  title: string;
  accent: string;
  steps: Array<{ label: string; description: string; status: RenderStatus | ApprovalStatus }>;
}) {
  return (
    <div className="rounded-[28px] border border-slate-200/80 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
      <div className="mb-4 flex items-center gap-3">
        <span className={cn("h-3 w-3 rounded-full", accent)} />
        <h3 className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-800 dark:text-slate-200">{title}</h3>
      </div>
      <div className="space-y-3">
        {steps.map((step) => (
          <div
            key={step.label}
            className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/70"
          >
            <div className="mb-1 flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-slate-900 dark:text-white">{step.label}</div>
              <StatusPill status={step.status} />
            </div>
            <p className="text-xs leading-5 text-slate-600 dark:text-slate-400">{step.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApprovalPanel({
  title,
  state,
  onStatusChange,
  onNoteChange,
  disabled,
}: {
  title: string;
  state: { status: ApprovalStatus; note: string };
  onStatusChange: (status: ApprovalStatus) => void;
  onNoteChange: (note: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/70">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="text-sm font-semibold text-slate-900 dark:text-white">{title}</div>
        <StatusPill status={state.status} />
      </div>
      <textarea
        value={state.note}
        onChange={(event) => onNoteChange(event.target.value)}
        placeholder="If you want changes, describe them here. This note will guide the next run."
        disabled={disabled}
        className="min-h-[88px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
      />
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => onStatusChange("approved")}
          disabled={disabled}
          className="rounded-full bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Approve
        </button>
        <button
          onClick={() => onStatusChange("rejected")}
          disabled={disabled}
          className="rounded-full bg-rose-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Needs changes
        </button>
      </div>
    </div>
  );
}

function ScriptOptionCard({
  script,
  selected,
  onAdopt,
}: {
  script: UgcScriptOption;
  selected: boolean;
  onAdopt: () => void;
}) {
  return (
    <div
      className={cn(
        "rounded-[24px] border p-4 transition",
        selected
          ? "border-amber-400 bg-amber-50/70 dark:border-amber-400 dark:bg-amber-950/20"
          : "border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/70"
      )}
    >
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{script.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{script.rationale}</div>
        </div>
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-900 dark:text-slate-300">
          ~{script.estimatedSeconds}s
        </span>
      </div>
      <div className="mb-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-300 line-clamp-6">
        {script.dialogue}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:ring-slate-800">
          Hook: {script.hook}
        </span>
        <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:ring-slate-800">
          CTA: {script.cta}
        </span>
        <button
          onClick={onAdopt}
          className="ml-auto rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-900 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
        >
          Adopt & rebuild
        </button>
      </div>
    </div>
  );
}

function ImageRenderCard({
  render,
  selected,
  subtitle,
  onSelect,
  onDownload,
  hideSelect,
}: {
  render: SceneRender;
  selected: boolean;
  subtitle: string;
  onSelect: () => void;
  onDownload: () => void;
  hideSelect?: boolean;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-[24px] border bg-white transition dark:bg-slate-950/70",
        selected ? "border-amber-400 shadow-lg shadow-amber-500/10" : "border-slate-200 dark:border-slate-800"
      )}
    >
      <div className="aspect-[9/16] bg-slate-100 dark:bg-slate-900">
        {render.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={render.url} alt={render.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {render.status === "running" ? "Generating..." : render.error || "No image yet"}
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900 dark:text-white">{render.title}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{subtitle}</div>
          </div>
          <StatusPill status={render.status} />
        </div>
        <div className="flex gap-2">
          {!hideSelect ? (
            <button
              onClick={onSelect}
              disabled={!render.url}
              className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
            >
              {selected ? "Selected" : "Use as base scene"}
            </button>
          ) : null}
          <button
            onClick={onDownload}
            disabled={!render.url}
            className={cn(
              "rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white",
              hideSelect && "w-full"
            )}
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

function VideoRenderCard({
  render,
  selected,
  onToggle,
  onDownload,
}: {
  render: VideoRender;
  selected: boolean;
  onToggle: () => void;
  onDownload: () => void;
}) {
  return (
    <div className="overflow-hidden rounded-[24px] border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950/70">
      <div className="aspect-[9/16] bg-slate-100 dark:bg-slate-900">
        {render.url ? (
          <video src={render.url} controls className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {render.status === "running" ? "Rendering..." : render.error || "No video yet"}
          </div>
        )}
      </div>
      <div className="space-y-2 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-slate-900 dark:text-white">{render.title}</div>
          <StatusPill status={render.status} />
        </div>
        <div className="flex gap-2">
          <button
            onClick={onToggle}
            disabled={!render.url}
            className="rounded-full bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"
          >
            {selected ? "Selected" : "Select"}
          </button>
          <button
            onClick={onDownload}
            disabled={!render.url}
            className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}

function MetricTile({
  label,
  value,
  detail,
}: {
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <div className="rounded-[28px] border border-stone-200/80 bg-stone-50/90 p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.3)] dark:border-slate-800 dark:bg-slate-900/70">
      <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-stone-500 dark:text-slate-400">{label}</div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-slate-950 dark:text-white">{value}</div>
      <div className="mt-2 text-xs leading-5 text-stone-600 dark:text-slate-400">{detail}</div>
    </div>
  );
}

function WorkspaceTab({
  active,
  label,
  hint,
  status,
  onClick,
}: {
  active: boolean;
  label: string;
  hint: string;
  status: ApprovalStatus | RenderStatus;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex min-w-[148px] flex-1 items-center justify-between gap-3 rounded-[24px] border px-4 py-3 text-left transition",
        active
          ? "border-slate-900 bg-slate-900 text-white shadow-[0_22px_44px_-28px_rgba(15,23,42,0.7)] dark:border-white dark:bg-white dark:text-slate-950"
          : "border-stone-200 bg-white/85 text-slate-900 hover:border-stone-300 hover:bg-white dark:border-slate-800 dark:bg-slate-950/70 dark:text-white dark:hover:border-slate-700"
      )}
    >
      <div>
        <div className="text-sm font-semibold">{label}</div>
        <div className={cn("mt-1 text-xs", active ? "text-white/68 dark:text-slate-700" : "text-stone-500 dark:text-slate-400")}>
          {hint}
        </div>
      </div>
      <StatusPill status={status} />
    </button>
  );
}

function AgentRunCard({
  name,
  summary,
  status,
  accentClass,
  inputs,
  output,
  actionLabel,
  onOpen,
}: {
  name: string;
  summary: string;
  status: ApprovalStatus | RenderStatus;
  accentClass: string;
  inputs: string;
  output: string;
  actionLabel: string;
  onOpen: () => void;
}) {
  return (
    <div className="relative overflow-hidden rounded-[30px] border border-stone-200/80 bg-white/92 p-5 shadow-[0_28px_70px_-38px_rgba(15,23,42,0.3)] dark:border-slate-800 dark:bg-slate-950/80">
      <div className={cn("absolute inset-x-0 top-0 h-1.5", accentClass)} />
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-stone-500 dark:text-slate-400">Agent run</div>
          <h3 className="mt-2 text-xl font-semibold tracking-tight text-slate-950 dark:text-white">{name}</h3>
        </div>
        <StatusPill status={status} />
      </div>
      <p className="mt-3 text-sm leading-6 text-stone-600 dark:text-slate-400">{summary}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-[22px] border border-stone-200 bg-stone-50/90 p-3 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">Reads</div>
          <div className="mt-2 text-sm leading-6 text-slate-800 dark:text-slate-200">{inputs}</div>
        </div>
        <div className="rounded-[22px] border border-stone-200 bg-stone-50/90 p-3 dark:border-slate-800 dark:bg-slate-900/70">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">Outputs</div>
          <div className="mt-2 text-sm leading-6 text-slate-800 dark:text-slate-200">{output}</div>
        </div>
      </div>
      <button
        onClick={onOpen}
        className="mt-5 rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:text-slate-950 dark:border-slate-700 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
      >
        {actionLabel}
      </button>
    </div>
  );
}

export default function UgcStudioPage() {
  const [campaignName] = useState("UGC Ad Run");
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productsLoading, setProductsLoading] = useState(false);
  const [productSource, setProductSource] = useState<"catalog" | "upload">("catalog");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [uploadedProductName, setUploadedProductName] = useState("Custom product");
  const [uploadedProductUrl, setUploadedProductUrl] = useState("");
  const [appearanceNotes, setAppearanceNotes] = useState("");
  const [scriptMode, setScriptMode] = useState<"generate" | "upload">("generate");
  const [scriptText, setScriptText] = useState("");
  const [theme, setTheme] = useState("Creator testimonial");
  const [description, setDescription] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [settings, setSettings] = useState(DEFAULT_UGC_WORKFLOW_SETTINGS);
  const [promptPack, setPromptPack] = useState<UgcAgentPromptPack>(DEFAULT_UGC_PROMPT_PACK);
  const [plan, setPlan] = useState<UgcWorkflowPlan | null>(null);
  const [planSource, setPlanSource] = useState<PlanSource>("heuristic");
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [sceneRenders, setSceneRenders] = useState<SceneRender[]>([]);
  const [dialogueVideos, setDialogueVideos] = useState<VideoRender[]>([]);
  const [brollSeedImages, setBrollSeedImages] = useState<SceneRender[]>([]);
  const [brollVideos, setBrollVideos] = useState<VideoRender[]>([]);
  const [selectedDialogueVideoIds, setSelectedDialogueVideoIds] = useState<Set<string>>(new Set());
  const [selectedBrollVideoIds, setSelectedBrollVideoIds] = useState<Set<string>>(new Set());
  const [approvals, setApprovals] = useState<ApprovalState>(createApprovalState(settings.safeMode));
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [planLoading, setPlanLoading] = useState(false);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [dialogueLoading, setDialogueLoading] = useState(false);
  const [brollSeedLoading, setBrollSeedLoading] = useState(false);
  const [brollLoading, setBrollLoading] = useState(false);
  const [uploadingProduct, setUploadingProduct] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [showPromptPanel, setShowPromptPanel] = useState(false);
  const [showPresetPanel, setShowPresetPanel] = useState(false);
  const [activeStage, setActiveStage] = useState<UgcStageView>("setup");

  const imageModelOptions = useMemo(() => MODEL_LIST.filter((model) => model.id !== "nanobanana-3-pro"), []);
  const deferredProductSearch = useDeferredValue(productSearch);
  const selectedScene = useMemo(
    () => sceneRenders.find((render) => render.id === selectedSceneId) || null,
    [sceneRenders, selectedSceneId]
  );
  const selectedProductCard = useMemo(() => {
    if (productSource === "catalog" && selectedProduct) {
      return {
        name: selectedProduct.name,
        imageUrl: selectedProduct.image_url,
        category: selectedProduct.shopify_product_type || "",
        vendor: selectedProduct.shopify_vendor || "",
      };
    }
    if (productSource === "catalog") {
      return {
        name: "",
        imageUrl: "",
        category: "",
        vendor: "",
      };
    }
    return {
      name: uploadedProductName.trim() || "Custom product",
      imageUrl: uploadedProductUrl,
      category: "",
      vendor: "",
    };
  }, [productSource, selectedProduct, uploadedProductName, uploadedProductUrl]);

  const selectedDialogueUrls = useMemo(
    () =>
      dialogueVideos
        .filter((video) => selectedDialogueVideoIds.has(video.id) && video.url)
        .map((video) => ({ title: video.title, url: video.url! })),
    [dialogueVideos, selectedDialogueVideoIds]
  );
  const selectedBrollUrls = useMemo(
    () =>
      brollVideos
        .filter((video) => selectedBrollVideoIds.has(video.id) && video.url)
        .map((video) => ({ title: video.title, url: video.url! })),
    [brollVideos, selectedBrollVideoIds]
  );

  const promptPackView = sectionPromptPack(promptPack, plan);
  const filteredCatalogProducts = useMemo(() => {
    if (!deferredProductSearch.trim()) return products.slice(0, 24);
    const query = deferredProductSearch.toLowerCase();
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(query) ||
          product.slug.toLowerCase().includes(query) ||
          product.shopify_vendor?.toLowerCase().includes(query) ||
          product.shopify_product_type?.toLowerCase().includes(query)
      )
      .slice(0, 24);
  }, [deferredProductSearch, products]);

  const addActivity = (stage: string, message: string, tone: ActivityEntry["tone"] = "info") => {
    setActivity((current) => [
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        stage,
        message,
        tone,
        timestamp: Date.now(),
      },
      ...current,
    ].slice(0, 24));
  };

  const refreshProducts = async () => {
    setProductsLoading(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/products");
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Failed to load products");
      setProducts(json.products || []);
      return true;
    } catch (error: any) {
      setErrorMessage(error?.message || "Failed to load products");
      return false;
    } finally {
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    let ignore = false;

    const loadProducts = async () => {
      setProductsLoading(true);
      setErrorMessage(null);
      try {
        const response = await fetch("/api/products");
        const json = await response.json();
        if (!response.ok) throw new Error(json?.error || "Failed to load products");
        if (!ignore) {
          setProducts(json.products || []);
        }
      } catch (error: any) {
        if (!ignore) {
          setErrorMessage(error?.message || "Failed to load products");
        }
      } finally {
        if (!ignore) {
          setProductsLoading(false);
        }
      }
    };

    void loadProducts();

    return () => {
      ignore = true;
    };
  }, []);

  const resetDownstream = (options?: { keepPlan?: boolean }) => {
    setSceneRenders([]);
    setSelectedSceneId(null);
    setDialogueVideos([]);
    setBrollSeedImages([]);
    setBrollVideos([]);
    setSelectedDialogueVideoIds(new Set());
    setSelectedBrollVideoIds(new Set());
    if (!options?.keepPlan) {
      setPlan(null);
      setSelectedScriptId(null);
    }
  };

  const handleProductUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingProduct(true);
    setErrorMessage(null);
    addActivity("product", `Uploading ${file.name} for use as the reference product image.`);

    try {
      const formData = new FormData();
      formData.append("files", file);
      const response = await fetch("/api/upload", {
        method: "POST",
        body: formData,
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Upload failed");
      const url = json?.urls?.[0];
      if (!url) throw new Error("Upload did not return a URL");
      setUploadedProductName(file.name.replace(/\.[^.]+$/, ""));
      setUploadedProductUrl(url);
      setProductSource("upload");
      setActiveStage("setup");
      addActivity("product", "Custom product image uploaded and ready.", "success");
    } catch (error: any) {
      setErrorMessage(error?.message || "Upload failed");
      addActivity("product", error?.message || "Upload failed", "error");
    } finally {
      setUploadingProduct(false);
    }
  };

  const handleScriptImport = async (file: File | null) => {
    if (!file) return;
    const text = await file.text();
    setScriptMode("upload");
    setScriptText(text);
    setActiveStage("setup");
    addActivity("script", `Imported script from ${file.name}.`, "success");
  };

  const handleBuildPlan = async (options?: { overrideInstructions?: string; scriptOverride?: string }) => {
    const productName = selectedProductCard.name.trim();
    if (!productName) {
      setErrorMessage("Select a catalog product or upload a product image first.");
      return;
    }

    if (scriptMode === "upload" && !scriptText.trim()) {
      setErrorMessage("Paste or import a script before building the workflow.");
      return;
    }

    setPlanLoading(true);
    setErrorMessage(null);
    resetDownstream();
    setApprovals(createApprovalState(settings.safeMode));
    addActivity("plan", "Building script, scene, dialogue, and B-roll workflow plan.");

    const payload: UgcPlanRequest = {
      campaignName,
      knowledge,
      product: {
        source: productSource,
        id: selectedProduct?.id || null,
        name: productName,
        imageUrl: selectedProductCard.imageUrl,
        category: selectedProductCard.category,
        vendor: selectedProductCard.vendor,
        appearanceNotes,
      },
      script: {
        mode: scriptMode,
        text: scriptText,
        totalSeconds: settings.dialogueSeconds,
        theme,
        description,
      },
      settings,
      promptPack,
      overrideInstructions: options?.overrideInstructions || approvals.script.note,
    };

    if (options?.scriptOverride) {
      payload.script.mode = "upload";
      payload.script.text = options.scriptOverride;
    }

    try {
      const response = await fetch("/api/ugc/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Failed to build plan");
      const nextPlan = json.plan as UgcWorkflowPlan;
      setPlan(nextPlan);
      setPlanSource((json.source || "heuristic") as PlanSource);
      setSelectedScriptId(nextPlan.selectedScriptId);
      setApprovals((current) => ({
        ...current,
        script: {
          ...current.script,
          status: settings.safeMode === "safe" ? "pending" : "approved",
        },
      }));
      setActiveStage("plan");
      addActivity("plan", `Workflow plan ready with ${nextPlan.summary.totalDialogueClips} dialogue clips and ${nextPlan.summary.totalBrollClips} B-roll clips.`, "success");
    } catch (error: any) {
      setErrorMessage(error?.message || "Failed to build plan");
      addActivity("plan", error?.message || "Failed to build plan", "error");
    } finally {
      setPlanLoading(false);
    }
  };

  const adoptScript = async (script: UgcScriptOption) => {
    setScriptMode("upload");
    setScriptText(script.dialogue);
    setSelectedScriptId(script.id);
    await handleBuildPlan({ scriptOverride: script.dialogue });
  };

  const handleGenerateScenes = async () => {
    if (!plan) return;
    if (settings.safeMode === "safe" && approvals.script.status !== "approved") {
      setErrorMessage("Approve the script stage before generating base scenes.");
      return;
    }

    const variations = plan.sceneVariations;
    setActiveStage("scene");
    setSceneLoading(true);
    setErrorMessage(null);
    const initial = variations.map((variation) => ({
      id: variation.id,
      planId: variation.id,
      title: variation.title,
      avatarId: variation.avatarId,
      prompt: applyOverride(variation.prompt, approvals.scene.note),
      url: null,
      status: "running" as RenderStatus,
      error: null,
    }));
    setSceneRenders(initial);
    addActivity("scene", `Rendering ${variations.length} base scene variations with ${settings.imageModelId}.`);

    try {
      await runWithConcurrency(variations, 2, async (variation, index) => {
        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: settings.imageModelId,
              profileId: UGC_PROFILE_ID,
              productId: productSource === "catalog" ? selectedProduct?.id : null,
              customUrl: productSource === "upload" ? uploadedProductUrl : null,
              prompt: applyOverride(variation.prompt, approvals.scene.note),
              options: buildImageOptions(settings.imageModelId),
            }),
          });
          const json = await response.json();
          if (!response.ok) throw new Error(json?.error || "Image generation failed");

          setSceneRenders((current) =>
            current.map((render) =>
              render.id === variation.id
                ? { ...render, url: json.imageDataUrl, status: "done", error: null }
                : render
            )
          );
          addActivity("scene", `${variation.title} is ready.`, "success");
        } catch (error: any) {
          setSceneRenders((current) =>
            current.map((render) =>
              render.id === variation.id
                ? { ...render, status: "error", error: error?.message || "Image generation failed" }
                : render
            )
          );
          addActivity("scene", error?.message || `${variation.title} failed`, "error");
        }
        return index;
      });
    } finally {
      setSceneLoading(false);
      if (settings.safeMode === "fast") {
        setApprovals((current) => ({ ...current, scene: { ...current.scene, status: "approved" } }));
      } else {
        setApprovals((current) => ({ ...current, scene: { ...current.scene, status: "pending" } }));
      }
    }
  };

  const handleGenerateDialogueClips = async () => {
    if (!plan || !selectedScene?.url) {
      setErrorMessage("Select a base scene before rendering dialogue clips.");
      return;
    }
    if (settings.safeMode === "safe" && approvals.scene.status !== "approved") {
      setErrorMessage("Approve the base scene stage before rendering dialogue clips.");
      return;
    }

    const clips = plan.dialogueClips;
    setActiveStage("clips");
    setDialogueLoading(true);
    setErrorMessage(null);
    const initial = clips.map((clip) => ({
      id: clip.id,
      planId: clip.id,
      title: `Clip ${clip.index + 1}`,
      prompt: applyOverride(clip.prompt, approvals.dialogue.note),
      url: null,
      status: "running" as RenderStatus,
      error: null,
    }));
    setDialogueVideos(initial);
    addActivity("dialogue", `Rendering ${clips.length} on-camera clips from the approved base scene.`);

    try {
      await runWithConcurrency(clips, 2, async (clip) => {
        try {
          const response = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "kling",
              model: "kling-3.0/video",
              mode: "kling30",
              prompt: applyOverride(clip.prompt, approvals.dialogue.note),
              duration: String(settings.videoDurationSeconds),
              aspect_ratio: "9:16",
              sound: settings.videoSound,
              kling_mode: "pro",
              image_urls: [selectedScene.url],
            }),
          });
          const json = await response.json();
          if (!response.ok) throw new Error(json?.error || "Video generation failed");

          setDialogueVideos((current) =>
            current.map((item) =>
              item.id === clip.id ? { ...item, url: json.videoUrl, status: "done", error: null } : item
            )
          );
          addActivity("dialogue", `Dialogue clip ${clip.index + 1} is ready.`, "success");
        } catch (error: any) {
          setDialogueVideos((current) =>
            current.map((item) =>
              item.id === clip.id
                ? { ...item, status: "error", error: error?.message || "Video generation failed" }
                : item
            )
          );
          addActivity("dialogue", error?.message || `Clip ${clip.index + 1} failed`, "error");
        }
      });
    } finally {
      setDialogueLoading(false);
      if (settings.safeMode === "fast") {
        setApprovals((current) => ({ ...current, dialogue: { ...current.dialogue, status: "approved" } }));
      } else {
        setApprovals((current) => ({ ...current, dialogue: { ...current.dialogue, status: "pending" } }));
      }
    }
  };

  const handleGenerateBrollSeeds = async () => {
    if (!plan || !selectedScene?.url) {
      setErrorMessage("Select a base scene before generating B-roll seeds.");
      return;
    }
    if (settings.safeMode === "safe" && approvals.scene.status !== "approved") {
      setErrorMessage("Approve the base scene stage before generating B-roll seeds.");
      return;
    }

    const shots = plan.bRollImagePlans;
    setActiveStage("broll");
    setBrollSeedLoading(true);
    setErrorMessage(null);
    const initial = shots.map((shot) => ({
      id: shot.id,
      planId: shot.id,
      title: shot.title,
      avatarId: shot.withoutHuman ? "none" : "context",
      prompt: applyOverride(shot.prompt, approvals.broll.note),
      url: null,
      status: "running" as RenderStatus,
      error: null,
    }));
    setBrollSeedImages(initial);
    addActivity("broll", `Generating ${shots.length} B-roll seed images from the approved scene.`);

    try {
      await runWithConcurrency(shots, 2, async (shot) => {
        try {
          const response = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: settings.imageModelId,
              profileId: UGC_PROFILE_ID,
              productId: null,
              customUrls: [selectedScene.url, selectedProductCard.imageUrl].filter(Boolean),
              prompt: applyOverride(shot.prompt, approvals.broll.note),
              options: buildImageOptions(settings.imageModelId),
            }),
          });
          const json = await response.json();
          if (!response.ok) throw new Error(json?.error || "B-roll image generation failed");
          setBrollSeedImages((current) =>
            current.map((item) =>
              item.id === shot.id ? { ...item, url: json.imageDataUrl, status: "done", error: null } : item
            )
          );
          addActivity("broll", `${shot.title} seed image is ready.`, "success");
        } catch (error: any) {
          setBrollSeedImages((current) =>
            current.map((item) =>
              item.id === shot.id
                ? { ...item, status: "error", error: error?.message || "B-roll image generation failed" }
                : item
            )
          );
          addActivity("broll", error?.message || `${shot.title} failed`, "error");
        }
      });
    } finally {
      setBrollSeedLoading(false);
    }
  };

  const handleGenerateBrollClips = async () => {
    if (!plan) return;
    const readySeeds = brollSeedImages.filter((seed) => seed.url);
    if (readySeeds.length === 0) {
      setErrorMessage("Generate at least one B-roll seed image before rendering B-roll clips.");
      return;
    }

    setBrollLoading(true);
    setErrorMessage(null);
    const clipPlansBySeed = new Map<string, UgcBrollClipPlan>();
    plan.bRollClipPlans.forEach((clip) => clipPlansBySeed.set(clip.imagePlanId, clip));

    const initial = readySeeds.map((seed) => {
      const clip = clipPlansBySeed.get(seed.planId);
      return {
        id: clip?.id || seed.id,
        planId: clip?.id || seed.id,
        title: clip?.title || seed.title,
        prompt: applyOverride(clip?.prompt || seed.prompt, approvals.broll.note),
        url: null,
        status: "running" as RenderStatus,
        error: null,
      };
    });

    setBrollVideos(initial);
    setActiveStage("broll");
    addActivity("broll", `Rendering ${initial.length} B-roll clips from approved seed images.`);

    try {
      await runWithConcurrency(initial, 2, async (render) => {
        const seed = readySeeds.find((item) => item.planId === render.planId || item.id === render.planId);
        if (!seed?.url) return;
        try {
          const response = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "kling",
              model: "kling-3.0/video",
              mode: "kling30",
              prompt: applyOverride(render.prompt, approvals.broll.note),
              duration: String(settings.videoDurationSeconds),
              aspect_ratio: "9:16",
              sound: false,
              kling_mode: "pro",
              image_urls: [seed.url],
            }),
          });
          const json = await response.json();
          if (!response.ok) throw new Error(json?.error || "B-roll video generation failed");
          setBrollVideos((current) =>
            current.map((item) =>
              item.id === render.id ? { ...item, url: json.videoUrl, status: "done", error: null } : item
            )
          );
          addActivity("broll", `${render.title} B-roll clip is ready.`, "success");
        } catch (error: any) {
          setBrollVideos((current) =>
            current.map((item) =>
              item.id === render.id
                ? { ...item, status: "error", error: error?.message || "B-roll video generation failed" }
                : item
            )
          );
          addActivity("broll", error?.message || `${render.title} failed`, "error");
        }
      });
    } finally {
      setBrollLoading(false);
      if (settings.safeMode === "fast") {
        setApprovals((current) => ({ ...current, broll: { ...current.broll, status: "approved" } }));
      } else {
        setApprovals((current) => ({ ...current, broll: { ...current.broll, status: "pending" } }));
      }
    }
  };

  const exportWorkflowJson = () => {
    if (!plan) return;
    downloadText(
      `${runFilePrefix || "ugc-workflow"}.json`,
      JSON.stringify(
        {
          planSource,
          product: selectedProductCard,
          settings,
          approvals,
          plan,
        },
        null,
        2
      ),
      "application/json;charset=utf-8"
    );
  };

  const exportPromptPack = () => {
    if (!plan) return;
    const content = [
      `Run: ${selectedProductCard.name || campaignName}`,
      `Plan source: ${planSource}`,
      "",
      "SYSTEM PROMPTS",
      JSON.stringify(promptPackView.prompts, null, 2),
      "",
      "SCENE VARIATIONS",
      ...plan.sceneVariations.map((scene) => `${scene.title}\n${scene.prompt}\n`),
      "DIALOGUE CLIPS",
      ...plan.dialogueClips.map((clip) => `Clip ${clip.index + 1}\n${clip.prompt}\n`),
      "B-ROLL IMAGE PLANS",
      ...plan.bRollImagePlans.map((shot) => `${shot.title}\n${shot.prompt}\n`),
      "B-ROLL CLIP PLANS",
      ...plan.bRollClipPlans.map((clip) => `${clip.title}\n${clip.prompt}\n`),
    ].join("\n");
    downloadText(`${runFilePrefix || "ugc-workflow"}-prompt-pack.txt`, content);
  };

  const bulkDownload = (items: Array<{ title: string; url: string }>, prefix: string) => {
    items.forEach((item, index) => {
      setTimeout(() => downloadUrl(item.url, `${safeName(prefix)}-${safeName(item.title || `asset-${index + 1}`)}`), index * 120);
    });
  };

  const applyPreset = (presetId: (typeof PRESET_OPTIONS)[number]["id"]) => {
    const preset = PRESET_OPTIONS.find((item) => item.id === presetId);
    if (!preset) return;
    setSettings((current) => ({
      ...current,
      safeMode: preset.settings.safeMode,
      dialogueSeconds: preset.settings.dialogueSeconds,
      clipDurationSeconds: preset.settings.clipDurationSeconds,
      sceneVariationCount: preset.settings.sceneVariationCount,
      bRollClipCount: preset.settings.bRollClipCount,
      videoDurationSeconds: preset.settings.clipDurationSeconds,
    }));
    setTheme(preset.theme);
    setShowPresetPanel(false);
    addActivity("setup", `${preset.name} preset applied.`, "success");
  };

  const stageStatuses: Record<UgcStageView, ApprovalStatus | RenderStatus> = {
    setup: planLoading ? "running" : plan ? "done" : "pending",
    plan: planLoading ? "running" : plan ? approvals.script.status : "pending",
    scene: sceneLoading ? "running" : sceneRenders.some((render) => render.url) ? approvals.scene.status : "pending",
    clips: dialogueLoading ? "running" : dialogueVideos.some((video) => video.url) ? approvals.dialogue.status : "pending",
    broll: brollLoading || brollSeedLoading ? "running" : brollVideos.some((video) => video.url) ? approvals.broll.status : "pending",
  };

  const recentActivity = activity.slice(0, 5);
  const selectedScript =
    plan?.scriptOptions.find((script) => script.id === selectedScriptId) ||
    plan?.scriptOptions.find((script) => script.id === plan.selectedScriptId) ||
    null;
  const selectedScenePlan = plan?.sceneVariations.find((scene) => scene.id === (selectedScene?.planId || selectedSceneId)) || null;
  const selectedAvatar = plan?.avatarOptions.find((avatar) => avatar.id === (selectedScene?.avatarId || selectedScenePlan?.avatarId)) || null;
  const activePlannerLabel =
    planSource === "anthropic" ? "Claude" : planSource === "gemini" ? "Gemini" : planSource === "openai" ? "OpenAI" : "Built-in";
  const plannerStatusNote =
    planSource === "anthropic"
      ? "Claude is active for this run."
      : "This run is using the built-in planner so script generation still works without an external model key.";
  const runFilePrefix = safeName(selectedProductCard.name || theme || "ugc-run");
  const readySceneCount = sceneRenders.filter((render) => render.url).length;
  const readyDialogueCount = dialogueVideos.filter((video) => video.url).length;
  const readyBrollCount = brollVideos.filter((video) => video.url).length;
  const leadAgentStatus: ApprovalStatus | RenderStatus =
    dialogueLoading || sceneLoading
      ? "running"
      : dialogueVideos.some((video) => video.url)
        ? approvals.dialogue.status
        : sceneRenders.some((render) => render.url)
          ? approvals.scene.status
          : plan
            ? approvals.script.status
            : planLoading
              ? "running"
              : "pending";
  const coverageAgentStatus: ApprovalStatus | RenderStatus =
    brollLoading || brollSeedLoading
      ? "running"
      : brollVideos.some((video) => video.url)
        ? approvals.broll.status
        : brollSeedImages.some((image) => image.url)
          ? "done"
          : "pending";
  const reviewAgentStatus: ApprovalStatus | RenderStatus =
    settings.safeMode === "fast"
      ? "skipped"
      : Object.values(approvals).some((item) => item.status === "rejected")
        ? "rejected"
        : Object.values(approvals).every((item) => item.status === "approved")
          ? "approved"
          : "pending";
  const nextActionLabel = !plan
    ? "Generate scripts"
    : readySceneCount === 0
      ? "Generate base scenes"
      : !selectedScene
        ? "Choose a base scene"
        : readyDialogueCount === 0
          ? "Render talking clips"
          : brollSeedImages.filter((image) => image.url).length === 0
            ? "Generate coverage starts"
            : readyBrollCount === 0
              ? "Render coverage clips"
              : "Download selected assets";

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#f3eee7] dark:bg-slate-950">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[460px] bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.92),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(15,23,42,0.09),_transparent_32%),linear-gradient(180deg,rgba(243,238,231,0.96),rgba(243,238,231,0))] dark:bg-[radial-gradient(circle_at_top_left,_rgba(255,255,255,0.06),_transparent_34%),radial-gradient(circle_at_top_right,_rgba(148,163,184,0.12),_transparent_26%),linear-gradient(180deg,rgba(2,6,23,0.94),rgba(2,6,23,0))]" />
      <div className="pointer-events-none absolute inset-y-0 left-[-12%] top-24 hidden w-[34rem] rounded-full bg-[radial-gradient(circle,_rgba(255,255,255,0.55),_transparent_65%)] blur-3xl xl:block dark:bg-[radial-gradient(circle,_rgba(148,163,184,0.10),_transparent_65%)]" />
      <div className="mx-auto flex w-full max-w-[1680px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[40px] border border-stone-200/80 bg-[linear-gradient(140deg,rgba(255,255,255,0.96),rgba(247,243,237,0.92))] p-6 shadow-[0_36px_110px_-56px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-[linear-gradient(140deg,rgba(2,6,23,0.92),rgba(15,23,42,0.84))]">
          <div className="pointer-events-none absolute inset-y-0 right-0 hidden w-[40%] bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.12),transparent_55%)] xl:block dark:bg-[radial-gradient(circle_at_top_right,rgba(148,163,184,0.14),transparent_55%)]" />
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1fr)_420px]">
            <div>
              <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.28em] text-stone-500 dark:text-slate-400">
                UGC Ad Studio
              </div>
              <h1 className="max-w-4xl text-4xl font-semibold tracking-[-0.04em] text-slate-950 dark:text-white md:text-5xl">
                Clean brief in. Talking ad and matching coverage out.
              </h1>
              <p className="mt-4 max-w-3xl text-sm leading-7 text-stone-600 dark:text-slate-400">
                Choose a product, set the runtime, write a short brief, then let the lead agent build the on-camera ad while a separate coverage agent prepares the supporting shots.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  onClick={() => handleBuildPlan()}
                  disabled={planLoading}
                  className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  {planLoading ? "Generating scripts..." : "Generate scripts"}
                </button>
                <button
                  onClick={() => setShowPresetPanel(true)}
                  className="rounded-full border border-stone-300 bg-white/70 px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  Presets
                </button>
                <button
                  onClick={() => setShowPromptPanel(true)}
                  className="rounded-full border border-stone-300 bg-white/70 px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:text-slate-950 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  Agent settings
                </button>
                <button
                  onClick={exportWorkflowJson}
                  disabled={!plan}
                  className="rounded-full border border-stone-300 bg-white/70 px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  Export run
                </button>
                <button
                  onClick={exportPromptPack}
                  disabled={!plan}
                  className="rounded-full border border-stone-300 bg-white/70 px-5 py-2.5 text-sm font-semibold text-slate-800 transition hover:border-slate-900 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:bg-slate-950/60 dark:text-slate-200 dark:hover:border-slate-500 dark:hover:text-white"
                >
                  Export prompts
                </button>
              </div>
              <div className="mt-8 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <MetricTile label="Run time" value={`${settings.dialogueSeconds}s`} detail="Target spoken length" />
                <MetricTile
                  label="Talking clips"
                  value={Math.ceil(settings.dialogueSeconds / settings.clipDurationSeconds)}
                  detail="Ordered 5-second parts"
                />
                <MetricTile label="Scene choices" value={settings.sceneVariationCount} detail="Base-image options" />
                <MetricTile
                  label="Coverage clips"
                  value={settings.bRollClipCount}
                  detail="Separate B-roll plan"
                />
              </div>
            </div>

            <div className="relative overflow-hidden rounded-[34px] border border-slate-900/10 bg-slate-950 p-5 text-white shadow-[0_30px_90px_-48px_rgba(15,23,42,0.7)] dark:border-white/10">
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.14),transparent_40%)]" />
              <div className="relative">
                <div className="text-[11px] font-semibold uppercase tracking-[0.24em] text-white/60">Run snapshot</div>
                <div className="mt-4 rounded-[26px] border border-white/10 bg-white/5 p-4">
                  <div className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Product</div>
                  <div className="mt-2 flex items-center gap-4">
                    {selectedProductCard.imageUrl ? (
                      <div className="h-20 w-16 overflow-hidden rounded-[18px] border border-white/10 bg-white/5">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selectedProductCard.imageUrl} alt={selectedProductCard.name} className="h-full w-full object-cover" />
                      </div>
                    ) : null}
                    <div className="min-w-0">
                      <div className="text-lg font-semibold">{selectedProductCard.name || "Choose a product"}</div>
                      <div className="mt-1 text-sm text-white/60">
                        {theme || "Choose a theme"} · {settings.dialogueSeconds}s
                      </div>
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Planner</div>
                    <div className="mt-2 text-xl font-semibold">{activePlannerLabel}</div>
                    <div className="mt-2 text-xs leading-5 text-white/60">{plannerStatusNote}</div>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-white/45">Next action</div>
                    <div className="mt-2 text-xl font-semibold">{nextActionLabel}</div>
                    <div className="mt-2 text-xs leading-5 text-white/60">
                      {settings.safeMode === "safe" ? "Review mode stops between stages." : "Hands-off mode runs straight through."}
                    </div>
                  </div>
                </div>
                <div className="mt-4 rounded-[26px] border border-white/10 bg-white/5 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72">
                      {settings.imageModelId}
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72">
                      {VIDEO_MODEL_OPTIONS[0].label}
                    </span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/72">
                      {settings.safeMode === "safe" ? "Review mode" : "Hands-off"}
                    </span>
                  </div>
                  {selectedScript ? (
                    <div className="mt-4 text-sm leading-6 text-white/72">
                      Current script: <span className="font-semibold text-white">{selectedScript.title}</span>
                    </div>
                  ) : (
                    <div className="mt-4 text-sm leading-6 text-white/72">No script selected yet.</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {errorMessage ? (
          <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
            {errorMessage}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
          <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
            <SectionCard title="Run Controls" eyebrow="Setup">
              <div className="space-y-4">
                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                    Duration
                  </div>
                  <div className="mb-3 grid grid-cols-4 gap-2">
                    {[15, 20, 25, 30].map((seconds) => (
                      <button
                        key={seconds}
                        onClick={() =>
                          setSettings((current) => ({
                            ...current,
                            dialogueSeconds: seconds,
                          }))
                        }
                        className={cn(
                          "rounded-2xl border px-3 py-2 text-sm font-semibold transition",
                          settings.dialogueSeconds === seconds
                            ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950"
                            : "border-stone-200 bg-stone-50 text-slate-700 hover:border-stone-300 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:border-slate-700"
                        )}
                      >
                        {seconds}s
                      </button>
                    ))}
                  </div>
                  <input
                    type="number"
                    min={5}
                    max={60}
                    value={settings.dialogueSeconds}
                    onChange={(event) =>
                      setSettings((current) => ({ ...current, dialogueSeconds: Number(event.target.value) || 20 }))
                    }
                    className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                    Run mode
                  </div>
                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-stone-100 p-1 dark:bg-slate-950/70">
                    <button
                      onClick={() => setSettings((current) => ({ ...current, safeMode: "safe" }))}
                      className={cn(
                        "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                        settings.safeMode === "safe"
                          ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                          : "text-stone-500 dark:text-slate-400"
                      )}
                    >
                      Review mode
                    </button>
                    <button
                      onClick={() => setSettings((current) => ({ ...current, safeMode: "fast" }))}
                      className={cn(
                        "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                        settings.safeMode === "fast"
                          ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                          : "text-stone-500 dark:text-slate-400"
                      )}
                    >
                      Hands-off
                    </button>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Scene choices
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={settings.sceneVariationCount}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, sceneVariationCount: Number(event.target.value) || 4 }))
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Coverage clips
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={settings.bRollClipCount}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, bRollClipCount: Number(event.target.value) || 4 }))
                      }
                      className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                  <label className="block sm:col-span-2">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Image model
                    </div>
                    <select
                      value={settings.imageModelId}
                      onChange={(event) => setSettings((current) => ({ ...current, imageModelId: event.target.value }))}
                      className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-900 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    >
                      {imageModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <button
                  onClick={() => handleBuildPlan()}
                  disabled={planLoading}
                  className="w-full rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  {planLoading ? "Generating scripts..." : "Generate scripts"}
                </button>
              </div>
            </SectionCard>

            <SectionCard title="Current Setup" eyebrow="Snapshot">
              <div className="space-y-3">
                <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">
                        Product
                      </div>
                      <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">
                        {selectedProductCard.name || "Choose a product"}
                      </div>
                    </div>
                    {selectedProductCard.imageUrl ? (
                      <div className="h-16 w-14 overflow-hidden rounded-2xl border border-stone-200 bg-white dark:border-slate-800 dark:bg-slate-950">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selectedProductCard.imageUrl} alt={selectedProductCard.name} className="h-full w-full object-cover" />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                      {productSource === "catalog" ? "Catalog" : "Uploaded image"}
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                      {activePlannerLabel}
                    </span>
                    {selectedProductCard.category ? (
                      <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-stone-600 ring-1 ring-stone-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                        {selectedProductCard.category}
                      </span>
                    ) : null}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Script options
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                      {plan ? plan.scriptOptions.length : 0}
                    </div>
                  </div>
                  <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Base scenes
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{readySceneCount}/{settings.sceneVariationCount}</div>
                  </div>
                  <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Talking clips
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{readyDialogueCount}</div>
                  </div>
                  <div className="rounded-[22px] border border-stone-200 bg-stone-50/80 p-3 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                      Coverage
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{readyBrollCount}</div>
                  </div>
                </div>

                {selectedScript ? (
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">
                      Selected script
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{selectedScript.title}</div>
                    <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-slate-400 line-clamp-5">
                      {selectedScript.dialogue}
                    </p>
                  </div>
                ) : null}

                {selectedScene ? (
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-xs font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">
                      Selected base scene
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{selectedScene.title}</div>
                    <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-slate-400">
                      {selectedScenePlan?.environment || "Ready for talking clips"}
                    </p>
                  </div>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard title="Live Feed" eyebrow="Run">
              <div className="space-y-3">
                {recentActivity.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-stone-300 p-5 text-sm text-stone-500 dark:border-slate-800 dark:text-slate-400">
                    Updates appear here as each run finishes.
                  </div>
                ) : (
                  recentActivity.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "rounded-[22px] border p-3",
                        entry.tone === "success" && "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20",
                        entry.tone === "error" && "border-rose-200 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/20",
                        entry.tone === "info" && "border-stone-200 bg-stone-50/80 dark:border-slate-800 dark:bg-slate-900/60"
                      )}
                    >
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                        {entry.stage}
                      </div>
                      <div className="mt-1 text-sm leading-5 text-slate-700 dark:text-slate-300">{entry.message}</div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_280px]">
              <AgentRunCard
                name="Lead Ad Agent"
                summary="Writes the script options, chooses the cast and room direction, then turns the approved scene into the talking-head clip plan."
                status={leadAgentStatus}
                accentClass="bg-[linear-gradient(90deg,#0f172a,#334155)]"
                inputs={`${selectedProductCard.name || "Product"}, ${theme || "theme"}, ${settings.dialogueSeconds}s brief`}
                output={
                  plan
                    ? `${plan.scriptOptions.length} scripts, ${plan.sceneVariations.length} base scenes, ${plan.dialogueClips.length} talking clips`
                    : "Script options, avatar direction, base scenes, talking clips"
                }
                actionLabel={plan ? "Open script and scene workspaces" : "Build the plan"}
                onOpen={() => setActiveStage(plan ? "plan" : "setup")}
              />
              <AgentRunCard
                name="Coverage Agent"
                summary="Starts after the base scene is chosen so supporting shots can change angle and framing without breaking the on-camera continuity."
                status={coverageAgentStatus}
                accentClass="bg-[linear-gradient(90deg,#6b7280,#cbd5e1)]"
                inputs={selectedScene ? `${selectedScene.title}, approved script, product reference` : "Approved base scene, product reference"}
                output={
                  plan
                    ? `${plan.bRollImagePlans.length} start frames, ${plan.bRollClipPlans.length} coverage clips`
                    : "Coverage start frames and B-roll clips"
                }
                actionLabel="Open coverage workspace"
                onOpen={() => setActiveStage("broll")}
              />
              <SectionCard title="Run Mode" eyebrow="Execution" className="h-full">
                <div className="space-y-4">
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">
                      Planner
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{activePlannerLabel}</div>
                    <div className="mt-2 text-xs leading-5 text-stone-500 dark:text-slate-400">{plannerStatusNote}</div>
                  </div>
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">
                      Review
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">
                      {settings.safeMode === "safe" ? "Stops for approval" : "Runs without stops"}
                    </div>
                    <div className="mt-2">
                      <StatusPill status={reviewAgentStatus} />
                    </div>
                  </div>
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-stone-500 dark:text-slate-400">
                      Next action
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{nextActionLabel}</div>
                  </div>
                </div>
              </SectionCard>
            </div>

            <SectionCard title="Workspace" eyebrow="Runboard">
              <div className="mb-6 flex flex-wrap gap-3">
                <WorkspaceTab
                  active={activeStage === "setup"}
                  label="Brief"
                  hint="Product and script input"
                  status={stageStatuses.setup}
                  onClick={() => setActiveStage("setup")}
                />
                <WorkspaceTab
                  active={activeStage === "plan"}
                  label="Scripts"
                  hint="Choose the direction"
                  status={stageStatuses.plan}
                  onClick={() => setActiveStage("plan")}
                />
                <WorkspaceTab
                  active={activeStage === "scene"}
                  label="Base scene"
                  hint="Choose the look"
                  status={stageStatuses.scene}
                  onClick={() => setActiveStage("scene")}
                />
                <WorkspaceTab
                  active={activeStage === "clips"}
                  label="Talking clips"
                  hint="Render the main ad"
                  status={stageStatuses.clips}
                  onClick={() => setActiveStage("clips")}
                />
                <WorkspaceTab
                  active={activeStage === "broll"}
                  label="Coverage"
                  hint="Generate support shots"
                  status={stageStatuses.broll}
                  onClick={() => setActiveStage("broll")}
                />
              </div>

            {activeStage === "setup" ? (
              <>
                <SectionCard
                  title="Build the brief"
                  eyebrow="Brief"
                  actions={
                    <button
                      onClick={() => handleBuildPlan()}
                      disabled={planLoading}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      {planLoading ? "Generating..." : "Generate scripts"}
                    </button>
                  }
                >
                  <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
                    <div className="space-y-5">
                      <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-900">
                        <button
                          onClick={() => setScriptMode("generate")}
                          className={cn(
                            "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                            scriptMode === "generate"
                              ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                              : "text-slate-500 dark:text-slate-400"
                          )}
                        >
                          Generate script
                        </button>
                        <button
                          onClick={() => setScriptMode("upload")}
                          className={cn(
                            "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                            scriptMode === "upload"
                              ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                              : "text-slate-500 dark:text-slate-400"
                          )}
                        >
                          Use my script
                        </button>
                      </div>

                      {scriptMode === "generate" ? (
                        <>
                          <div>
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              Theme
                            </div>
                            <div className="mb-3 flex flex-wrap gap-2">
                              {THEME_SUGGESTIONS.map((item) => (
                                <button
                                  key={item}
                                  onClick={() => setTheme(item)}
                                  className={cn(
                                    "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                                    theme === item
                                      ? "border-slate-900 bg-slate-900 text-white dark:border-white dark:bg-white dark:text-slate-950"
                                      : "border-slate-300 text-slate-700 hover:border-amber-400 hover:text-slate-950 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                                  )}
                                >
                                  {item}
                                </button>
                              ))}
                            </div>
                            <input
                              value={theme}
                              onChange={(event) => setTheme(event.target.value)}
                              placeholder="Creator testimonial"
                              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                          </div>

                          <label className="block">
                            <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                              Description
                            </div>
                            <textarea
                              value={description}
                              onChange={(event) => setDescription(event.target.value)}
                              placeholder="Describe the angle, claim, scene, audience feel, or anything the script should include."
                              className="min-h-[180px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                            />
                          </label>
                        </>
                      ) : (
                        <div className="space-y-3">
                          <textarea
                            value={scriptText}
                            onChange={(event) => setScriptText(event.target.value)}
                            placeholder="Paste your approved dialogue here."
                            className="min-h-[220px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                          <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white">
                            Import text file
                            <input
                              type="file"
                              accept=".txt,.md"
                              className="hidden"
                              onChange={(event) => handleScriptImport(event.target.files?.[0] || null)}
                            />
                          </label>
                        </div>
                      )}
                    </div>

                    <div className="rounded-[28px] border border-stone-200 bg-stone-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="mb-4 text-sm font-semibold text-slate-900 dark:text-white">How this run works</div>
                      <div className="space-y-4">
                        <div className="rounded-[24px] border border-stone-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                            Planner
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{activePlannerLabel}</div>
                          <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-slate-400">{plannerStatusNote}</p>
                        </div>
                        <div className="rounded-[24px] border border-stone-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                            Output
                          </div>
                          <p className="mt-2 text-sm leading-6 text-slate-800 dark:text-slate-200">
                            The lead agent writes the script and plans the base scene. After a scene is chosen, the coverage agent builds the supporting shots.
                          </p>
                        </div>
                        <div className="rounded-[24px] border border-stone-200 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/70">
                          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500 dark:text-slate-400">
                            Video model
                          </div>
                          <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{VIDEO_MODEL_OPTIONS[0].label}</div>
                          <p className="mt-2 text-xs leading-5 text-stone-500 dark:text-slate-400">
                            Talking clips use Kling 3.0 with synced audio from the approved base scene.
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                </SectionCard>

                <SectionCard title="Choose the product" eyebrow="Product">
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1 dark:bg-slate-900">
                      <button
                        onClick={() => setProductSource("catalog")}
                        className={cn(
                          "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                          productSource === "catalog"
                            ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                            : "text-slate-500 dark:text-slate-400"
                        )}
                      >
                        Choose from catalog
                      </button>
                      <button
                        onClick={() => setProductSource("upload")}
                        className={cn(
                          "rounded-2xl px-3 py-2 text-sm font-semibold transition",
                          productSource === "upload"
                            ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-white"
                            : "text-slate-500 dark:text-slate-400"
                        )}
                      >
                        Upload image
                      </button>
                    </div>

                    {productSource === "catalog" ? (
                      <div className="space-y-4">
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <input
                            value={productSearch}
                            onChange={(event) => setProductSearch(event.target.value)}
                            placeholder="Search products"
                            className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                          <button
                            onClick={async () => {
                              const ok = await refreshProducts();
                              addActivity(
                                "product",
                                ok ? "Catalog refreshed." : "Catalog refresh failed.",
                                ok ? "success" : "error"
                              );
                            }}
                            disabled={productsLoading}
                            className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                          >
                            {productsLoading ? "Loading..." : "Refresh catalog"}
                          </button>
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {productsLoading ? "Loading products..." : `${products.length} products available`}
                        </div>
                        {selectedProduct ? (
                          <div className="rounded-[24px] border border-amber-300 bg-amber-50/70 p-4 dark:border-amber-500/40 dark:bg-amber-950/20">
                            <div className="flex items-center gap-4">
                              <div className="h-24 w-20 overflow-hidden rounded-2xl border border-amber-200 bg-white dark:border-amber-500/30 dark:bg-slate-950">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={selectedProduct.image_url} alt={selectedProduct.name} className="h-full w-full object-cover" />
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="text-sm font-semibold text-slate-900 dark:text-white">{selectedProduct.name}</div>
                                <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                  {selectedProduct.shopify_vendor || "Manual"}{" "}
                                  {selectedProduct.shopify_product_type ? `· ${selectedProduct.shopify_product_type}` : ""}
                                </div>
                              </div>
                              <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-700 ring-1 ring-amber-200 dark:bg-slate-950 dark:text-amber-300 dark:ring-amber-500/30">
                                Selected
                              </span>
                            </div>
                          </div>
                        ) : null}

                        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                          {productsLoading ? (
                            <div className="sm:col-span-2 xl:col-span-3 rounded-[24px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              Loading products...
                            </div>
                          ) : filteredCatalogProducts.length === 0 ? (
                            <div className="sm:col-span-2 xl:col-span-3 rounded-[24px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                              No products matched your search.
                            </div>
                          ) : (
                            filteredCatalogProducts.map((product) => (
                              <button
                                key={product.id}
                                onClick={() => {
                                  setSelectedProduct(product);
                                  setProductSource("catalog");
                                  addActivity("product", `Selected ${product.name} from the catalog.`, "success");
                                }}
                                className={cn(
                                  "overflow-hidden rounded-[24px] border bg-white text-left transition hover:-translate-y-0.5 hover:border-amber-400 dark:bg-slate-950/70",
                                  selectedProduct?.id === product.id
                                    ? "border-amber-400 shadow-lg shadow-amber-500/10"
                                    : "border-slate-200 dark:border-slate-800"
                                )}
                              >
                                <div className="aspect-[4/5] bg-slate-100 dark:bg-slate-900">
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                                </div>
                                <div className="space-y-1 p-4">
                                  <div className="text-sm font-semibold text-slate-900 dark:text-white">{product.name}</div>
                                  <div className="text-xs text-slate-500 dark:text-slate-400">
                                    {product.shopify_vendor || "Manual"}{" "}
                                    {product.shopify_product_type ? `· ${product.shopify_product_type}` : ""}
                                  </div>
                                </div>
                              </button>
                            ))
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-4">
                        <label className="block">
                          <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                            Product label
                          </div>
                          <input
                            value={uploadedProductName}
                            onChange={(event) => setUploadedProductName(event.target.value)}
                            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                          />
                        </label>
                        <label className="inline-flex cursor-pointer items-center rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white">
                          {uploadingProduct ? "Uploading..." : "Upload product image"}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            className="hidden"
                            onChange={(event) => handleProductUpload(event.target.files?.[0] || null)}
                          />
                        </label>
                        {uploadedProductUrl ? (
                          <div className="h-64 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={uploadedProductUrl} alt={uploadedProductName} className="h-full w-full object-cover" />
                          </div>
                        ) : null}
                      </div>
                    )}

                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Appearance notes
                      </div>
                      <textarea
                        value={appearanceNotes}
                        onChange={(event) => setAppearanceNotes(event.target.value)}
                        placeholder="Anything that must stay exact: materials, color, branding, hero details."
                        className="min-h-[120px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                  </div>
                </SectionCard>
              </>
            ) : null}

            {activeStage === "plan" ? (
              <SectionCard
                title="Choose the script"
                actions={
                  <button
                    onClick={handleGenerateScenes}
                    disabled={!plan || sceneLoading}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    {sceneLoading ? "Generating..." : "Generate scene options"}
                  </button>
                }
              >
                {plan ? (
                  <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Planner
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{activePlannerLabel}</div>
                      </div>
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Talking clips
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{plan.summary.totalDialogueClips}</div>
                      </div>
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          B-roll clips
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{plan.summary.totalBrollClips}</div>
                      </div>
                      <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                          Base scenes
                        </div>
                        <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-white">{plan.summary.sceneVariationCount}</div>
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Product read
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{plan.productAnalysis}</p>
                    </div>

                    <div className="space-y-4">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h3 className="text-base font-semibold text-slate-900 dark:text-white">Choose a script</h3>
                          <p className="text-xs text-slate-500 dark:text-slate-400">
                            Click a card if you want to rebuild the whole workflow around a different script.
                          </p>
                        </div>
                        <StatusPill status={approvals.script.status} />
                      </div>
                      <div className="grid gap-4 xl:grid-cols-3">
                        {plan.scriptOptions.map((script) => (
                          <ScriptOptionCard
                            key={script.id}
                            script={script}
                            selected={selectedScriptId === script.id}
                            onAdopt={() => adoptScript(script)}
                          />
                        ))}
                      </div>
                    </div>

                    {settings.safeMode === "safe" ? (
                      <ApprovalPanel
                        title="Approve the script direction"
                        state={approvals.script}
                        onStatusChange={(status) =>
                          setApprovals((current) => ({ ...current, script: { ...current.script, status } }))
                        }
                        onNoteChange={(note) =>
                          setApprovals((current) => ({ ...current, script: { ...current.script, note } }))
                        }
                      />
                    ) : null}

                    <div className="grid gap-4 xl:grid-cols-3">
                      {plan.avatarOptions.map((avatar) => (
                        <div key={avatar.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{avatar.label}</div>
                          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{avatar.persona}</p>
                          <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{avatar.castingRationale}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Generate scripts first.
                  </div>
                )}
              </SectionCard>
            ) : null}

            {activeStage === "scene" ? (
              <SectionCard
                title="Choose the base scene"
                actions={
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleGenerateScenes}
                      disabled={!plan || sceneLoading}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      {sceneLoading ? "Generating..." : "Generate scene options"}
                    </button>
                    <button
                      onClick={handleGenerateDialogueClips}
                      disabled={!selectedScene || dialogueLoading}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                    >
                      Go to talking clips
                    </button>
                  </div>
                }
              >
                {plan ? (
                  <div className="space-y-5">
                    {selectedScene ? (
                      <div className="rounded-[24px] border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <div className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700 dark:text-emerald-300">
                              Selected base scene
                            </div>
                            <div className="mt-1 text-sm font-semibold text-slate-900 dark:text-white">{selectedScene.title}</div>
                            <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                              {selectedAvatar ? `${selectedAvatar.label} · ` : ""}
                              {selectedScenePlan?.environment || "Ready for talking clips"}
                            </div>
                          </div>
                          <StatusPill status={approvals.scene.status} />
                        </div>
                      </div>
                    ) : null}

                    {sceneRenders.length === 0 ? (
                      <div className="grid gap-4 xl:grid-cols-4">
                        {plan.sceneVariations.map((scene) => {
                          const avatar = plan.avatarOptions.find((item) => item.id === scene.avatarId);
                          return (
                            <div key={scene.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                              <div className="text-sm font-semibold text-slate-900 dark:text-white">{scene.title}</div>
                              <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                                {avatar?.label || "Avatar"} · {scene.environment}
                              </div>
                              <p className="mt-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{scene.summary}</p>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {sceneRenders.map((render) => {
                          const scene = plan.sceneVariations.find((item) => item.id === render.planId);
                          const avatar = plan.avatarOptions.find((item) => item.id === render.avatarId);
                          return (
                            <ImageRenderCard
                              key={render.id}
                              render={render}
                              subtitle={avatar ? avatar.label : scene?.environment || "Scene variation"}
                              selected={selectedSceneId === render.id}
                              onSelect={() => {
                                setSelectedSceneId(render.id);
                                if (settings.safeMode === "fast") {
                                  setApprovals((current) => ({ ...current, scene: { ...current.scene, status: "approved" } }));
                                }
                              }}
                              onDownload={() => render.url && downloadUrl(render.url, `${safeName(render.title)}.png`)}
                            />
                          );
                        })}
                      </div>
                    )}

                    {settings.safeMode === "safe" ? (
                      <ApprovalPanel
                        title="Approve the base scene"
                        state={approvals.scene}
                        onStatusChange={(status) =>
                          setApprovals((current) => ({ ...current, scene: { ...current.scene, status } }))
                        }
                        onNoteChange={(note) =>
                          setApprovals((current) => ({ ...current, scene: { ...current.scene, note } }))
                        }
                        disabled={!sceneRenders.some((render) => render.url)}
                      />
                    ) : null}
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Generate scripts first.
                  </div>
                )}
              </SectionCard>
            ) : null}

            {activeStage === "clips" ? (
              <SectionCard
                title="Talking clips"
                actions={
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleGenerateDialogueClips}
                      disabled={!selectedScene || dialogueLoading}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      {dialogueLoading ? "Rendering..." : "Render talking clips"}
                    </button>
                    <button
                      onClick={() => bulkDownload(selectedDialogueUrls, `${runFilePrefix}-dialogue`)}
                      disabled={selectedDialogueUrls.length === 0}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                    >
                      Download selected
                    </button>
                  </div>
                }
              >
                {plan ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 xl:grid-cols-4">
                      {plan.dialogueClips.map((clip: UgcDialogueClipPlan) => (
                        <div key={clip.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">Clip {clip.index + 1}</div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                              {clip.startSecond}s-{clip.endSecond}s
                            </span>
                          </div>
                          <p className="mb-3 text-sm leading-6 text-slate-700 dark:text-slate-300">{clip.spokenText}</p>
                          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {clip.objective} · {clip.camera}
                          </p>
                        </div>
                      ))}
                    </div>

                    {settings.safeMode === "safe" ? (
                      <ApprovalPanel
                        title="Approve the talking clips"
                        state={approvals.dialogue}
                        onStatusChange={(status) =>
                          setApprovals((current) => ({ ...current, dialogue: { ...current.dialogue, status } }))
                        }
                        onNoteChange={(note) =>
                          setApprovals((current) => ({ ...current, dialogue: { ...current.dialogue, note } }))
                        }
                        disabled={!dialogueVideos.some((video) => video.url)}
                      />
                    ) : null}

                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                      {dialogueVideos.length > 0 ? (
                        dialogueVideos.map((video) => (
                          <VideoRenderCard
                            key={video.id}
                            render={video}
                            selected={selectedDialogueVideoIds.has(video.id)}
                            onToggle={() =>
                              setSelectedDialogueVideoIds((current) => {
                                const next = new Set(current);
                                if (next.has(video.id)) next.delete(video.id);
                                else next.add(video.id);
                                return next;
                              })
                            }
                            onDownload={() => video.url && downloadUrl(video.url, `${safeName(video.title)}.mp4`)}
                          />
                        ))
                      ) : (
                        <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                          Select a base scene, then render the talking clips here.
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Generate scripts and choose a base scene first.
                  </div>
                )}
              </SectionCard>
            ) : null}

            {activeStage === "broll" ? (
              <SectionCard
                title="Coverage"
                actions={
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={handleGenerateBrollSeeds}
                      disabled={!selectedScene || brollSeedLoading}
                      className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                    >
                      {brollSeedLoading ? "Generating..." : "Generate B-roll images"}
                    </button>
                    <button
                      onClick={handleGenerateBrollClips}
                      disabled={!brollSeedImages.some((image) => image.url) || brollLoading}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                    >
                      {brollLoading ? "Rendering..." : "Render B-roll clips"}
                    </button>
                    <button
                      onClick={() => bulkDownload(selectedBrollUrls, `${runFilePrefix}-broll`)}
                      disabled={selectedBrollUrls.length === 0}
                      className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                    >
                      Download selected
                    </button>
                  </div>
                }
              >
                {plan ? (
                  <div className="space-y-5">
                    <div className="grid gap-4 xl:grid-cols-4">
                      {plan.bRollImagePlans.map((shot: UgcBrollImagePlan) => (
                        <div key={shot.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                          <div className="mb-2 flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">{shot.title}</div>
                            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                              {shot.withoutHuman ? "No person" : "Person optional"}
                            </span>
                          </div>
                          <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">{shot.objective}</p>
                          <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                            {shot.angle} · {shot.lens}
                          </p>
                        </div>
                      ))}
                    </div>

                    {settings.safeMode === "safe" ? (
                      <ApprovalPanel
                        title="Approve the B-roll set"
                        state={approvals.broll}
                        onStatusChange={(status) =>
                          setApprovals((current) => ({ ...current, broll: { ...current.broll, status } }))
                        }
                        onNoteChange={(note) =>
                          setApprovals((current) => ({ ...current, broll: { ...current.broll, note } }))
                        }
                        disabled={!brollVideos.some((video) => video.url)}
                      />
                    ) : null}

                    <div>
                      <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">B-roll image starts</div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {brollSeedImages.length > 0 ? (
                          brollSeedImages.map((render) => (
                            <ImageRenderCard
                              key={render.id}
                              render={render}
                              selected={false}
                              subtitle="Start frame"
                              onSelect={() => undefined}
                              onDownload={() => render.url && downloadUrl(render.url, `${safeName(render.title)}.png`)}
                              hideSelect
                            />
                          ))
                        ) : (
                          <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            Generate the B-roll images first.
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">B-roll clips</div>
                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                        {brollVideos.length > 0 ? (
                          brollVideos.map((video) => (
                            <VideoRenderCard
                              key={video.id}
                              render={video}
                              selected={selectedBrollVideoIds.has(video.id)}
                              onToggle={() =>
                                setSelectedBrollVideoIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(video.id)) next.delete(video.id);
                                  else next.add(video.id);
                                  return next;
                                })
                              }
                              onDownload={() => video.url && downloadUrl(video.url, `${safeName(video.title)}.mp4`)}
                            />
                          ))
                        ) : (
                          <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                            Rendered B-roll clips appear here after the image starts are ready.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Generate scripts and choose a base scene first.
                  </div>
                )}
              </SectionCard>
            ) : null}
            </SectionCard>
          </div>
        </div>

        {showPromptPanel ? (
          <OverlaySheet
            title="Prompt settings"
            subtitle="Optional advanced controls for the planner and the two generation paths."
            onClose={() => setShowPromptPanel(false)}
          >
            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Extra guidance
                  </div>
                  <textarea
                    value={knowledge}
                    onChange={(event) => setKnowledge(event.target.value)}
                    placeholder="Brand rules, claims to avoid, room style, lighting, compliance notes, or edit preferences."
                    className="min-h-[120px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                {(
                  [
                    ["strategist", "Script prompt"],
                    ["sceneArchitect", "Scene prompt"],
                    ["dialogueDirector", "Talking clip prompt"],
                    ["bRollDirector", "B-roll prompt"],
                    ["safetyCoordinator", "Review mode prompt"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      {label}
                    </div>
                    <textarea
                      value={promptPack[key]}
                      onChange={(event) =>
                        setPromptPack((current) => ({
                          ...current,
                          [key]: event.target.value,
                        }))
                      }
                      className="min-h-[120px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                ))}
              </div>

              <div className="space-y-4">
                <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="text-sm font-semibold text-slate-900 dark:text-white">How this is used</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">
                    These prompts shape script writing, base-image planning, talking-clip prompts, and B-roll planning. Leave them alone unless you want to change how the workflow behaves.
                  </p>
                </div>

                {promptPackView.architecture.length > 0 ? (
                  promptPackView.architecture.map((agent) => (
                    <div key={agent.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-sm font-semibold text-slate-900 dark:text-white">{agent.name}</div>
                      <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{agent.responsibility}</p>
                    </div>
                  ))
                ) : (
                  <div className="rounded-[24px] border border-dashed border-slate-300 p-5 text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Build the scripts once if you want to inspect the full workflow structure here.
                  </div>
                )}
              </div>
            </div>
          </OverlaySheet>
        ) : null}

        {showPresetPanel ? (
          <OverlaySheet
            title="Presets"
            subtitle="Quick starting points for runtime, review mode, and generation counts."
            onClose={() => setShowPresetPanel(false)}
          >
            <div className="grid gap-4 md:grid-cols-3">
              {PRESET_OPTIONS.map((preset) => (
                <div key={preset.id} className="rounded-[26px] border border-slate-200 bg-slate-50/80 p-5 dark:border-slate-800 dark:bg-slate-900/60">
                  <div className="text-lg font-semibold text-slate-900 dark:text-white">{preset.name}</div>
                  <p className="mt-2 text-sm leading-6 text-slate-600 dark:text-slate-400">{preset.description}</p>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                      {preset.settings.dialogueSeconds}s
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                      {preset.settings.sceneVariationCount} scenes
                    </span>
                    <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                      {preset.settings.bRollClipCount} B-roll
                    </span>
                  </div>
                  <div className="mt-4 text-xs text-slate-500 dark:text-slate-400">Theme suggestion: {preset.theme}</div>
                  <button
                    onClick={() => applyPreset(preset.id)}
                    className="mt-5 rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    Apply preset
                  </button>
                </div>
              ))}
            </div>
          </OverlaySheet>
        ) : null}
      </div>
    </div>
  );
}
