"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import JSZip from "jszip";
import { MODEL_LIST, getModelById, IMAGE_RESOLUTIONS, IMAGE_SIZES } from "@/lib/models";
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
      return "text-emerald-600 bg-emerald-50 ring-emerald-500/10";
    case "done":
      return "text-indigo-600 bg-indigo-50 ring-indigo-500/10";
    case "cancelled":
      return "text-slate-600 bg-slate-50 ring-slate-500/10";
    case "error":
      return "text-rose-600 bg-rose-50 ring-rose-500/10";
    default:
      return "text-slate-600 bg-slate-50 ring-slate-500/10";
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
  const modelNameDisplay = `${modelDef.label}`;
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
  
  // Product Creation State
  const [showProductModal, setShowProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState({ name: "", image_url: "" });
  const [creatingProduct, setCreatingProduct] = useState(false);

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
  
  async function handleAddProduct() {
      if (!newProduct.name || !newProduct.image_url) return;
      setCreatingProduct(true);
      try {
          const res = await fetch("/api/products", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(newProduct)
          });
          const json = await res.json();
          if(!res.ok) throw new Error(json.error || "Failed to create product");
          
          setProducts(prev => [...prev, json.product].sort((a,b) => a.name.localeCompare(b.name)));
          setSelectedId(json.product.id);
          setShowProductModal(false);
          setNewProduct({ name: "", image_url: "" });
          setSaveToast({ message: "Product created", type: "success" });
      } catch (e: any) {
          setSaveToast({ message: e.message, type: "error" });
      } finally {
          setCreatingProduct(false);
      }
  }

  useEffect(() => {
    if (!saveToast) return;
    const timer = setTimeout(() => setSaveToast(null), 3000);
    return () => clearTimeout(timer);
  }, [saveToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
          if (refPreviewUrl) setRefPreviewUrl(null);
          if (showProductModal) setShowProductModal(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [refPreviewUrl, showProductModal]);

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
                 setSelectedId("custom");
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
          productId: selectedId !== "custom" ? selectedId : null,
          productName,
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
          productId: selectedId !== "custom" ? selectedId : null,
          productName,
          referenceUrl: selectedId === "custom" ? null : referenceUrl || null,
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
    <div className="min-h-screen bg-[#fcfcfc] p-4 lg:p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-6 flex items-center justify-between">
           <div className="flex items-center gap-3">
               <h1 className="text-xl font-bold text-slate-900 tracking-tight">Image Studio</h1>
               <div className="h-4 w-px bg-slate-200" />
               <div className="flex gap-1 text-xs font-medium text-slate-500">
                   <span>Runs: {runs.length}</span>
                   <span className="text-slate-300">•</span>
                   <span>Active: {runs.filter(r => r.status === "running").length}</span>
               </div>
           </div>
           <Link href="/library" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
             View Library &rarr;
           </Link>
        </div>

        {/* Grid Layout Update: Wider Center Column */}
        <div className="grid gap-6 lg:grid-cols-[320px_640px_minmax(0,1fr)] items-start">
          
          {/* Column 1: Configuration */}
          <div className="space-y-6">
             <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                 <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Model</h2>
                 <div className="space-y-3">
                    {MODEL_LIST.map(model => (
                        <button
                          key={model.id}
                          onClick={() => setModelId(model.id)}
                          className={`w-full flex items-center justify-between p-3 rounded-lg border text-left text-sm transition-all ${modelId === model.id
                              ? "border-indigo-600 ring-1 ring-indigo-600 bg-indigo-50/50 text-indigo-900"
                              : "border-slate-200 hover:border-slate-300 text-slate-700"
                          }`}
                        >
                            <span className="font-medium">{model.label}</span>
                            <span className="text-[10px] uppercase text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">{model.version}</span>
                        </button>
                    ))}
                 </div>

                  {modelDef.provider === "seedream" && (
                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-semibold uppercase text-slate-400">Ratio</label>
                        <select
                            className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium"
                            value={sdSize}
                            onChange={(e) => setSdSize(e.target.value as any)}
                        >
                            {IMAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>
                     <div>
                        <label className="text-[10px] font-semibold uppercase text-slate-400">Quality</label>
                         <select
                            className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium"
                            value={sdRes}
                            onChange={(e) => setSdRes(e.target.value as any)}
                        >
                            {IMAGE_RESOLUTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                    </div>
                  </div>
                   <div>
                      <label className="text-[10px] font-semibold uppercase text-slate-400">Seed</label>
                      <input 
                         type="number" 
                         placeholder="Random"
                         className="mt-1 w-full rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs font-medium placeholder:text-slate-400"
                         value={sdSeed}
                         onChange={(e) => setSdSeed(e.target.value === "" ? "" : Number(e.target.value))}
                      />
                   </div>
                </div>
              )}
             </div>

             <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                 <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Context</h2>
                    {modelRequiresReference && (
                        <span className={`h-2 w-2 rounded-full ${hasRefs ? "bg-emerald-500" : "bg-rose-500"}`} />
                    )}
                 </div>
                 
                 <div className="space-y-4">
                     <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="block text-xs font-medium text-slate-600">Subject / Product</label>
                            <button 
                                onClick={() => setShowProductModal(true)}
                                className="text-[10px] text-indigo-600 hover:text-indigo-700 font-medium"
                            >
                                + Add Product
                            </button>
                        </div>
                        <select
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={selectedId}
                            onChange={(e) => setSelectedId(e.target.value)}
                        >
                            <option value="custom">Custom (Ad-hoc)</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                     </div>

                     {selectedProduct && selectedId !== "custom" && (
                        <div className="flex gap-3 items-start rounded-lg bg-slate-50 p-2 border border-slate-100">
                             {selectedProduct.image_url && (
                                 <button 
                                    onClick={() => setRefPreviewUrl(selectedProduct.image_url)}
                                    className="shrink-0 h-12 w-12 rounded overflow-hidden border border-slate-200 hover:ring-2 ring-indigo-500 transition"
                                 >
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={selectedProduct.image_url} className="h-full w-full object-cover bg-white" alt="" />
                                 </button>
                             )}
                             <div>
                                 <p className="text-xs font-semibold text-slate-900">{selectedProduct.name}</p>
                                 <p className="text-[10px] text-slate-500 uppercase">{selectedProduct.slug}</p>
                             </div>
                        </div>
                     )}

                     {/* References Section */}
                     <div className="space-y-3">
                        <label className="block text-xs font-medium text-slate-600">Reference Images</label>
                        
                        {selectedId === "custom" && (
                             <input 
                                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                                placeholder="Paste image URL..."
                                value={customUrl}
                                onChange={(e) => setCustomUrl(e.target.value)}
                             />
                        )}

                         <div className="grid grid-cols-4 gap-2">
                            <label className="flex aspect-square cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-300 hover:bg-slate-50 hover:border-slate-400 transition">
                                <span className="text-2xl text-slate-300">+</span>
                                <input 
                                    type="file" 
                                    className="hidden" 
                                    multiple 
                                    accept="image/*"
                                    onChange={async (e) => {
                                        const urls = await filesToDataUrls(e.target.files);
                                        if(selectedId === 'custom') setCustomUploads(prev => [...prev, ...urls]);
                                        else setExtraRefUploads(prev => [...prev, ...urls]);
                                    }}
                                />
                            </label>
                            {refSources.map((src, i) => (
                                <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-slate-200">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={src} className="h-full w-full object-cover" alt="" />
                                    <button 
                                        onClick={() => {
                                             if (src.startsWith("data:")) removeUploadSrc(src);
                                             else if (selectedId === 'custom' && src === customUrl) setCustomUrl("");
                                        }}
                                        className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition text-white text-xs"
                                    >
                                        ✕
                                    </button>
                                    <button 
                                        onClick={() => setRefPreviewUrl(src)}
                                        className="absolute inset-0"
                                    />
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
             <div className="flex-1 flex flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between p-3 border-b border-slate-100 bg-slate-50/50">
                     <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Prompt Engineering</h2>
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
                         <div className="h-4 w-px bg-slate-200" />
                         <select 
                            className="bg-transparent text-xs font-medium text-slate-600 focus:outline-none"
                            value={speed}
                            onChange={(e) => setSpeed(Number(e.target.value) as RunSpeed)}
                        >
                            {RUN_SPEED_OPTIONS.map(s => <option key={s} value={s}>Speed {s}x</option>)}
                         </select>
                     </div>
                </div>
                <textarea 
                    className="flex-1 w-full resize-none p-4 text-sm outline-none text-slate-700 placeholder:text-slate-300 font-mono leading-relaxed"
                    placeholder={`Describe your image generation tasks here.\nOne prompt per line.\n\nExample:\nplace this exact light source top-left, creating soft shadows on the product.`}
                    value={promptsText}
                    onChange={(e) => setPromptsText(e.target.value)}
                />
                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                    <span className="text-xs text-slate-400 font-medium">{promptLines.length} prompt{promptLines.length !== 1 ? 's' : ''} ready</span>
                    <button
                        onClick={onGenerateNewRun}
                        disabled={!canStartRun}
                        className="px-6 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
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
                 <div className="flex flex-col flex-1 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                    <div className="p-4 border-b border-slate-100">
                        <div className="flex items-center justify-between mb-2">
                             <span className="font-semibold text-sm text-slate-900">{activeRun.name}</span>
                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ring-1 ring-inset ${statusColor(activeRun.status)}`}>
                                 {activeRun.status}
                             </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                             <div className="h-full bg-slate-900 transition-all duration-500" style={{ width: `${overallPct}%` }} />
                        </div>
                         <div className="mt-2 flex justify-between text-[10px] text-slate-500">
                             <span>{activeRun.modelNameDisplay}</span>
                             <span>{activeRun.progress.done} / {activeRun.progress.total}</span>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
                        {activeRun.images.length > 0 ? (
                             <div className="space-y-3">
                                 <div className="relative aspect-square rounded-lg overflow-hidden bg-slate-200 border border-slate-200 shadow-sm group">
                                     {/* eslint-disable-next-line @next/next/no-img-element */}
                                     <img src={activeRun.images[activeRun.activeIdx].imageDataUrl} className="h-full w-full object-contain" alt="" />
                                     
                                     <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition flex justify-center gap-3">
                                         <button onClick={() => saveImageToLibrary(activeRun.images[activeRun.activeIdx].imageDataUrl, activeRun.images[activeRun.activeIdx].prompt)} className="bg-white/90 hover:bg-white text-slate-900 text-xs font-medium px-3 py-1.5 rounded-full shadow">Save</button>
                                         <button onClick={() => downloadDataUrl(activeRun.images[activeRun.activeIdx].imageDataUrl, `${safeName(activeRun.productName || "custom")}_${safeName(modelNameDisplay)}_${Date.now()}.png`)} className="bg-white/90 hover:bg-white text-slate-900 text-xs font-medium px-3 py-1.5 rounded-full shadow">Download</button>
                                     </div>
                                 </div>
                                 
                                 <div className="flex items-center justify-between px-1">
                                     <button onClick={() => stepActiveImage(activeRun.id, -1)} className="p-1 hover:bg-slate-100 rounded text-slate-500">←</button>
                                     <span className="text-xs font-medium text-slate-600">{activeRun.activeIdx + 1} of {activeRun.images.length}</span>
                                     <button onClick={() => stepActiveImage(activeRun.id, 1)} className="p-1 hover:bg-slate-100 rounded text-slate-500">→</button>
                                 </div>
                                 
                                 <div className="bg-white p-3 rounded-lg border border-slate-100 text-xs text-slate-600 leading-relaxed">
                                     {activeRun.images[activeRun.activeIdx].prompt}
                                 </div>

                                 {/* Thumbnails Grid */}
                                 <div className="grid grid-cols-5 gap-2 pt-2 border-t border-slate-100">
                                     {activeRun.images.map((img, idx) => (
                                         <button 
                                            key={img.id}
                                            onClick={() => {
                                                setRuns(prev => prev.map(r => r.id === activeRun.id ? { ...r, activeIdx: idx } : r));
                                            }}
                                            className={`aspect-square rounded overflow-hidden border ${activeRun.activeIdx === idx ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 opacity-70 hover:opacity-100'}`}
                                         >
                                             {/* eslint-disable-next-line @next/next/no-img-element */}
                                             <img src={img.imageDataUrl} className="h-full w-full object-cover" alt="" />
                                         </button>
                                     ))}
                                 </div>
                             </div>
                        ) : (
                             <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                 <div className="h-8 w-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                                 <span className="text-xs">Processing...</span>
                             </div>
                        )}
                    </div>
                    
                    <div className="p-3 bg-white border-t border-slate-100 flex gap-2 justify-end">
                        <button onClick={() => zipRun(activeRun, false)} className="text-xs font-medium text-slate-600 hover:text-slate-900 px-3 py-1.5 border border-slate-200 rounded-lg hover:bg-slate-50">Download All Zip</button>
                    </div>
                 </div>
            ) : (
                <div className="flex-1 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex items-center justify-center text-slate-400 text-sm">
                    No active run
                </div>
            )}
            
            {/* Run Queue / History List (Mini) */}
            <div className="max-h-[200px] rounded-xl border border-slate-200 bg-white p-3 overflow-y-auto shadow-sm">
                <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">History</h3>
                <div className="space-y-1">
                    {runs.map(run => (
                        <div key={run.id} 
                             onClick={() => setActiveRunId(run.id)}
                             className={`group flex items-center justify-between p-2 rounded-md border cursor-pointer transition ${activeRunId === run.id ? 'bg-slate-50 border-slate-300' : 'bg-white border-transparent hover:bg-slate-50'}`}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <div className={`h-2 w-2 rounded-full ${run.status === 'running' ? 'bg-emerald-500 animate-pulse' : run.status === 'error' ? 'bg-rose-500' : 'bg-slate-300'}`} />
                                <span className="truncate text-xs font-medium text-slate-700">{run.name}</span>
                                <span className="text-[10px] text-slate-400">({run.images.length})</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); deleteRun(run.id); }}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-rose-500 px-1"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {runs.length === 0 && <p className="text-[10px] text-slate-400 italic">No recent runs.</p>}
                </div>
            </div>

          </div>

        </div>
      </div>
      
      {/* Product Creation Modal */}
      {showProductModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
              <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
                  <h3 className="text-lg font-semibold text-slate-900 mb-4">Add New Product</h3>
                  <div className="space-y-4">
                      <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Product Name</label>
                          <input 
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                              placeholder="e.g. Neon Runner 2025"
                              value={newProduct.name}
                              onChange={(e) => setNewProduct(prev => ({ ...prev, name: e.target.value }))}
                          />
                      </div>
                      <div>
                          <label className="block text-xs font-medium text-slate-500 mb-1">Image URL</label>
                          <input 
                              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                              placeholder="https://..."
                              value={newProduct.image_url}
                              onChange={(e) => setNewProduct(prev => ({ ...prev, image_url: e.target.value }))}
                          />
                      </div>
                      <div className="flex gap-3 pt-2">
                          <button 
                            onClick={() => setShowProductModal(false)}
                            className="flex-1 rounded-lg border border-slate-200 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                          >
                              Cancel
                          </button>
                          <button 
                            onClick={handleAddProduct}
                            disabled={!newProduct.name || !newProduct.image_url || creatingProduct}
                            className="flex-1 rounded-lg bg-slate-900 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
                          >
                              {creatingProduct ? "Creating..." : "Create Product"}
                          </button>
                      </div>
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
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all transform translate-y-0 ${saveToast.type === 'success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>
          {saveToast.message}
        </div>
      )}
    </div>
  );
}
