"use client";

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { IBM_Plex_Sans, Manrope } from "next/font/google";
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
type ProductPickerView = "compact" | "list";

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
const PRESET_OPTIONS = [
  {
    id: "quick",
    name: "Quick Test",
    description: "Shorter run, fewer variations.",
    settings: {
      safeMode: "fast" as UgcSafeMode,
      dialogueSeconds: 15,
      clipDurationSeconds: 7,
      sceneVariationCount: 3,
      bRollClipCount: 3,
    },
  },
  {
    id: "balanced",
    name: "Balanced",
    description: "Default setup for a clean first pass.",
    settings: {
      safeMode: "safe" as UgcSafeMode,
      dialogueSeconds: 20,
      clipDurationSeconds: 7,
      sceneVariationCount: 4,
      bRollClipCount: 4,
    },
  },
  {
    id: "review",
    name: "Review First",
    description: "More options, review at each step.",
    settings: {
      safeMode: "safe" as UgcSafeMode,
      dialogueSeconds: 25,
      clipDurationSeconds: 7,
      sceneVariationCount: 5,
      bRollClipCount: 5,
    },
  },
] as const;
const PRODUCT_PICKER_BATCH_SIZE = 72;

const ugcBodyFont = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-ugc-body",
});

const ugcDisplayFont = Manrope({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-ugc-display",
});

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

/* ─── Reusable UI Components ─── */

function StatusDot({ status }: { status: ApprovalStatus | RenderStatus }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 rounded-full",
        (status === "approved" || status === "done") && "bg-emerald-400",
        status === "running" && "bg-sky-400 animate-pulse",
        (status === "rejected" || status === "error") && "bg-rose-400",
        (status === "pending" || status === "idle") && "bg-slate-600",
        status === "skipped" && "bg-slate-700"
      )}
    />
  );
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
        "inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]",
        (status === "approved" || status === "done") &&
          "bg-emerald-950/40 text-emerald-300 ring-1 ring-emerald-800/50",
        status === "running" && "bg-sky-950/40 text-sky-300 ring-1 ring-sky-800/50",
        (status === "rejected" || status === "error") && "bg-rose-950/40 text-rose-300 ring-1 ring-rose-800/50",
        (status === "pending" || status === "idle") && "bg-slate-800/60 text-slate-400 ring-1 ring-slate-700/50",
        status === "skipped" && "bg-slate-800/60 text-slate-500 ring-1 ring-slate-700/50"
      )}
    >
      {label}
    </span>
  );
}

