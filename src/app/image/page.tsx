"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import {
  MODEL_LIST,
  getModelById,
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
  NANOBANANA_ASPECT_RATIOS,
  NANOBANANA_RESOLUTIONS,
} from "@/lib/models";
import { consumeStudioIntent, StudioIntent } from "@/lib/studio-intent";
import { PromptAssistant } from "@/components/PromptAssistant";

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
  // productId: string | null; // Removed, as we're handling all references as custom
  // productName: string;     // Removed
  // referenceUrl: string;    // Removed
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
      return "text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-500/10 dark:ring-emerald-500/20";
    case "done":
      return "text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/30 ring-indigo-500/10 dark:ring-indigo-500/20";
    case "cancelled":
      return "text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 ring-slate-500/10 dark:ring-slate-500/20";
    case "error":
      return "text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/30 ring-rose-500/10 dark:ring-rose-500/20";
    default:
      return "text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 ring-slate-500/10 dark:ring-slate-500/20";
  }
}

export default function ImageStudioPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  // const [selectedId, setSelectedId] = useState<string>("custom"); // Removed
  const [customUrl, setCustomUrl] = useState("");
  const [customUrls, setCustomUrls] = useState<string[]>([]);
  const [customUploads, setCustomUploads] = useState<string[]>([]);
  // const [extraRefUrls, setExtraRefUrls] = useState<string[]>([]); // Removed
  // const [extraRefUploads, setExtraRefUploads] = useState<string[]>([]); // Removed
  const [modelId, setModelId] = useState<string>("nanobanana-3-pro");
  const modelDef = useMemo(() => getModelById(modelId)!, [modelId]);
  const modelNameDisplay = `${modelDef.label}`;
  const [nbAspectRatio, setNbAspectRatio] = useState<string>(
    modelDef.aspectRatioOptions?.[0] || NANOBANANA_ASPECT_RATIOS[0]
  );
  const [nbResolution, setNbResolution] = useState<string>(
    modelDef.resolutionOptions?.[0] || NANOBANANA_RESOLUTIONS[0]
  );
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
  const [showNanoGuide, setShowNanoGuide] = useState(false);
  
  // Product Creation State
  // const [newProduct, setNewProduct] = useState({ name: "", image_url: "" }); // Removed
  // const [creatingProduct, setCreatingProduct] = useState(false); // Removed
  
  const [showRefProductModal, setShowRefProductModal] = useState(false);
  const [refSearchQuery, setRefSearchQuery] = useState("");

  // const selectedProduct = useMemo(
  //   () => products.find((product) => product.id === selectedId),
  //   [products, selectedId]
  // );
  const productName = "Custom"; // Simplified

  // const [selectedProduct, setSelectedProduct] = useState<Product | undefined>(undefined); // Removed
  // const productName = "Custom"; // Simplified
  // const referenceUrl = customUrl.trim(); // Simplified
  const modelRequiresReference = modelDef.requiresReference !== false;
  const isNanoBanana = modelDef.provider === "nanobanana";
  const isNanoBananaPro = modelDef.id === "nanobanana-3-pro";
  const nanoAspectOptions = modelDef.aspectRatioOptions || Array.from(NANOBANANA_ASPECT_RATIOS);
  const nanoResolutionOptions = modelDef.resolutionOptions || Array.from(NANOBANANA_RESOLUTIONS);
  const hasRefs = customUrl.trim().length > 0 || customUploads.length > 0 || customUrls.some((url) => (url || "").trim().length > 0);
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
  }, [customUploads, customUrl, customUrls]);

  function removeUploadSrc(src: string) {
    setCustomUploads((prev) => prev.filter((u) => u !== src));
    setCustomUrls((prev) => prev.filter((u) => u !== src));
  }

  useEffect(() => {
    if (modelDef.aspectRatioOptions?.length) {
      const fallback = modelDef.aspectRatioOptions[0];
      setNbAspectRatio((prev) =>
        modelDef.aspectRatioOptions && modelDef.aspectRatioOptions.includes(prev) ? prev : fallback
      );
    }
    if (modelDef.resolutionOptions?.length) {
      const fallback = modelDef.resolutionOptions[0];
      setNbResolution((prev) =>
        modelDef.resolutionOptions && modelDef.resolutionOptions.includes(prev) ? prev : fallback
      );
    }
  }, [modelDef]);

  useEffect(() => {
    loadProducts();
  }, []);

  async function loadProducts() {
    try {
      setProductsLoading(true);
      const res = await fetch("/api/products");
      const json = await res.json();
      if (res.ok) setProducts(json.products || []);
    } finally {
      setProductsLoading(false);
    }
  }
  
  // async function handleAddProduct() {
  //     if (!newProduct.name || !newProduct.image_url) return;
  //     setCreatingProduct(true);
  //     try {
  //         const res = await fetch("/api/products", {
  //             method: "POST",
  //             headers: { "Content-Type": "application/json" },
  //             body: JSON.stringify(newProduct)
  //         });
  //         const json = await res.json();
  //         if(!res.ok) throw new Error(json.error || "Failed to create product");
          
  //         setProducts(prev => [...prev, json.product].sort((a,b) => a.name.localeCompare(b.name)));
  //         setSelectedId(json.product.id);
  //         setShowProductModal(false);
  //         setNewProduct({ name: "", image_url: "" });
  //         setSaveToast({ message: "Product created", type: "success" });
  //     } catch (e: any) {
  //         setSaveToast({ message: e.message, type: "error" });
  //     } finally {
  //         setCreatingProduct(false);
  //     }
  // }

  useEffect(() => {
    if (!saveToast) return;
    const timer = setTimeout(() => setSaveToast(null), 3000);
    return () => clearTimeout(timer);
  }, [saveToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
          if (refPreviewUrl) setRefPreviewUrl(null);
          // if (showProductModal) setShowProductModal(false); // Removed
          if (showRefProductModal) setShowRefProductModal(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refPreviewUrl, showRefProductModal]);

  useEffect(() => {
    const intent = consumeStudioIntent();
    if (intent && intent.type === "prompts") {
      setPromptsText((prev) => {
        const existing = prev.trim().length > 0 ? `${prev.trimEnd()}\n` : "";
        return `${existing}${intent.prompts.join("\n")}`;
      });
      setSaveToast({ message: `Imported ${intent.prompts.length} prompts`, type: "success" });
    } else if (intent && intent.type === "reference") {
      void fetch(`/api/saved-images/${intent.id}`).then(async (res) => {
         if(res.ok) {
             const json = await res.json();
             if(json.image?.image_data) {
                 // setSelectedId("custom"); // Removed
                 setCustomUploads(prev => [json.image.image_data, ...prev]);
                 setSaveToast({ message: "Reference imported", type: "success" });
             }
         }
      });
    }
  }, []);

  async function saveSinglePrompt(prompt: string) {
    if (!prompt.trim()) return;
    try {
      const res = await fetch("/api/prompts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productId: null,
          productName: "Custom",
          modelName: modelNameDisplay,
          prompts: [prompt],
        }),
      });
      if (!res.ok) throw new Error("Failed to save prompt");
      setSaveToast({ message: "Prompt saved", type: "success" });
    } catch (error: any) {
      setSaveToast({ message: error.message, type: "error" });
    }
  }

  async function saveImageToLibrary(imageDataUrl: string, prompt: string) {
      try {
      const res = await fetch("/api/saved-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageData: imageDataUrl,
          prompt,
          modelName: modelNameDisplay,
          productId: null,
          productName: "Custom",
          referenceUrl: refSources[0] || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save image");
      setSaveToast({ message: "Image saved", type: "success" });
    } catch (error: any) {
      setSaveToast({ message: error.message, type: "error" });
    }
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
      if (activeRunId === runId) setActiveRunId(filtered[0]?.id ?? null);
      return filtered;
    });
  }

  function clearRuns() {
    setRuns([]);
    setActiveRunId(null);
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

    const folderName = safeName(run.name);
    const zip = new JSZip();
     const manifest = [
      `Run: ${run.name}`,
      `Model: ${run.modelNameDisplay}`,
      `Product: Custom References`,
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
    if (!canStartRun) return;

    setRuns((prev) => {
      if (prev.length < MAX_CONCURRENT_RUNS) return prev;
      const sorted = [...prev].sort((a, b) => a.startedAt - b.startedAt);
      const oldest = sorted[0];
      oldest.controller?.abort();
      return prev.filter((run) => run.id !== oldest.id);
    });

    const id = crypto.randomUUID();
    const ordinal = runs.length > 0 ? Math.max(...runs.map((run) => Number(run.name.replace(/\D/g, "")) || 0)) + 1 : 1;
    const runName = `Run #${ordinal}`;
    const controller = new AbortController();
    const primaryRef = refSources[0] || "";

    const newRun: Run = {
      id,
      name: runName,
      startedAt: Date.now(),
      modelId,
      modelNameDisplay,
      // productId: null, // No longer tracked in Run type
      // productName: "Custom", // No longer tracked in Run type
      // referenceUrl: primaryRef, // No longer tracked in Run type
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

    void runGenerator(newRun, refSources);
  }
  
    async function runGenerator(run: Run, currentRefSources: string[]) {
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
              customUrls: currentRefSources,
              prompt,
              options: (() => {
                const runModel = getModelById(run.modelId);
                if (!runModel) return undefined;
                if (runModel.provider === "seedream") {
                  return {
                    image_size: sdSize,
                    image_resolution: sdRes,
                    max_images: sdMax,
                    seed: sdSeed === "" ? null : sdSeed,
                  };
                }
                if (runModel.id === "nanobanana-3-pro") {
                  return {
                    aspect_ratio: nbAspectRatio,
                    image_size: nbResolution,
                  };
                }
                return undefined;
              })(),
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
    <div className="min-h-screen bg-[#fcfcfc] dark:bg-black p-4 lg:p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-6 flex items-center justify-between">
           <div className="flex items-center gap-3">
               <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Image Studio</h1>
               <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
               <div className="flex gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                   <span>Runs: {runs.length}</span>
                   <span className="text-slate-300 dark:text-slate-600">|</span>
                   <span>Active: {runs.filter(r => r.status === "running").length}</span>
               </div>
           </div>
           <Link href="/library" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
             View Library &rarr;
           </Link>
        </div>

        {/* Grid Layout Update: Wider Center Column */}
        <div className="grid gap-6 lg:grid-cols-[320px_640px_minmax(0,1fr)] items-start">
          
          {/* Column 1: Configuration */}
          <div className="space-y-6">
             <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                 <div className="mb-4 flex items-center justify-between gap-2">
                   <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Model</h2>
                   {isNanoBananaPro && (
                     <button
                       onClick={() => setShowNanoGuide(true)}
                       className="group relative flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 shadow-sm hover:border-emerald-300 hover:bg-emerald-100 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200"
                       title="What's new in Nano Banana?"
                     >
                       <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" aria-hidden />
                       <span>Nano guide</span>
                     </button>
                   )}
                 </div>
                 <div className="space-y-3">
                    {MODEL_LIST.map(model => (
                        <button
                          key={model.id}
                          onClick={() => setModelId(model.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border text-left text-sm transition-all ${modelId === model.id
                              ? "border-indigo-600 dark:border-indigo-500 ring-1 ring-indigo-600 dark:ring-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-300"
                              : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300"
                          }`}
                        >
                            <span className="font-medium">{model.label}</span>
                            <span className="text-[10px] uppercase text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">{model.version}</span>
                        </button>
                    ))}
                 </div>

                  {isNanoBananaPro && (
                <div className="mt-4 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Aspect Ratio</label>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                            value={nbAspectRatio}
                            onChange={(e) => setNbAspectRatio(e.target.value)}
                        >
                            {nanoAspectOptions.map((ratio) => (
                              <option key={ratio} value={ratio}>{ratio}</option>
                            ))}
                        </select>
                    </div>
                     <div>
                        <label className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Resolution</label>
                         <select
                            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                            value={nbResolution}
                            onChange={(e) => setNbResolution(e.target.value)}
                        >
                            {nanoResolutionOptions.map((res) => (
                              <option key={res} value={res}>{res}</option>
                            ))}
                        </select>
                    </div>
                  </div>
                  <p className="text-[10px] leading-relaxed text-slate-500 dark:text-slate-400">
                    Flash keeps output at 1K; Pro unlocks 2K & 4K. Aspect ratios match Gemini guidance (square, portrait, landscape, ultrawide).
                  </p>
                </div>
              )}

                  {modelDef.provider === "seedream" && (
                <div className="mt-4 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Ratio</label>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                            value={sdSize}
                            onChange={(e) => setSdSize(e.target.value as any)}
                        >
                            {IMAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Quality</label>
                         <select
                            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs font-medium text-slate-900 dark:text-slate-100"
                            value={sdRes}
                            onChange={(e) => setSdRes(e.target.value as any)}
                        >
                            {IMAGE_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                  </div>
                   <div>
                      <label className="text-[10px] font-semibold uppercase text-slate-400 dark:text-slate-500">Seed</label>
                      <input 
                         type="number" 
                         placeholder="Random"
                         className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs font-medium placeholder:text-slate-400 text-slate-900 dark:text-slate-100"
                         value={sdSeed}
                         onChange={(e) => setSdSeed(e.target.value === "" ? "" : Number(e.target.value))}
                      />
                   </div>
                </div>
              )}
             </div>

             <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                 <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Context</h2>
                    {modelRequiresReference && (
                        <span className={`h-2 w-2 rounded-full ${hasRefs ? "bg-emerald-500" : "bg-rose-500"}`} />
                    )}
                 </div>
                 
                 <div className="space-y-4">
                     {/* Removed Subject / Product section */} 

                     {/* References Section */}
                     <div className="space-y-3">
                        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400">Reference Images</label>
                        
                             <input 
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                                placeholder="Paste image URL..."
                                value={customUrl}
                                onChange={(e) => setCustomUrl(e.target.value)}
                             />

                         <div className="grid grid-cols-4 gap-2">
                            <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 transition" title="Upload Images">
                                <span className="text-2xl text-slate-300 dark:text-slate-600">+</span>
                                <input 
                                    type="file" 
                                    className="hidden" 
                                    multiple 
                                    accept="image/*"
                                    onChange={async (e) => {
                                        const urls = await filesToDataUrls(e.target.files);
                                        setCustomUploads(prev => [...prev, ...urls]);
                                    }}
                                />
                            </label>
                            <button 
                                onClick={() => setShowRefProductModal(true)}
                                className="group flex aspect-square flex-col items-center justify-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-indigo-500 dark:hover:border-indigo-500 hover:ring-1 hover:ring-indigo-500 transition shadow-sm"
                                title="Browse Product Library"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 text-slate-400 group-hover:text-indigo-500 transition">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
                                </svg>
                                <span className="text-[9px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide group-hover:text-indigo-600 dark:group-hover:text-indigo-400">Library</span>
                            </button>
                            {refSources.map((src, i) => (
                                <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={src} className="h-full w-full object-cover" alt="" />
                                    <button
                                        type="button"
                                        onClick={() => setRefPreviewUrl(src)}
                                        className="absolute inset-0"
                                        aria-label="Preview reference"
                                    />
                                    <button 
                                        type="button"
                                        onClick={(e) => {
                                             e.stopPropagation();
                                             if (src === customUrl) {
                                                 setCustomUrl("");
                                             } else {
                                                 removeUploadSrc(src);
                                             }
                                        }}
                                        className="absolute inset-0 z-10 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition text-white text-xs"
                                    >
                                        Remove
                                    </button>
                                </div>
                            ))}
                         </div>
                         {refSources.length === 0 && (
                            <p className="text-[10px] text-slate-400 italic">No references selected.</p>
                         )}
                     </div>
                 </div>
             </div>
          </div>

          {/* Column 2: Creation */}
          <div className="flex flex-col gap-6 h-[calc(100vh-120px)]">
             <div className="flex-1 flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
                     <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Prompt Engineering</h2>
                     <div className="flex items-center gap-2">
                        <PromptAssistant 
                            onAccept={(newPrompts, mode) => {
                                if (mode === "replace") {
                                    setPromptsText(newPrompts.join("\n"));
                                } else {
                                    setPromptsText(prev => {
                                        const prefix = prev.trim() ? prev.trim() + "\n" : "";
                                        return prefix + newPrompts.join("\n");
                                    });
                                }
                            }}
                        />
                         <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                         <select 
                            className="bg-transparent text-xs font-medium text-slate-600 dark:text-slate-400 focus:outline-none dark:bg-slate-900"
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value) as RunSpeed)}
                        >
                            {RUN_SPEED_OPTIONS.map(s => <option key={s} value={s}>Speed {s}x</option>)}
                        </select>
                     </div>
                </div>
                <textarea 
                    className="flex-1 w-full resize-none p-4 text-sm outline-none text-slate-700 dark:text-slate-300 placeholder:text-slate-300 dark:placeholder:text-slate-600 font-mono leading-relaxed bg-white dark:bg-slate-900"
                    placeholder={`Describe your image generation tasks here.\nOne prompt per line.\n\nExample:\nplace this exact light source top-left, creating soft shadows on the product.`}
                    value={promptsText}
                    onChange={(e) => setPromptsText(e.target.value)}
                />
                <div className="p-3 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-400 dark:text-slate-500 font-medium">{promptLines.length} prompt{promptLines.length !== 1 ? 's' : ''} ready</span>
                    <button
                        onClick={onGenerateNewRun}
                        disabled={!canStartRun}
                        className="px-6 py-2 bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
                    >
                        Start Generation
                    </button>
                </div>
             </div>
          </div>

          {/* Column 3: Feed / Results */}
          <div className="flex flex-col gap-4 h-[calc(100vh-120px)]">
            {/* Active Run Card */}
            {activeRun ? (
                 <div className="flex flex-col flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                        <div className="flex items-center justify-between mb-2">
                             <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{activeRun.name}</span>
                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ring-1 ring-inset ${statusColor(activeRun.status)}`}>
                                 {activeRun.status}
                             </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                             <div className="h-full bg-slate-900 dark:bg-slate-50 transition-all duration-500" style={{ width: `${overallPct}%` }} />
                        </div>
                         <div className="mt-2 flex justify-between text-[10px] text-slate-500 dark:text-slate-400">
                             <span>{activeRun.modelNameDisplay}</span>
                             <span>{activeRun.progress.done} / {activeRun.progress.total}</span>
                        </div>
                    </div>

                    <div className="flex-1 min-h-0 flex flex-col gap-4 p-4 bg-slate-50/30 dark:bg-slate-950/30 overflow-y-auto">
                        {activeRun.images.length > 0 ? (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Generated gallery</span>
                              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300">{activeRun.activeIdx + 1} of {activeRun.images.length}</span>
                            </div>

                            <div className="flex gap-2 overflow-x-auto pb-2 -mx-1 px-1 border-b border-slate-100 dark:border-slate-800">
                              {activeRun.images.map((img, idx) => (
                                <button
                                  key={img.id}
                                  onClick={() => {
                                    setRuns(prev => prev.map(r => r.id === activeRun.id ? { ...r, activeIdx: idx } : r));
                                  }}
                                  className={`relative flex-none h-20 w-20 rounded-md overflow-hidden border transition ${activeRun.activeIdx === idx
                                    ? "border-slate-900 dark:border-slate-50 ring-1 ring-slate-900 dark:ring-slate-50"
                                    : "border-slate-200 dark:border-slate-700 opacity-70 hover:opacity-100"}`}
                                >
                                  {/* eslint-disable-next-line @next/next/no-img-element */}
                                  <img src={img.imageDataUrl} className="h-full w-full object-cover" alt="" />
                                </button>
                              ))}
                            </div>

                            <div className="flex items-center justify-end gap-2">
                              <button onClick={() => stepActiveImage(activeRun.id, -1)} className="p-2 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">&larr; Prev</button>
                              <button onClick={() => stepActiveImage(activeRun.id, 1)} className="p-2 rounded-md bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition">Next &rarr;</button>
                            </div>

                            <div className="flex-1 min-h-0 flex flex-col gap-3">
                              <div className="relative flex-1 min-h-[340px] rounded-xl overflow-hidden bg-slate-200 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={activeRun.images[activeRun.activeIdx].imageDataUrl} className="h-full w-full object-contain" alt="" />
                                <div className="absolute top-3 right-3 flex flex-wrap gap-2">
                                  <button onClick={() => saveImageToLibrary(activeRun.images[activeRun.activeIdx].imageDataUrl, activeRun.images[activeRun.activeIdx].prompt)} className="bg-white/90 dark:bg-black/80 hover:bg-white dark:hover:bg-black text-slate-900 dark:text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-full shadow">Save</button>
                                  <button onClick={() => downloadDataUrl(activeRun.images[activeRun.activeIdx].imageDataUrl, `${safeName(productName)}_${safeName(modelNameDisplay)}_${Date.now()}.png`)} className="bg-white/90 dark:bg-black/80 hover:bg-white dark:hover:bg-black text-slate-900 dark:text-slate-100 text-xs font-semibold px-3 py-1.5 rounded-full shadow">Download</button>
                                </div>
                              </div>

                              <div className="max-h-24 overflow-y-auto bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                {activeRun.images[activeRun.activeIdx].prompt}
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                            <div className="h-8 w-8 border-2 border-slate-200 dark:border-slate-700 border-t-slate-400 dark:border-t-slate-500 rounded-full animate-spin" />
                            <span className="text-xs">Processing...</span>
                          </div>
                        )}
                    </div>
                    
                    <div className="p-3 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex gap-2 justify-end">
                        <button onClick={() => zipRun(activeRun, false)} className="text-xs font-medium text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 px-3 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800">Download All Zip</button>
                    </div>
                 </div>
            ) : (
                <div className="flex-1 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-center text-slate-400 text-sm">
                    No active run
                </div>
            )}
            
            {/* Run Queue / History List (Mini) */}
            <div className="h-52 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 overflow-y-auto shadow-sm">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">History</h3>
                  <button
                    onClick={clearRuns}
                    disabled={runs.length === 0}
                    className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 hover:text-rose-500 disabled:opacity-40 disabled:cursor-not-allowed"
                    title="Clear all history"
                  >
                    Clear all
                  </button>
                </div>
                <div className="space-y-1">
                    {runs.map(run => (
                        <div key={run.id} 
                             onClick={() => setActiveRunId(run.id)}
                             className={`group flex items-center justify-between p-2 rounded-md border cursor-pointer transition ${activeRunId === run.id ? 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600' : 'bg-white dark:bg-slate-900 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <div className={`h-2 w-2 rounded-full ${run.status === 'running' ? 'bg-emerald-500 animate-pulse' : run.status === 'error' ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{run.name}</span>
                                <span className="text-[10px] text-slate-400">({run.images.length})</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); deleteRun(run.id); }}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-rose-500 px-1"
                            >
                                x
                            </button>
                        </div>
                    ))}
                    {runs.length === 0 && <p className="text-[10px] text-slate-400 italic">No recent runs.</p>}
                </div>
            </div>

          </div>

        </div>
      </div>
      
      {showNanoGuide && isNanoBananaPro && (
        <div
          className="fixed inset-0 z-[60] flex items-start justify-end bg-black/30 p-4 backdrop-blur-sm"
          onClick={() => setShowNanoGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-emerald-100 bg-white shadow-2xl ring-1 ring-emerald-400/20 dark:border-emerald-500/30 dark:bg-slate-900 dark:ring-emerald-400/10"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-emerald-100/60 px-4 py-3 dark:border-emerald-500/20">
              <div>
                <p className="text-sm font-semibold text-slate-900 dark:text-white">Nano Banana quick guide</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Tap options to match Gemini image controls.</p>
              </div>
              <button
                onClick={() => setShowNanoGuide(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                aria-label="Close Nano guide"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M6 18L18 6" />
                </svg>
              </button>
            </div>
            <div className="space-y-3 px-4 py-3 text-xs text-slate-700 dark:text-slate-300">
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-emerald-500" />
                <p><span className="font-semibold">Aspect ratios:</span> 1:1, 4:3, 3:2, 4:5, 9:16, 16:9, 21:9 and more. Pick one before you generate.</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-indigo-500" />
                <p><span className="font-semibold">Resolution:</span> Flash stays at 1K (1024px). Pro unlocks 2K & 4K; stick to uppercase "K".</p>
              </div>
              <div className="flex items-start gap-2">
                <span className="mt-0.5 h-2 w-2 rounded-full bg-slate-400" />
                <p><span className="font-semibold">Best prompts:</span> describe the scene, lighting, and intent; mention text you want rendered. References are optional for Nano Banana.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Product Creation Modal */}
      {/* Removed Product Creation Modal */}

      {/* Reference Selection Modal (Select Products) */}
      {showRefProductModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
            <div className="w-full max-w-4xl flex flex-col max-h-[85vh] rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-50/10 overflow-hidden">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
                    <div className="flex items-center gap-4 flex-1">
                         <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">Product Library</h3>
                         <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                         <div className="relative flex-1 max-w-md">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="absolute left-2.5 top-2.5 w-4 h-4 text-slate-400">
                                <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
                            </svg>
                            <input 
                                type="text"
                                placeholder="Search products..."
                                className="w-full bg-slate-100 dark:bg-slate-800 text-sm text-slate-900 dark:text-white pl-9 pr-4 py-2 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 placeholder:text-slate-500"
                                autoFocus
                                value={refSearchQuery}
                                onChange={(e) => setRefSearchQuery(e.target.value)}
                            />
                         </div>
                    </div>
                    <button 
                        onClick={() => setShowRefProductModal(false)} 
                        className="ml-4 p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                          <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
                        </svg>
                    </button>
                </div>

                {/* Modal Body (Grid) */}
                <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-950/50">
                    {products.filter(p => !refSearchQuery || p.name.toLowerCase().includes(refSearchQuery.toLowerCase())).length > 0 ? (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
                            {products
                                .filter(p => !refSearchQuery || p.name.toLowerCase().includes(refSearchQuery.toLowerCase()))
                                .map(product => (
                                <button
                                    key={product.id}
                                    onClick={() => {
                                        if (product.image_url) {
                                            setCustomUrls(prev => [...prev, product.image_url]);
                                            setShowRefProductModal(false);
                                            setRefSearchQuery(""); // Clear search on selection
                                        }
                                    }}
                                    className="group flex flex-col gap-2 text-left outline-none"
                                >
                                    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800 shadow-sm transition-all group-hover:border-indigo-500 dark:group-hover:border-indigo-500 group-hover:shadow-md group-hover:ring-2 group-hover:ring-indigo-500/20">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img 
                                            src={product.image_url} 
                                            className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-110" 
                                            alt="" 
                                            loading="lazy"
                                        />
                                        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
                                        {/* Selection Indicator Overlay */}
                                        <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                            <div className="bg-white/90 dark:bg-black/80 text-indigo-600 dark:text-indigo-400 rounded-full p-1.5 shadow-lg transform scale-90 group-hover:scale-100 transition-transform">
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                                                  <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="px-1">
                                        <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                                            {product.name}
                                        </p>
                                        <p className="truncate text-[10px] text-slate-400">
                                            {product.slug}
                                        </p>
                                    </div>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="flex h-64 flex-col items-center justify-center text-center">
                            <div className="mb-4 rounded-full bg-slate-100 dark:bg-slate-800 p-4">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-slate-400">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                                </svg>
                            </div>
                            <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No products found</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">Try searching for something else.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
      )}

      {/* Preview Modal (Shared for Refs & Product) */}
      {refPreviewUrl && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setRefPreviewUrl(null)}
        >
          <div
            className="relative max-h-full max-w-5xl overflow-hidden rounded-xl bg-transparent"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setRefPreviewUrl(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={refPreviewUrl} alt="Preview" className="max-h-[90vh] w-auto rounded-lg shadow-2xl" />
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {saveToast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all transform translate-y-0 ${saveToast.type === 'success' ? 'bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900' : 'bg-rose-600 text-white'}`}>
          {saveToast.message}
        </div>
      )}
    </div>
  );
}

