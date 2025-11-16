"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { MODEL_LIST, getModelById, IMAGE_RESOLUTIONS, IMAGE_SIZES } from "@/lib/models";
import { consumeStudioIntent, StudioIntent } from "@/lib/studio-intent";

type Product = { id: string; name: string; slug: string; image_url: string };
type GenImage = { id: string; prompt: string; imageDataUrl: string };
type RunStatus = "idle" | "running" | "done" | "cancelled" | "error";
type RunSpeed = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10;

type Run = {
  id: string;
  name: string;
  startedAt: number;
  modelId: string;
  modelNameDisplay: string;
  productId: string | null;
  productName: string;
  referenceUrl: string;
  prompts: string[];
  status: RunStatus;
  error: string | null;
  debug: unknown | null;
  images: GenImage[];
  activeIdx: number;
  selectedIdx: Set<number>;
  progress: { done: number; total: number };
  speed: RunSpeed;
  controller: AbortController | null;
};

const RUN_SPEED_OPTIONS: RunSpeed[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const MAX_CONCURRENT_RUNS = 10;

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function fetchImageBytes(src: string): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  if (src.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/i.exec(src);
    const mime = match?.[1] || "image/png";
    const body = match?.[2] || "";
    const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    return { bytes, mime, ext };
  }
  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to fetch ${src}`);
  const mime = res.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await res.arrayBuffer());
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return { bytes: buf, mime, ext };
}

function statusColor(status: RunStatus) {
  switch (status) {
    case "running":
      return "bg-emerald-500";
    case "done":
      return "bg-sky-500";
    case "cancelled":
      return "bg-slate-400";
    case "error":
      return "bg-red-500";
    default:
      return "bg-slate-300";
  }
}

export default function ImageStudioPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("custom");
  const [customUrl, setCustomUrl] = useState("");
  const [customUrls, setCustomUrls] = useState<string[]>([]);
  const [customUploads, setCustomUploads] = useState<string[]>([]);
  const [extraRefUrls, setExtraRefUrls] = useState<string[]>([]);
  const [extraRefUploads, setExtraRefUploads] = useState<string[]>([]);
  const [modelId, setModelId] = useState<string>("nanobanana-v1");
  const modelDef = useMemo(() => getModelById(modelId)!, [modelId]);
  const modelNameDisplay = `${modelDef.label}-${modelDef.version}`;
  const [sdSize, setSdSize] = useState<(typeof IMAGE_SIZES)[number]>("square");
  const [sdRes, setSdRes] = useState<(typeof IMAGE_RESOLUTIONS)[number]>("1K");
  const [sdMax, setSdMax] = useState(1);
  const [sdSeed, setSdSeed] = useState<number | "">("");
  const [speed, setSpeed] = useState<RunSpeed>(1);
  const [promptsText, setPromptsText] = useState("");
  const promptLines = useMemo(
    () => promptsText.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [promptsText]
  );
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRun = runs.find((r) => r.id === activeRunId) ?? runs[0] ?? null;
  const [saveToast, setSaveToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [refPreviewUrl, setRefPreviewUrl] = useState<string | null>(null);
  const [intentNotice, setIntentNotice] = useState<string | null>(null);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId),
    [products, selectedId]
  );
  const productName = selectedProduct ? selectedProduct.name : "Custom";
  const referenceUrl =
    selectedId === "custom" ? customUrl.trim() : (selectedProduct?.image_url?.trim() ?? "");
  const modelRequiresReference = modelDef.requiresReference !== false;
  const hasCustomRefs =
    selectedId === "custom" &&
    (customUrl.trim().length > 0 ||
      customUploads.length > 0 ||
      customUrls.some((url) => (url || "").trim().length > 0));
  const hasRefs = selectedId === "custom" ? hasCustomRefs : referenceUrl.length > 0;
  const canStartRun = promptLines.length > 0 && (modelRequiresReference ? hasRefs : true);
  const somethingRunning = runs.some((run) => run.status === "running");
  const overallPct =
    activeRun && activeRun.progress.total > 0
      ? Math.round((activeRun.progress.done / activeRun.progress.total) * 100)
      : 0;

  async function filesToDataUrls(files: FileList | null): Promise<string[]> {
    if (!files || files.length === 0) return [];
    const readers: Promise<string>[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      readers.push(
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(file);
        })
      );
    }
    return Promise.all(readers);
  }

  const refSources = useMemo(() => {
    if (selectedId === "custom") {
      const list = [
        ...customUploads,
        ...(customUrl.trim() ? [customUrl.trim()] : []),
        ...customUrls.map((u) => u.trim()).filter(Boolean),
      ];
      const seen = new Set<string>();
      return list.filter((src) => {
        if (seen.has(src)) return false;
        seen.add(src);
        return true;
      });
    }
    const base = (selectedProduct?.image_url || "").trim();
    const list = [
      ...(base ? [base] : []),
      ...extraRefUploads,
      ...extraRefUrls.map((url) => url.trim()).filter(Boolean),
    ];
    const seen = new Set<string>();
    return list.filter((src) => {
      if (seen.has(src)) return false;
      seen.add(src);
      return true;
    });
  }, [
    selectedId,
    selectedProduct,
    customUploads,
    customUrl,
    customUrls,
    extraRefUploads,
    extraRefUrls,
  ]);

  function removeUploadSrc(src: string) {
    if (selectedId === "custom") {
      setCustomUploads((prev) => prev.filter((u) => u !== src));
    } else {
      setExtraRefUploads((prev) => prev.filter((u) => u !== src));
    }
  }

  async function loadProducts() {
    try {
      setProductsLoading(true);
      const res = await fetch("/api/products");
      const json = await res.json();
      if (res.ok) {
        setProducts(json.products || []);
      }
    } finally {
      setProductsLoading(false);
    }
  }

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (!saveToast) return;
    const timer = setTimeout(() => setSaveToast(null), 3200);
    return () => clearTimeout(timer);
  }, [saveToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape" && refPreviewUrl) {
        setRefPreviewUrl(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refPreviewUrl]);

  async function applyStudioIntent(intent: StudioIntent | null) {
    if (!intent) return;
    if (intent.type === "prompts") {
      setPromptsText((prev) => {
        const existing = prev.trim().length > 0 ? `${prev.trimEnd()}\n` : "";
        return `${existing}${intent.prompts.join("\n")}`;
      });
      setIntentNotice(`Imported ${intent.prompts.length} prompt${intent.prompts.length > 1 ? "s" : ""} from Library`);
      setSaveToast({ message: "Prompts added from Library", type: "success" });
      return;
    }
    if (intent.type === "reference") {
      try {
        const res = await fetch(`/api/saved-images/${intent.id}`);
        const json = await res.json();
        if (!res.ok || !json.image?.image_data) {
          throw new Error(json.error || "Unable to load saved image");
        }
        setSelectedId("custom");
        setCustomUploads((prev) => [json.image.image_data, ...prev]);
        setIntentNotice("Reference imported from Library");
        setSaveToast({ message: "Reference added from Library", type: "success" });
      } catch (error: any) {
        setSaveToast({ message: error?.message || "Failed to import reference", type: "error" });
      }
    }
  }

  useEffect(() => {
    const intent = consumeStudioIntent();
    void applyStudioIntent(intent);
  }, []);

  async function saveSinglePrompt(prompt: string) {
    if (!prompt.trim()) return;
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: selectedId !== "custom" ? selectedId : null,
          productName,
          modelName: modelNameDisplay,
          prompts: [prompt],
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save prompt");
      setSaveToast({ message: "Prompt saved to library", type: "success" });
    } catch (error: any) {
      setSaveToast({ message: error?.message || "Failed to save prompt", type: "error" });
    }
  }

  async function saveImageToLibrary(imageDataUrl: string, prompt: string) {
    if (!imageDataUrl) return;
    try {
      const res = await fetch("/api/saved-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: imageDataUrl,
          prompt,
          modelName: modelNameDisplay,
          productId: selectedId !== "custom" ? selectedId : null,
          productName,
          referenceUrl: selectedId === "custom" ? null : referenceUrl || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to save image");
      setSaveToast({ message: "Image saved to library", type: "success" });
    } catch (error: any) {
      setSaveToast({ message: error?.message || "Failed to save image", type: "error" });
    }
  }

  function setActiveRun(id: string) {
    setActiveRunId(id);
  }

  function toggleImageSelection(runId: string, index: number) {
    setRuns((prev) =>
      prev.map((run) => {
        if (run.id !== runId) return run;
        const next = new Set(run.selectedIdx);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return { ...run, selectedIdx: next };
      })
    );
  }

  function stepActiveImage(runId: string, delta: number) {
    setRuns((prev) =>
      prev.map((run) => {
        if (run.id !== runId) return run;
        if (run.images.length === 0) return run;
        const nextIdx = Math.max(0, Math.min(run.images.length - 1, run.activeIdx + delta));
        return { ...run, activeIdx: nextIdx };
      })
    );
  }

  function deleteRun(runId: string) {
    setRuns((prev) => {
      const filtered = prev.filter((run) => run.id !== runId);
      if (activeRunId === runId) {
        setActiveRunId(filtered[0]?.id ?? null);
      }
      return filtered;
    });
  }

  function cancelRun(runId: string) {
    setRuns((prev) =>
      prev.map((run) => {
        if (run.id !== runId) return run;
        run.controller?.abort();
        return { ...run, status: "cancelled" as RunStatus };
      })
    );
  }

  async function zipRun(run: Run, selectedOnly: boolean) {
    if (run.images.length === 0) return;
    const indexes = selectedOnly ? Array.from(run.selectedIdx) : run.images.map((_, idx) => idx);
    if (indexes.length === 0) return;

    const folderName = safeName(run.productName || "custom");
    const zip = new JSZip();
    const manifest = [
      `Run: ${run.name}`,
      `Model: ${run.modelNameDisplay}`,
      `Product: ${run.productName}`,
      `Started: ${new Date(run.startedAt).toLocaleString()}`,
      "",
      "Index, Prompt",
      ...indexes.map((i) => `${i + 1}, ${run.images[i].prompt.replace(/\r?\n/g, " ")}`),
    ].join("\n");
    zip.file(`${folderName}/manifest.txt`, manifest);

    for (const idx of indexes) {
      const image = run.images[idx];
      const { bytes, ext } = await fetchImageBytes(image.imageDataUrl);
      const fileName = `${folderName}/${String(idx + 1).padStart(2, "0")}_${safeName(run.modelNameDisplay)}_${safeName(
        image.prompt
      ).slice(0, 60)}.${ext}`;
      zip.file(fileName, bytes);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `${folderName}_${safeName(run.modelNameDisplay)}.zip`);
  }

  async function onGenerateNewRun() {
    if (!canStartRun) {
      setSaveToast({
        message: modelRequiresReference ? "Add a reference image before starting a run." : "Add at least one prompt.",
        type: "error",
      });
      return;
    }

    setRuns((prev) => {
      if (prev.length < MAX_CONCURRENT_RUNS) return prev;
      const sorted = [...prev].sort((a, b) => a.startedAt - b.startedAt);
      const oldest = sorted[0];
      oldest.controller?.abort();
      return prev.filter((run) => run.id !== oldest.id);
    });

    const id = crypto.randomUUID();
    const ordinal =
      runs.length > 0
        ? Math.max(...runs.map((run) => Number(run.name.replace(/\D/g, "")) || 0)) + 1
        : 1;
    const runName = `Run #${ordinal}`;
    const controller = new AbortController();
    const primaryRef =
      selectedId === "custom"
        ? customUploads[0] || customUrl.trim() || customUrls.find((u) => (u || "").trim().length > 0) || ""
        : referenceUrl || "";

    const newRun: Run = {
      id,
      name: runName,
      startedAt: Date.now(),
      modelId,
      modelNameDisplay,
      productId: selectedId !== "custom" ? selectedId : null,
      productName,
      referenceUrl: primaryRef,
      prompts: [...promptLines],
      status: "running",
      error: null,
      debug: null,
      images: [],
      activeIdx: 0,
      selectedIdx: new Set<number>(),
      progress: { done: 0, total: promptLines.length },
      speed,
      controller,
    };

    setRuns((prev) => {
      const next = [...prev, newRun];
      setActiveRunId(id);
      return next;
    });

    void runGenerator(newRun);
  }

  async function runGenerator(run: Run) {
    let cursor = 0;
    const total = run.prompts.length;

    const pushImage = (image: GenImage) => {
      setRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          const images = [...item.images, image];
          const activeIdx = images.length === 1 ? 0 : item.activeIdx;
          return { ...item, images, activeIdx };
        })
      );
    };

    const advance = () => {
      setRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          const done = item.progress.done + 1;
          return { ...item, progress: { done, total: item.progress.total } };
        })
      );
    };

    const setError = (message: string, debug?: unknown) => {
      setRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          return { ...item, status: "error" as RunStatus, error: message, debug: debug ?? null };
        })
      );
    };

    const worker = async () => {
      while (true) {
        const index = cursor;
        if (index >= total) return;
        cursor++;
        const prompt = run.prompts[index];

        try {
          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: run.modelId,
              productId: run.productId,
              customUrl: run.productId ? null : run.referenceUrl || null,
              ...(run.productId
                ? {
                    additionalUrls: [
                      ...extraRefUrls.map((url) => url.trim()).filter(Boolean),
                      ...extraRefUploads,
                    ],
                  }
                : {
                    customUrls: [
                      ...(run.referenceUrl ? [run.referenceUrl] : []),
                      ...customUrls.map((u) => u.trim()).filter(Boolean),
                      ...customUploads,
                    ],
                  }),
              prompt,
              options:
                getModelById(run.modelId)?.provider === "seedream"
                  ? {
                      image_size: sdSize,
                      image_resolution: sdRes,
                      max_images: sdMax,
                      seed: sdSeed === "" ? null : sdSeed,
                    }
                  : undefined,
            }),
            signal: run.controller?.signal,
          });

          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(json.error || "Generation failed", json.debug);
            advance();
            continue;
          }

          pushImage({ id: crypto.randomUUID(), prompt, imageDataUrl: json.imageDataUrl });
          advance();
        } catch (error: any) {
          const abort = error?.name === "AbortError";
          setError(abort ? "Run cancelled" : error?.message || "Request failed");
          return;
        }
      }
    };

    const parallel = Math.max(1, Math.min(run.speed, RUN_SPEED_OPTIONS[RUN_SPEED_OPTIONS.length - 1]));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < parallel; i++) workers.push(worker());
    await Promise.all(workers).catch(() => undefined);

    setRuns((prev) =>
      prev.map((item) => {
        if (item.id !== run.id) return item;
        if (item.status === "running") return { ...item, status: "done" as RunStatus };
        return item;
      })
    );
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-10">
        <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-indigo-50 via-white to-sky-50 p-10 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr),320px] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-indigo-500">Outlight Image Studio</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">
                Scalable image generation for product teams.
              </h1>
              <p className="mt-4 text-base text-slate-600">
                Orchestrate cross-model runs, structure references, and ship approved assets directly to the shared library.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link
                  href="/library"
                  className="rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-slate-800"
                >
                  Browse Library
                </Link>
                <Link
                  href="/products"
                  className="rounded-full border border-slate-300 px-5 py-2.5 text-sm font-medium text-slate-700 hover:border-slate-400"
                >
                  Manage Products
                </Link>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-indigo-100 bg-white/70 p-5 text-sm text-slate-600 shadow-inner">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Active Runs</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">
                  {runs.filter((run) => run.status === "running").length}/{MAX_CONCURRENT_RUNS}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Models Ready</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">{MODEL_LIST.length}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Current Model</dt>
                <dd className="mt-1 text-lg font-semibold text-slate-900">{modelNameDisplay}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Reference Mode</dt>
                <dd className="mt-1 text-sm font-semibold text-slate-900">
                  {modelRequiresReference ? "Reference required" : "Reference optional"}
                </dd>
              </div>
            </dl>
          </div>
        </section>

        {intentNotice && (
          <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-900 shadow-sm flex items-center justify-between">
            <span>{intentNotice}</span>
            <button
              className="text-emerald-700 hover:text-emerald-900"
              onClick={() => setIntentNotice(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[420px,1fr]">
          <div className="space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">
                    Model
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Generation Engine</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {modelNameDisplay}
                </span>
              </div>
              <div className="mt-5 grid gap-3">
                {MODEL_LIST.map((model) => {
                  const active = model.id === modelId;
                  return (
                    <button
                      key={model.id}
                      onClick={() => setModelId(model.id)}
                      className={`flex w-full justify-between rounded-xl border px-4 py-3 text-left text-sm transition ${
                        active
                          ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <span>
                        {model.label} <span className="text-xs opacity-70">{model.version}</span>
                      </span>
                      <span className="text-xs uppercase tracking-wide opacity-70">{model.provider}</span>
                    </button>
                  );
                })}
              </div>
              {modelDef.provider === "seedream" && (
                <div className="mt-6 space-y-4 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Seedream Controls
                  </div>
                  <label className="text-xs font-medium text-slate-500">Image Size</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={sdSize}
                    onChange={(e) => setSdSize(e.target.value as (typeof IMAGE_SIZES)[number])}
                  >
                    {IMAGE_SIZES.map((size) => (
                      <option key={size}>{size}</option>
                    ))}
                  </select>
                  <label className="text-xs font-medium text-slate-500">Resolution</label>
                  <select
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    value={sdRes}
                    onChange={(e) => setSdRes(e.target.value as (typeof IMAGE_RESOLUTIONS)[number])}
                  >
                    {IMAGE_RESOLUTIONS.map((res) => (
                      <option key={res}>{res}</option>
                    ))}
                  </select>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-xs font-medium text-slate-500">Max Images</label>
                      <input
                        type="number"
                        min={1}
                        max={4}
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={sdMax}
                        onChange={(e) => setSdMax(Number(e.target.value) || 1)}
                      />
                    </div>
                    <div>
                      <label className="text-xs font-medium text-slate-500">Seed (optional)</label>
                      <input
                        type="number"
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        value={sdSeed}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSdSeed(val === "" ? "" : Number(val));
                        }}
                      />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Reference Plan
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Products & Inputs</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Select a product hero or run Custom mode for standalone concepts. Attach additional references
                    for richer edits.
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    hasRefs || !modelRequiresReference ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"
                  }`}
                >
                  {hasRefs || !modelRequiresReference ? "Configured" : "Needs reference"}
                </span>
              </div>

              <div className="mt-5 space-y-4">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Product Context
                </label>
                <select
                  className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  value={selectedId}
                  onChange={(e) => setSelectedId(e.target.value)}
                >
                  <option value="custom">Custom Session</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                {productsLoading && <p className="text-xs text-slate-400">Loading products...</p>}
                {selectedProduct && selectedId !== "custom" && (
                  <div className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm text-slate-600">
                    <p className="font-semibold text-slate-900">{selectedProduct.name}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{selectedProduct.slug}</p>
                    {selectedProduct.image_url && (
                      <div className="mt-3 overflow-hidden rounded-lg border border-slate-200">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={selectedProduct.image_url}
                          alt={selectedProduct.name}
                          className="h-36 w-full object-cover"
                        />
                      </div>
                    )}
                    <p className="mt-2 text-xs">
                      Manage items in{" "}
                      <Link href="/products" className="font-medium text-slate-900 hover:underline">
                        Products
                      </Link>
                      .
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-6 space-y-5">
                {selectedId === "custom" ? (
                  <>
                    <div>
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Primary Reference URL
                      </label>
                      <input
                        className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                        placeholder="https://..."
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                      />
                    </div>
                    <div className="space-y-3">
                      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Additional URLs
                        <button
                          className="text-indigo-600 hover:text-indigo-500"
                          onClick={() => setCustomUrls((prev) => [...prev, ""])}
                        >
                          + Field
                        </button>
                      </div>
                      {customUrls.length === 0 && <p className="text-xs text-slate-400">Add more angles.</p>}
                      {customUrls.map((url, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            value={url}
                            placeholder="https://..."
                            onChange={(e) =>
                              setCustomUrls((prev) => prev.map((item, idx) => (idx === index ? e.target.value : item)))
                            }
                          />
                          <button
                            className="rounded-lg border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50"
                            onClick={() => setCustomUrls((prev) => prev.filter((_, idx) => idx !== index))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                      Additional Reference URLs
                    </label>
                    <div className="mt-3 space-y-3">
                      {extraRefUrls.map((url, index) => (
                        <div key={index} className="flex gap-2">
                          <input
                            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                            placeholder="https://..."
                            value={url}
                            onChange={(e) =>
                              setExtraRefUrls((prev) => prev.map((item, idx) => (idx === index ? e.target.value : item)))
                            }
                          />
                          <button
                            className="rounded-lg border border-slate-200 px-2 text-xs text-slate-500 hover:bg-slate-50"
                            onClick={() => setExtraRefUrls((prev) => prev.filter((_, idx) => idx !== index))}
                          >
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="mt-3 rounded-xl border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 hover:border-slate-400"
                      onClick={() => setExtraRefUrls((prev) => [...prev, ""])}
                    >
                      + Add URL
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Upload Additional Angles
                  </label>
                  <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 hover:border-slate-400">
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      className="hidden"
                      onChange={async (e) => {
                        const urls = await filesToDataUrls(e.target.files);
                        if (selectedId === "custom") setCustomUploads((prev) => [...prev, ...urls]);
                        else setExtraRefUploads((prev) => [...prev, ...urls]);
                      }}
                    />
                    Drop files or click to upload
                  </label>
                </div>
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-slate-900">Reference Library</h3>
                  <span className="text-xs text-slate-500">{refSources.length} source(s)</span>
                </div>
                {refSources.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-500">
                    No references yet. {modelRequiresReference ? "Add at least one before running." : "Optional for Nano Banana runs."}
                  </p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {refSources.map((src) => (
                      <div
                        key={src}
                        className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700"
                      >
                        <div className="flex items-center gap-3">
                          <button
                            className="h-12 w-12 overflow-hidden rounded-lg border border-slate-200"
                            onClick={() => setRefPreviewUrl(src)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={src} alt="reference" className="h-full w-full object-cover" />
                          </button>
                          <div>
                            <p className="font-medium truncate max-w-[180px]">
                              {src.startsWith("data:") ? "Uploaded image" : src}
                            </p>
                            <p className="text-xs text-slate-500">
                              {src.startsWith("data:") ? "Upload" : "URL"}
                            </p>
                          </div>
                        </div>
                        {src.startsWith("data:") && (
                          <button
                            className="text-xs text-slate-500 hover:text-rose-600"
                            onClick={() => removeUploadSrc(src)}
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Prompts</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Creative Direction</h2>
                </div>
                <div className="text-xs text-slate-500">
                  Speed
                  <select
                    className="ml-2 rounded-full border border-slate-200 px-3 py-1 text-sm"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value) as RunSpeed)}
                  >
                    {RUN_SPEED_OPTIONS.map((value) => (
                      <option key={value} value={value}>
                        {value}x
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <textarea
                className="mt-4 h-48 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                placeholder={`Each line creates a run step.\nExample: place this floor lamp in a modern loft with warm sunlight.`}
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={onGenerateNewRun}
                  disabled={!canStartRun}
                  className={`rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm transition ${
                    canStartRun ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"
                  }`}
                >
                  Start Run ({promptLines.length})
                </button>
                <Link href="/library" className="text-sm font-medium text-slate-600 hover:text-slate-900">
                  Prompt Library &gt;
                </Link>
                <span className="text-xs text-slate-400">
                  Oldest runs auto-close when hitting {MAX_CONCURRENT_RUNS}.
                </span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Active Run</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">
                    {activeRun ? activeRun.name : "No runs yet"}
                  </h2>
                  {activeRun && (
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {activeRun.status} - {activeRun.progress.done}/{activeRun.progress.total}
                    </p>
                  )}
                </div>
                {activeRun && (
                  <div className="flex gap-2">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={() => zipRun(activeRun, false)}
                    >
                      Zip All
                    </button>
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                      disabled={activeRun.selectedIdx.size === 0}
                      onClick={() => zipRun(activeRun, true)}
                    >
                      Zip Selected ({activeRun.selectedIdx.size})
                    </button>
                  </div>
                )}
              </div>
              {activeRun ? (
                <>
                  <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr),240px]">
                    <div className="rounded-2xl border border-slate-100 bg-slate-50 p-3">
                      {activeRun.images.length > 0 ? (
                        <div className="space-y-3">
                          <div className="relative overflow-hidden rounded-xl border border-slate-200">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={activeRun.images[activeRun.activeIdx].imageDataUrl}
                              alt={activeRun.images[activeRun.activeIdx].prompt}
                              className="h-[360px] w-full object-cover"
                            />
                          </div>
                          <div className="flex items-center justify-between text-xs text-slate-500">
                            <button onClick={() => stepActiveImage(activeRun.id, -1)}>Previous</button>
                            <span>
                              {activeRun.activeIdx + 1} / {activeRun.images.length}
                            </span>
                            <button onClick={() => stepActiveImage(activeRun.id, 1)}>Next</button>
                          </div>
                          <p className="rounded-xl bg-white/80 p-3 text-sm text-slate-700">
                            {activeRun.images[activeRun.activeIdx].prompt}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                              onClick={() =>
                                saveImageToLibrary(
                                  activeRun.images[activeRun.activeIdx].imageDataUrl,
                                  activeRun.images[activeRun.activeIdx].prompt
                                )
                              }
                            >
                              Save to Library
                            </button>
                            <button
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                              onClick={() => saveSinglePrompt(activeRun.images[activeRun.activeIdx].prompt)}
                            >
                              Save Prompt
                            </button>
                            <button
                              className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                              onClick={() =>
                                downloadDataUrl(
                                  activeRun.images[activeRun.activeIdx].imageDataUrl,
                                  `${safeName(modelNameDisplay)}_${Date.now()}.png`
                                )
                              }
                            >
                              Download
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-60 flex-col items-center justify-center text-slate-400">
                          <p>No frames yet - generation in progress.</p>
                        </div>
                      )}
                    </div>
                    <div className="space-y-3 text-sm text-slate-600">
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Reference</p>
                        <p className="mt-1 break-words text-slate-900">
                          {activeRun.referenceUrl ? "Custom / Upload" : productName}
                        </p>
                      </div>
                      <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
                        <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
                        <p className="mt-1 capitalize text-slate-900">{activeRun.status}</p>
                        <div className="mt-3 h-2 rounded-full bg-slate-200">
                          <div
                            className="h-2 rounded-full bg-slate-900 transition-all"
                            style={{ width: `${overallPct}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                  {activeRun.images.length > 0 && (
                    <div className="mt-6 grid grid-cols-4 gap-2">
                      {activeRun.images.map((image, index) => {
                        const selected = activeRun.selectedIdx.has(index);
                        return (
                          <button
                            key={image.id}
                            onClick={() => {
                              setActiveRunId(activeRun.id);
                              setRuns((prev) =>
                                prev.map((run) => {
                                  if (run.id !== activeRun.id) return run;
                                  return { ...run, activeIdx: index };
                                })
                              );
                              toggleImageSelection(activeRun.id, index);
                            }}
                            className={`relative overflow-hidden rounded-xl border ${
                              selected ? "border-slate-900" : "border-slate-200"
                            }`}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={image.imageDataUrl} alt="" className="h-24 w-full object-cover" />
                            {selected && (
                              <span className="absolute right-2 top-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
                                SEL
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500">
                  No runs yet. Add prompts and press "Start Run".
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">Run Queue</h2>
                <span className="text-xs text-slate-500">{runs.length} total</span>
              </div>
              {runs.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Runs will appear here with status, progress, and actions.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {runs.map((run) => (
                    <div
                      key={run.id}
                      className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                        run.id === activeRun?.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <button
                            className="text-left font-semibold text-slate-900 hover:underline"
                            onClick={() => setActiveRun(run.id)}
                          >
                            {run.name}
                          </button>
                          <p className="text-xs text-slate-500">
                            {run.prompts.length} prompt(s) - {run.modelNameDisplay}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white ${statusColor(
                              run.status
                            )}`}
                          >
                            {run.status}
                          </span>
                          <button
                            className="text-xs text-slate-500 hover:text-slate-900"
                            onClick={() => cancelRun(run.id)}
                          >
                            Cancel
                          </button>
                          <button
                            className="text-xs text-slate-500 hover:text-rose-600"
                            onClick={() => deleteRun(run.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-slate-200">
                        <div
                          className="h-1.5 rounded-full bg-slate-900"
                          style={{
                            width:
                              run.progress.total === 0
                                ? "0%"
                                : `${Math.round((run.progress.done / run.progress.total) * 100)}%`,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {refPreviewUrl && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setRefPreviewUrl(null)}
        >
          <div
            className="w-full max-w-3xl rounded-2xl bg-white p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="mb-3 rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500 hover:bg-slate-50"
              onClick={() => setRefPreviewUrl(null)}
            >
              Close
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={refPreviewUrl} alt="Reference preview" className="w-full rounded-xl" />
          </div>
        </div>
      )}

      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg">
          {saveToast.message}
        </div>
      )}
    </div>
  );
}