function SectionCard({
  title,
  subtitle,
  actions,
  children,
  className,
  noPadding,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}) {
  return (
    <section
      className={cn(
        "rounded-2xl border border-slate-800 bg-slate-950/92 shadow-[0_24px_54px_-42px_rgba(2,6,23,0.45)]",
        !noPadding && "p-5",
        className
      )}
    >
      <div className={cn("mb-4 flex items-start justify-between gap-4", noPadding && "px-5 pt-5")}>
        <div>
          <h2 className="font-[var(--font-ugc-display)] text-lg font-semibold tracking-[-0.02em] text-white">
            {title}
          </h2>
          {subtitle ? (
            <p className="mt-1 text-sm text-slate-400">{subtitle}</p>
          ) : null}
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
      <div className="flex max-h-[88vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-[0_40px_120px_-56px_rgba(2,6,23,0.8)]">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div>
            <h3 className="font-[var(--font-ugc-display)] text-lg font-semibold tracking-[-0.02em] text-white">
              {title}
            </h3>
            {subtitle ? <p className="mt-1 text-sm text-slate-400">{subtitle}</p> : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm text-slate-300 transition hover:border-slate-500 hover:text-white"
          >
            Close
          </button>
        </div>
        <div className="overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

function ProductSelectorModal({
  products,
  loading,
  search,
  setSearch,
  onClose,
  onSelect,
}: {
  products: Product[];
  loading: boolean;
  search: string;
  setSearch: (value: string) => void;
  onClose: () => void;
  onSelect: (product: Product) => void;
}) {
  const [view, setView] = useState<ProductPickerView>("compact");
  const [visibleCount, setVisibleCount] = useState(PRODUCT_PICKER_BATCH_SIZE);
  const deferredSearch = useDeferredValue(search);
  const filtered = useMemo(() => {
    if (!deferredSearch.trim()) return products;
    const q = deferredSearch.toLowerCase();
    return products.filter(
      (product) =>
        product.name.toLowerCase().includes(q) ||
        product.slug.toLowerCase().includes(q) ||
        product.shopify_vendor?.toLowerCase().includes(q) ||
        product.shopify_product_type?.toLowerCase().includes(q)
    );
  }, [deferredSearch, products]);
  const visibleProducts = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = visibleProducts.length < filtered.length;

  useEffect(() => {
    setVisibleCount(PRODUCT_PICKER_BATCH_SIZE);
  }, [deferredSearch, products.length]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-7xl flex-col overflow-hidden rounded-2xl border border-slate-800 bg-slate-950 shadow-[0_42px_140px_-56px_rgba(2,6,23,0.8)]">
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-5">
          <div className="min-w-0">
            <h3 className="font-[var(--font-ugc-display)] text-xl font-semibold text-white">Choose a product</h3>
            <p className="mt-1 text-sm text-slate-400">
              Search or browse your catalog to select the product for this video.
            </p>
          </div>
          <div className="ml-4 flex items-center gap-2">
            <div className="grid grid-cols-2 rounded-xl border border-slate-800 bg-slate-900/80 p-1">
              <button
                onClick={() => setView("compact")}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-semibold transition",
                  view === "compact" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"
                )}
              >
                Grid
              </button>
              <button
                onClick={() => setView("list")}
                className={cn(
                  "rounded-lg px-3 py-2 text-xs font-semibold transition",
                  view === "list" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"
                )}
              >
                List
              </button>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl border border-slate-700 px-3 py-1.5 text-sm text-slate-200 transition hover:border-slate-500 hover:text-white"
            >
              Close
            </button>
          </div>
        </div>

        <div className="border-b border-slate-800 bg-slate-950/95 px-6 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="relative w-full max-w-xl">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
              >
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search products..."
                className="w-full rounded-xl border border-slate-800 bg-slate-900 px-10 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
              />
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
              <span className="rounded-full bg-slate-900/80 px-3 py-1.5">
                {loading ? "Loading..." : `${filtered.length} products`}
              </span>
              {search.trim() ? (
                <button
                  onClick={() => setSearch("")}
                  className="rounded-full border border-slate-700 px-3 py-1.5 text-slate-300 transition hover:border-slate-500 hover:text-white"
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-slate-950 px-6 py-5">
          {loading ? (
            <div className={cn("grid gap-3", view === "compact" ? "md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1")}>
              {Array.from({ length: 12 }).map((_, index) => (
                <div key={index} className="grid grid-cols-[88px_minmax(0,1fr)] gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3">
                  <div className="h-20 w-[88px] animate-pulse rounded-lg bg-slate-800" />
                  <div className="space-y-2 py-1">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-slate-800" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-slate-800" />
                  </div>
                </div>
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full min-h-[320px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-800 p-10 text-center">
              <div className="text-base font-semibold text-white">No products found</div>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-400">
                Try a different search term or clear the filter to browse everything.
              </p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className={cn("grid gap-3", view === "compact" ? "md:grid-cols-2 xl:grid-cols-3" : "grid-cols-1")}>
                {visibleProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => onSelect(product)}
                    className={cn(
                      "group text-left transition",
                      view === "compact"
                        ? "grid grid-cols-[88px_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-3 hover:border-slate-600 hover:bg-slate-900"
                        : "grid grid-cols-[96px_minmax(0,1fr)_auto] items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/80 p-4 hover:border-slate-600 hover:bg-slate-900"
                    )}
                  >
                    <div className={cn("overflow-hidden rounded-lg border border-slate-800 bg-slate-950", view === "compact" ? "h-20 w-[88px]" : "h-24 w-24")}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{product.name}</div>
                      <div className="mt-1 truncate text-xs text-slate-400">
                        {product.shopify_vendor || "Manual"} {product.shopify_product_type ? `· ${product.shopify_product_type}` : ""}
                      </div>
                    </div>
                    <div className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-300 transition group-hover:border-slate-500 group-hover:text-white">
                      Select
                    </div>
                  </button>
                ))}
              </div>

              {hasMore ? (
                <div className="flex justify-center pt-2">
                  <button
                    onClick={() => setVisibleCount((current) => current + PRODUCT_PICKER_BATCH_SIZE)}
                    className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm font-semibold text-slate-200 transition hover:border-slate-500 hover:text-white"
                  >
                    Load more ({Math.min(PRODUCT_PICKER_BATCH_SIZE, filtered.length - visibleProducts.length)})
                  </button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ScriptCard({
  script,
  selected,
  onUse,
  loading,
}: {
  script: UgcScriptOption;
  selected: boolean;
  onUse: () => void;
  loading?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div
      className={cn(
        "rounded-2xl border p-5 transition",
        selected
          ? "border-white/20 bg-slate-900 ring-1 ring-white/10"
          : "border-slate-800 bg-slate-950/70 hover:border-slate-700"
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{script.title}</div>
          <div className="mt-1 text-xs leading-5 text-slate-400">{script.rationale}</div>
        </div>
        <span className="shrink-0 rounded-full bg-slate-800/80 px-2.5 py-1 text-[11px] font-semibold text-slate-300">
          ~{script.estimatedSeconds}s
        </span>
      </div>
      <div
        className={cn(
          "mb-4 rounded-xl border border-slate-800 bg-slate-900/60 p-3.5 text-sm leading-6 text-slate-300 transition-all cursor-pointer",
          expanded ? "" : "line-clamp-4"
        )}
        onClick={() => setExpanded(!expanded)}
      >
        {script.dialogue}
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-lg bg-slate-800/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Hook: {script.hook}
          </span>
          <span className="rounded-lg bg-slate-800/60 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            CTA: {script.cta}
          </span>
        </div>
        <button
          onClick={onUse}
          disabled={loading}
          className={cn(
            "shrink-0 rounded-xl px-4 py-2 text-xs font-semibold transition",
            selected
              ? "bg-white text-slate-950 hover:bg-slate-200"
              : "border border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white",
            loading && "cursor-not-allowed opacity-50"
          )}
        >
          {loading ? "Working..." : selected ? "Selected" : "Use this script"}
        </button>
      </div>
    </div>
  );
}

function PromptViewer({ prompt }: { prompt: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-[10px] font-semibold text-slate-500 transition hover:text-slate-300"
      >
        {open ? "Hide prompt" : "View prompt"}
      </button>
      {open && (
        <div className="mt-1.5 max-h-32 overflow-y-auto rounded-lg bg-slate-950 p-2 text-[10px] leading-4 text-slate-400 select-all">
          {prompt}
        </div>
      )}
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
  selectLabel,
  selectedLabel,
}: {
  render: SceneRender;
  selected: boolean;
  subtitle: string;
  onSelect: () => void;
  onDownload: () => void;
  hideSelect?: boolean;
  selectLabel?: string;
  selectedLabel?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border transition",
        selected ? "border-white/20 ring-1 ring-white/10" : "border-slate-800 hover:border-slate-700"
      )}
    >
      <div className="aspect-[9/16] bg-slate-900">
        {render.url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={render.url} alt={render.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {render.status === "running" ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-white" />
                <span>Generating...</span>
              </div>
            ) : render.error || "Waiting"}
          </div>
        )}
      </div>
      <div className="space-y-2.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">{render.title}</div>
            <div className="mt-0.5 text-xs text-slate-400">{subtitle}</div>
          </div>
          <StatusDot status={render.status} />
        </div>
        <PromptViewer prompt={render.prompt} />
        <div className="flex gap-2">
          {!hideSelect ? (
            <button
              onClick={onSelect}
              disabled={!render.url}
              className={cn(
                "flex-1 rounded-xl py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
                selected
                  ? "bg-white text-slate-950"
                  : "bg-slate-800 text-white hover:bg-slate-700"
              )}
            >
              {selected ? selectedLabel || "Selected" : selectLabel || "Use this scene"}
            </button>
          ) : null}
          <button
            onClick={onDownload}
            disabled={!render.url}
            className={cn(
              "rounded-xl border border-slate-700 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40",
              hideSelect ? "flex-1" : "px-3"
            )}
          >
            Save
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
  onRegenerate,
}: {
  render: VideoRender;
  selected: boolean;
  onToggle: () => void;
  onDownload: () => void;
  onRegenerate: (feedback: string) => void;
}) {
  const [showFeedback, setShowFeedback] = useState(false);
  const [feedback, setFeedback] = useState("");
  const isReady = render.url && render.status !== "running";

  return (
    <div className={cn(
      "overflow-hidden rounded-2xl border transition",
      selected ? "border-white/20 ring-1 ring-white/10" : "border-slate-800 hover:border-slate-700"
    )}>
      <div className="aspect-[9/16] bg-slate-900">
        {render.url ? (
          <video src={render.url} controls className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-slate-500">
            {render.status === "running" ? (
              <div className="flex flex-col items-center gap-2">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-slate-700 border-t-white" />
                <span>Rendering...</span>
              </div>
            ) : render.error || "Waiting"}
          </div>
        )}
      </div>
      <div className="space-y-2.5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-semibold text-white">{render.title}</div>
          <StatusDot status={render.status} />
        </div>
        <PromptViewer prompt={render.prompt} />
        <div className="flex gap-2">
          <button
            onClick={onToggle}
            disabled={!render.url}
            className={cn(
              "flex-1 rounded-xl py-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-40",
              selected
                ? "bg-white text-slate-950"
                : "bg-slate-800 text-white hover:bg-slate-700"
            )}
          >
            {selected ? "Selected" : "Select"}
          </button>
          <button
            onClick={onDownload}
            disabled={!render.url}
            className="rounded-xl border border-slate-700 px-3 py-2 text-xs font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Save
          </button>
        </div>
        {isReady && (
          <div>
            {!showFeedback ? (
              <button
                onClick={() => setShowFeedback(true)}
                className="w-full rounded-xl border border-slate-800 py-2 text-xs font-semibold text-slate-400 transition hover:border-slate-600 hover:text-white"
              >
                Discard &amp; regenerate
              </button>
            ) : (
              <div className="space-y-2">
                <textarea
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  placeholder="What went wrong? What should be different?"
                  className="w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-xs leading-5 text-white outline-none transition placeholder:text-slate-500 focus:border-slate-500"
                  rows={3}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      onRegenerate(feedback);
                      setFeedback("");
                      setShowFeedback(false);
                    }}
                    className="flex-1 rounded-lg bg-white py-1.5 text-xs font-semibold text-slate-950 transition hover:bg-slate-200"
                  >
                    Regenerate
                  </button>
                  <button
                    onClick={() => { setShowFeedback(false); setFeedback(""); }}
                    className="rounded-lg border border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-400 transition hover:text-white"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Primary Action Button (used at the bottom of each stage) ─── */

function PrimaryAction({
  label,
  onClick,
  disabled,
  loading,
  secondary,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
  secondary?: { label: string; onClick: () => void; disabled?: boolean }[];
}) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-800 bg-slate-900/50 p-4">
      <button
        onClick={onClick}
        disabled={disabled || loading}
        className="rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Working..." : label}
      </button>
      {secondary?.map((action) => (
        <button
          key={action.label}
          onClick={action.onClick}
          disabled={action.disabled}
          className="rounded-xl border border-slate-700 px-4 py-3 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {action.label}
        </button>
      ))}
    </div>
  );
}

/* ─── Feedback Panel (simplified approval for safe mode) ─── */

function FeedbackPanel({
  note,
  onNoteChange,
  visible,
}: {
  note: string;
  onNoteChange: (note: string) => void;
  visible: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!visible) return null;

  return (
    <div className="mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="text-xs font-semibold text-slate-400 transition hover:text-slate-200"
      >
        {open ? "Hide feedback" : "Add feedback for next generation"}
      </button>
      {open ? (
        <textarea
          value={note}
          onChange={(event) => onNoteChange(event.target.value)}
          placeholder="Describe any changes you'd like to see in the next generation..."
          className="mt-2 min-h-[80px] w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
        />
      ) : null}
    </div>
  );
}

/* ─── Main Page ─── */

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
  const [selectedBrollSeedIds, setSelectedBrollSeedIds] = useState<Set<string>>(new Set());
  const [selectedDialogueVideoIds, setSelectedDialogueVideoIds] = useState<Set<string>>(new Set());
  const [selectedBrollVideoIds, setSelectedBrollVideoIds] = useState<Set<string>>(new Set());
  const [coverageSeedSourceSceneId, setCoverageSeedSourceSceneId] = useState<string | null>(null);
  const [lastAutoCoverageSceneId, setLastAutoCoverageSceneId] = useState<string | null>(null);
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
  const [showProductSelector, setShowProductSelector] = useState(false);
  const [activeStage, setActiveStage] = useState<UgcStageView>("setup");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoGenerateScenes, setAutoGenerateScenes] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const imageModelOptions = useMemo(() => MODEL_LIST.filter((model) => model.id !== "nanobanana-3-pro"), []);
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
      return { name: "", imageUrl: "", category: "", vendor: "" };
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
        if (!ignore) setProducts(json.products || []);
      } catch (error: any) {
        if (!ignore) setErrorMessage(error?.message || "Failed to load products");
      } finally {
        if (!ignore) setProductsLoading(false);
      }
    };
    void loadProducts();
    return () => { ignore = true; };
  }, []);

  const resetDownstream = (options?: { keepPlan?: boolean }) => {
    setSceneRenders([]);
    setSelectedSceneId(null);
    setDialogueVideos([]);
    setBrollSeedImages([]);
    setBrollVideos([]);
    setSelectedBrollSeedIds(new Set());
    setSelectedDialogueVideoIds(new Set());
    setSelectedBrollVideoIds(new Set());
    setCoverageSeedSourceSceneId(null);
    setLastAutoCoverageSceneId(null);
    if (!options?.keepPlan) {
      setPlan(null);
      setSelectedScriptId(null);
    }
  };

  const handleProductUpload = async (file: File | null) => {
    if (!file) return;
    setUploadingProduct(true);
    setErrorMessage(null);
    addActivity("product", `Uploading ${file.name}...`);
    try {
      const formData = new FormData();
      formData.append("files", file);
      const response = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await response.json();
      if (!response.ok) throw new Error(json?.error || "Upload failed");
      const url = json?.urls?.[0];
      if (!url) throw new Error("Upload did not return a URL");
      setUploadedProductName(file.name.replace(/\.[^.]+$/, ""));
      setUploadedProductUrl(url);
      setProductSource("upload");
      addActivity("product", "Product image uploaded.", "success");
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
    addActivity("script", `Imported script from ${file.name}.`, "success");
  };

  const handleBuildPlan = async (options?: { overrideInstructions?: string; scriptOverride?: string; skipNavigation?: boolean }) => {
    const productName = selectedProductCard.name.trim();
    if (!productName) {
      setErrorMessage("Select a product first.");
      return;
    }
    if (scriptMode === "upload" && !scriptText.trim()) {
      setErrorMessage("Paste or import a script before generating.");
      return;
    }

    setPlanLoading(true);
    setErrorMessage(null);
    resetDownstream();
    setApprovals(createApprovalState(settings.safeMode));
    addActivity("plan", "Generating scripts and building workflow...");

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
      if (!response.ok) throw new Error(json?.error || "Failed to generate scripts");
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
      addActivity("plan", `${nextPlan.scriptOptions.length} scripts ready.`, "success");

      // When user provided their own script, skip the script selection stage
      // and go directly to scene generation
      const isUploadMode = scriptMode === "upload" || !!options?.scriptOverride;
      if (!options?.skipNavigation) {
        if (isUploadMode) {
          // Auto-approve the script and jump to scene generation
          setApprovals((current) => ({
            ...current,
            script: { ...current.script, status: "approved" },
          }));
          setActiveStage("scene");
          setAutoGenerateScenes(true);
        } else {
          setActiveStage("plan");
        }
      }
    } catch (error: any) {
      setErrorMessage(error?.message || "Failed to generate scripts");
      addActivity("plan", error?.message || "Failed to generate scripts", "error");
    } finally {
      setPlanLoading(false);
    }
  };

  const handleRegenerateScripts = async () => {
    if (scriptMode !== "generate") return;
    await handleBuildPlan({
      overrideInstructions: [
        approvals.script.note,
        "Generate three completely fresh script alternatives with different hooks, structures, and wording.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  };

  const handleGenerateScenes = async (options?: { bypassApproval?: boolean }) => {
    if (!plan) return;
    if (settings.safeMode === "safe" && !options?.bypassApproval && approvals.script.status !== "approved") {
      setErrorMessage("Select a script first.");
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
    addActivity("scene", `Generating ${variations.length} scene options...`);

    try {
      await runWithConcurrency(variations, variations.length, async (variation, index) => {
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
          addActivity("scene", `${variation.title} ready.`, "success");
        } catch (error: any) {
          setSceneRenders((current) =>
            current.map((render) =>
              render.id === variation.id
                ? { ...render, status: "error", error: error?.message || "Generation failed" }
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

  const handleGenerateDialogueClips = async (options?: { bypassApproval?: boolean }) => {
    if (!plan || !selectedScene?.url) {
      setErrorMessage("Select a scene first.");
      return;
    }
    if (settings.safeMode === "safe" && !options?.bypassApproval && approvals.scene.status !== "approved") {
      setErrorMessage("Approve the scene before rendering clips.");
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
    addActivity("clips", `Rendering ${clips.length} talking clips...`);

    try {
      await runWithConcurrency(clips, clips.length, async (clip) => {
        try {
          const response = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "kling",
              model: "kling-3.0/video",
              mode: "kling30",
              prompt: applyOverride(clip.prompt, approvals.dialogue.note),
              duration: String(clip.durationSeconds),
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
          addActivity("clips", `Clip ${clip.index + 1} ready.`, "success");
        } catch (error: any) {
          setDialogueVideos((current) =>
            current.map((item) =>
              item.id === clip.id
                ? { ...item, status: "error", error: error?.message || "Video generation failed" }
                : item
            )
          );
          addActivity("clips", error?.message || `Clip ${clip.index + 1} failed`, "error");
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

  const handleGenerateBrollSeeds = async (options?: { auto?: boolean }) => {
    if (!plan || !selectedScene?.url) {
      setErrorMessage("Select a scene first.");
      return;
    }
    if (settings.safeMode === "safe" && approvals.scene.status !== "approved") {
      setErrorMessage("Approve the scene first.");
      return;
    }
    if (brollSeedLoading) return;

    const shots = plan.bRollImagePlans;
    if (!options?.auto) setActiveStage("broll");
    setBrollSeedLoading(true);
    setErrorMessage(null);
    setSelectedBrollSeedIds(new Set());
    setCoverageSeedSourceSceneId(selectedScene.id);
    setLastAutoCoverageSceneId(selectedScene.id);
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
    addActivity("broll", `Generating ${shots.length} B-roll images...`);

    try {
      await runWithConcurrency(shots, shots.length, async (shot) => {
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
          if (!response.ok) throw new Error(json?.error || "B-roll generation failed");
          setBrollSeedImages((current) =>
            current.map((item) =>
              item.id === shot.id ? { ...item, url: json.imageDataUrl, status: "done", error: null } : item
            )
          );
          addActivity("broll", `${shot.title} ready.`, "success");
        } catch (error: any) {
          setBrollSeedImages((current) =>
            current.map((item) =>
              item.id === shot.id
                ? { ...item, status: "error", error: error?.message || "B-roll generation failed" }
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
      setErrorMessage("Generate B-roll images first.");
      return;
    }
    const selectedReadySeeds = readySeeds.filter((seed) => selectedBrollSeedIds.has(seed.id));
    if (settings.safeMode === "safe" && selectedReadySeeds.length === 0 && approvals.broll.status !== "approved") {
      setErrorMessage("Select the B-roll images you want to animate, or approve the full set.");
      return;
    }
    const seedsToRender =
      settings.safeMode === "safe" && selectedReadySeeds.length > 0 ? selectedReadySeeds : readySeeds;

    setBrollLoading(true);
    setErrorMessage(null);
    const clipPlansBySeed = new Map<string, UgcBrollClipPlan>();
    plan.bRollClipPlans.forEach((clip) => clipPlansBySeed.set(clip.imagePlanId, clip));

    // Build a map from video render ID → seed, so we can find the source image for each clip
    const seedByVideoId = new Map<string, typeof seedsToRender[number]>();
    const initial = seedsToRender.map((seed) => {
      const clip = clipPlansBySeed.get(seed.planId);
      const videoId = clip?.id || seed.id;
      seedByVideoId.set(videoId, seed);
      return {
        id: videoId,
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
    addActivity("broll", `Rendering ${initial.length} B-roll clips...`);

    try {
      await runWithConcurrency(initial, initial.length, async (render) => {
        const seed = seedByVideoId.get(render.id);
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
          addActivity("broll", `${render.title} clip ready.`, "success");
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

  /* ─── Single-clip Regenerate Handlers ─── */

  const handleRegenerateDialogueClip = async (videoId: string, feedback: string) => {
    if (!plan || !selectedScene?.url) return;
    const clip = plan.dialogueClips.find((c) => c.id === videoId);
    if (!clip) return;

    const feedbackPrompt = feedback.trim()
      ? `${clip.prompt}\n\nREGENERATE FEEDBACK: The previous result was not right. ${feedback.trim()}`
      : clip.prompt;

    // Mark this clip as regenerating
    setDialogueVideos((current) =>
      current.map((item) =>
        item.id === videoId ? { ...item, url: null, status: "running", error: null, prompt: feedbackPrompt } : item
      )
    );
    addActivity("clips", `Regenerating ${clip.index + 1}...`);

    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "kling",
          model: "kling-3.0/video",
          mode: "kling30",
          prompt: feedbackPrompt,
          duration: String(clip.durationSeconds),
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
          item.id === videoId ? { ...item, url: json.videoUrl, status: "done", error: null } : item
        )
      );
      addActivity("clips", `Clip ${clip.index + 1} regenerated.`, "success");
    } catch (error: any) {
      setDialogueVideos((current) =>
        current.map((item) =>
          item.id === videoId
            ? { ...item, status: "error", error: error?.message || "Regeneration failed" }
            : item
        )
      );
      addActivity("clips", error?.message || `Clip ${clip.index + 1} regeneration failed`, "error");
    }
  };

  const handleRegenerateBrollClip = async (videoId: string, feedback: string) => {
    if (!plan) return;
    const video = brollVideos.find((v) => v.id === videoId);
    if (!video) return;
    // Find the seed image: the video's planId is a clip ID (e.g. "broll-clip-1"),
    // so look up the clip plan to get imagePlanId, then match to the seed
    const clipPlan = plan.bRollClipPlans.find((c) => c.id === video.planId);
    const seed = clipPlan
      ? brollSeedImages.find((s) => s.planId === clipPlan.imagePlanId || s.id === clipPlan.imagePlanId)
      : brollSeedImages.find((s) => s.id === video.planId);
    if (!seed?.url) return;

    const feedbackPrompt = feedback.trim()
      ? `${video.prompt}\n\nREGENERATE FEEDBACK: The previous result was not right. ${feedback.trim()}`
      : video.prompt;

    // Mark this clip as regenerating
    setBrollVideos((current) =>
      current.map((item) =>
        item.id === videoId ? { ...item, url: null, status: "running", error: null, prompt: feedbackPrompt } : item
      )
    );
    addActivity("broll", `Regenerating ${video.title}...`);

    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: "kling",
          model: "kling-3.0/video",
          mode: "kling30",
          prompt: feedbackPrompt,
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
          item.id === videoId ? { ...item, url: json.videoUrl, status: "done", error: null } : item
        )
      );
      addActivity("broll", `${video.title} regenerated.`, "success");
    } catch (error: any) {
      setBrollVideos((current) =>
        current.map((item) =>
          item.id === videoId
            ? { ...item, status: "error", error: error?.message || "Regeneration failed" }
            : item
        )
      );
      addActivity("broll", error?.message || `${video.title} regeneration failed`, "error");
    }
  };

  /* ─── Combined Flow Handlers ─── */

  const handleUseScript = async (script: UgcScriptOption) => {
    setSelectedScriptId(script.id);
    setApprovals((current) => ({
      ...current,
      script: { ...current.script, status: "approved" },
    }));
    // Navigate to Scene stage immediately so user sees progress
    setActiveStage("scene");

    if (script.id !== plan?.selectedScriptId) {
      // Different script - rebuild plan, then auto-generate scenes
      setScriptMode("upload");
      setScriptText(script.dialogue);
      setAutoGenerateScenes(true);
      await handleBuildPlan({ scriptOverride: script.dialogue, skipNavigation: true });
    } else {
      // Same script - directly generate scenes
      setAutoGenerateScenes(true);
    }
  };

  const handleUseScene = (render: SceneRender) => {
    const isNew = selectedSceneId !== render.id;
    setSelectedSceneId(render.id);
    if (isNew) {
      setDialogueVideos([]);
      setSelectedDialogueVideoIds(new Set());
      setBrollSeedImages([]);
      setBrollVideos([]);
      setSelectedBrollSeedIds(new Set());
      setSelectedBrollVideoIds(new Set());
      setCoverageSeedSourceSceneId(null);
      setLastAutoCoverageSceneId(null);
    }
    setApprovals((current) => ({
      ...current,
      scene: { ...current.scene, status: "approved" },
      ...(isNew && {
        dialogue: { ...current.dialogue, status: settings.safeMode === "safe" ? "pending" : "approved" },
        broll: { ...current.broll, status: settings.safeMode === "safe" ? "pending" : "approved" },
      }),
    }));
    setActiveStage("clips");
  };

  const exportWorkflowJson = () => {
    if (!plan) return;
    downloadText(
      `${runFilePrefix || "ugc-workflow"}.json`,
      JSON.stringify({ planSource, product: selectedProductCard, settings, approvals, plan }, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const exportPromptPack = () => {
    if (!plan) return;
    const content = [
      `Run: ${selectedProductCard.name || campaignName}`,
      `Plan source: ${planSource}`,
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
    downloadText(`${runFilePrefix || "ugc-workflow"}-prompts.txt`, content);
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
    setShowPresetPanel(false);
    addActivity("setup", `${preset.name} preset applied.`, "success");
  };

  /* ─── Auto-trigger effects ─── */

  // Auto-generate scenes after plan is built (when coming from handleUseScript)
  useEffect(() => {
    if (autoGenerateScenes && plan && !planLoading) {
      setAutoGenerateScenes(false);
      void handleGenerateScenes({ bypassApproval: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoGenerateScenes, plan, planLoading]);

  // Auto-generate B-roll seeds after scene approval
  useEffect(() => {
    if (!plan || !selectedScene?.url) return;
    if (settings.safeMode === "safe" && approvals.scene.status !== "approved") return;
    if (coverageSeedSourceSceneId === selectedScene.id && brollSeedImages.some((image) => image.url)) return;
    if (lastAutoCoverageSceneId === selectedScene.id || brollSeedLoading) return;
    void handleGenerateBrollSeeds({ auto: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    approvals.scene.status,
    brollSeedImages,
    brollSeedLoading,
    coverageSeedSourceSceneId,
    lastAutoCoverageSceneId,
    plan,
    selectedScene?.id,
    selectedScene?.url,
    settings.safeMode,
  ]);

  /* ─── Derived State ─── */

  const stageStatuses: Record<UgcStageView, ApprovalStatus | RenderStatus> = {
    setup: planLoading ? "running" : plan ? "done" : "pending",
    plan: planLoading ? "running" : plan ? approvals.script.status : "pending",
    scene: sceneLoading ? "running" : sceneRenders.some((r) => r.url) ? (selectedScene ? "done" : "pending") : "pending",
    clips: dialogueLoading ? "running" : dialogueVideos.some((v) => v.url) ? "done" : "pending",
    broll: brollLoading || brollSeedLoading ? "running" : brollVideos.some((v) => v.url) ? "done" : "pending",
  };

  const selectedScript =
    plan?.scriptOptions.find((s) => s.id === selectedScriptId) ||
    plan?.scriptOptions.find((s) => s.id === plan.selectedScriptId) ||
    null;
  const selectedScenePlan = plan?.sceneVariations.find((s) => s.id === (selectedScene?.planId || selectedSceneId)) || null;
  const selectedAvatar = plan?.avatarOptions.find((a) => a.id === (selectedScene?.avatarId || selectedScenePlan?.avatarId)) || null;
  const runFilePrefix = safeName(selectedProductCard.name || "ugc-run");
  const readySceneCount = sceneRenders.filter((r) => r.url).length;
  const readyDialogueCount = dialogueVideos.filter((v) => v.url).length;
  const readyBrollSeedCount = brollSeedImages.filter((i) => i.url).length;
  const readyBrollCount = brollVideos.filter((v) => v.url).length;

  const stages: Array<{ id: UgcStageView; label: string; status: ApprovalStatus | RenderStatus }> = [
    { id: "setup", label: "Setup", status: stageStatuses.setup },
    { id: "plan", label: "Script", status: stageStatuses.plan },
    { id: "scene", label: "Scene", status: stageStatuses.scene },
    { id: "clips", label: "Clips", status: stageStatuses.clips },
    { id: "broll", label: "B-Roll", status: stageStatuses.broll },
  ];

  /* ─── Context bar summary ─── */
  const contextParts: string[] = [];
  if (selectedProductCard.name) contextParts.push(selectedProductCard.name);
  if (selectedScript) contextParts.push(selectedScript.title);
  if (selectedScene) contextParts.push(selectedScene.title);
  const contextSummary = contextParts.length > 0 ? contextParts.join("  /  ") : null;

  /* ─── Render ─── */

  return (
    <div className={cn(ugcBodyFont.variable, ugcDisplayFont.variable, "relative min-h-screen bg-slate-950 font-[var(--font-ugc-body)] text-white")}>
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(148,163,184,0.06),transparent_32%)]" />

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
        {/* ─── Header ─── */}
        <header className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-[0.28em] text-slate-500">UGC Video Studio</div>
              <h1 className="mt-2 font-[var(--font-ugc-display)] text-3xl font-semibold tracking-[-0.04em] text-white sm:text-4xl">
                Create your video
              </h1>
              <p className="mt-2 max-w-lg text-sm leading-6 text-slate-400">
                Pick a product, generate a script, choose a scene, and render your talking-head clips and B-roll.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowPresetPanel(true)}
                className="rounded-xl border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
              >
                Presets
              </button>
              <button
                onClick={() => setShowPromptPanel(true)}
                className="rounded-xl border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:border-slate-600 hover:text-slate-200"
              >
                Settings
              </button>
              <div className="relative">
                <button
                  onClick={() => setShowExportMenu(!showExportMenu)}
                  disabled={!plan}
                  className="rounded-xl border border-slate-800 px-3 py-2 text-xs font-semibold text-slate-400 transition hover:border-slate-600 hover:text-slate-200 disabled:opacity-40"
                >
                  Export
                </button>
                {showExportMenu ? (
                  <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-xl border border-slate-800 bg-slate-900 py-1 shadow-xl">
                    <button onClick={() => { exportWorkflowJson(); setShowExportMenu(false); }} className="block w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white">
                      Export as JSON
                    </button>
                    <button onClick={() => { exportPromptPack(); setShowExportMenu(false); }} className="block w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white">
                      Export prompts
                    </button>
                    <button
                      onClick={() => { bulkDownload(selectedDialogueUrls, `${runFilePrefix}-clips`); setShowExportMenu(false); }}
                      disabled={selectedDialogueUrls.length === 0}
                      className="block w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40"
                    >
                      Download clips ({selectedDialogueUrls.length})
                    </button>
                    <button
                      onClick={() => { bulkDownload(selectedBrollUrls, `${runFilePrefix}-broll`); setShowExportMenu(false); }}
                      disabled={selectedBrollUrls.length === 0}
                      className="block w-full px-4 py-2 text-left text-sm text-slate-300 hover:bg-slate-800 hover:text-white disabled:opacity-40"
                    >
                      Download B-roll ({selectedBrollUrls.length})
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* ─── Stepper ─── */}
          <nav className="mt-6 flex items-center gap-1 rounded-2xl border border-slate-800 bg-slate-900/40 p-1.5">
            {stages.map((stage, index) => (
              <button
                key={stage.id}
                onClick={() => setActiveStage(stage.id)}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold transition",
                  activeStage === stage.id
                    ? "bg-white text-slate-950 shadow-sm"
                    : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
                )}
              >
                <span className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold",
                  activeStage === stage.id
                    ? "bg-slate-950 text-white"
                    : (stage.status === "done" || stage.status === "approved")
                      ? "bg-emerald-500/20 text-emerald-400"
                      : "bg-slate-800 text-slate-500"
                )}>
                  {(stage.status === "done" || stage.status === "approved") && activeStage !== stage.id ? (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={3} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>
                  ) : (
                    index + 1
                  )}
                </span>
                <span className="hidden sm:inline">{stage.label}</span>
              </button>
            ))}
          </nav>

          {/* ─── Context breadcrumb ─── */}
          {contextSummary ? (
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-slate-900/40 px-4 py-2.5 text-xs text-slate-400">
              <StatusDot status={stageStatuses[activeStage]} />
              <span className="truncate">{contextSummary}</span>
              {settings.safeMode === "safe" ? (
                <span className="ml-auto shrink-0 rounded-full bg-amber-950/40 px-2 py-0.5 text-[10px] font-semibold text-amber-300 ring-1 ring-amber-800/40">
                  Review mode
                </span>
              ) : null}
            </div>
          ) : null}
        </header>

        {/* ─── Error Banner ─── */}
        {errorMessage ? (
          <div className="mb-5 flex items-center justify-between rounded-2xl border border-rose-900/50 bg-rose-950/20 px-4 py-3 text-sm text-rose-300">
            <span>{errorMessage}</span>
            <button onClick={() => setErrorMessage(null)} className="ml-3 text-rose-400 hover:text-rose-200">
              Dismiss
            </button>
          </div>
        ) : null}

        {/* ─── Stage Content ─── */}
        <main className="space-y-5">

          {/* ═══ SETUP ═══ */}
          {activeStage === "setup" ? (
            <SectionCard title="Set up your video" subtitle="Choose a product and define the direction for your script.">
              <div className="grid gap-5 lg:grid-cols-2">
                {/* Product */}
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="text-sm font-semibold text-white">Product</div>

                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                    <button
                      onClick={() => setProductSource("catalog")}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-semibold transition",
                        productSource === "catalog" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"
                      )}
                    >
                      From catalog
                    </button>
                    <button
                      onClick={() => setProductSource("upload")}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-semibold transition",
                        productSource === "upload" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"
                      )}
                    >
                      Upload image
                    </button>
                  </div>

                  {productSource === "catalog" ? (
                    <div className="space-y-3">
                      {selectedProduct ? (
                        <div className="grid grid-cols-[64px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-slate-800 bg-slate-950 p-3">
                          <div className="h-16 w-16 overflow-hidden rounded-lg border border-slate-800">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={selectedProduct.image_url} alt={selectedProduct.name} className="h-full w-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-white">{selectedProduct.name}</div>
                            <div className="mt-0.5 truncate text-xs text-slate-400">
                              {selectedProduct.shopify_vendor || "Manual"} {selectedProduct.shopify_product_type ? `· ${selectedProduct.shopify_product_type}` : ""}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-700 p-6 text-center text-sm text-slate-500">
                          No product selected
                        </div>
                      )}
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setProductSearch(""); setShowProductSelector(true); }}
                          className="rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                        >
                          {selectedProduct ? "Change" : "Choose product"}
                        </button>
                        <button
                          onClick={async () => {
                            const ok = await refreshProducts();
                            addActivity("product", ok ? "Catalog refreshed." : "Refresh failed.", ok ? "success" : "error");
                          }}
                          disabled={productsLoading}
                          className="rounded-xl border border-slate-700 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white disabled:opacity-40"
                        >
                          {productsLoading ? "Loading..." : "Refresh"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <input
                        value={uploadedProductName}
                        onChange={(event) => setUploadedProductName(event.target.value)}
                        placeholder="Product name"
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
                      />
                      <label className="inline-flex cursor-pointer items-center rounded-xl border border-slate-700 px-3 py-2.5 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:text-white">
                        {uploadingProduct ? "Uploading..." : "Upload image"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          className="hidden"
                          onChange={(event) => handleProductUpload(event.target.files?.[0] || null)}
                        />
                      </label>
                      {uploadedProductUrl ? (
                        <div className="h-48 overflow-hidden rounded-xl border border-slate-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={uploadedProductUrl} alt={uploadedProductName} className="h-full w-full object-cover" />
                        </div>
                      ) : null}
                    </div>
                  )}
                </div>

                {/* Script Direction */}
                <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4">
                  <div className="text-sm font-semibold text-white">Script direction</div>

                  <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                    <button
                      onClick={() => setScriptMode("generate")}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-semibold transition",
                        scriptMode === "generate" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"
                      )}
                    >
                      AI-generated
                    </button>
                    <button
                      onClick={() => setScriptMode("upload")}
                      className={cn(
                        "rounded-lg px-3 py-2 text-sm font-semibold transition",
                        scriptMode === "upload" ? "bg-white text-slate-950" : "text-slate-400 hover:text-white"
                      )}
                    >
                      My own script
                    </button>
                  </div>

                  {scriptMode === "generate" ? (
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">Creative direction <span className="font-normal text-slate-500">(optional)</span></div>
                      <textarea
                        value={description}
                        onChange={(event) => setDescription(event.target.value)}
                        placeholder="e.g. &quot;Honest review angle, creator discovers the product at their desk&quot; or &quot;Problem-solution hook, quick before/after&quot;"
                        className="min-h-[120px] w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
                      />
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="mb-2 text-xs font-semibold text-slate-400">Your script</div>
                      <textarea
                        value={scriptText}
                        onChange={(event) => setScriptText(event.target.value)}
                        placeholder="Paste your script here..."
                        className="min-h-[120px] w-full rounded-xl border border-slate-800 bg-slate-950 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
                      />
                      <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-white">
                        Or import a text file
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
              </div>

              {/* Advanced Settings */}
              <div className="mt-4">
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 transition hover:text-slate-200"
                >
                  <svg className={cn("h-3 w-3 transition", showAdvanced && "rotate-90")} fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                  </svg>
                  Advanced settings
                </button>
                {showAdvanced ? (
                  <div className="mt-3 grid gap-4 rounded-xl border border-slate-800 bg-slate-900/40 p-4 sm:grid-cols-2 lg:grid-cols-4">
                    <div>
                      <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-400">
                        <span>Duration</span>
                        <span className="text-white">{settings.dialogueSeconds}s</span>
                      </div>
                      <input
                        type="range"
                        min={5}
                        max={60}
                        step={1}
                        value={settings.dialogueSeconds}
                        onChange={(e) => setSettings((c) => ({ ...c, dialogueSeconds: Number(e.target.value) }))}
                        className="w-full accent-white"
                      />
                      <div className="mt-1 flex justify-between text-[10px] text-slate-500">
                        <span>5s</span>
                        <span>30s</span>
                        <span>60s</span>
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">Mode</div>
                      <div className="grid grid-cols-2 gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
                        <button
                          onClick={() => setSettings((c) => ({ ...c, safeMode: "safe" }))}
                          className={cn(
                            "rounded-lg px-3 py-2 text-xs font-semibold transition",
                            settings.safeMode === "safe" ? "bg-white text-slate-950" : "text-slate-400"
                          )}
                        >
                          Review
                        </button>
                        <button
                          onClick={() => setSettings((c) => ({ ...c, safeMode: "fast" }))}
                          className={cn(
                            "rounded-lg px-3 py-2 text-xs font-semibold transition",
                            settings.safeMode === "fast" ? "bg-white text-slate-950" : "text-slate-400"
                          )}
                        >
                          Fast
                        </button>
                      </div>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">Scene options</div>
                      <input
                        type="number" min={1} max={8}
                        value={settings.sceneVariationCount}
                        onChange={(e) => setSettings((c) => ({ ...c, sceneVariationCount: Number(e.target.value) || 4 }))}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-600"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">B-roll clips</div>
                      <input
                        type="number" min={1} max={8}
                        value={settings.bRollClipCount}
                        onChange={(e) => setSettings((c) => ({ ...c, bRollClipCount: Number(e.target.value) || 4 }))}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-600"
                      />
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">Image model</div>
                      <select
                        value={settings.imageModelId}
                        onChange={(e) => setSettings((c) => ({ ...c, imageModelId: e.target.value }))}
                        className="w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-slate-600"
                      >
                        {imageModelOptions.map((model) => (
                          <option key={model.id} value={model.id}>{model.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <div className="mb-2 text-xs font-semibold text-slate-400">Appearance notes</div>
                      <textarea
                        value={appearanceNotes}
                        onChange={(e) => setAppearanceNotes(e.target.value)}
                        placeholder="Materials, finish, branding details..."
                        className="min-h-[60px] w-full rounded-xl border border-slate-800 bg-slate-950 px-3 py-2 text-sm text-white outline-none placeholder:text-slate-500 focus:border-slate-600"
                      />
                    </div>
                  </div>
                ) : null}
              </div>

              <PrimaryAction
                label={planLoading
                  ? (scriptMode === "upload" ? "Building plan..." : "Generating scripts...")
                  : (scriptMode === "upload" ? "Build plan & generate scenes" : "Generate scripts")}
                onClick={() => handleBuildPlan()}
                disabled={!selectedProductCard.name.trim() || (scriptMode === "upload" && !scriptText.trim())}
                loading={planLoading}
              />
            </SectionCard>
          ) : null}

          {/* ═══ SCRIPTS ═══ */}
          {activeStage === "plan" ? (
            <SectionCard title="Choose a script" subtitle="Pick the script direction for your video. This will generate scene options automatically.">
              {plan ? (
                <div className="space-y-4">
                  <div className="grid gap-4 lg:grid-cols-3">
                    {plan.scriptOptions.map((script) => (
                      <ScriptCard
                        key={script.id}
                        script={script}
                        selected={selectedScriptId === script.id}
                        onUse={() => handleUseScript(script)}
                        loading={planLoading || sceneLoading}
                      />
                    ))}
                  </div>

                  <FeedbackPanel
                    note={approvals.script.note}
                    onNoteChange={(note) => setApprovals((c) => ({ ...c, script: { ...c.script, note } }))}
                    visible={settings.safeMode === "safe"}
                  />

                  <PrimaryAction
                    label={sceneLoading ? "Generating scenes..." : "Use selected script & generate scenes"}
                    onClick={() => {
                      const script = plan.scriptOptions.find((s) => s.id === selectedScriptId);
                      if (script) handleUseScript(script);
                    }}
                    disabled={!selectedScriptId || sceneLoading}
                    loading={sceneLoading || planLoading}
                    secondary={scriptMode === "generate" ? [{
                      label: "Regenerate all scripts",
                      onClick: handleRegenerateScripts,
                      disabled: planLoading,
                    }] : undefined}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
                  Go back to Setup and generate scripts first.
                </div>
              )}
            </SectionCard>
          ) : null}

          {/* ═══ SCENE ═══ */}
          {activeStage === "scene" ? (
            <SectionCard title="Choose your scene" subtitle="Select the scene that will be used as the base for all your video clips.">
              {/* Thinking / progress indicator */}
              {(planLoading || (sceneLoading && sceneRenders.every((r) => !r.url))) ? (
                <div className="space-y-5">
                  <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-800 bg-slate-900/40 py-16">
                    <div className="mb-4 h-8 w-8 animate-spin rounded-full border-[3px] border-slate-700 border-t-white" />
                    <div className="text-sm font-semibold text-white">
                      {planLoading ? "Building scene plan..." : "Generating scenes..."}
                    </div>
                    <p className="mt-2 max-w-sm text-center text-xs leading-5 text-slate-400">
                      {planLoading
                        ? "Adapting the scene prompts, dialogue clips, and B-roll plan to your selected script. This takes a moment."
                        : `Rendering ${settings.sceneVariationCount} scene options. Each one will appear as it finishes.`}
                    </p>
                  </div>
                  {/* Show progress steps */}
                  <div className="flex items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/40 px-4 py-3">
                    <div className="flex items-center gap-2">
                      <StatusDot status={planLoading ? "running" : "done"} />
                      <span className={cn("text-xs font-medium", planLoading ? "text-white" : "text-slate-400")}>Prepare plan</span>
                    </div>
                    <svg className="h-3 w-3 text-slate-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                    <div className="flex items-center gap-2">
                      <StatusDot status={sceneLoading ? "running" : planLoading ? "pending" : "pending"} />
                      <span className={cn("text-xs font-medium", sceneLoading ? "text-white" : "text-slate-500")}>Generate scenes</span>
                    </div>
                    <svg className="h-3 w-3 text-slate-700" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                    <div className="flex items-center gap-2">
                      <StatusDot status="pending" />
                      <span className="text-xs font-medium text-slate-500">Pick your scene</span>
                    </div>
                  </div>
                </div>
              ) : plan ? (
                <div className="space-y-4">
                  {selectedScene ? (
                    <div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-900/40 bg-emerald-950/20 px-4 py-3">
                      <div className="flex items-center gap-3">
                        <StatusDot status="done" />
                        <div>
                          <span className="text-sm font-semibold text-white">{selectedScene.title}</span>
                          <span className="ml-2 text-xs text-slate-400">
                            {selectedAvatar ? `${selectedAvatar.label} · ` : ""}{selectedScenePlan?.environment || ""}
                          </span>
                        </div>
                      </div>
                      <span className="text-xs text-emerald-400">Scene locked</span>
                    </div>
                  ) : null}

                  {sceneRenders.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {sceneRenders.map((render) => {
                        const scene = plan.sceneVariations.find((s) => s.id === render.planId);
                        const avatar = plan.avatarOptions.find((a) => a.id === render.avatarId);
                        return (
                          <ImageRenderCard
                            key={render.id}
                            render={render}
                            subtitle={avatar ? avatar.label : scene?.environment || "Scene"}
                            selected={selectedSceneId === render.id}
                            onSelect={() => handleUseScene(render)}
                            onDownload={() => render.url && downloadUrl(render.url, `${safeName(render.title)}.png`)}
                          />
                        );
                      })}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
                      Scenes will appear here after you select a script.
                    </div>
                  )}

                  <FeedbackPanel
                    note={approvals.scene.note}
                    onNoteChange={(note) => setApprovals((c) => ({ ...c, scene: { ...c.scene, note } }))}
                    visible={settings.safeMode === "safe"}
                  />

                  <PrimaryAction
                    label="Regenerate scenes"
                    onClick={() => handleGenerateScenes({ bypassApproval: true })}
                    disabled={!plan || sceneLoading}
                    loading={sceneLoading}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
                  Generate scripts first.
                </div>
              )}
            </SectionCard>
          ) : null}

          {/* ═══ CLIPS ═══ */}
          {activeStage === "clips" ? (
            <SectionCard title="Talking clips" subtitle="Render your dialogue clips from the selected scene. Each clip syncs speech with the visual.">
              {plan ? (
                <div className="space-y-5">
                  {/* Clip plan summary */}
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                    {plan.dialogueClips.map((clip: UgcDialogueClipPlan) => (
                      <div key={clip.id} className="rounded-xl border border-slate-800 bg-slate-900/40 p-3">
                        <div className="mb-1.5 flex items-center justify-between gap-2">
                          <div className="text-sm font-semibold text-white">Clip {clip.index + 1}</div>
                          <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[10px] font-semibold text-slate-400">
                            {clip.durationSeconds}s
                          </span>
                        </div>
                        <p className="text-xs leading-5 text-slate-300 line-clamp-3">{clip.spokenText}</p>
                      </div>
                    ))}
                  </div>

                  {/* Rendered videos */}
                  {dialogueVideos.length > 0 ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      {dialogueVideos.map((video) => (
                        <VideoRenderCard
                          key={video.id}
                          render={video}
                          selected={selectedDialogueVideoIds.has(video.id)}
                          onToggle={() =>
                            setSelectedDialogueVideoIds((current) => {
                              const next = new Set(current);
                              if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
                              return next;
                            })
                          }
                          onDownload={() => video.url && downloadUrl(video.url, `${safeName(video.title)}.mp4`)}
                          onRegenerate={(feedback) => handleRegenerateDialogueClip(video.id, feedback)}
                        />
                      ))}
                    </div>
                  ) : null}

                  <FeedbackPanel
                    note={approvals.dialogue.note}
                    onNoteChange={(note) => setApprovals((c) => ({ ...c, dialogue: { ...c.dialogue, note } }))}
                    visible={settings.safeMode === "safe"}
                  />

                  <PrimaryAction
                    label={dialogueLoading ? "Rendering clips..." : readyDialogueCount > 0 ? "Re-render clips" : "Render talking clips"}
                    onClick={() => handleGenerateDialogueClips({ bypassApproval: true })}
                    disabled={!selectedScene || dialogueLoading}
                    loading={dialogueLoading}
                    secondary={[
                      ...(selectedDialogueUrls.length > 0 ? [{
                        label: `Download selected (${selectedDialogueUrls.length})`,
                        onClick: () => bulkDownload(selectedDialogueUrls, `${runFilePrefix}-clips`),
                      }] : []),
                      {
                        label: "Go to B-Roll",
                        onClick: () => setActiveStage("broll"),
                      },
                    ]}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
                  Generate scripts and select a scene first.
                </div>
              )}
            </SectionCard>
          ) : null}

          {/* ═══ B-ROLL ═══ */}
          {activeStage === "broll" ? (
            <SectionCard title="B-Roll" subtitle="Supporting shots from the same scene. Select the ones you want to animate into clips.">
              {plan ? (
                <div className="space-y-6">
                  {/* B-Roll still images */}
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">
                        Still frames
                        {readyBrollSeedCount > 0 ? <span className="ml-2 text-xs font-normal text-slate-400">({readyBrollSeedCount} ready)</span> : null}
                      </div>
                      {brollSeedLoading ? <StatusPill status="running" /> : null}
                    </div>
                    {brollSeedImages.length > 0 ? (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {brollSeedImages.map((render) => (
                          <ImageRenderCard
                            key={render.id}
                            render={render}
                            selected={selectedBrollSeedIds.has(render.id)}
                            subtitle="B-roll frame"
                            onSelect={() =>
                              setSelectedBrollSeedIds((current) => {
                                const next = new Set(current);
                                if (next.has(render.id)) next.delete(render.id); else next.add(render.id);
                                return next;
                              })
                            }
                            onDownload={() => render.url && downloadUrl(render.url, `${safeName(render.title)}.png`)}
                            selectLabel="Use this frame"
                            selectedLabel="Selected"
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
                        {selectedScene
                          ? "B-roll frames are being generated automatically from your selected scene."
                          : "Select a scene first to generate B-roll frames."}
                      </div>
                    )}
                  </div>

                  {/* B-Roll video clips */}
                  <div>
                    <div className="mb-3 flex items-center justify-between">
                      <div className="text-sm font-semibold text-white">
                        Animated clips
                        {readyBrollCount > 0 ? <span className="ml-2 text-xs font-normal text-slate-400">({readyBrollCount} ready)</span> : null}
                      </div>
                      {brollLoading ? <StatusPill status="running" /> : null}
                    </div>
                    {brollVideos.length > 0 ? (
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        {brollVideos.map((video) => (
                          <VideoRenderCard
                            key={video.id}
                            render={video}
                            selected={selectedBrollVideoIds.has(video.id)}
                            onToggle={() =>
                              setSelectedBrollVideoIds((current) => {
                                const next = new Set(current);
                                if (next.has(video.id)) next.delete(video.id); else next.add(video.id);
                                return next;
                              })
                            }
                            onDownload={() => video.url && downloadUrl(video.url, `${safeName(video.title)}.mp4`)}
                            onRegenerate={(feedback) => handleRegenerateBrollClip(video.id, feedback)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-2xl border border-dashed border-slate-800 p-8 text-center text-sm text-slate-500">
                        Select frames above and click &quot;Animate selected&quot; to create video clips.
                      </div>
                    )}
                  </div>

                  <FeedbackPanel
                    note={approvals.broll.note}
                    onNoteChange={(note) => setApprovals((c) => ({ ...c, broll: { ...c.broll, note } }))}
                    visible={settings.safeMode === "safe"}
                  />

                  <PrimaryAction
                    label={brollSeedLoading ? "Generating frames..." : brollLoading ? "Rendering clips..." : readyBrollSeedCount > 0 ? "Animate selected frames" : "Generate B-roll frames"}
                    onClick={() => {
                      if (readyBrollSeedCount > 0) {
                        handleGenerateBrollClips();
                      } else {
                        handleGenerateBrollSeeds();
                      }
                    }}
                    disabled={brollSeedLoading || brollLoading || !selectedScene}
                    loading={brollSeedLoading || brollLoading}
                    secondary={[
                      ...(readyBrollSeedCount > 0 && readyBrollCount === 0 ? [{
                        label: "Regenerate frames",
                        onClick: () => handleGenerateBrollSeeds(),
                        disabled: brollSeedLoading,
                      }] : []),
                      ...(selectedBrollUrls.length > 0 ? [{
                        label: `Download selected (${selectedBrollUrls.length})`,
                        onClick: () => bulkDownload(selectedBrollUrls, `${runFilePrefix}-broll`),
                      }] : []),
                    ]}
                  />
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-800 p-10 text-center text-sm text-slate-500">
                  Generate scripts and select a scene first.
                </div>
              )}
            </SectionCard>
          ) : null}
        </main>
      </div>

      {/* ─── Modals ─── */}

      {showProductSelector ? (
        <ProductSelectorModal
          products={products}
          loading={productsLoading}
          search={productSearch}
          setSearch={setProductSearch}
          onClose={() => setShowProductSelector(false)}
          onSelect={(product) => {
            setSelectedProduct(product);
            setProductSource("catalog");
            setShowProductSelector(false);
            addActivity("product", `Selected ${product.name}.`, "success");
          }}
        />
      ) : null}

      {showPromptPanel ? (
        <OverlaySheet
          title="System prompts & settings"
          subtitle="Advanced controls for script generation, scene design, and clip rendering."
          onClose={() => setShowPromptPanel(false)}
        >
          <div className="space-y-5">
            <div>
              <div className="mb-2 text-xs font-semibold text-slate-400">Extra guidance for all stages</div>
              <textarea
                value={knowledge}
                onChange={(event) => setKnowledge(event.target.value)}
                placeholder="Brand rules, compliance notes, room style preferences, etc."
                className="min-h-[100px] w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              {(
                [
                  ["strategist", "Script generation"],
                  ["sceneArchitect", "Scene design"],
                  ["dialogueDirector", "Talking clips"],
                  ["bRollDirector", "B-roll direction"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div className="mb-2 text-xs font-semibold text-slate-400">{label}</div>
                  <textarea
                    value={promptPack[key]}
                    onChange={(event) => setPromptPack((c) => ({ ...c, [key]: event.target.value }))}
                    className="min-h-[100px] w-full rounded-xl border border-slate-800 bg-slate-900 px-4 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-slate-500 focus:border-slate-600"
                  />
                </div>
              ))}
            </div>
          </div>
        </OverlaySheet>
      ) : null}

      {showPresetPanel ? (
        <OverlaySheet
          title="Presets"
          subtitle="Quick starting points to configure your run."
          onClose={() => setShowPresetPanel(false)}
        >
          <div className="grid gap-4 md:grid-cols-3">
            {PRESET_OPTIONS.map((preset) => (
              <div key={preset.id} className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5">
                <div className="font-[var(--font-ugc-display)] text-lg font-semibold text-white">{preset.name}</div>
                <p className="mt-2 text-sm leading-6 text-slate-400">{preset.description}</p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <span className="rounded-lg bg-slate-800/80 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {preset.settings.dialogueSeconds}s
                  </span>
                  <span className="rounded-lg bg-slate-800/80 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {preset.settings.sceneVariationCount} scenes
                  </span>
                  <span className="rounded-lg bg-slate-800/80 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {preset.settings.bRollClipCount} B-roll
                  </span>
                  <span className="rounded-lg bg-slate-800/80 px-2 py-1 text-[10px] font-semibold text-slate-300">
                    {preset.settings.safeMode === "safe" ? "Review" : "Fast"}
                  </span>
                </div>
                <button
                  onClick={() => applyPreset(preset.id)}
                  className="mt-4 w-full rounded-xl bg-white px-4 py-2.5 text-sm font-semibold text-slate-950 transition hover:bg-slate-200"
                >
                  Apply
                </button>
              </div>
            ))}
          </div>
        </OverlaySheet>
      ) : null}

      {/* Close export menu on outside click */}
      {showExportMenu ? (
        <div className="fixed inset-0 z-10" onClick={() => setShowExportMenu(false)} />
      ) : null}
    </div>
  );
}
