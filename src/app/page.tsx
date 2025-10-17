"use client";

import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import {
  MODEL_LIST,
  getModelById,
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
} from "@/lib/models";

/* ---------------- Types ---------------- */

type Product = { id: string; name: string; slug: string; image_url: string };
type GenImage = { id: string; prompt: string; imageDataUrl: string };

type LibraryItem = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  model_name: string;
  prompt: string;
  created_at: string;
};

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

/* ---------------- Utils ---------------- */

function safeName(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
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
    // data:[<mediatype>][;base64],<data>
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

/* ---------------- Component ---------------- */

export default function Home() {
  /* Products / reference */
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string>("custom");
  const [customUrl, setCustomUrl] = useState<string>("");

  /* Model selection */
  const [modelId, setModelId] = useState<string>("nanobanana-v1");
  const modelDef = useMemo(() => getModelById(modelId)!, [modelId]);
  const modelNameDisplay = `${modelDef.label}-${modelDef.version}`;

  /* Seedream-only knobs */
  const [sdSize, setSdSize] = useState<(typeof IMAGE_SIZES)[number]>("square");
  const [sdRes, setSdRes] = useState<(typeof IMAGE_RESOLUTIONS)[number]>("1K");
  const [sdMax, setSdMax] = useState<number>(1);
  const [sdSeed, setSdSeed] = useState<number | "">("");

  /* Speed (parallelism per run) */
  const [speed, setSpeed] = useState<1 | 2 | 3>(1);

  /* Prompts */
  const [promptsText, setPromptsText] = useState<string>("");
  const promptLines = useMemo(
    () =>
      promptsText
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    [promptsText]
  );

  /* Runs management (up to 3) */
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  /* Overlays / panels */
  const [libOpen, setLibOpen] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [libLoading, setLibLoading] = useState(false);

  const [prodOpen, setProdOpen] = useState(false);
  const [prodSaving, setProdSaving] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodForm, setProdForm] = useState<{
    id?: string;
    name: string;
    slug: string;
    image_url: string;
  }>({ name: "", slug: "", image_url: "" });

  const [guideOpen, setGuideOpen] = useState(false);

  const selected = useMemo(
    () => products.find((p) => p.id === selectedId),
    [products, selectedId]
  );
  const productName = selected ? selected.name : "Custom";
  const referenceUrl =
    selectedId === "custom" ? customUrl : (selected?.image_url as string | undefined);

  /* Load products */
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

  /* -------------- Product Manager -------------- */

  function openProductManager() {
    setProdError(null);
    setProdForm({ name: "", slug: "", image_url: "" });
    setProdOpen(true);
  }

  function editProduct(p: Product) {
    setProdError(null);
    setProdForm({
      id: p.id,
      name: p.name,
      slug: p.slug,
      image_url: p.image_url,
    });
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
        if (json.product?.id) setSelectedId(json.product.id);
      }

      await loadProducts();
      setProdOpen(false);
    } catch (e: unknown) {
      const msg = (e as Error)?.message || "Save failed";
      setProdError(msg);
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
      if (selectedId === id) setSelectedId("custom");
      await loadProducts();
    } catch (e: unknown) {
      alert((e as Error)?.message || "Delete failed");
    }
  }

  /* -------------- Prompt Library -------------- */

  async function openLibrary() {
    setLibOpen(true);
    setLibLoading(true);
    try {
      const url = new URL("/api/prompts", window.location.origin);
      if (selectedId !== "custom") url.searchParams.set("productId", selectedId);
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
        productId: selectedId !== "custom" ? selectedId : null,
        productName,
        modelName: modelNameDisplay,
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
    const baseModel = safeName(modelNameDisplay);
    const filename = `${baseProduct}_${baseModel}_${id}.txt`;
    const blob = new Blob([p], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, filename);
  }

  /* -------------- Runs helpers -------------- */

  const activeRun = useMemo(
    () => runs.find((r) => r.id === activeRunId) || null,
    [runs, activeRunId]
  );

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

  function downloadSelectedFromRun(run: Run) {
    if (run.selectedIdx.size === 0) return;
    const baseProduct = safeName(run.productName || "product");
    const baseModel = safeName(run.modelNameDisplay);
    Array.from(run.selectedIdx).forEach((i) => {
      const id = run.images[i]?.id || `${Date.now()}-${i + 1}`;
      const filename = `${baseProduct}_${baseModel}_${id}.png`;
      downloadDataUrl(run.images[i].imageDataUrl, filename);
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

  function deleteRun(runId: string) {
    setRuns((prev) => {
      const next = prev.filter((r) => r.id !== runId);
      if (activeRunId === runId) {
        const newActive = next[0]?.id ?? null;
        setActiveRunId(newActive);
      }
      return next;
    });
  }

  /* ---- NEW: ZIP helpers ---- */

  async function zipRun(run: Run, selectedOnly: boolean) {
    if (run.images.length === 0) return;
    const chosenIdxs = selectedOnly ? Array.from(run.selectedIdx) : run.images.map((_, i) => i);
    if (chosenIdxs.length === 0) return;

    const folderName = safeName(run.productName || "product");
    const zip = new JSZip();

    // Optional: include a run manifest text file
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

    // Add images
    for (const i of chosenIdxs) {
      const img = run.images[i];
      const baseModel = safeName(run.modelNameDisplay);
      const basePrompt = safeName(img.prompt).slice(0, 60) || `img-${i + 1}`;
      const { bytes, ext } = await fetchImageBytes(img.imageDataUrl);
      // Filename pattern: <product>/<index>_<model>_<prompt>.ext
      const filename = `${folderName}/${String(i + 1).padStart(2, "0")}_${baseModel}_${basePrompt}.${ext}`;
      zip.file(filename, bytes);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const zipName = `${folderName}_${safeName(run.modelNameDisplay)}_${safeName(run.name)}.zip`;
    downloadBlob(blob, zipName);
  }

  /* -------------- Start a run (pool parallelism) -------------- */

  async function onGenerateNewRun() {
    const ref = referenceUrl || "";
    if (!ref || promptLines.length === 0) return;

    // Drop oldest if already at 3 (cancel if running)
    setRuns((prev) => {
      if (prev.length < 3) return prev;
      const sorted = [...prev].sort((a, b) => a.startedAt - b.startedAt);
      const oldest = sorted[0];
      oldest.controller?.abort();
      return prev.filter((r) => r.id !== oldest.id);
    });

    const id = crypto.randomUUID();
    const runOrdinal =
      (runs.length
        ? Math.max(
            ...runs.map((r) => parseInt(r.name.replace(/\D/g, "") || "0"))
          )
        : 0) + 1;
    const runName = `Run #${runOrdinal}`;

    const ac = new AbortController();
    const newRun: Run = {
      id,
      name: runName,
      startedAt: Date.now(),
      modelId,
      modelNameDisplay,
      productId: selectedId !== "custom" ? selectedId : null,
      productName,
      referenceUrl: ref,
      prompts: [...promptLines],
      status: "running",
      error: null,
      debug: null,
      images: [],
      activeIdx: 0,
      selectedIdx: new Set<number>(),
      progress: { done: 0, total: promptLines.length },
      speed,
      controller: ac,
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
          const done = r.progress.done + 1;
          return { ...r, progress: { done, total: r.progress.total } };
        })
      );
    };
    const setError = (message: string, debug?: unknown) => {
      setRuns((prevRuns) =>
        prevRuns.map((r) => {
          if (r.id !== run.id) return r;
          return {
            ...r,
            status: "error" as RunStatus,
            error: message,
            debug: debug ?? null,
          };
        })
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

          const json = await res.json().catch(() => ({} as any));
          if (!res.ok) {
            setError(json.error || "Generation failed", json.debug ?? null);
            incProgress();
            continue;
          }

          pushImage({
            id: crypto.randomUUID(),
            prompt,
            imageDataUrl: json.imageDataUrl,
          });
          incProgress();
        } catch (e: unknown) {
          const msg =
            (e as any)?.name === "AbortError"
              ? "Run cancelled"
              : (e as Error)?.message || "Request failed";
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
      prevRuns.map((r) => {
        if (r.id !== run.id) return r;
        if (r.status === "running") return { ...r, status: "done" as RunStatus };
        return r;
      })
    );
  }

  /* -------------- Header & Runs Dock UI -------------- */

  const somethingRunning = runs.some((r) => r.status === "running");
  const overallPct =
    activeRun && activeRun.progress.total > 0
      ? Math.round((activeRun.progress.done / activeRun.progress.total) * 100)
      : 0;

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-white/10 flex items-center justify-center border border-white/15 text-sm">
              OL
            </div>
            <div>
              <h1 className="text-xl md:text-2xl font-semibold leading-tight">
                Outlight — Image Generator
              </h1>
              <p className="text-xs text-neutral-400 hidden md:block">
                Multi-model, parallel image generation with product library
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Guide button */}
            <button
              className="rounded-md bg-white/10 hover:bg-white/15 border border-white/20 px-3 py-1.5 text-sm"
              onClick={() => setGuideOpen(true)}
              title="Open the guide"
            >
              Guide
            </button>

            {/* Running indicator (compact) */}
            <div
              className={`hidden md:flex items-center gap-2 rounded-md border px-2 py-1 ${
                somethingRunning
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-white/15 bg-white/5"
              }`}
              title="Concurrent runs"
            >
              <span
                className={`inline-block h-2 w-2 rounded-full ${somethingRunning ? "bg-emerald-400 animate-pulse" : "bg-neutral-400"}`}
              />
              <span className="text-xs text-neutral-300">
                Runs: {runs.length}/3
              </span>
            </div>
          </div>
        </header>

        {/* Runs Dock */}
        <div className="rounded-lg border border-neutral-800 bg-neutral-950/60 p-2">
          <div className="flex flex-wrap items-center gap-2">
            {runs.length === 0 && (
              <div className="text-xs text-neutral-500 px-2 py-1">
                No runs yet. Configure your prompt(s) and click <span className="underline">Start Run</span>.
              </div>
            )}
            {runs.map((r) => {
              const pct =
                r.progress.total > 0
                  ? Math.round((r.progress.done / r.progress.total) * 100)
                  : 0;
              return (
                <div
                  key={r.id}
                  className={`group rounded-md border ${
                    activeRunId === r.id
                      ? "border-white/30 bg-white/5"
                      : "border-white/10 bg-black/20 hover:bg-black/30"
                  }`}
                >
                  <button
                    className="px-3 py-1.5 text-sm flex items-center gap-2"
                    onClick={() => setActiveRunId(r.id)}
                    title={`${r.name} — ${r.status}`}
                  >
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${statusColor(
                        r.status
                      )}`}
                    />
                    <span className="text-neutral-200">{r.name}</span>
                    {r.status === "running" && (
                      <span className="text-[11px] text-neutral-400">
                        {r.progress.done}/{r.progress.total}
                      </span>
                    )}
                  </button>
                  {/* micro progress */}
                  <div className="h-[3px] w-full bg-white/5">
                    <div
                      className={`h-[3px] ${r.status === "error" ? "bg-red-500" : "bg-white/70"}`}
                      style={{ width: `${pct}%` }}
                    />
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
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                      onClick={() => cancelRun(activeRun.id)}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                    onClick={() => zipRun(activeRun, false)}
                    title="Download all images in a ZIP"
                  >
                    ZIP all
                  </button>
                  <button
                    className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs disabled:opacity-50"
                    onClick={() => zipRun(activeRun, true)}
                    disabled={activeRun.selectedIdx.size === 0}
                    title="Download only selected images in a ZIP"
                  >
                    ZIP selected ({activeRun.selectedIdx.size})
                  </button>
                  <button
                    className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                    onClick={() => deleteRun(activeRun.id)}
                  >
                    Delete
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Two columns: Left (controls + reference), Right (prompt + results) */}
        <section className="grid md:grid-cols-3 gap-6">
          {/* LEFT COLUMN */}
          <div className="space-y-4 md:col-span-1">
            {/* Model */}
            <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
              <label className="text-sm text-neutral-300">Model</label>
              <select
                className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                value={modelId}
                onChange={(e) => setModelId(e.target.value)}
              >
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
              <select
                className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="custom">Custom (use your own image)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>

              {selectedId === "custom" && (
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
            {modelDef.provider === "seedream" && (
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-neutral-400">Image size</label>
                    <select
                      className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                      value={sdSize}
                      onChange={(e) => setSdSize(e.target.value as any)}
                    >
                      {IMAGE_SIZES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs text-neutral-400">Resolution</label>
                    <select
                      className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                      value={sdRes}
                      onChange={(e) => setSdRes(e.target.value as any)}
                    >
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
                      onChange={(e) =>
                        setSdMax(
                          Math.max(1, Math.min(6, Number(e.target.value || 1)))
                        )
                      }
                    />
                  </div>
                  <div>
                    <label className="text-xs text-neutral-400">Seed (optional)</label>
                    <input
                      type="number"
                      className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                      value={sdSeed}
                      onChange={(e) =>
                        setSdSeed(e.target.value === "" ? "" : Number(e.target.value))
                      }
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {referenceUrl ? (
                    <img
                      src={referenceUrl}
                      alt="Reference"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600 text-sm">
                      —
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN — prompt + results */}
          <div className="md:col-span-2 space-y-6">
            {/* Prompt + controls */}
            <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60 space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm text-neutral-300">
                  Prompt (each line = one image)
                </label>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-neutral-400">Speed</label>
                  <select
                    className="rounded-md bg-neutral-900 border border-neutral-800 p-2 text-sm"
                    value={speed}
                    onChange={(e) => setSpeed(Number(e.target.value) as 1 | 2 | 3)}
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
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
              />

              <div className="flex flex-wrap items-center gap-2">
                <button
                  className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                  onClick={onGenerateNewRun}
                  disabled={!referenceUrl || promptLines.length === 0}
                  title="Start a new run. Oldest of 3 will be removed automatically."
                >
                  Start Run ({promptLines.length || 0})
                </button>

                <button
                  className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2"
                  onClick={openLibrary}
                  title="Open Prompt Library"
                >
                  Prompt Library
                </button>

                {activeRun && (
                  <>
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2"
                      onClick={() => zipRun(activeRun, false)}
                      title="Download all images in a ZIP (organized by product folder)"
                    >
                      ZIP all
                    </button>
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2 disabled:opacity-50"
                      onClick={() => zipRun(activeRun, true)}
                      disabled={activeRun.selectedIdx.size === 0}
                      title="Download only selected images in a ZIP"
                    >
                      ZIP selected ({activeRun.selectedIdx.size})
                    </button>
                  </>
                )}
              </div>

              {activeRun && activeRun.progress.total > 0 && (
                <div className="h-1 w-full bg-neutral-800 rounded">
                  <div
                    className={`h-1 rounded ${activeRun.status === "error" ? "bg-red-500" : "bg-white/70"}`}
                    style={{ width: `${overallPct}%`, transition: "width .2s ease" }}
                  />
                </div>
              )}
            </div>

            {/* Results for active run */}
            {activeRun && activeRun.images.length > 0 && (
              <div className="grid md:grid-cols-3 gap-4 items-start">
                {/* Thumbnails */}
                <div className="md:col-span-1 self-start grid grid-cols-3 gap-[2px] place-content-start">
                  {activeRun.images.map((img, i) => {
                    const isActive = i === activeRun.activeIdx;
                    const isSelected = activeRun.selectedIdx.has(i);
                    return (
                      <div
                        key={img.id}
                        className="relative overflow-hidden rounded-[6px] border border-neutral-800"
                        style={{ aspectRatio: "1 / 1" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.imageDataUrl}
                          alt={`Result ${i + 1}`}
                          className={`absolute inset-0 block w-full h-full object-cover ${
                            isActive ? "ring-2 ring-white/40" : ""
                          }`}
                          onClick={() =>
                            setRuns((prev) =>
                              prev.map((r) =>
                                r.id === activeRun.id ? { ...r, activeIdx: i } : r
                              )
                            )
                          }
                        />
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(activeRun.id, i)}
                          className="absolute top-1 left-1 w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent
                                     checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                          title={isSelected ? "Deselect" : "Select"}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Main viewer + per-image actions */}
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
                        onChange={() =>
                          toggleSelect(activeRun.id, activeRun.activeIdx)
                        }
                        className="w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent
                                   checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                        title={
                          activeRun.selectedIdx.has(activeRun.activeIdx)
                            ? "Deselect"
                            : "Select"
                        }
                      />
                      <button
                        onClick={() => {
                          const baseProduct = safeName(activeRun.productName || "product");
                          const baseModel = safeName(activeRun.modelNameDisplay);
                          const id =
                            activeRun.images[activeRun.activeIdx]?.id ||
                            `${Date.now()}-${activeRun.activeIdx + 1}`;
                          const filename = `${baseProduct}_${baseModel}_${id}.png`;
                          downloadDataUrl(
                            activeRun.images[activeRun.activeIdx].imageDataUrl,
                            filename
                          );
                        }}
                        className="rounded-md bg-black/60 hover:bg-black/75 border border-white/30 text-white text-sm px-3 py-1"
                        title="Download image"
                      >
                        ⬇︎ Download
                      </button>
                    </div>
                  </div>

                  {/* Prompt card */}
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="shrink-0 text-sm font-medium text-neutral-100">
                        Prompt
                      </div>
                      <div className="flex gap-2">
                        <button
                          className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                          onClick={() =>
                            copyPromptToClipboard(
                              activeRun.images[activeRun.activeIdx].prompt
                            )
                          }
                          title="Copy prompt to clipboard"
                        >
                          Copy
                        </button>
                        <button
                          className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                          onClick={() =>
                            saveSinglePrompt(
                              activeRun.images[activeRun.activeIdx].prompt
                            )
                          }
                          title="Save this prompt to library"
                        >
                          Save
                        </button>
                        <button
                          className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                          onClick={() =>
                            downloadPromptTxt(
                              activeRun.images[activeRun.activeIdx].prompt,
                              activeRun.images[activeRun.activeIdx].id
                            )
                          }
                          title="Download prompt as .txt"
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
            )}

            {/* If no images yet but we do have an active run, show its status */}
            {activeRun && activeRun.images.length === 0 && (
              <div className="text-sm text-neutral-400">
                {activeRun.status === "running"
                  ? "Generating…"
                  : activeRun.status === "error"
                  ? `Run error: ${activeRun.error || "Unknown error"}`
                  : activeRun.status === "cancelled"
                  ? "Run cancelled."
                  : "No images in this run yet."}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Floating mini-indicator (mobile / always-on) */}
      <div className="fixed bottom-4 right-4 md:hidden">
        <div
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 shadow-lg border ${
            runs.some((r) => r.status === "running")
              ? "border-emerald-500/30 bg-neutral-900/90"
              : "border-white/10 bg-neutral-900/80"
          }`}
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${runs.some((r) => r.status === "running") ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"}`}
          />
          <span className="text-xs text-neutral-200">Runs {runs.length}/3</span>
        </div>
      </div>

      {/* Prompt Library Panel */}
      {libOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="ml-auto h-full w-full max-w-xl bg-neutral-950 border-l border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Prompt Library</h2>
              <button
                className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1"
                onClick={() => setLibOpen(false)}
              >
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
              <button
                className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3"
                onClick={openLibrary}
              >
                Search
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-2">
              {libLoading && (
                <div className="text-sm text-neutral-400">Loading…</div>
              )}
              {!libLoading && libItems.length === 0 && (
                <div className="text-sm text-neutral-500">No prompts yet.</div>
              )}
              {libItems.map((it) => (
                <div
                  key={it.id}
                  className="rounded-md border border-neutral-800 p-2 hover:bg-white/5"
                >
                  <div className="text-xs text-neutral-500 mb-1">
                    {it.product_name || "Any"} • {it.model_name} •{" "}
                    {new Date(it.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{it.prompt}</div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                        onClick={() =>
                          setPromptsText((prev) =>
                            prev ? prev + "\n" + it.prompt : it.prompt
                          )
                        }
                      >
                        Insert
                      </button>
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                        onClick={() => setPromptsText(it.prompt)}
                      >
                        Replace
                      </button>
                    </div>

                    <button
                      className="rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-300 px-2 py-1 text-sm"
                      onClick={async () => {
                        if (!confirm("Delete this saved prompt?")) return;
                        const res = await fetch(`/api/prompts/${it.id}`, {
                          method: "DELETE",
                        });
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

      {/* Product Manager Panel */}
      {prodOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="ml-auto h-full w-full max-w-xl bg-neutral-950 border-l border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">
                {prodForm.id ? "Edit Product" : "Add Product"}
              </h2>
              <button
                className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1"
                onClick={() => setProdOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-sm text-neutral-300">Name</label>
                <input
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={prodForm.name}
                  onChange={(e) =>
                    setProdForm((f) => ({ ...f, name: e.target.value }))
                  }
                  placeholder="Awesome Lamp"
                />
              </div>

              <div>
                <label className="text-sm text-neutral-300">Slug</label>
                <input
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={prodForm.slug}
                  onChange={(e) =>
                    setProdForm((f) => ({ ...f, slug: e.target.value }))
                  }
                  placeholder="awesome-lamp"
                />
                <p className="mt-1 text-[11px] text-neutral-500">
                  Leave blank to auto-generate from name.
                </p>
              </div>

              <div>
                <label className="text-sm text-neutral-300">Image URL</label>
                <input
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={prodForm.image_url}
                  onChange={(e) =>
                    setProdForm((f) => ({ ...f, image_url: e.target.value }))
                  }
                  placeholder="https://.../image.jpg"
                />
              </div>

              {prodError && <div className="text-sm text-red-400">{prodError}</div>}

              <div className="flex items-center gap-2">
                <button
                  className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                  onClick={saveProduct}
                  disabled={prodSaving}
                >
                  {prodSaving
                    ? "Saving…"
                    : prodForm.id
                    ? "Update Product"
                    : "Add Product"}
                </button>

                {prodForm.id && (
                  <button
                    className="rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-300 px-3 py-2"
                    onClick={() => prodForm.id && deleteProduct(prodForm.id!)}
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
              {products.length === 0 && (
                <div className="text-sm text-neutral-500">No products yet.</div>
              )}
              {products.map((p) => (
                <div
                  key={p.id}
                  className="rounded-md border border-neutral-800 p-2 hover:bg-white/5 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">
                      {p.name}
                    </div>
                    <div className="text-xs text-neutral-500 truncate">{p.slug}</div>
                    <div className="text-[11px] text-neutral-500 truncate">
                      {p.image_url}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                      onClick={() => editProduct(p)}
                    >
                      Edit
                    </button>
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                      onClick={() => {
                        setSelectedId(p.id);
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

      {/* Guide Panel */}
      {guideOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="mx-auto my-6 h-[92vh] w/full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-neutral-800 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Outlight Guide</h2>
              <button
                className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1"
                onClick={() => setGuideOpen(false)}
              >
                Close
              </button>
            </div>
            <div className="p-4 space-y-4 overflow-auto text-sm leading-6 text-neutral-200">
              <section>
                <h3 className="font-semibold text-neutral-100">Overview</h3>
                <p>
                  Outlight is a multi-model image generator with parallel execution
                  and product-based reference images. You can keep up to{" "}
                  <b>3 concurrent runs</b>, each with its own prompts, progress,
                  and results.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Basic Flow</h3>
                <ol className="list-decimal ml-5 space-y-1">
                  <li>Select a <b>Model</b> and a <b>Product</b> (or paste a Custom URL).</li>
                  <li>Enter one or more prompts (one per line).</li>
                  <li>Choose <b>Speed</b> (1–3 parallel requests).</li>
                  <li>Click <b>Start Run</b>. Results appear as they finish.</li>
                </ol>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Runs</h3>
                <p>
                  The runs dock shows all active and recent runs. Each chip displays
                  status and a micro progress bar. Switch between runs, cancel a
                  running run, or delete a run. Starting a 4th run removes the oldest
                  (cancelled if still running).
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Products</h3>
                <p>
                  Use <b>Manage</b> to add, edit, or delete products. Selecting a
                  product uses its image as the reference for generation.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Prompt Library</h3>
                <p>
                  Save prompts tied to a product and model, search and reuse them.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Download as ZIP</h3>
                <p>
                  Use <b>ZIP all</b> or <b>ZIP selected</b> to download results
                  organized into a folder named after the product. A manifest file
                  is included with prompts and metadata.
                </p>
              </section>

              <section>
                <h3 className="font-semibold text-neutral-100">Tips</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Speed 2–3 increases throughput but may hit provider rate limits.</li>
                  <li>For Seedream, set image size/resolution/max images/seed.</li>
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
