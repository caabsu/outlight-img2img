"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";
import {
  MODEL_LIST,
  getModelById,
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
} from "@/lib/models";

/* =================== Types & Model Lists =================== */

type Product = { id: string; name: string; slug: string; image_url: string };

// Image results
type GenImage = { id: string; prompt: string; imageDataUrl: string };

// Prompt library (image tab only)
type LibraryItem = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  model_name: string;
  prompt: string;
  created_at: string;
};

// Image run states
type RunStatus = "idle" | "running" | "done" | "cancelled" | "error";
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
  speed: 1 | 2 | 3;

  controller: AbortController | null;
};

// Page mode
type PageMode = "image" | "video";

// Video configs
type KlingMode = "image-to-video" | "text-to-video";
type Duration = "5" | "10";
type AR = "16:9" | "9:16" | "1:1";
type VideoItem = { id: string; prompt: string; url: string };

// basic set of video model choices (pass through to /api/video/generate)
type VideoModel = {
  id: string;
  label: string;
  // KIE model string
  model: string;
  // default mode this model is for (helps with UX text)
  kind: KlingMode;
};
const VIDEO_MODELS: VideoModel[] = [
  { id: "kling-i2v-pro", label: "Kling i2v — Pro", model: "kling/v2-5-turbo-image-to-video-pro", kind: "image-to-video" },
  { id: "kling-t2v-pro", label: "Kling t2v — Pro", model: "kling/v2-5-turbo-text-to-video-pro", kind: "text-to-video" },
];

/* =================== Utils =================== */

function safeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function statusColor(status: RunStatus) {
  switch (status) {
    case "running":
      return "bg-emerald-500";
    case "done":
      return "bg-sky-500";
    case "cancelled":
      return "bg-neutral-400";
    case "error":
      return "bg-red-500";
    default:
      return "bg-neutral-400";
  }
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Accepts data URL or http(s) URL and returns Uint8Array + mime */
async function fetchImageBytes(src: string): Promise<{ bytes: Uint8Array; mime: string; ext: string }> {
  if (src.startsWith("data:")) {
    const match = /^data:([^;]+);base64,(.*)$/i.exec(src);
    const mime = match?.[1] || "image/png";
    const b64 = match?.[2] || "";
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
    return { bytes, mime, ext };
  }

  const res = await fetch(src);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const mime = res.headers.get("content-type") || "image/png";
  const buf = new Uint8Array(await res.arrayBuffer());
  const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
  return { bytes: buf, mime, ext };
}

async function downloadUrlAs(url: string, filename: string) {
  try {
    const res = await fetch(url);
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  } catch {
    window.open(url, "_blank");
  }
}

/** Simple concurrency runner for an array of async task factories */
async function runWithLimit<T>(limit: number, tasks: Array<() => Promise<T>>): Promise<T[]> {
  const queue = [...tasks];
  const out: T[] = [];
  let running = 0;

  return await new Promise<T[]>((resolve, reject) => {
    const kick = () => {
      if (queue.length === 0 && running === 0) return resolve(out);

      while (running < limit && queue.length) {
        const task = queue.shift()!;
        running++;

        task()
          .then((r) => {
            out.push(r);
          })
          .catch((e) => {
            reject(e);
          })
          .finally(() => {
            running--;
            if (queue.length > 0) kick();
            else if (queue.length === 0 && running === 0) resolve(out);
          });
      }
    };

    kick();
  });
}

/* =================== Component =================== */

export default function ContentGeneratorPage() {
  /** Top-level mode */
  const [pageMode, setPageMode] = useState<PageMode>("image");

  /** Shared: products */
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>("custom");
  const [customUrl, setCustomUrl] = useState<string>("");

  const selectedProduct = useMemo(
    () => products.find((p) => p.id === selectedProductId) || null,
    [products, selectedProductId]
  );
  const productName = selectedProduct ? selectedProduct.name : "Custom";
  const referenceUrl = selectedProductId === "custom" ? customUrl : (selectedProduct?.image_url ?? "");

  async function loadProducts() {
    try {
      const res = await fetch("/api/products");
      const json = await res.json();
      setProducts(json.products || []);
    } catch {
      // ignore
    }
  }
  useEffect(() => {
    loadProducts();
  }, []);

  /* ---------------- IMAGE TAB STATE ---------------- */

  // model (image)
  const [imageModelId, setImageModelId] = useState<string>("nanobanana-v1");
  const imageModelDef = useMemo(() => getModelById(imageModelId)!, [imageModelId]);
  const imageModelNameDisplay = `${imageModelDef.label}-${imageModelDef.version}`;

  // seedream controls
  const [sdSize, setSdSize] = useState<(typeof IMAGE_SIZES)[number]>("square");
  const [sdRes, setSdRes] = useState<(typeof IMAGE_RESOLUTIONS)[number]>("1K");
  const [sdMax, setSdMax] = useState<number>(1);
  const [sdSeed, setSdSeed] = useState<number | "">("");

  // speed per run
  const [imageSpeed, setImageSpeed] = useState<1 | 2 | 3>(1);

  // prompts (image)
  const [imagePromptsText, setImagePromptsText] = useState<string>("");
  const imagePromptLines = useMemo(
    () => imagePromptsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [imagePromptsText]
  );

  // runs (image)
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const activeRun = useMemo(() => runs.find((r) => r.id === activeRunId) || null, [runs, activeRunId]);

  // prompt library
  const [libOpen, setLibOpen] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [libLoading, setLibLoading] = useState(false);

  // product manager
  const [prodOpen, setProdOpen] = useState(false);
  const [prodSaving, setProdSaving] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodForm, setProdForm] = useState<{ id?: string; name: string; slug: string; image_url: string }>({
    name: "",
    slug: "",
    image_url: "",
  });

  // guide
  const [guideOpen, setGuideOpen] = useState(false);

  // helpers (image)
  function toggleSelect(runId: string, idx: number) {
    setRuns((prevRuns) =>
      prevRuns.map((r) => {
        if (r.id !== runId) return r;
        const copy = new Set(r.selectedIdx);
        if (copy.has(idx)) copy.delete(idx);
        else copy.add(idx);
        return { ...r, selectedIdx: copy };
      })
    );
  }

  function deleteRun(runId: string) {
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== runId);
      if (activeRunId === runId) setActiveRunId(next[0]?.id ?? null);
      return next;
    });
  }

  function cancelRun(runId: string) {
    setRuns((prevRuns) =>
      prevRuns.map((r) => {
        if (r.id !== runId) return r;
        r.controller?.abort();
        return { ...r, status: "cancelled" as RunStatus };
      })
    );
  }

  async function zipRun(run: Run, selectedOnly: boolean) {
    if (run.images.length === 0) return;
    const chosenIdxs = selectedOnly ? Array.from(run.selectedIdx) : run.images.map((_, i) => i);
    if (chosenIdxs.length === 0) return;

    const folderName = safeName(run.productName || "product");
    const zip = new JSZip();

    // manifest
    const manifestLines = [
      `Run: ${run.name}`,
      `Product: ${run.productName}`,
      `Model: ${run.modelNameDisplay}`,
      `Started: ${new Date(run.startedAt).toLocaleString()}`,
      `Images: ${chosenIdxs.length}`,
      "",
      "Index, Prompt",
      ...chosenIdxs.map((i) => `${i + 1}, ${run.images[i].prompt.replace(/\r?\n/g, " ")}`),
      "",
    ];
    zip.file(`${folderName}/_manifest.txt`, manifestLines.join("\n"));

    // add images
    for (const i of chosenIdxs) {
      const img = run.images[i];
      const baseModel = safeName(run.modelNameDisplay);
      const basePrompt = safeName(img.prompt).slice(0, 60) || `img-${i + 1}`;
      const { bytes, ext } = await fetchImageBytes(img.imageDataUrl);
      const filename = `${folderName}/${String(i + 1).padStart(2, "0")}_${baseModel}_${basePrompt}.${ext}`;
      zip.file(filename, bytes);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const zipName = `${folderName}_${safeName(run.modelNameDisplay)}_${safeName(run.name)}.zip`;
    downloadBlob(blob, zipName);
  }

  // start image run (parallel workers)
  async function startImageRun() {
    const ref = referenceUrl || "";
    if (!ref || imagePromptLines.length === 0) return;

    // Drop oldest if already at 3 (cancel if running)
    setRuns((prev) => {
      if (prev.length < 3) return prev;
      const sorted = [...prev].sort((a, b) => a.startedAt - b.startedAt);
      const oldest = sorted[0];
      oldest.controller?.abort();
      return prev.filter((r) => r.id !== oldest.id);
    });

    const id = crypto.randomUUID();
    const ordinal = (runs.length ? Math.max(...runs.map((r) => parseInt(r.name.replace(/\D/g, "") || "0"))) : 0) + 1;
    const name = `Run #${ordinal}`;
    const ac = new AbortController();

    const newRun: Run = {
      id,
      name,
      startedAt: Date.now(),
      modelId: imageModelId,
      modelNameDisplay: imageModelNameDisplay,
      productId: selectedProductId !== "custom" ? selectedProductId : null,
      productName,
      referenceUrl: ref,
      prompts: [...imagePromptLines],
      status: "running",
      error: null,
      debug: null,
      images: [],
      activeIdx: 0,
      selectedIdx: new Set<number>(),
      progress: { done: 0, total: imagePromptLines.length },
      speed: imageSpeed,
      controller: ac,
    };

    setRuns((prev) => {
      const next = [...prev, newRun];
      setActiveRunId(id);
      return next;
    });

    await runImageWorkers(newRun);
  }

  async function runImageWorkers(run: Run) {
    let cursor = 0;
    const total = run.prompts.length;

    const pushImage = (img: GenImage) => {
      setRuns((prevRuns) =>
        prevRuns.map((r) => {
          if (r.id !== run.id) return r;
          const images = [...r.images, img];
          const activeIdx = images.length === 1 ? 0 : r.activeIdx;
          return { ...r, images, activeIdx };
        })
      );
    };
    const incProgress = () => {
      setRuns((prevRuns) =>
        prevRuns.map((r) => {
          if (r.id !== run.id) return r;
          return { ...r, progress: { done: r.progress.done + 1, total: r.progress.total } };
        })
      );
    };
    const setError = (message: string, debug?: unknown) => {
      setRuns((prevRuns) =>
        prevRuns.map((r) => (r.id === run.id ? { ...r, status: "error" as RunStatus, error: message, debug: debug ?? null } : r))
      );
    };

    const worker = async () => {
      while (true) {
        const idx = cursor;
        if (idx >= total) return;
        cursor++;

        const prompt = run.prompts[idx];

        try {
          const res = await fetch("/api/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              modelId: run.modelId,
              productId: run.productId,
              customUrl: run.productId ? null : run.referenceUrl,
              prompt,
              options:
                getModelById(run.modelId)!.provider === "seedream"
                  ? { image_size: sdSize, image_resolution: sdRes, max_images: sdMax, seed: sdSeed === "" ? null : sdSeed }
                  : undefined,
            }),
            signal: run.controller?.signal,
          });

          const json: any = await res.json().catch(() => ({}));
          if (!res.ok) {
            setError(json.error || "Generation failed", json.debug ?? null);
            incProgress();
            continue;
          }

          pushImage({ id: crypto.randomUUID(), prompt, imageDataUrl: json.imageDataUrl });
          incProgress();
        } catch (e: unknown) {
          const msg = (e as any)?.name === "AbortError" ? "Run cancelled" : (e as Error)?.message || "Request failed";
          setError(msg);
          return;
        }
      }
    };

    const parallel = Math.max(1, Math.min(3, run.speed));
    const workers: Promise<void>[] = [];
    for (let i = 0; i < parallel; i++) workers.push(worker());
    await Promise.all(workers).catch(() => {});

    setRuns((prevRuns) =>
      prevRuns.map((r) => (r.id === run.id && r.status === "running" ? { ...r, status: "done" as RunStatus } : r))
    );
  }

  // product manager UI handlers
  function openProductManager() {
    setProdError(null);
    setProdForm({ name: "", slug: "", image_url: "" });
    setProdOpen(true);
  }
  function editProduct(p: Product) {
    setProdError(null);
    setProdForm({ id: p.id, name: p.name, slug: p.slug, image_url: p.image_url });
    setProdOpen(true);
  }
  async function saveProduct() {
    try {
      setProdError(null);
      setProdSaving(true);
      const body = {
        name: prodForm.name.trim(),
        slug: prodForm.slug.trim() || safeName(prodForm.name.trim()),
        image_url: prodForm.image_url.trim(),
      };
      if (!body.name || !body.slug || !body.image_url) {
        setProdError("Name, slug, and image URL are required.");
        setProdSaving(false);
        return;
      }
      if (prodForm.id) {
        const res = await fetch(`/api/products/${prodForm.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to update product");
      } else {
        const res = await fetch(`/api/products`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Failed to create product");
        if (json.product?.id) setSelectedProductId(json.product.id);
      }
      await loadProducts();
      setProdOpen(false);
    } catch (e: unknown) {
      setProdError((e as Error)?.message || "Save failed");
    } finally {
      setProdSaving(false);
    }
  }
  async function deleteProduct(id: string) {
    if (!id) return;
    if (!confirm("Delete this product?")) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to delete product");
      if (selectedProductId === id) setSelectedProductId("custom");
      await loadProducts();
    } catch (e: unknown) {
      alert((e as Error)?.message || "Delete failed");
    }
  }

  // prompt library
  async function openLibrary() {
    setLibOpen(true);
    setLibLoading(true);
    try {
      const url = new URL("/api/prompts", window.location.origin);
      if (selectedProductId !== "custom") url.searchParams.set("productId", selectedProductId);
      if (libSearch.trim()) url.searchParams.set("q", libSearch.trim());
      const res = await fetch(url.toString());
      const json = await res.json();
      if (res.ok) setLibItems(json.prompts || []);
      else alert(json.error || "Failed to load library");
    } finally {
      setLibLoading(false);
    }
  }
  async function saveSinglePrompt(p: string) {
    const res = await fetch("/api/prompts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        productId: selectedProductId !== "custom" ? selectedProductId : null,
        productName,
        modelName: imageModelNameDisplay,
        prompts: [p],
      }),
    });
    const json = await res.json();
    if (!res.ok) alert(`Save failed: ${json.error || "unknown error"}`);
    else alert("Prompt saved.");
  }
  async function copyPromptToClipboard(p: string) {
    try {
      await navigator.clipboard.writeText(p);
    } catch {
      alert("Could not copy to clipboard.");
    }
  }
  function downloadPromptTxt(p: string, id: string) {
    const baseProduct = safeName(productName || "product");
    const baseModel = safeName(imageModelNameDisplay);
    const filename = `${baseProduct}_${baseModel}_${id}.txt`;
    const blob = new Blob([p], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, filename);
  }

  const somethingRunning = runs.some((r) => r.status === "running");
  const activePct =
    activeRun && activeRun.progress.total > 0
      ? Math.round((activeRun.progress.done / activeRun.progress.total) * 100)
      : 0;

  /* ---------------- VIDEO TAB STATE ---------------- */

  const [videoModelId, setVideoModelId] = useState<string>(VIDEO_MODELS[0].id);
  const videoModel = useMemo(() => VIDEO_MODELS.find((m) => m.id === videoModelId)!, [videoModelId]);

  const [klingMode, setKlingMode] = useState<KlingMode>(videoModel.kind); // i2v | t2v
  const [duration, setDuration] = useState<Duration>("5");
  const [aspectRatio, setAspectRatio] = useState<AR>("16:9"); // t2v only
  const [negativePrompt, setNegativePrompt] = useState<string>("");
  const [cfgScale, setCfgScale] = useState<string>("0.5");
  const [parallelCount, setParallelCount] = useState<number>(1);

  const [videoPromptsText, setVideoPromptsText] = useState<string>("");
  const videoPromptLines = useMemo(
    () => videoPromptsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [videoPromptsText]
  );

  const [videos, setVideos] = useState<VideoItem[]>([]);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoServerDebug, setVideoServerDebug] = useState<any>(null);
  const [videoProgress, setVideoProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const videoControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    // keep klingMode in sync when model changes
    const m = VIDEO_MODELS.find((x) => x.id === videoModelId);
    if (m) setKlingMode(m.kind);
  }, [videoModelId]);

  async function onGenerateVideos() {
    if (videoPromptLines.length === 0) return;
    if (klingMode === "image-to-video" && !referenceUrl) {
      setVideoError("Please select a product or provide a custom image URL.");
      return;
    }

    setVideoLoading(true);
    setVideoError(null);
    setVideoServerDebug(null);
    setVideos([]);
    setVideoProgress({ done: 0, total: videoPromptLines.length });

    const ac = new AbortController();
    videoControllerRef.current = ac;

    try {
      const cfgValue = Number.isFinite(Number(cfgScale)) ? Number(cfgScale) : undefined;

      const tasks = videoPromptLines.map((p, idx) => async () => {
        const body: any = {
          model: videoModel.model,
          mode: klingMode,
          prompt: p,
          duration,
        };
        if (klingMode === "text-to-video") body.aspect_ratio = aspectRatio;
        if (negativePrompt.trim()) body.negative_prompt = negativePrompt.trim();
        if (typeof cfgValue === "number") body.cfg_scale = cfgValue;
        if (klingMode === "image-to-video") {
          body.productId = selectedProductId !== "custom" ? selectedProductId : null;
          body.customUrl = selectedProductId === "custom" ? customUrl : null;
        }

        const res = await fetch("/api/video/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });
        const json: any = await res.json();
        if (!res.ok) {
          setVideoServerDebug(json.debug ?? null);
          throw new Error(json.error || `Generation failed (line ${idx + 1})`);
        } else {
          setVideoServerDebug(null);
        }

        const item: VideoItem = { id: crypto.randomUUID(), prompt: p, url: json.videoUrl };
        setVideos((prev) => [...prev, item]);
        setVideoProgress((s) => ({ done: s.done + 1, total: s.total }));
        return item;
      });

      await runWithLimit(Math.min(3, Math.max(1, parallelCount)), tasks);
    } catch (e: any) {
      if (e?.name === "AbortError") setVideoError("Generation cancelled.");
      else setVideoError(e?.message || "Something went wrong.");
    } finally {
      setVideoLoading(false);
      videoControllerRef.current = null;
    }
  }
  function onCancelVideos() {
    videoControllerRef.current?.abort();
  }
  const videoPct = videoProgress.total > 0 ? Math.round((videoProgress.done / videoProgress.total) * 100) : 0;

  /* =================== RENDER =================== */

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center border border-white/15 text-sm">OL</div>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold leading-tight">Outlight — Content Generator</h1>
              <p className="text-xs text-neutral-400 hidden md:block">
                Image + Video generation • parallel execution • product library
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode switch */}
            <div className="flex items-center gap-1 rounded-md border border-white/20 bg-white/5 p-1">
              <button
                className={`px-3 py-1.5 text-sm rounded ${pageMode === "image" ? "bg-white/15" : ""}`}
                onClick={() => setPageMode("image")}
              >
                Image
              </button>
              <button
                className={`px-3 py-1.5 text-sm rounded ${pageMode === "video" ? "bg-white/15" : ""}`}
                onClick={() => setPageMode("video")}
              >
                Video
              </button>
            </div>

            {/* Guide */}
            <button
              className="rounded-md bg-white/10 hover:bg-white/15 border border-white/20 px-3 py-1.5 text-sm"
              onClick={() => setGuideOpen(true)}
              title="Open guide"
            >
              Guide
            </button>

            {/* Runs indicator (image) */}
            <div
              className={`hidden md:flex items-center gap-2 rounded-md border px-2 py-1 ${
                somethingRunning ? "border-emerald-500/30 bg-emerald-500/10" : "border-white/15 bg-white/5"
              }`}
              title="Concurrent runs"
            >
              <span className={`inline-block h-2 w-2 rounded-full ${somethingRunning ? "bg-emerald-400 animate-pulse" : "bg-neutral-400"}`} />
              <span className="text-xs text-neutral-300">Runs: {runs.length}/3</span>
            </div>
          </div>
        </header>

        {/* Tabs */}
        {pageMode === "image" ? (
          /* ---------------- IMAGE TAB ---------------- */
          <>
            {/* Runs dock */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
              <div className="flex flex-wrap items-center gap-2">
                {runs.length === 0 && (
                  <div className="text-xs text-neutral-500 px-2 py-1">
                    No runs yet. Configure your prompt(s) and click <span className="underline">Start Run</span>.
                  </div>
                )}
                {runs.map((r) => {
                  const pct = r.progress.total > 0 ? Math.round((r.progress.done / r.progress.total) * 100) : 0;
                  return (
                    <div
                      key={r.id}
                      className={`group rounded-md border ${
                        activeRunId === r.id ? "border-white/30 bg-white/5" : "border-white/10 bg-black/20 hover:bg-black/30"
                      }`}
                    >
                      <button className="px-3 py-1.5 text-sm flex items-center gap-2" onClick={() => setActiveRunId(r.id)}>
                        <span className={`inline-block h-2 w-2 rounded-full ${statusColor(r.status)}`} />
                        <span className="text-neutral-200">{r.name}</span>
                        {r.status === "running" && (
                          <span className="text-[11px] text-neutral-400">{r.progress.done}/{r.progress.total}</span>
                        )}
                      </button>
                      <div className="h-[3px] w-full bg-white/5">
                        <div className={`h-[3px] ${r.status === "error" ? "bg-red-500" : "bg-white/70"}`} style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })}

                <div className="ml-auto flex items-center gap-2">
                  {activeRun && (
                    <>
                      <span className="text-xs text-neutral-500">
                        Viewing: <b className="text-neutral-300">{activeRun.name}</b>
                      </span>
                      {activeRun.status === "running" && (
                        <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs" onClick={() => cancelRun(activeRun.id)}>
                          Cancel
                        </button>
                      )}
                      <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs" onClick={() => zipRun(activeRun, false)}>
                        ZIP all
                      </button>
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs disabled:opacity-50"
                        onClick={() => zipRun(activeRun, true)}
                        disabled={activeRun.selectedIdx.size === 0}
                      >
                        ZIP selected ({activeRun.selectedIdx.size})
                      </button>
                      <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs" onClick={() => deleteRun(activeRun.id)}>
                        Delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Two columns */}
            <section className="grid md:grid-cols-3 gap-6">
              {/* LEFT controls */}
              <div className="space-y-4 md:col-span-1">
                {/* Model */}
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <label className="text-sm text-neutral-300">Model</label>
                  <select className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2" value={imageModelId} onChange={(e) => setImageModelId(e.target.value)}>
                    {MODEL_LIST.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label} — {m.version}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Product */}
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-neutral-300">Product</label>
                    <button
                      type="button"
                      className="text-xs rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1"
                      onClick={openProductManager}
                      title="Add / Edit products"
                    >
                      Manage
                    </button>
                  </div>
                  <select className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2" value={selectedProductId} onChange={(e) => setSelectedProductId(e.target.value)}>
                    <option value="custom">Custom (use your own image)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {selectedProductId === "custom" && (
                    <div className="space-y-2 mt-3">
                      <label className="text-sm text-neutral-300">Custom image URL</label>
                      <input
                        placeholder="https://..."
                        className="w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                      />
                    </div>
                  )}
                </div>

                {/* Seedream-only controls */}
                {imageModelDef.provider === "seedream" && (
                  <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-xs text-neutral-400">Image size</label>
                        <select className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2" value={sdSize} onChange={(e) => setSdSize(e.target.value as any)}>
                          {IMAGE_SIZES.map((s) => (
                            <option key={s} value={s}>
                              {s}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-neutral-400">Resolution</label>
                        <select className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2" value={sdRes} onChange={(e) => setSdRes(e.target.value as any)}>
                          {IMAGE_RESOLUTIONS.map((r) => (
                            <option key={r} value={r}>
                              {r}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs text-neutral-400">Max images (1–6)</label>
                        <input
                          type="number"
                          min={1}
                          max={6}
                          className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                          value={sdMax}
                          onChange={(e) => setSdMax(Math.max(1, Math.min(6, Number(e.target.value || 1))))}
                        />
                      </div>
                      <div>
                        <label className="text-xs text-neutral-400">Seed (optional)</label>
                        <input
                          type="number"
                          className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                          value={sdSeed}
                          onChange={(e) => setSdSeed(e.target.value === "" ? "" : Number(e.target.value))}
                          placeholder="blank = random"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Reference preview */}
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <label className="text-sm text-neutral-300">Reference preview</label>
                  <div className="rounded-xl overflow-hidden border border-neutral-800 mt-2 max-w-sm">
                    <div className="aspect-square bg-neutral-950">
                      {referenceUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={referenceUrl} alt="Reference" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-600 text-sm">—</div>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* RIGHT: prompt + results */}
              <div className="md:col-span-2 space-y-6">
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-neutral-300">Prompt (each line = one image)</label>
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-neutral-400">Speed</label>
                      <select
                        className="rounded-md bg-neutral-900 border border-neutral-800 p-2 text-sm"
                        value={imageSpeed}
                        onChange={(e) => setImageSpeed(Number(e.target.value) as 1 | 2 | 3)}
                      >
                        <option value={1}>1× (safe)</option>
                        <option value={2}>2×</option>
                        <option value={3}>3×</option>
                      </select>
                    </div>
                  </div>

                  <textarea
                    className="w-full h-56 rounded-md bg-neutral-900 border border-neutral-800 p-3"
                    placeholder={`place this floor lamp light on a modern house, living room. glass windows
place this floor lamp on a studio-like space, extremely zoomed in to show the texture of the lights.`}
                    value={imagePromptsText}
                    onChange={(e) => setImagePromptsText(e.target.value)}
                  />

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                      onClick={startImageRun}
                      disabled={!referenceUrl || imagePromptLines.length === 0}
                      title="Start a new run. Oldest of 3 will be removed automatically."
                    >
                      Start Run ({imagePromptLines.length || 0})
                    </button>

                    <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2" onClick={openLibrary}>
                      Prompt Library
                    </button>
                  </div>

                  {activeRun && activeRun.progress.total > 0 && (
                    <div className="h-1 w-full bg-neutral-800 rounded">
                      <div
                        className={`h-1 rounded ${activeRun.status === "error" ? "bg-red-500" : "bg-white/70"}`}
                        style={{ width: `${activePct}%`, transition: "width .2s ease" }}
                      />
                    </div>
                  )}
                </div>

                {/* Results */}
                {activeRun && activeRun.images.length > 0 ? (
                  <div className="grid md:grid-cols-3 gap-4 items-start">
                    {/* Thumbs */}
                    <div className="md:col-span-1 self-start grid grid-cols-3 gap-[2px] place-content-start">
                      {activeRun.images.map((img, i) => {
                        const isActive = i === activeRun.activeIdx;
                        const isSelected = activeRun.selectedIdx.has(i);
                        return (
                          <div key={img.id} className="relative overflow-hidden rounded-[6px] border border-neutral-800" style={{ aspectRatio: "1 / 1" }}>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={img.imageDataUrl}
                              alt={`Result ${i + 1}`}
                              className={`absolute inset-0 block w-full h-full object-cover ${isActive ? "ring-2 ring-white/40" : ""}`}
                              onClick={() =>
                                setRuns((prev) => prev.map((r) => (r.id === activeRun.id ? { ...r, activeIdx: i } : r)))
                              }
                            />
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelect(activeRun.id, i)}
                              className="absolute top-1 left-1 w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                              title={isSelected ? "Deselect" : "Select"}
                            />
                          </div>
                        );
                      })}
                    </div>

                    {/* Main + prompt */}
                    <div className="md:col-span-2">
                      <div className="relative rounded-xl overflow-hidden border border-neutral-800">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={activeRun.images[activeRun.activeIdx].imageDataUrl}
                          alt={`Main ${activeRun.activeIdx + 1}`}
                          className="w-full h-auto"
                        />
                        <div className="absolute top-2 right-2 flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={activeRun.selectedIdx.has(activeRun.activeIdx)}
                            onChange={() => toggleSelect(activeRun.id, activeRun.activeIdx)}
                            className="w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                            title={activeRun.selectedIdx.has(activeRun.activeIdx) ? "Deselect" : "Select"}
                          />
                          <button
                            onClick={() => {
                              const baseProduct = safeName(activeRun.productName || "product");
                              const baseModel = safeName(activeRun.modelNameDisplay);
                              const id = activeRun.images[activeRun.activeIdx]?.id || `${Date.now()}-${activeRun.activeIdx + 1}`;
                              const filename = `${baseProduct}_${baseModel}_${id}.png`;
                              downloadDataUrl(activeRun.images[activeRun.activeIdx].imageDataUrl, filename);
                            }}
                            className="rounded-md bg-black/60 hover:bg-black/75 border border-white/30 text-white text-sm px-3 py-1"
                          >
                            ⬇︎ Download
                          </button>
                        </div>
                      </div>

                      <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="shrink-0 text-sm font-medium text-neutral-100">Prompt</div>
                          <div className="flex gap-2">
                            <button
                              className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                              onClick={() => copyPromptToClipboard(activeRun.images[activeRun.activeIdx].prompt)}
                            >
                              Copy
                            </button>
                            <button
                              className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                              onClick={() => saveSinglePrompt(activeRun.images[activeRun.activeIdx].prompt)}
                            >
                              Save
                            </button>
                            <button
                              className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                              onClick={() =>
                                downloadPromptTxt(activeRun.images[activeRun.activeIdx].prompt, activeRun.images[activeRun.activeIdx].id)
                              }
                            >
                              Download .txt
                            </button>
                          </div>
                        </div>
                        <p className="mt-2 text-[13px] leading-relaxed text-neutral-200 whitespace-pre-wrap break-words">
                          {activeRun.images[activeRun.activeIdx].prompt}
                        </p>
                      </div>
                    </div>
                  </div>
                ) : (
                  activeRun && (
                    <div className="text-sm text-neutral-400">
                      {activeRun.status === "running"
                        ? "Generating…"
                        : activeRun.status === "error"
                        ? `Run error: ${activeRun.error || "Unknown error"}`
                        : activeRun.status === "cancelled"
                        ? "Run cancelled."
                        : "No images in this run yet."}
                    </div>
                  )
                )}
              </div>
            </section>
          </>
        ) : (
          /* ---------------- VIDEO TAB ---------------- */
          <section className="grid md:grid-cols-3 gap-6">
            {/* LEFT controls */}
            <div className="space-y-4 md:col-span-1">
              {/* Video model */}
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                <label className="text-sm text-neutral-300">Video Model</label>
                <select
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={videoModelId}
                  onChange={(e) => setVideoModelId(e.target.value)}
                >
                  {VIDEO_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Kling mode */}
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                <label className="text-sm text-neutral-300">Mode</label>
                <select
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={klingMode}
                  onChange={(e) => setKlingMode(e.target.value as KlingMode)}
                >
                  <option value="image-to-video">Image → Video</option>
                  <option value="text-to-video">Text → Video</option>
                </select>
              </div>

              {/* Product / custom for i2v */}
              {klingMode === "image-to-video" && (
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60 space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-neutral-300">Product</label>
                  </div>
                  <select
                    className="w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                    value={selectedProductId}
                    onChange={(e) => setSelectedProductId(e.target.value)}
                  >
                    <option value="custom">Custom (use your own image)</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>

                  {selectedProductId === "custom" && (
                    <div className="space-y-2">
                      <label className="text-sm text-neutral-300">Custom image URL</label>
                      <input
                        placeholder="https://..."
                        className="w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={customUrl}
                        onChange={(e) => setCustomUrl(e.target.value)}
                      />
                    </div>
                  )}

                  <div>
                    <label className="text-sm text-neutral-300">Reference preview</label>
                    <div className="rounded-xl overflow-hidden border border-neutral-800 mt-2 max-w-sm">
                      <div className="aspect-square bg-neutral-950">
                        {referenceUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={referenceUrl} alt="Reference" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-neutral-600 text-sm">—</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Common options */}
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-neutral-400">Duration</label>
                    <select className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2" value={duration} onChange={(e) => setDuration(e.target.value as Duration)}>
                      <option value="5">5s</option>
                      <option value="10">10s</option>
                    </select>
                  </div>

                  {klingMode === "text-to-video" && (
                    <div>
                      <label className="text-xs text-neutral-400">Aspect Ratio</label>
                      <select
                        className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={aspectRatio}
                        onChange={(e) => setAspectRatio(e.target.value as AR)}
                      >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="1:1">1:1</option>
                      </select>
                    </div>
                  )}
                </div>

                <div className="mt-2">
                  <label className="text-xs text-neutral-400">Negative prompt (optional)</label>
                  <input
                    className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                    value={negativePrompt}
                    onChange={(e) => setNegativePrompt(e.target.value)}
                    placeholder="blur, distort, low quality"
                  />
                </div>

                <div className="mt-2">
                  <label className="text-xs text-neutral-400">CFG scale (0–1, optional)</label>
                  <input
                    className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                    value={cfgScale}
                    onChange={(e) => setCfgScale(e.target.value)}
                    placeholder="0.5"
                  />
                </div>

                <div className="mt-2">
                  <label className="text-xs text-neutral-400">Speed (parallel jobs)</label>
                  <input
                    type="range"
                    min={1}
                    max={3}
                    step={1}
                    value={parallelCount}
                    onChange={(e) => setParallelCount(Number(e.target.value))}
                    className="w-full"
                  />
                  <div className="text-xs text-neutral-500 mt-1">Parallel: {parallelCount} (max 3)</div>
                </div>
              </div>
            </div>

            {/* RIGHT: prompts + results */}
            <div className="md:col-span-2 space-y-6">
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60 space-y-3">
                <label className="text-sm text-neutral-300">Prompt (each line = one video)</label>
                <textarea
                  className="w-full h-56 rounded-md bg-neutral-900 border border-neutral-800 p-3"
                  placeholder={
                    klingMode === "image-to-video"
                      ? `slow product orbit\nclose-up macro pan, dramatic lighting`
                      : `Wide shot of city at dusk, slow aerial push-in\nCinematic macro of waves with golden reflections`
                  }
                  value={videoPromptsText}
                  onChange={(e) => setVideoPromptsText(e.target.value)}
                />
                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                    onClick={onGenerateVideos}
                    disabled={
                      videoLoading ||
                      videoPromptLines.length === 0 ||
                      (klingMode === "image-to-video" && !referenceUrl)
                    }
                  >
                    {videoLoading ? "Generating…" : `Generate ${videoPromptLines.length || ""}`}
                  </button>
                  {videoLoading && (
                    <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2" onClick={onCancelVideos}>
                      Cancel
                    </button>
                  )}

                  {videoError && <span className="text-sm text-red-400">{videoError}</span>}
                </div>

                {videoServerDebug && (
                  <details className="mt-2 rounded border border-red-900/40 bg-red-900/10 p-2 text-xs text-red-200">
                    <summary className="cursor-pointer">Show server debug</summary>
                    <pre className="mt-2 whitespace-pre-wrap break-words">{JSON.stringify(videoServerDebug, null, 2)}</pre>
                  </details>
                )}

                {videoProgress.total > 0 && (
                  <div className="h-1 w-full bg-neutral-800 rounded">
                    <div className="h-1 bg-white/70 rounded" style={{ width: `${videoPct}%`, transition: "width .2s ease" }} />
                  </div>
                )}
              </div>

              {/* Results */}
              {videos.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-neutral-300">Results ({videos.length})</div>
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1 text-sm"
                      onClick={() => {
                        const base = safeName(productName || "product");
                        videos.forEach((v, i) => downloadUrlAs(v.url, `${base}_video_${i + 1}.mp4`));
                      }}
                    >
                      Download all
                    </button>
                  </div>

                  <div className="grid md:grid-cols-2 gap-4">
                    {videos.map((v, i) => (
                      <div key={v.id} className="rounded-lg border border-neutral-800 overflow-hidden">
                        <video className="w-full h-auto block bg-black" src={v.url} controls playsInline />
                        <div className="p-3 flex items-center justify-between gap-3">
                          <div className="text-xs text-neutral-400 line-clamp-2">{v.prompt}</div>
                          <button
                            className="rounded-md bg-black/60 hover:bg-black/75 border border-white/30 text-white text-xs px-3 py-1"
                            onClick={() => {
                              const base = safeName(productName || "product");
                              downloadUrlAs(v.url, `${base}_video_${i + 1}.mp4`);
                            }}
                          >
                            ⬇︎ Download
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        {/* Floating mini-indicator (mobile / always-on) */}
        <div className="fixed bottom-4 right-4 md:hidden">
          <div
            className={`flex items-center gap-2 rounded-full px-3 py-1.5 shadow-lg border ${
              runs.some((r) => r.status === "running") ? "border-emerald-500/30 bg-neutral-900/90" : "border-white/10 bg-neutral-900/80"
            }`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-full ${runs.some((r) => r.status === "running") ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"}`} />
            <span className="text-xs text-neutral-200">Runs {runs.length}/3</span>
          </div>
        </div>
      </div>

      {/* Prompt Library Panel (image) */}
      {libOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="ml-auto h-full w-full max-w-xl bg-neutral-950 border-l border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Prompt Library</h2>
              <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1" onClick={() => setLibOpen(false)}>
                Close
              </button>
            </div>

            <div className="flex gap-2 mb-3">
              <input
                className="flex-1 rounded-md bg-neutral-900 border border-neutral-800 p-2"
                placeholder="Search prompts…"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
              />
              <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3" onClick={openLibrary}>
                Search
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-2">
              {libLoading && <div className="text-sm text-neutral-400">Loading…</div>}
              {!libLoading && libItems.length === 0 && <div className="text-sm text-neutral-500">No prompts yet.</div>}
              {libItems.map((it) => (
                <div key={it.id} className="rounded-md border border-neutral-800 p-2 hover:bg-white/5">
                  <div className="text-xs text-neutral-500 mb-1">
                    {it.product_name || "Any"} • {it.model_name} • {new Date(it.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{it.prompt}</div>
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                        onClick={() => setImagePromptsText((prev) => (prev ? prev + "\n" + it.prompt : it.prompt))}
                      >
                        Insert
                      </button>
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                        onClick={() => setImagePromptsText(it.prompt)}
                      >
                        Replace
                      </button>
                    </div>
                    <button
                      className="rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-300 px-2 py-1 text-sm"
                      onClick={async () => {
                        if (!confirm("Delete this saved prompt?")) return;
                        const res = await fetch(`/api/prompts/${it.id}`, { method: "DELETE" });
                        const json = await res.json();
                        if (!res.ok) {
                          alert(json.error || "Failed to delete prompt.");
                          return;
                        }
                        setLibItems((prev) => prev.filter((p) => p.id !== it.id));
                      }}
                      title="Delete this saved prompt"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Product Manager Panel (shared) */}
      {prodOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="ml-auto h-full w-full max-w-xl bg-neutral-950 border-l border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">{prodForm.id ? "Edit Product" : "Add Product"}</h2>
              <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1" onClick={() => setProdOpen(false)}>
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-neutral-300">Name</label>
                <input
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={prodForm.name}
                  onChange={(e) => setProdForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Awesome Lamp"
                />
              </div>

              <div>
                <label className="text-sm text-neutral-300">Slug</label>
                <input
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={prodForm.slug}
                  onChange={(e) => setProdForm((f) => ({ ...f, slug: e.target.value }))}
                  placeholder="awesome-lamp"
                />
                <p className="mt-1 text-[11px] text-neutral-500">Leave blank to auto-generate from name.</p>
              </div>

              <div>
                <label className="text-sm text-neutral-300">Image URL</label>
                <input
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={prodForm.image_url}
                  onChange={(e) => setProdForm((f) => ({ ...f, image_url: e.target.value }))}
                  placeholder="https://.../image.jpg"
                />
              </div>

              {prodError && <div className="text-sm text-red-400">{prodError}</div>}

              <div className="flex items-center gap-2">
                <button className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50" onClick={saveProduct} disabled={prodSaving}>
                  {prodSaving ? "Saving…" : prodForm.id ? "Update Product" : "Add Product"}
                </button>

                {prodForm.id && (
                  <button
                    className="rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-300 px-3 py-2"
                    onClick={() => prodForm.id && deleteProduct(prodForm.id)}
                    disabled={prodSaving}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>

            <hr className="my-4 border-neutral-800" />

            <div className="flex-1 overflow-auto space-y-2">
              <div className="text-xs text-neutral-500 mb-2">All products</div>
              {products.length === 0 && <div className="text-sm text-neutral-500">No products yet.</div>}
              {products.map((p) => (
                <div key={p.id} className="rounded-md border border-neutral-800 p-2 hover:bg-white/5 flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">{p.name}</div>
                    <div className="text-xs text-neutral-500 truncate">{p.slug}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{p.image_url}</div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm" onClick={() => editProduct(p)}>
                      Edit
                    </button>
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                      onClick={() => {
                        setSelectedProductId(p.id);
                        setProdOpen(false);
                      }}
                    >
                      Use
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Guide */}
      {guideOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="mx-auto my-6 h-[92vh] w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Outlight Guide</h2>
              <button className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1" onClick={() => setGuideOpen(false)}>
                Close
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-auto text-sm leading-6 text-neutral-200">
              <section>
                <h3 className="font-semibold text-neutral-100">Overview</h3>
                <p>
                  Outlight is a multi-model <b>content generator</b> for Images and Videos. Images support up to{" "}
                  <b>3 concurrent runs</b> with parallel requests per run (1–3×) and product-based reference images. Videos use Kling
                  via KIE with parallel job scheduling (1–3).
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Image Flow</h3>
                <ol className="list-decimal ml-5 space-y-1">
                  <li>Select a <b>Model</b> and a <b>Product</b> (or paste a Custom URL).</li>
                  <li>Enter one or more prompts (one per line).</li>
                  <li>Choose <b>Speed</b> (1–3 parallel requests).</li>
                  <li>Click <b>Start Run</b>. Switch between runs in the dock. Download ZIP (all/selected).</li>
                </ol>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Video Flow</h3>
                <ol className="list-decimal ml-5 space-y-1">
                  <li>Pick a <b>Video Model</b> and <b>Mode</b> (Image→Video or Text→Video).</li>
                  <li>For i2v, choose a product or custom image URL; set duration and optional params.</li>
                  <li>Enter one or more prompts (one per line); set parallel jobs (1–3); click <b>Generate</b>.</li>
                </ol>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Tips</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Higher parallelism is faster but can hit provider rate limits.</li>
                  <li>Ensure reference images are publicly accessible URLs.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
