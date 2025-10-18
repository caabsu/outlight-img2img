"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import JSZip from "jszip";

// ---- IMAGE models (existing) ----
import {
  MODEL_LIST,
  getModelById,
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
} from "@/lib/models";

/* =========================================================
   Types (shared)
========================================================= */

type Product = { id: string; name: string; slug: string; image_url: string };

/** IMAGE generation (unchanged) */
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

/** VIDEO generation */
type VideoItem = { id: string; prompt: string; url: string };

type VideoProvider = "kling" | "veo" | "sora";
type KlingModel = "kling/v2-5-turbo-image-to-video-pro" | "kling/v2-5-turbo-text-to-video-pro";
type VeoModel = "veo3" | "veo3_fast"; // via /api/v1/veo/generate
type SoraModel = "sora-2-pro-storyboard"; // via KIE /jobs/createTask

type VideoModelId = KlingModel | VeoModel | SoraModel;

type VideoTab = "image" | "video";

/* =========================================================
   Utils
========================================================= */

function safeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
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

/** Accepts data URL or http(s) URL and returns Uint8Array + mime (for ZIP) */
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

/* =========================================================
   Page
========================================================= */

export default function ContentGeneratorPage() {
  /* --------- MODE (Image / Video) ---------- */
  const [tab, setTab] = useState<VideoTab>("image");

  /* =====================================================
     IMAGE SIDE (kept from your working page)
  ===================================================== */

  // Products / reference
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string>("custom");
  const [customUrl, setCustomUrl] = useState<string>("");

  // Model selection (image)
  const [modelId, setModelId] = useState<string>("nanobanana-v1");
  const modelDef = useMemo(() => getModelById(modelId)!, [modelId]);
  const modelNameDisplay = `${modelDef.label}-${modelDef.version}`;

  // Seedream-only knobs
  const [sdSize, setSdSize] = useState<(typeof IMAGE_SIZES)[number]>("square");
  const [sdRes, setSdRes] = useState<(typeof IMAGE_RESOLUTIONS)[number]>("1K");
  const [sdMax, setSdMax] = useState<number>(1);
  const [sdSeed, setSdSeed] = useState<number | "">("");

  // Speed (parallelism per run)
  const [speed, setSpeed] = useState<1 | 2 | 3>(1);

  // Prompts (image)
  const [promptsText, setPromptsText] = useState<string>("");
  const promptLines = useMemo(
    () => promptsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [promptsText]
  );

  // Runs management (up to 3)
  const [runs, setRuns] = useState<Run[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  // Panels (image)
  const [libOpen, setLibOpen] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [libLoading, setLibLoading] = useState(false);

  const [prodOpen, setProdOpen] = useState(false);
  const [prodSaving, setProdSaving] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [prodForm, setProdForm] = useState<{ id?: string; name: string; slug: string; image_url: string }>({
    name: "",
    slug: "",
    image_url: "",
  });

  const [guideOpen, setGuideOpen] = useState(false);

  const selected = useMemo(() => products.find((p) => p.id === selectedId), [products, selectedId]);
  const productName = selected ? selected.name : "Custom";
  const referenceUrl = selectedId === "custom" ? customUrl : (selected?.image_url as string | undefined);

  // Load products
  async function loadProducts() {
    try {
      const res = await fetch("/api/products");
      const json = await res.json();
      setProducts(json.products || []);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    loadProducts();
  }, []);

  // Product manager
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
        if (json.product?.id) setSelectedId(json.product.id);
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
      if (selectedId === id) setSelectedId("custom");
      await loadProducts();
    } catch (e: unknown) {
      alert((e as Error)?.message || "Delete failed");
    }
  }

  // Library
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

  // Runs helpers
  const activeRun = useMemo(() => runs.find((r) => r.id === activeRunId) || null, [runs, activeRunId]);

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
      if (activeRunId === runId) {
        const newActive = next[0]?.id ?? null;
        setActiveRunId(newActive);
      }
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

  // ZIP helpers
  async function zipRun(run: Run, selectedOnly: boolean) {
    if (run.images.length === 0) return;
    const chosenIdxs = selectedOnly ? Array.from(run.selectedIdx) : run.images.map((_, i) => i);
    if (chosenIdxs.length === 0) return;

    const folderName = safeName(run.productName || "product");
    const zip = new JSZip();

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

  // Start run (image) with pool parallelism
  async function onGenerateNewRun() {
    const ref = referenceUrl || "";
    if (!ref || promptLines.length === 0) return;

    // drop oldest if already 3
    setRuns((prev) => {
      if (prev.length < 3) return prev;
      const sorted = [...prev].sort((a, b) => a.startedAt - b.startedAt);
      const oldest = sorted[0];
      oldest.controller?.abort();
      return prev.filter((r) => r.id !== oldest.id);
    });

    const id = crypto.randomUUID();
    const runOrdinal = (runs.length ? Math.max(...runs.map((r) => parseInt(r.name.replace(/\D/g, "") || "0"))) : 0) + 1;
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
          return { ...r, status: "error" as RunStatus, error: message, debug: debug ?? null };
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
      prevRuns.map((r) => {
        if (r.id !== run.id) return r;
        if (r.status === "running") return { ...r, status: "done" as RunStatus };
        return r;
      })
    );
  }

  // Some image UI derived values
  const somethingRunning = runs.some((r) => r.status === "running");
  const overallPct =
    activeRun && activeRun.progress.total > 0
      ? Math.round((activeRun.progress.done / activeRun.progress.total) * 100)
      : 0;

  /* =====================================================
     VIDEO SIDE (new models / tailored inputs)
  ===================================================== */

  // Video model selection
  const [videoModel, setVideoModel] = useState<VideoModelId>("kling/v2-5-turbo-image-to-video-pro");
  const [videoPrompts, setVideoPrompts] = useState("");
  const videoPromptLines = useMemo(
    () => videoPrompts.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [videoPrompts]
  );

  // Shared controls
  const [videoParallel, setVideoParallel] = useState<number>(1);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoProgress, setVideoProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [videos, setVideos] = useState<VideoItem[]>([]);
  const videoCtlRef = useRef<AbortController | null>(null);

  // Kling options
  const [klingDuration, setKlingDuration] = useState<"5" | "10">("5");
  const [klingAspect, setKlingAspect] = useState<"16:9" | "9:16" | "1:1">("16:9"); // text-to-video only
  const [klingNeg, setKlingNeg] = useState("");
  const [klingCfg, setKlingCfg] = useState<string>("0.5");

  // Veo options
  type VeoRatio = "16:9" | "9:16" | "Auto";
  const [veoModelChoice, setVeoModelChoice] = useState<VeoModel>("veo3_fast");
  const [veoAspect, setVeoAspect] = useState<VeoRatio>("16:9");
  type VeoGenType = "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" | "REFERENCE_2_VIDEO";
  const [veoGenType, setVeoGenType] = useState<VeoGenType>("TEXT_2_VIDEO");
  const [veoSeed, setVeoSeed] = useState<string>(""); // 10000..99999
  // image URLs for Veo (can be 0-2; for REFERENCE_2_VIDEO can be 1-3 but we expose 1-2 here)
  const [veoSecondImage, setVeoSecondImage] = useState<string>("");

  // Sora storyboard options (KIE)
  const [soraFrames, setSoraFrames] = useState<"10" | "15" | "25">("15");
  const [soraAspect, setSoraAspect] = useState<"portrait" | "landscape">("landscape");
  const [soraShotsText, setSoraShotsText] = useState(
    `5|A cute puppy running on the playground
10|The puppy stops and looks at the camera`
  );
  const [soraImageUrl, setSoraImageUrl] = useState<string>("");

  // Derived: should video model require a reference image?
  const videoNeedsImage =
    videoModel === "kling/v2-5-turbo-image-to-video-pro" ||
    (videoModel === "veo3" && veoGenType !== "TEXT_2_VIDEO") ||
    (videoModel === "veo3_fast" && veoGenType !== "TEXT_2_VIDEO") ||
    videoModel === "sora-2-pro-storyboard"; // optional, but we allow one

  // Current "reference" for first image field (reuse product/custom from image tab)
  const currentRefUrl = selectedId === "custom" ? customUrl : (selected?.image_url || "");

  // Concurrency helper
  async function runWithLimit<T>(limit: number, tasks: Array<() => Promise<T>>) {
    const queue = [...tasks];
    const out: T[] = [];
    let running = 0;
    return await new Promise<T[]>((resolve, reject) => {
      const kick = () => {
        if (queue.length === 0 && running === 0) return resolve(out);
        while (running < limit && queue.length) {
          const task = queue.shift()!;
          running++;
          const p: Promise<T> = task()
            .then((r) => {
              out.push(r);
              return r;
            })
            .catch((e) => {
              reject(e);
              return Promise.reject(e);
            })
            .finally(() => {
              if (running > 0) running--;
              if (queue.length > 0) kick();
              else if (queue.length === 0 && running === 0) resolve(out);
            });
          void p;
        }
      };
      kick();
    });
  }

  // Video generate
  async function onGenerateVideo() {
    if (videoPromptLines.length === 0) return;
    if (videoNeedsImage && !currentRefUrl && videoModel !== "veo3" && videoModel !== "veo3_fast") {
      setVideoError("Please select a product or provide a custom image URL.");
      return;
    }

    setVideoLoading(true);
    setVideoError(null);
    setVideos([]);
    setVideoProgress({ done: 0, total: videoPromptLines.length });

    const ac = new AbortController();
    videoCtlRef.current = ac;

    try {
      const tasks = videoPromptLines.map((line, idx) => async () => {
        // Build provider & payload based on model
        let provider: VideoProvider = "kling";
        let body: any = {};

        if (videoModel.startsWith("kling/")) {
          provider = "kling";
          const cfgVal = Number.isFinite(Number(klingCfg)) ? Number(klingCfg) : undefined;
          body = {
            provider,
            model: videoModel,
            // Kling payload (KIE jobs/createTask)
            mode: videoModel === "kling/v2-5-turbo-text-to-video-pro" ? "text-to-video" : "image-to-video",
            prompt: line,
            duration: klingDuration,
            ...(videoModel === "kling/v2-5-turbo-text-to-video-pro" ? { aspect_ratio: klingAspect } : {}),
            ...(klingNeg.trim() ? { negative_prompt: klingNeg.trim() } : {}),
            ...(typeof cfgVal === "number" ? { cfg_scale: cfgVal } : {}),
            ...(videoModel === "kling/v2-5-turbo-image-to-video-pro"
              ? {
                  productId: selectedId !== "custom" ? selectedId : null,
                  customUrl: selectedId === "custom" ? customUrl : null,
                }
              : {}),
          };
        } else if (videoModel === "veo3" || videoModel === "veo3_fast") {
          provider = "veo";
          const imgs: string[] = [];
          if (currentRefUrl) imgs.push(currentRefUrl);
          if (veoGenType !== "TEXT_2_VIDEO" && veoSecondImage.trim()) imgs.push(veoSecondImage.trim());

          // Validate gen type availability
          let effectiveGen = veoGenType;
          if (videoModel === "veo3" && veoGenType === "REFERENCE_2_VIDEO") {
            effectiveGen = "TEXT_2_VIDEO";
          }

          body = {
            provider,
            model: videoModel as VeoModel,
            prompt: line,
            aspectRatio: veoAspect,
            generationType: effectiveGen,
            ...(imgs.length ? { imageUrls: imgs } : {}),
            ...(veoSeed.trim() ? { seeds: Number(veoSeed) } : {}),
          };
        } else {
          // Sora storyboard (KIE jobs/createTask)
          provider = "sora";
          // Parse shots
          const shots = soraShotsText
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
            .map((row) => {
              const [durStr, ...rest] = row.split("|");
              const duration = Math.max(1, Number(durStr.trim() || "1"));
              const Scene = rest.join("|").trim() || line;
              return { duration, Scene };
            });

          body = {
            provider,
            model: "sora-2-pro-storyboard",
            input: {
              n_frames: soraFrames,
              image_urls: soraImageUrl.trim() ? [soraImageUrl.trim()] : [],
              aspect_ratio: soraAspect,
              shots,
            },
          };
        }

        const res = await fetch("/api/video/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: ac.signal,
        });

        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(json.error || `Generation failed (line ${idx + 1})`);
        }
        const item: VideoItem = {
          id: crypto.randomUUID(),
          prompt: line,
          url: json.videoUrl, // server should normalize to { videoUrl }
        };
        setVideos((prev) => [...prev, item]);
        setVideoProgress((p) => ({ done: p.done + 1, total: p.total }));
        return item;
      });

      await runWithLimit(Math.max(1, Math.min(3, videoParallel)), tasks);
    } catch (e: any) {
      if (e?.name === "AbortError") setVideoError("Generation cancelled.");
      else setVideoError(e?.message || "Something went wrong.");
    } finally {
      setVideoLoading(false);
      videoCtlRef.current = null;
    }
  }
  function cancelVideo() {
    videoCtlRef.current?.abort();
  }

  const videoPct =
    videoProgress.total > 0 ? Math.round((videoProgress.done / videoProgress.total) * 100) : 0;

  /* =====================================================
     UI
  ===================================================== */

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
                Outlight — Content Generator
              </h1>
              <p className="text-xs text-neutral-400 hidden md:block">
                Image + Video generation • parallel execution • product library
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Mode toggle */}
            <div className="flex items-center gap-1 rounded-md border border-white/20 bg-white/5 p-1">
              <button
                className={`px-3 py-1.5 text-sm rounded ${tab === "image" ? "bg-white/15" : ""}`}
                onClick={() => setTab("image")}
              >
                Image
              </button>
              <button
                className={`px-3 py-1.5 text-sm rounded ${tab === "video" ? "bg-white/15" : ""}`}
                onClick={() => setTab("video")}
              >
                Video
              </button>
            </div>

            {/* Guide */}
            <button
              className="rounded-md bg-white/10 hover:bg-white/15 border border-white/20 px-3 py-1.5 text-sm"
              onClick={() => setGuideOpen(true)}
              title="Open the guide"
            >
              Guide
            </button>
          </div>
        </header>

        {/* ========================= IMAGE TAB ========================= */}
        {tab === "image" && (
          <>
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
                        <span className={`inline-block h-2 w-2 rounded-full ${statusColor(r.status)}`} />
                        <span className="text-neutral-200">{r.name}</span>
                        {r.status === "running" && (
                          <span className="text-[11px] text-neutral-400">
                            {r.progress.done}/{r.progress.total}
                          </span>
                        )}
                      </button>
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

            {/* Two columns */}
            <section className="grid md:grid-cols-3 gap-6">
              {/* LEFT: Model & Product */}
              <div className="space-y-4 md:col-span-1">
                {/* Image model */}
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
                          title="Download all images in a ZIP"
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
                    {/* Thumbs */}
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
                              className={`absolute inset-0 block w-full h-full object-cover ${isActive ? "ring-2 ring-white/40" : ""}`}
                              onClick={() =>
                                setRuns((prev) =>
                                  prev.map((r) => (r.id === activeRun.id ? { ...r, activeIdx: i } : r))
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

                    {/* Main viewer */}
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
                            className="w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent
                                   checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                            title={activeRun.selectedIdx.has(activeRun.activeIdx) ? "Deselect" : "Select"}
                          />
                          <button
                            onClick={() => {
                              const baseProduct = safeName(activeRun.productName || "product");
                              const baseModel = safeName(activeRun.modelNameDisplay);
                              const id =
                                activeRun.images[activeRun.activeIdx]?.id ||
                                `${Date.now()}-${activeRun.activeIdx + 1}`;
                              const filename = `${baseProduct}_${baseModel}_${id}.png`;
                              downloadDataUrl(activeRun.images[activeRun.activeIdx].imageDataUrl, filename);
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
                          <div className="shrink-0 text-sm font-medium text-neutral-100">Prompt</div>
                          <div className="flex gap-2">
                            <button
                              className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                              onClick={() => copyPromptToClipboard(activeRun.images[activeRun.activeIdx].prompt)}
                              title="Copy prompt to clipboard"
                            >
                              Copy
                            </button>
                            <button
                              className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                              onClick={() => saveSinglePrompt(activeRun.images[activeRun.activeIdx].prompt)}
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

                {/* If no images yet but we do have an active run, show status */}
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
          </>
        )}

        {/* ========================= VIDEO TAB ========================= */}
        {tab === "video" && (
          <section className="grid md:grid-cols-3 gap-6">
            {/* LEFT: video model + inputs (tailored per model) */}
            <div className="space-y-4 md:col-span-1">
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                <label className="text-sm text-neutral-300">Video Model</label>
                <select
                  className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={videoModel}
                  onChange={(e) => setVideoModel(e.target.value as VideoModelId)}
                >
                  <optgroup label="Kling (KIE)">
                    <option value="kling/v2-5-turbo-image-to-video-pro">Kling — Image → Video</option>
                    <option value="kling/v2-5-turbo-text-to-video-pro">Kling — Text → Video</option>
                  </optgroup>
                  <optgroup label="Veo 3.1 (KIE / /veo/generate)">
                    <option value="veo3_fast">Veo 3.1 Fast</option>
                    <option value="veo3">Veo 3.1 Quality</option>
                  </optgroup>
                  <optgroup label="Sora (KIE storyboard)">
                    <option value="sora-2-pro-storyboard">Sora — Storyboard</option>
                  </optgroup>
                </select>
              </div>

              {/* Product / reference (shown only when the selected model can use an image) */}
              {(videoNeedsImage || videoModel.startsWith("kling/")) && (
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <div className="flex items-center justify-between">
                    <label className="text-sm text-neutral-300">Reference (Product or custom URL)</label>
                    {videoModel !== "sora-2-pro-storyboard" && (
                      <button
                        type="button"
                        className="text-xs rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1"
                        onClick={openProductManager}
                      >
                        Manage Products
                      </button>
                    )}
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

                  {/* Veo optional second image (only when not TEXT_2_VIDEO) */}
                  {(videoModel === "veo3" || videoModel === "veo3_fast") && veoGenType !== "TEXT_2_VIDEO" && (
                    <div className="space-y-2 mt-3">
                      <label className="text-sm text-neutral-300">
                        Second image URL (optional, becomes last frame)
                      </label>
                      <input
                        placeholder="https://... (optional)"
                        className="w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={veoSecondImage}
                        onChange={(e) => setVeoSecondImage(e.target.value)}
                      />
                    </div>
                  )}

                  {/* Sora optional reference image */}
                  {videoModel === "sora-2-pro-storyboard" && (
                    <div className="space-y-2 mt-3">
                      <label className="text-sm text-neutral-300">Reference image URL (optional)</label>
                      <input
                        placeholder="https://... (optional)"
                        className="w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={soraImageUrl}
                        onChange={(e) => setSoraImageUrl(e.target.value)}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Model-specific controls */}
              {videoModel.startsWith("kling/") && (
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-neutral-400">Duration</label>
                      <select
                        className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={klingDuration}
                        onChange={(e) => setKlingDuration(e.target.value as "5" | "10")}
                      >
                        <option value="5">5s</option>
                        <option value="10">10s</option>
                      </select>
                    </div>
                    {videoModel === "kling/v2-5-turbo-text-to-video-pro" && (
                      <div>
                        <label className="text-xs text-neutral-400">Aspect Ratio</label>
                        <select
                          className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                          value={klingAspect}
                          onChange={(e) =>
                            setKlingAspect(e.target.value as "16:9" | "9:16" | "1:1")
                          }
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
                      value={klingNeg}
                      onChange={(e) => setKlingNeg(e.target.value)}
                      placeholder="blur, distort, low quality"
                    />
                  </div>

                  <div className="mt-2">
                    <label className="text-xs text-neutral-400">CFG scale (0–1, optional)</label>
                    <input
                      className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                      value={klingCfg}
                      onChange={(e) => setKlingCfg(e.target.value)}
                      placeholder="0.5"
                    />
                  </div>
                </div>
              )}

              {(videoModel === "veo3" || videoModel === "veo3_fast") && (
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-neutral-400">Aspect Ratio</label>
                      <select
                        className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={veoAspect}
                        onChange={(e) => setVeoAspect(e.target.value as "16:9" | "9:16" | "Auto")}
                      >
                        <option value="16:9">16:9</option>
                        <option value="9:16">9:16</option>
                        <option value="Auto">Auto</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-400">Model Variant</label>
                      <select
                        className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={veoModelChoice}
                        onChange={(e) => {
                          const val = e.target.value as VeoModel;
                          setVeoModelChoice(val);
                          setVideoModel(val); // keep videoModel in sync
                          if (val === "veo3" && veoGenType === "REFERENCE_2_VIDEO") {
                            setVeoGenType("TEXT_2_VIDEO");
                          }
                        }}
                      >
                        <option value="veo3_fast">veo3_fast</option>
                        <option value="veo3">veo3 (Quality)</option>
                      </select>
                    </div>
                  </div>

                  {/* Only show generationType when it makes sense */}
                  <div className="mt-2">
                    <label className="text-xs text-neutral-400">Generation Type</label>
                    <select
                      className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                      value={veoGenType}
                      onChange={(e) => setVeoGenType(e.target.value as any)}
                    >
                      <option value="TEXT_2_VIDEO">TEXT_2_VIDEO</option>
                      <option value="FIRST_AND_LAST_FRAMES_2_VIDEO">FIRST_AND_LAST_FRAMES_2_VIDEO</option>
                      {/* REFERENCE only for veo3_fast */}
                      {veoModelChoice === "veo3_fast" && (
                        <option value="REFERENCE_2_VIDEO">REFERENCE_2_VIDEO</option>
                      )}
                    </select>
                    {veoModelChoice === "veo3" && veoGenType === "REFERENCE_2_VIDEO" && (
                      <p className="text-[11px] text-amber-400 mt-1">
                        REFERENCE_2_VIDEO is only supported by veo3_fast. Switched to TEXT_2_VIDEO.
                      </p>
                    )}
                  </div>

                  <div className="mt-2">
                    <label className="text-xs text-neutral-400">Seed (10000–99999, optional)</label>
                    <input
                      className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                      value={veoSeed}
                      onChange={(e) => setVeoSeed(e.target.value)}
                      placeholder="e.g. 12345"
                    />
                  </div>
                </div>
              )}

              {videoModel === "sora-2-pro-storyboard" && (
                <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-neutral-400">Total length</label>
                      <select
                        className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={soraFrames}
                        onChange={(e) => setSoraFrames(e.target.value as "10" | "15" | "25")}
                      >
                        <option value="10">10s</option>
                        <option value="15">15s</option>
                        <option value="25">25s</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-xs text-neutral-400">Aspect</label>
                      <select
                        className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                        value={soraAspect}
                        onChange={(e) => setSoraAspect(e.target.value as "portrait" | "landscape")}
                      >
                        <option value="landscape">landscape</option>
                        <option value="portrait">portrait</option>
                      </select>
                    </div>
                  </div>

                  <div className="mt-2">
                    <label className="text-xs text-neutral-400">Shots (one per line: duration|Scene)</label>
                    <textarea
                      className="mt-1 w-full h-28 rounded-md bg-neutral-900 border border-neutral-800 p-2 text-xs"
                      value={soraShotsText}
                      onChange={(e) => setSoraShotsText(e.target.value)}
                    />
                  </div>
                </div>
              )}

              {/* Parallel slider */}
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60">
                <label className="text-xs text-neutral-400">Speed (parallel jobs)</label>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={1}
                  value={videoParallel}
                  onChange={(e) => setVideoParallel(Number(e.target.value))}
                  className="w-full"
                />
                <div className="text-xs text-neutral-500 mt-1">Parallel: {videoParallel} (max 3)</div>
              </div>
            </div>

            {/* RIGHT: prompts + results */}
            <div className="md:col-span-2 space-y-6">
              <div className="rounded-lg border border-neutral-800 p-3 bg-neutral-950/60 space-y-3">
                <label className="text-sm text-neutral-300">
                  Prompt (each line = one video)
                </label>
                <textarea
                  className="w-full h-56 rounded-md bg-neutral-900 border border-neutral-800 p-3"
                  placeholder={
                    videoModel.startsWith("kling/")
                      ? (videoModel === "kling/v2-5-turbo-image-to-video-pro"
                          ? `slow product orbit\nmacro detail pan, dramatic lighting`
                          : `Wide shot of city at dusk, slow aerial push-in\nCinematic macro of waves with golden reflections`)
                      : videoModel === "sora-2-pro-storyboard"
                      ? `Overall story/theme for the storyboard (each line's Scene can override)`
                      : `Describe the scene(s) you want to generate`
                  }
                  value={videoPrompts}
                  onChange={(e) => setVideoPrompts(e.target.value)}
                />

                <div className="flex items-center gap-2">
                  <button
                    className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                    onClick={onGenerateVideo}
                    disabled={
                      videoLoading ||
                      videoPromptLines.length === 0 ||
                      (videoNeedsImage && !currentRefUrl && videoModel !== "veo3" && videoModel !== "veo3_fast")
                    }
                  >
                    {videoLoading ? "Generating…" : `Generate ${videoPromptLines.length || ""}`}
                  </button>
                  {videoLoading && (
                    <button
                      className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2"
                      onClick={cancelVideo}
                    >
                      Cancel
                    </button>
                  )}
                  {videoError && <span className="text-sm text-red-400">{videoError}</span>}
                </div>

                {videoProgress.total > 0 && (
                  <div className="h-1 w-full bg-neutral-800 rounded">
                    <div
                      className="h-1 bg-white/70 rounded"
                      style={{ width: `${videoPct}%`, transition: "width .2s ease" }}
                    />
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
                      onClick={async () => {
                        const base = safeName(productName || "product");
                        for (let i = 0; i < videos.length; i++) {
                          const v = videos[i];
                          try {
                            const res = await fetch(v.url);
                            const blob = await res.blob();
                            const a = document.createElement("a");
                            a.href = URL.createObjectURL(blob);
                            a.download = `${base}_video_${i + 1}.mp4`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                            setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                          } catch {
                            window.open(v.url, "_blank");
                          }
                        }
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
                            onClick={async () => {
                              const base = safeName(productName || "product");
                              try {
                                const res = await fetch(v.url);
                                const blob = await res.blob();
                                const a = document.createElement("a");
                                a.href = URL.createObjectURL(blob);
                                a.download = `${base}_video_${i + 1}.mp4`;
                                document.body.appendChild(a);
                                a.click();
                                a.remove();
                                setTimeout(() => URL.revokeObjectURL(a.href), 1000);
                              } catch {
                                window.open(v.url, "_blank");
                              }
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
      </div>

      {/* Product Manager Panel */}
      {prodOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="ml-auto h-full w-full max-w-xl bg-neutral-950 border-l border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">{prodForm.id ? "Edit Product" : "Add Product"}</h2>
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
                <button
                  className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                  onClick={saveProduct}
                  disabled={prodSaving}
                >
                  {prodSaving ? "Saving…" : prodForm.id ? "Update Product" : "Add Product"}
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
              {products.length === 0 && <div className="text-sm text-neutral-500">No products yet.</div>}
              {products.map((p) => (
                <div
                  key={p.id}
                  className="rounded-md border border-neutral-800 p-2 hover:bg-white/5 flex items-center justify-between"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-neutral-100 truncate">{p.name}</div>
                    <div className="text-xs text-neutral-500 truncate">{p.slug}</div>
                    <div className="text-[11px] text-neutral-500 truncate">{p.image_url}</div>
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

      {/* Guide Panel (unchanged copy-friendly) */}
      {guideOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="mx-auto my-6 h-[92vh] w-full max-w-3xl bg-neutral-950 border border-neutral-800 rounded-xl overflow-hidden flex flex-col">
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
                  Outlight is a multi-model content generator for <b>images</b> and <b>videos</b>. Images support up to{" "}
                  <b>3 concurrent runs</b> with parallel requests per run. Videos support Kling, Veo 3.1, and Sora storyboard via KIE.
                </p>
              </section>
              <section>
                <h3 className="font-semibold text-neutral-100">Video models</h3>
                <ul className="list-disc ml-5 space-y-1">
                  <li>Kling: Image→Video or Text→Video (duration, ratio, negative, cfg).</li>
                  <li>Veo 3.1: Quality or Fast; TEXT_2_VIDEO, FIRST_AND_LAST_FRAMES; REFERENCE_2_VIDEO (Fast only).</li>
                  <li>Sora Storyboard: shots as <code>duration|Scene</code> lines; optional reference image.</li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      {/* Floating mini-indicator for image runs on mobile */}
      <div className="fixed bottom-4 right-4 md:hidden">
        <div
          className={`flex items-center gap-2 rounded-full px-3 py-1.5 shadow-lg border ${
            runs.some((r) => r.status === "running")
              ? "border-emerald-500/30 bg-neutral-900/90"
              : "border-white/10 bg-neutral-900/80"
          }`}
        >
          <span
            className={`inline-block h-2.5 w-2.5 rounded-full ${
              somethingRunning ? "bg-emerald-400 animate-pulse" : "bg-neutral-500"
            }`}
          />
          <span className="text-xs text-neutral-200">Runs {runs.length}/3</span>
        </div>
      </div>
    </main>
  );
}
