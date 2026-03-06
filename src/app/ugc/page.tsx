"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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

type PlanSource = "heuristic" | "gemini" | "openai";
type RenderStatus = "idle" | "running" | "done" | "error";
type ApprovalStatus = "pending" | "approved" | "rejected" | "skipped";

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
        "rounded-[28px] border border-slate-200/80 bg-white/90 p-5 shadow-[0_20px_60px_-34px_rgba(15,23,42,0.28)] dark:border-slate-800 dark:bg-slate-950/80",
        className
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          {eyebrow ? (
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-amber-700 dark:text-amber-300">
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
        placeholder="Add approval feedback or override instructions"
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
          Disapprove
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
      <div className="mb-3 rounded-2xl bg-slate-50 p-3 text-sm leading-6 text-slate-700 dark:bg-slate-900 dark:text-slate-300">
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
        <p className="line-clamp-4 text-xs leading-5 text-slate-600 dark:text-slate-400">{render.prompt}</p>
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
        <p className="line-clamp-4 text-xs leading-5 text-slate-600 dark:text-slate-400">{render.prompt}</p>
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

export default function UgcStudioPage() {
  const [campaignName, setCampaignName] = useState("Creator Launch Sprint");
  const [products, setProducts] = useState<Product[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [productsLoading, setProductsLoading] = useState(false);
  const [showProductModal, setShowProductModal] = useState(false);
  const [productSource, setProductSource] = useState<"catalog" | "upload">("catalog");
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [uploadedProductName, setUploadedProductName] = useState("Custom product");
  const [uploadedProductUrl, setUploadedProductUrl] = useState("");
  const [appearanceNotes, setAppearanceNotes] = useState("");
  const [scriptMode, setScriptMode] = useState<"generate" | "upload">("generate");
  const [scriptText, setScriptText] = useState("");
  const [audience, setAudience] = useState("busy professionals");
  const [primaryBenefit, setPrimaryBenefit] = useState("cuts decision fatigue and looks premium on camera");
  const [offer, setOffer] = useState("there is a launch bundle with free shipping");
  const [cta, setCta] = useState("Tap below to try it.");
  const [tone, setTone] = useState("direct creator energy with premium polish");
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

  useEffect(() => {
    let ignore = false;

    const loadProducts = async () => {
      setProductsLoading(true);
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
        if (!ignore) setProductsLoading(false);
      }
    };

    loadProducts();

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
        tone,
        audience,
        primaryBenefit,
        offer,
        cta,
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
      `${safeName(campaignName || "ugc-workflow")}.json`,
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
      `Campaign: ${campaignName}`,
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
    downloadText(`${safeName(campaignName || "ugc-workflow")}-prompt-pack.txt`, content);
  };

  const bulkDownload = (items: Array<{ title: string; url: string }>, prefix: string) => {
    items.forEach((item, index) => {
      setTimeout(() => downloadUrl(item.url, `${safeName(prefix)}-${safeName(item.title || `asset-${index + 1}`)}`), index * 120);
    });
  };

  const dialogueLaneSteps = [
    {
      label: "Script strategy",
      description: "Generates selectable dialogue, beat map, and approval-aware workflow contract.",
      status: plan ? approvals.script.status : "pending",
    },
    {
      label: "Base scene render",
      description: "Creates avatar-scene candidates anchored to the product and script context.",
      status: sceneLoading ? "running" : sceneRenders.some((render) => render.status === "done") ? approvals.scene.status : "pending",
    },
    {
      label: "Dialogue clip batch",
      description: "Renders contiguous 5-second talking-head clips from the approved base scene.",
      status: dialogueLoading
        ? "running"
        : dialogueVideos.some((render) => render.status === "done")
          ? approvals.dialogue.status
          : "pending",
    },
  ] as const;

  const brollLaneSteps = [
    {
      label: "Shot planning",
      description: "Derives non-dialogue coverage from the approved script and scene continuity.",
      status: plan ? approvals.script.status : "pending",
    },
    {
      label: "Seed image render",
      description: "Creates starting frames for product-only, empty-scene, and angle-shifted B-roll.",
      status: brollSeedLoading
        ? "running"
        : brollSeedImages.some((render) => render.status === "done")
          ? "done"
          : "pending",
    },
    {
      label: "B-roll clip batch",
      description: "Turns the approved seed images into cutaway clips ready for vertical edit assembly.",
      status: brollLoading ? "running" : brollVideos.some((render) => render.status === "done") ? approvals.broll.status : "pending",
    },
  ] as const;

  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.18),_transparent_38%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.16),_transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.85),rgba(248,250,252,0))] dark:bg-[radial-gradient(circle_at_top_left,_rgba(251,191,36,0.10),_transparent_35%),radial-gradient(circle_at_top_right,_rgba(14,165,233,0.10),_transparent_25%),linear-gradient(180deg,rgba(2,6,23,0.88),rgba(2,6,23,0))]" />
      <div className="mx-auto flex w-full max-w-[1800px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <section className="relative overflow-hidden rounded-[32px] border border-slate-200/80 bg-white/90 p-6 shadow-[0_28px_90px_-48px_rgba(15,23,42,0.42)] dark:border-slate-800 dark:bg-slate-950/85">
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.24em] text-amber-700 dark:text-amber-300">
                UGC Video Ad Studio
              </div>
              <h1 className="max-w-4xl text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">
                Dual-agent workflow for creator-led video ads, from script selection to scene seeds and ordered 5-second clip batches.
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 dark:text-slate-400">
                This page plans and executes a high-control UGC pipeline: choose or upload a script, anchor the product, render avatar-scene variations, batch talking-head clips, then run a separate B-roll agent for alternate-angle coverage. Safe mode inserts explicit approval gates and honors your latest override instruction at every stage.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  onClick={() => handleBuildPlan()}
                  disabled={planLoading}
                  className="rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  {planLoading ? "Planning..." : "Build workflow plan"}
                </button>
                <button
                  onClick={exportWorkflowJson}
                  disabled={!plan}
                  className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                >
                  Export JSON
                </button>
                <button
                  onClick={exportPromptPack}
                  disabled={!plan}
                  className="rounded-full border border-slate-300 px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                >
                  Export prompt pack
                </button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Runtime
                </div>
                <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">{settings.dialogueSeconds}s</div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Default creator dialogue length</div>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Batches
                </div>
                <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">
                  {Math.ceil(settings.dialogueSeconds / settings.clipDurationSeconds)}
                </div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">5-second dialogue clip groups</div>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Scene Seeds
                </div>
                <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">{settings.sceneVariationCount}</div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Vertical base-scene variations</div>
              </div>
              <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                  Mode
                </div>
                <div className="mt-3 text-3xl font-semibold capitalize text-slate-950 dark:text-white">
                  {settings.safeMode}
                </div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">Approval gate behavior</div>
              </div>
            </div>
          </div>
        </section>

        <div className="grid gap-6 xl:grid-cols-[430px_minmax(0,1fr)]">
          <div className="space-y-6 xl:sticky xl:top-20 xl:self-start">
            <SectionCard title="Campaign Setup" eyebrow="Configure">
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Campaign name
                  </div>
                  <input
                    value={campaignName}
                    onChange={(event) => setCampaignName(event.target.value)}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Safe mode
                    </div>
                    <select
                      value={settings.safeMode}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          safeMode: event.target.value as UgcSafeMode,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    >
                      <option value="safe">Safe: block for approval</option>
                      <option value="fast">Fast: autopilot execution</option>
                    </select>
                  </label>
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Video model
                    </div>
                    <select
                      value={settings.videoModelId}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, videoModelId: event.target.value }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    >
                      {VIDEO_MODEL_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Dialogue seconds
                    </div>
                    <input
                      type="number"
                      min={5}
                      max={60}
                      value={settings.dialogueSeconds}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, dialogueSeconds: Number(event.target.value) || 20 }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Clip duration
                    </div>
                    <input
                      type="number"
                      min={3}
                      max={10}
                      value={settings.clipDurationSeconds}
                      onChange={(event) =>
                        setSettings((current) => ({
                          ...current,
                          clipDurationSeconds: Number(event.target.value) || 5,
                          videoDurationSeconds: Number(event.target.value) || 5,
                        }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Scene variations
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={settings.sceneVariationCount}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, sceneVariationCount: Number(event.target.value) || 4 }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                  <label className="block">
                    <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      B-roll clips
                    </div>
                    <input
                      type="number"
                      min={1}
                      max={8}
                      value={settings.bRollClipCount}
                      onChange={(event) =>
                        setSettings((current) => ({ ...current, bRollClipCount: Number(event.target.value) || 4 }))
                      }
                      className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                </div>

                <label className="block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Image model
                  </div>
                  <select
                    value={settings.imageModelId}
                    onChange={(event) => setSettings((current) => ({ ...current, imageModelId: event.target.value }))}
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  >
                    {imageModelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                </label>

                <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 text-xs leading-6 text-slate-600 dark:border-slate-800 dark:bg-slate-900/70 dark:text-slate-400">
                  All generated visuals are planned for <span className="font-semibold text-slate-900 dark:text-white">9:16</span> framing.
                  Base scene and B-roll seeds are set to <span className="font-semibold text-slate-900 dark:text-white">2K</span>.
                  Dialogue and B-roll video clips render in ordered {settings.clipDurationSeconds}-second batches.
                </div>
              </div>
            </SectionCard>

            <SectionCard title="Script Source" eyebrow="Step 1">
              <div className="space-y-4">
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
                    Upload / paste
                  </button>
                </div>

                {scriptMode === "generate" ? (
                  <div className="space-y-3">
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Audience
                      </div>
                      <input
                        value={audience}
                        onChange={(event) => setAudience(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Primary benefit
                      </div>
                      <input
                        value={primaryBenefit}
                        onChange={(event) => setPrimaryBenefit(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Offer / promo
                      </div>
                      <input
                        value={offer}
                        onChange={(event) => setOffer(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        CTA
                      </div>
                      <input
                        value={cta}
                        onChange={(event) => setCta(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Tone
                      </div>
                      <input
                        value={tone}
                        onChange={(event) => setTone(event.target.value)}
                        className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                      />
                    </label>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={scriptText}
                      onChange={(event) => setScriptText(event.target.value)}
                      placeholder="Paste your approved dialogue here."
                      className="min-h-[180px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
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
            </SectionCard>

            <SectionCard
              title="Product Anchor"
              eyebrow="Step 2"
              actions={
                <button
                  onClick={() => setShowProductModal(true)}
                  className="rounded-full border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                >
                  {productsLoading ? "Loading..." : "Catalog"}
                </button>
              }
            >
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
                    Catalog product
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
                  <div className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    {selectedProduct ? (
                      <div className="flex gap-4">
                        <div className="h-28 w-24 overflow-hidden rounded-2xl bg-slate-200 dark:bg-slate-800">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={selectedProduct.image_url} alt={selectedProduct.name} className="h-full w-full object-cover" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-slate-900 dark:text-white">{selectedProduct.name}</div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                            {selectedProduct.shopify_vendor || "Manual"} {selectedProduct.shopify_product_type ? `· ${selectedProduct.shopify_product_type}` : ""}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-sm text-slate-500 dark:text-slate-400">Choose a product from the catalog modal.</div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="block">
                      <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                        Uploaded product label
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
                      <div className="h-56 overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
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
                    placeholder="Add product appearance cues you want preserved: finish, materials, branding, hero details."
                    className="min-h-[120px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>
              </div>
            </SectionCard>

            <SectionCard title="Knowledge + Prompts" eyebrow="Agent Control">
              <div className="space-y-4">
                <label className="block">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                    Knowledge / constraints
                  </div>
                  <textarea
                    value={knowledge}
                    onChange={(event) => setKnowledge(event.target.value)}
                    placeholder="Brand rules, prohibited claims, target aesthetic, compliance notes, or editorial guidance."
                    className="min-h-[120px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                  />
                </label>

                {(
                  [
                    ["strategist", "Script Strategist"],
                    ["sceneArchitect", "Scene Architect"],
                    ["dialogueDirector", "Dialogue Director"],
                    ["bRollDirector", "B-roll Director"],
                    ["safetyCoordinator", "Safe Mode Coordinator"],
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
                      className="min-h-[110px] w-full rounded-3xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-amber-400 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                  </label>
                ))}
              </div>
            </SectionCard>
          </div>

          <div className="space-y-6">
            {errorMessage ? (
              <div className="rounded-3xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/20 dark:text-rose-300">
                {errorMessage}
              </div>
            ) : null}

            <SectionCard title="Agent Execution Board" eyebrow="Workflow">
              <div className="grid gap-4 xl:grid-cols-2">
                <AgentLane
                  title="On-camera dialogue agent"
                  accent="bg-amber-500"
                  steps={dialogueLaneSteps.map((step) => ({ ...step }))}
                />
                <AgentLane
                  title="Separate B-roll coverage agent"
                  accent="bg-sky-500"
                  steps={brollLaneSteps.map((step) => ({ ...step }))}
                />
              </div>
            </SectionCard>

            <SectionCard
              title="Workflow Plan"
              eyebrow="Plan"
              actions={
                <div className="flex items-center gap-2">
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-600 dark:bg-slate-900 dark:text-slate-300">
                    {plan ? planSource : "idle"}
                  </span>
                </div>
              }
            >
              {plan ? (
                <div className="space-y-5">
                  <div className="grid gap-3 md:grid-cols-4">
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Product analysis
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-700 dark:text-slate-300">{plan.productAnalysis}</p>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Dialogue clips
                      </div>
                      <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">{plan.summary.totalDialogueClips}</div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        B-roll clips
                      </div>
                      <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">{plan.summary.totalBrollClips}</div>
                    </div>
                    <div className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                        Scene variations
                      </div>
                      <div className="mt-3 text-3xl font-semibold text-slate-950 dark:text-white">{plan.summary.sceneVariationCount}</div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h3 className="text-base font-semibold text-slate-900 dark:text-white">Script options</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                          Choose one if you want to rebuild the downstream plan around a different dialogue variant.
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
                      title="Plan approval gate"
                      state={approvals.script}
                      onStatusChange={(status) =>
                        setApprovals((current) => ({ ...current, script: { ...current.script, status } }))
                      }
                      onNoteChange={(note) =>
                        setApprovals((current) => ({ ...current, script: { ...current.script, note } }))
                      }
                    />
                  ) : null}

                  <div className="grid gap-4 xl:grid-cols-2">
                    <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Avatar candidates</div>
                      <div className="space-y-3">
                        {plan.avatarOptions.map((avatar) => (
                          <div key={avatar.id} className="rounded-2xl border border-slate-200 bg-white p-3 dark:border-slate-800 dark:bg-slate-950/70">
                            <div className="text-sm font-semibold text-slate-900 dark:text-white">{avatar.label}</div>
                            <p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{avatar.persona}</p>
                            <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{avatar.castingRationale}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-[28px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                      <div className="mb-3 text-sm font-semibold text-slate-900 dark:text-white">Architecture notes</div>
                      <div className="space-y-3">
                        {plan.architecture.notes.map((note) => (
                          <div key={note} className="rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-400">
                            {note}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  Build the workflow plan to generate script options, avatar casting, scene prompts, dialogue batches, and B-roll coverage plans.
                </div>
              )}
            </SectionCard>

            <SectionCard
              title="Base Scene Generation"
              eyebrow="Step 3"
              actions={
                <button
                  onClick={handleGenerateScenes}
                  disabled={!plan || sceneLoading}
                  className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                >
                  {sceneLoading ? "Generating..." : "Generate scene variations"}
                </button>
              }
            >
              {plan ? (
                <div className="space-y-5">
                  <div className="grid gap-4 xl:grid-cols-4">
                    {plan.sceneVariations.map((scene) => (
                      <div key={scene.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                        <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{scene.title}</div>
                        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500 dark:text-slate-400">
                          {scene.environment}
                        </div>
                        <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">{scene.summary}</p>
                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">{scene.prompt}</p>
                      </div>
                    ))}
                  </div>

                  {settings.safeMode === "safe" ? (
                    <ApprovalPanel
                      title="Scene approval gate"
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
                    {sceneRenders.length === 0 ? (
                      <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        Rendered base scenes will appear here for selection.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500 dark:text-slate-400">Plan the workflow first.</div>
              )}
            </SectionCard>

            <SectionCard
              title="Dialogue Clip Batch"
              eyebrow="Step 4"
              actions={
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleGenerateDialogueClips}
                    disabled={!selectedScene || dialogueLoading}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    {dialogueLoading ? "Rendering..." : "Render dialogue clips"}
                  </button>
                  <button
                    onClick={() => bulkDownload(selectedDialogueUrls, `${campaignName}-dialogue`)}
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
                          {clip.objective} · {clip.movement} · {clip.camera}
                        </p>
                      </div>
                    ))}
                  </div>

                  {settings.safeMode === "safe" ? (
                    <ApprovalPanel
                      title="Dialogue clip review gate"
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
                    {dialogueVideos.map((video) => (
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
                    ))}
                    {dialogueVideos.length === 0 ? (
                      <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        Rendered dialogue clips will appear here. Select the ones you want to download as the first-stage final outputs.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500 dark:text-slate-400">Plan the workflow and select a base scene first.</div>
              )}
            </SectionCard>

            <SectionCard
              title="Separate B-roll Agent"
              eyebrow="Step 4B"
              actions={
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleGenerateBrollSeeds}
                    disabled={!selectedScene || brollSeedLoading}
                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-slate-950 dark:hover:bg-slate-200"
                  >
                    {brollSeedLoading ? "Generating seeds..." : "Generate B-roll seeds"}
                  </button>
                  <button
                    onClick={handleGenerateBrollClips}
                    disabled={!brollSeedImages.some((image) => image.url) || brollLoading}
                    className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition hover:border-amber-400 hover:text-slate-950 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-200 dark:hover:border-amber-400 dark:hover:text-white"
                  >
                    {brollLoading ? "Rendering B-roll..." : "Render B-roll clips"}
                  </button>
                  <button
                    onClick={() => bulkDownload(selectedBrollUrls, `${campaignName}-broll`)}
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
                            {shot.withoutHuman ? "No talent" : "Talent optional"}
                          </span>
                        </div>
                        <p className="mb-3 text-xs leading-5 text-slate-600 dark:text-slate-400">{shot.objective}</p>
                        <p className="text-xs leading-5 text-slate-500 dark:text-slate-400">
                          {shot.angle} · {shot.lens} · {shot.lighting}
                        </p>
                      </div>
                    ))}
                  </div>

                  {settings.safeMode === "safe" ? (
                    <ApprovalPanel
                      title="B-roll review gate"
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

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {brollSeedImages.map((render) => (
                      <ImageRenderCard
                        key={render.id}
                        render={render}
                        selected={false}
                        subtitle="B-roll starting frame"
                        onSelect={() => undefined}
                        onDownload={() => render.url && downloadUrl(render.url, `${safeName(render.title)}.png`)}
                        hideSelect
                      />
                    ))}
                    {brollSeedImages.length === 0 ? (
                      <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        B-roll seed images appear here first. The separate B-roll agent uses them as start frames for motion generation.
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    {brollVideos.map((video) => (
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
                    ))}
                    {brollVideos.length === 0 ? (
                      <div className="md:col-span-2 xl:col-span-4 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                        Rendered B-roll clips appear here once the seed images have been generated and approved.
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-500 dark:text-slate-400">Plan the workflow and select a base scene first.</div>
              )}
            </SectionCard>

            <SectionCard title="Agent Prompt Architecture" eyebrow="Inspect">
              <div className="grid gap-4 xl:grid-cols-2">
                {promptPackView.architecture.map((agent) => (
                  <div key={agent.id} className="rounded-[24px] border border-slate-200 bg-slate-50/80 p-4 dark:border-slate-800 dark:bg-slate-900/60">
                    <div className="mb-2 text-sm font-semibold text-slate-900 dark:text-white">{agent.name}</div>
                    <p className="mb-3 text-xs leading-5 text-slate-500 dark:text-slate-400">{agent.responsibility}</p>
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Inputs
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {agent.inputs.map((item) => (
                        <span key={item} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500 dark:text-slate-400">
                      Outputs
                    </div>
                    <div className="mb-3 flex flex-wrap gap-2">
                      {agent.outputs.map((item) => (
                        <span key={item} className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-600 ring-1 ring-slate-200 dark:bg-slate-950 dark:text-slate-300 dark:ring-slate-800">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="rounded-2xl border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600 dark:border-slate-800 dark:bg-slate-950/70 dark:text-slate-400">
                      {agent.systemPrompt}
                    </div>
                  </div>
                ))}
                {!plan ? (
                  <div className="xl:col-span-2 rounded-[28px] border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    The page exposes every agent prompt before execution. Build the plan to inspect the active agent contract.
                  </div>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard title="Activity Log" eyebrow="Runtime">
              <div className="space-y-3">
                {activity.length === 0 ? (
                  <div className="rounded-[24px] border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500 dark:border-slate-800 dark:text-slate-400">
                    Runtime activity will stream here as the workflow progresses.
                  </div>
                ) : (
                  activity.map((entry) => (
                    <div
                      key={entry.id}
                      className={cn(
                        "rounded-[24px] border p-4",
                        entry.tone === "success" && "border-emerald-200 bg-emerald-50/80 dark:border-emerald-900/40 dark:bg-emerald-950/20",
                        entry.tone === "error" && "border-rose-200 bg-rose-50/80 dark:border-rose-900/40 dark:bg-rose-950/20",
                        entry.tone === "info" && "border-slate-200 bg-slate-50/80 dark:border-slate-800 dark:bg-slate-900/60"
                      )}
                    >
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500 dark:text-slate-400">
                          {entry.stage}
                        </div>
                        <div className="text-xs text-slate-400">
                          {new Date(entry.timestamp).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                            second: "2-digit",
                          })}
                        </div>
                      </div>
                      <div className="text-sm leading-6 text-slate-700 dark:text-slate-300">{entry.message}</div>
                    </div>
                  ))
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      {showProductModal ? (
        <ProductSelectorModal
          products={products}
          search={productSearch}
          setSearch={setProductSearch}
          onClose={() => setShowProductModal(false)}
          onSelect={(product) => {
            setSelectedProduct(product);
            setProductSource("catalog");
            setShowProductModal(false);
            addActivity("product", `Selected ${product.name} from the catalog.`, "success");
          }}
        />
      ) : null}
    </div>
  );
}
