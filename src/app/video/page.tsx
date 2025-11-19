"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MODEL_LIST } from "@/lib/models";
import { PromptAssistant } from "@/components/PromptAssistant";

type Product = { id: string; name: string; slug: string; image_url: string };

type VideoProvider = "kling" | "veo" | "sora";
type VideoModelKind = "image-to-video" | "text-to-video" | "veo" | "storyboard";

type VideoModelOption = {
  id: string;
  provider: VideoProvider;
  label: string;
  kind: VideoModelKind;
  requiresImage?: boolean;
};

type VeoRatio = "16:9" | "9:16" | "Auto";
type VeoGenType = "TEXT_2_VIDEO" | "FIRST_AND_LAST_FRAMES_2_VIDEO" | "REFERENCE_2_VIDEO";

type VideoItem = { id: string; prompt: string; url: string };
type RunStatus = "idle" | "running" | "done" | "cancelled" | "error";
type VideoRun = {
  id: string;
  name: string;
  startedAt: number;
  modelId: string;
  modelLabel: string;
  isBatch: boolean;
  prompts: string[];
  status: RunStatus;
  error: string | null;
  videos: VideoItem[];
  activeIdx: number;
  selectedIdx: Set<number>;
  progress: { done: number; total: number };
  speed: number;
  controller: AbortController | null;
};

const RUN_PARALLEL_OPTIONS = [1, 2, 3, 4];
const MAX_VIDEO_RUNS = 5;
const MAX_CONCURRENT_REQUESTS = 6;

type VideoRunContext = {
  productId: string | null;
  customUrl: string | null;
  referenceUrl: string | null;
  kling: {
    duration: "5" | "10";
    aspect: "16:9" | "9:16" | "1:1";
    negative: string;
    cfg: string;
  };
  veo: {
    aspect: VeoRatio;
    generation: VeoGenType;
    seed: string;
    secondImage: string;
  };
  sora: {
    frames: "10" | "15" | "25";
    aspect: "portrait" | "landscape";
    shots: string;
    imageUrl: string;
  };
  batchImages?: string[];
};

const VIDEO_MODEL_GROUPS: Array<{ label: string; options: VideoModelOption[] }> = [
  {
    label: "Kling (KIE)",
    options: [
      { id: "kling/v2-5-turbo-image-to-video-pro", provider: "kling", label: "Kling 2.5 Turbo I2V Pro", kind: "image-to-video", requiresImage: true },
      { id: "kling/v2-5-turbo-text-to-video-pro", provider: "kling", label: "Kling 2.5 Turbo T2V Pro", kind: "text-to-video" },
      { id: "kling/v2-1-image-to-video", provider: "kling", label: "Kling 2.1 Image-to-Video", kind: "image-to-video", requiresImage: true },
      { id: "kling/v2-1-text-to-video", provider: "kling", label: "Kling 2.1 Text-to-Video", kind: "text-to-video" },
    ],
  },
  {
    label: "Veo (Google DeepMind)",
    options: [
      { id: "veo3_fast", provider: "veo", label: "Veo 3.1 Fast", kind: "veo" },
      { id: "veo3", provider: "veo", label: "Veo 3.1 Quality", kind: "veo" },
    ],
  },
  {
    label: "Sora (Storyboard)",
    options: [{ id: "sora-2-pro-storyboard", provider: "sora", label: "Sora 2 Pro Storyboard", kind: "storyboard", requiresImage: true }],
  },
];

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
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

export default function VideoStudioPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string>("custom");
  const [customVideoUrl, setCustomVideoUrl] = useState("");
  const [referenceUploadPreview, setReferenceUploadPreview] = useState<string | null>(null);
  const [referenceUploadedUrl, setReferenceUploadedUrl] = useState<string | null>(null);
  const [videoModel, setVideoModel] = useState<string>(VIDEO_MODEL_GROUPS[0].options[0].id);
  const videoModelDef = useMemo(
    () => VIDEO_MODEL_GROUPS.flatMap((group) => group.options).find((opt) => opt.id === videoModel) ?? VIDEO_MODEL_GROUPS[0].options[0],
    [videoModel]
  );
  const [videoPrompts, setVideoPrompts] = useState("");
  const videoPromptLines = useMemo(
    () => videoPrompts.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    [videoPrompts]
  );
  const [videoRuns, setVideoRuns] = useState<VideoRun[]>([]);
  const [activeVideoRunId, setActiveVideoRunId] = useState<string | null>(null);
  const activeVideoRun = videoRuns.find((run) => run.id === activeVideoRunId) ?? videoRuns[0] ?? null;
  const [videoParallel, setVideoParallel] = useState<number>(1);
  const [saveToast, setSaveToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [batchVideoMode, setBatchVideoMode] = useState(false);
  const [batchVideoImages, setBatchVideoImages] = useState<string[]>([]);
  const [batchVideoPrompt, setBatchVideoPrompt] = useState("");
  const [batchVideoPreviews, setBatchVideoPreviews] = useState<string[]>([]);
  const [batchVideoUploading, setBatchVideoUploading] = useState(false);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedId),
    [products, selectedId]
  );

  const baseReference = selectedId === "custom" ? customVideoUrl.trim() : selectedProduct?.image_url?.trim() ?? "";
  const resolvedVideoReferenceUrl = referenceUploadedUrl || baseReference;

  const isKling = videoModelDef.provider === "kling";
  const isKlingText = isKling && videoModelDef.kind === "text-to-video";
  const isKlingImage = isKling && videoModelDef.kind === "image-to-video";
  const isVeo = videoModelDef.provider === "veo";
  const isSora = videoModelDef.provider === "sora";

  const [klingDuration, setKlingDuration] = useState<"5" | "10">("5");
  const [klingAspect, setKlingAspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [klingNeg, setKlingNeg] = useState("");
  const [klingCfg, setKlingCfg] = useState<string>("0.5");

  const [veoAspect, setVeoAspect] = useState<VeoRatio>("16:9");
  const [veoGenType, setVeoGenType] = useState<VeoGenType>("TEXT_2_VIDEO");
  const [veoSeed, setVeoSeed] = useState("");
  const [veoSecondImage, setVeoSecondImage] = useState("");

  const [soraFrames, setSoraFrames] = useState<"10" | "15" | "25">("15");
  const [soraAspect, setSoraAspect] = useState<"portrait" | "landscape">("landscape");
  const [soraShotsText, setSoraShotsText] = useState(
    `5|Establishing shot of the scene\n10|Add detail or talent`
  );
  const [soraImageUrl, setSoraImageUrl] = useState("");

  const trimmedSoraImageUrl = soraImageUrl.trim();
  const finalReferenceUrl = isSora ? trimmedSoraImageUrl || resolvedVideoReferenceUrl : resolvedVideoReferenceUrl;
  const videoNeedsImage =
    isKlingImage ||
    (isVeo && veoGenType !== "TEXT_2_VIDEO") ||
    (isSora && videoModelDef.kind === "storyboard");
  const videoSomethingRunning = videoRuns.some((run) => run.status === "running");
  const canStartVideo = videoPromptLines.length > 0 && (!videoNeedsImage || !!finalReferenceUrl || isVeo);
  const canStartBatch = batchVideoPrompt.trim().length > 0 && batchVideoImages.length > 0;

  // ... (runWithLimit, load, useEffects, filesToDataUrls same as before)
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
          task()
            .then((result) => {
              out.push(result);
            })
            .catch((error) => {
              reject(error);
            })
            .finally(() => {
              running = Math.max(0, running - 1);
              if (queue.length > 0) kick();
              else if (queue.length === 0 && running === 0) resolve(out);
            });
        }
      };
      kick();
    });
  }

  useEffect(() => {
    async function load() {
      try {
        setProductsLoading(true);
        const res = await fetch("/api/products");
        const json = await res.json();
        if (res.ok) setProducts(json.products || []);
      } finally {
        setProductsLoading(false);
      }
    }
    load();
  }, []);

  useEffect(() => {
    if (!saveToast) return;
    const timer = setTimeout(() => setSaveToast(null), 3200);
    return () => clearTimeout(timer);
  }, [saveToast]);

  async function filesToDataUrls(files: FileList | null) {
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

  async function handleBatchVideoUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBatchVideoUploading(true);
    try {
      const previews = await filesToDataUrls(files);
      setBatchVideoPreviews(previews);

      const formData = new FormData();
      Array.from(files).forEach((file) => formData.append("files", file));
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Upload failed");
      setBatchVideoImages(json.urls || []);
      setSaveToast({ message: `${json.urls.length} images uploaded`, type: "success" });
    } catch (error: any) {
      setSaveToast({ message: error?.message || "Upload failed", type: "error" });
      setBatchVideoPreviews([]);
      setBatchVideoImages([]);
    } finally {
      setBatchVideoUploading(false);
    }
  }

  async function handleReferenceUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    try {
      const [preview] = await filesToDataUrls(files);
      setReferenceUploadPreview(preview || null);

      const formData = new FormData();
      formData.append("files", files[0]);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      const json = await res.json();
      if (!res.ok || !json.urls?.length) throw new Error(json.error || "Upload failed");
      setReferenceUploadedUrl(json.urls[0]);
      setSaveToast({ message: "Reference uploaded", type: "success" });
    } catch (error: any) {
      setReferenceUploadPreview(null);
      setReferenceUploadedUrl(null);
      setSaveToast({ message: error?.message || "Upload failed", type: "error" });
    }
  }

  function setActiveVideoRun(runId: string) {
    setActiveVideoRunId(runId);
  }

  function stepActiveVideo(runId: string, delta: number) {
    setVideoRuns((prev) =>
      prev.map((run) => {
        if (run.id !== runId) return run;
        const next = Math.max(0, Math.min(run.videos.length - 1, run.activeIdx + delta));
        return { ...run, activeIdx: next };
      })
    );
  }

  function toggleVideoSelection(runId: string, idx: number) {
    setVideoRuns((prev) =>
      prev.map((run) => {
        if (run.id !== runId) return run;
        const next = new Set(run.selectedIdx);
        if (next.has(idx)) next.delete(idx);
        else next.add(idx);
        return { ...run, selectedIdx: next };
      })
    );
  }

  function cancelVideoRun(runId: string) {
    setVideoRuns((prev) =>
      prev.map((run) => {
        if (run.id !== runId) return run;
        run.controller?.abort();
        return { ...run, status: "cancelled" as RunStatus, controller: null };
      })
    );
  }

  function deleteVideoRun(runId: string) {
    setVideoRuns((prev) => {
      const filtered = prev.filter((run) => run.id !== runId);
      if (activeVideoRunId === runId) {
        setActiveVideoRunId(filtered[0]?.id ?? null);
      }
      return filtered;
    });
  }

  function addRun(run: VideoRun) {
    setVideoRuns((prev) => {
      if (prev.length >= MAX_VIDEO_RUNS) {
        const [oldest, ...rest] = [...prev].sort((a, b) => a.startedAt - b.startedAt);
        oldest.controller?.abort();
        return [...rest.filter((r) => r.id !== oldest.id), run];
      }
      return [...prev, run];
    });
    setActiveVideoRunId(run.id);
  }
  
   function startVideoRun() {
    if (!canStartVideo) {
      setSaveToast({ message: "Add prompts and required reference first.", type: "error" });
      return;
    }
    if (videoRuns.length >= MAX_VIDEO_RUNS) {
      setSaveToast({ message: `Max ${MAX_VIDEO_RUNS} runs`, type: "error" });
      return;
    }

    const run: VideoRun = {
      id: crypto.randomUUID(),
      name: `${videoModelDef.label} - ${new Date().toLocaleTimeString()}`,
      startedAt: Date.now(),
      modelId: videoModel,
      modelLabel: videoModelDef.label,
      isBatch: false,
      prompts: [...videoPromptLines],
      status: "running",
      error: null,
      videos: [],
      activeIdx: 0,
      selectedIdx: new Set(),
      progress: { done: 0, total: videoPromptLines.length },
      speed: videoParallel,
      controller: new AbortController(),
    };

    const context: VideoRunContext = {
      productId: selectedId !== "custom" ? selectedId : null,
      customUrl: selectedId === "custom" ? (finalReferenceUrl || null) : null,
      referenceUrl: finalReferenceUrl || null,
      kling: { duration: klingDuration, aspect: klingAspect, negative: klingNeg, cfg: klingCfg },
      veo: { aspect: veoAspect, generation: veoGenType, seed: veoSeed, secondImage: veoSecondImage.trim() },
      sora: { frames: soraFrames, aspect: soraAspect, shots: soraShotsText, imageUrl: trimmedSoraImageUrl },
    };

    addRun(run);
    void executeVideoRun(run, context);
  }

  function startBatchVideoRun() {
    if (!canStartBatch) {
      setSaveToast({ message: "Provide a prompt and upload images.", type: "error" });
      return;
    }
    if (videoRuns.length >= MAX_VIDEO_RUNS) {
      setSaveToast({ message: `Max ${MAX_VIDEO_RUNS} runs`, type: "error" });
      return;
    }

    const run: VideoRun = {
      id: crypto.randomUUID(),
      name: `${videoModelDef.label} Batch - ${new Date().toLocaleTimeString()}`,
      startedAt: Date.now(),
      modelId: videoModel,
      modelLabel: videoModelDef.label,
      isBatch: true,
      prompts: [batchVideoPrompt.trim()],
      status: "running",
      error: null,
      videos: [],
      activeIdx: 0,
      selectedIdx: new Set(),
      progress: { done: 0, total: batchVideoImages.length },
      speed: videoParallel,
      controller: new AbortController(),
    };

    const context: VideoRunContext = {
      productId: selectedId !== "custom" ? selectedId : null,
      customUrl: selectedId === "custom" ? (finalReferenceUrl || null) : null,
      referenceUrl: finalReferenceUrl || null,
      kling: { duration: klingDuration, aspect: klingAspect, negative: klingNeg, cfg: klingCfg },
      veo: { aspect: veoAspect, generation: veoGenType, seed: veoSeed, secondImage: veoSecondImage.trim() },
      sora: { frames: soraFrames, aspect: soraAspect, shots: soraShotsText, imageUrl: trimmedSoraImageUrl },
      batchImages: [...batchVideoImages],
    };

    addRun(run);
    void executeVideoRun(run, context);
  }
  
  async function executeVideoRun(run: VideoRun, context: VideoRunContext) {
    const controller = run.controller;
    if (!controller) return;
    const modelOption =
      VIDEO_MODEL_GROUPS.flatMap((group) => group.options).find((opt) => opt.id === run.modelId) ??
      VIDEO_MODEL_GROUPS[0].options[0];
    const runIsKling = modelOption.provider === "kling";
    const runIsKlingText = runIsKling && modelOption.kind === "text-to-video";
    const runIsKlingImage = runIsKling && modelOption.kind === "image-to-video";
    const runIsVeo = modelOption.provider === "veo";
    const runIsSora = modelOption.provider === "sora";

    const pushVideo = (video: VideoItem) => {
      setVideoRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          const videos = [...item.videos, video];
          const activeIdx = videos.length === 1 ? 0 : item.activeIdx;
          return { ...item, videos, activeIdx };
        })
      );
    };

    const incProgress = () => {
      setVideoRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          const done = item.progress.done + 1;
          return { ...item, progress: { done, total: item.progress.total } };
        })
      );
    };

    const setError = (message: string) => {
      setVideoRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          return { ...item, status: "error" as RunStatus, error: message, controller: null };
        })
      );
    };

    const tasks: Array<() => Promise<void>> = [];

    if (run.isBatch) {
        // ... (batch logic same as before)
        const prompt = run.prompts[0];
      (context.batchImages || []).forEach((imageUrl, index) => {
        tasks.push(async () => {
          let provider: VideoProvider = "kling";
          let body: any = {};
          if (runIsKling) {
            const cfgVal = Number.isFinite(Number(context.kling.cfg)) ? Number(context.kling.cfg) : undefined;
            provider = "kling";
            body = {
              provider,
              model: run.modelId,
              mode: "image-to-video",
              prompt,
              duration: context.kling.duration,
              imageUrl,
              ...(context.kling.negative.trim() ? { negative_prompt: context.kling.negative.trim() } : {}),
              ...(typeof cfgVal === "number" ? { cfg_scale: cfgVal } : {}),
            };
          } else if (runIsVeo) {
            provider = "veo";
            const imgs = [imageUrl];
            if (context.veo.secondImage) imgs.push(context.veo.secondImage);
            let effectiveGen = context.veo.generation;
            if (run.modelId === "veo3" && context.veo.generation === "REFERENCE_2_VIDEO") {
              effectiveGen = "TEXT_2_VIDEO";
            }
            body = {
              provider,
              model: run.modelId,
              prompt,
              aspectRatio: context.veo.aspect,
              generationType: effectiveGen,
              imageUrls: imgs,
              ...(context.veo.seed.trim() ? { seeds: Number(context.veo.seed) } : {}),
            };
          } else {
            provider = "sora";
            const shots = context.sora.shots
              .split(/\r?\n/)
              .map((row) => row.trim())
              .filter(Boolean)
              .map((row) => {
                const [durStr, ...rest] = row.split("|");
                const duration = Math.max(1, Number(durStr.trim() || "1"));
                const Scene = rest.join("|").trim() || prompt;
                return { duration, Scene };
              });
            body = {
              provider,
              model: run.modelId,
              input: {
                n_frames: context.sora.frames,
                aspect_ratio: context.sora.aspect,
                image_urls: [imageUrl],
                shots,
              },
            };
          }

          const res = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || "Generation failed");
          pushVideo({ id: crypto.randomUUID(), prompt: `${prompt} [img ${index + 1}]`, url: json.videoUrl });
          incProgress();
        });
      });
    } else {
      run.prompts.forEach((line, index) => {
        tasks.push(async () => {
           // ... (normal run logic same as before)
           let provider: VideoProvider = "kling";
          let body: any = {};
          if (runIsKling) {
            const cfgVal = Number.isFinite(Number(context.kling.cfg)) ? Number(context.kling.cfg) : undefined;
            provider = "kling";
            body = {
              provider,
              model: run.modelId,
              mode: runIsKlingText ? "text-to-video" : "image-to-video",
              prompt: line,
              duration: context.kling.duration,
              ...(runIsKlingText ? { aspect_ratio: context.kling.aspect } : {}),
              ...(context.kling.negative.trim() ? { negative_prompt: context.kling.negative.trim() } : {}),
              ...(typeof cfgVal === "number" ? { cfg_scale: cfgVal } : {}),
              ...(runIsKlingImage
                ? {
                    productId: context.productId,
                    customUrl: context.customUrl,
                  }
                : {}),
            };
          } else if (runIsVeo) {
            provider = "veo";
            const imgs: string[] = [];
            if (context.referenceUrl) imgs.push(context.referenceUrl);
            if (context.veo.secondImage) imgs.push(context.veo.secondImage);
            let effectiveGen = context.veo.generation;
            if (run.modelId === "veo3" && context.veo.generation === "REFERENCE_2_VIDEO") {
              effectiveGen = "TEXT_2_VIDEO";
            }
            body = {
              provider,
              model: run.modelId,
              prompt: line,
              aspectRatio: context.veo.aspect,
              generationType: effectiveGen,
              ...(imgs.length ? { imageUrls: imgs } : {}),
              ...(context.veo.seed.trim() ? { seeds: Number(context.veo.seed) } : {}),
            };
          } else {
            provider = "sora";
            const shots = context.sora.shots
              .split(/\r?\n/)
              .map((row) => row.trim())
              .filter(Boolean)
              .map((row) => {
                const [durStr, ...rest] = row.split("|");
                const duration = Math.max(1, Number(durStr.trim() || "1"));
                const Scene = rest.join("|").trim() || line;
                return { duration, Scene };
              });
            const imageUrls = context.sora.imageUrl
              ? [context.sora.imageUrl]
              : context.referenceUrl
              ? [context.referenceUrl]
              : [];
            body = {
              provider,
              model: run.modelId,
              input: {
                n_frames: context.sora.frames,
                aspect_ratio: context.sora.aspect,
                image_urls: imageUrls,
                shots,
              },
            };
          }

          const res = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(json.error || `Generation failed (${index + 1})`);
          pushVideo({ id: crypto.randomUUID(), prompt: line, url: json.videoUrl });
          incProgress();
        });
      });
    }

    try {
      await runWithLimit(Math.max(1, Math.min(run.speed, MAX_CONCURRENT_REQUESTS)), tasks);
      setVideoRuns((prev) =>
        prev.map((item) => {
          if (item.id !== run.id) return item;
          if (item.status === "running") return { ...item, status: "done" as RunStatus };
          return item;
        })
      );
    } catch (error: any) {
      const msg = error?.name === "AbortError" ? "Run cancelled" : error?.message || "Request failed";
      setError(msg);
    }
  }

  return (
    <div className="min-h-screen bg-[#fcfcfc] p-4 lg:p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-6 flex items-center justify-between">
           <div className="flex items-center gap-3">
               <h1 className="text-xl font-bold text-slate-900 tracking-tight">Video Studio</h1>
               <div className="h-4 w-px bg-slate-200" />
               <div className="flex gap-1 text-xs font-medium text-slate-500">
                   <span>Runs: {videoRuns.length}</span>
                   <span className="text-slate-300">•</span>
                   <span>Active: {videoRuns.filter(r => r.status === "running").length}</span>
               </div>
           </div>
           <Link href="/library" className="text-xs font-medium text-indigo-600 hover:text-indigo-700">
             View Library &rarr;
           </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_380px_minmax(0,1fr)] items-start">
          
          {/* Column 1: Configuration */}
          <div className="space-y-6">
             {/* Model Select */}
             <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                 <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400">Model</h2>
                 <div className="space-y-4">
                     {VIDEO_MODEL_GROUPS.map(group => (
                         <div key={group.label}>
                             <p className="mb-2 text-[10px] font-bold uppercase text-slate-400 opacity-70">{group.label}</p>
                             <div className="space-y-2">
                                 {group.options.map(option => (
                                     <button
                                        key={option.id}
                                        onClick={() => setVideoModel(option.id)}
                                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left text-sm transition-all ${ 
                                            videoModel === option.id
                                            ? "border-indigo-600 ring-1 ring-indigo-600 bg-indigo-50/50 text-indigo-900"
                                            : "border-slate-200 hover:border-slate-300 text-slate-700"
                                        }`}
                                     >
                                         <span className="font-medium">{option.label}</span>
                                     </button>
                                 ))}
                             </div>
                         </div>
                     ))}
                 </div>
                 
                 {/* Model Specific Params */}
                 <div className="mt-4 border-t border-slate-100 pt-4">
                     {/* Kling Params */}
                     {isKling && (
                         <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400">Duration</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" value={klingDuration} onChange={e => setKlingDuration(e.target.value as any)}>
                                        <option value="5">5s</option>
                                        <option value="10">10s</option>
                                    </select>
                                </div>
                                {isKlingText && (
                                    <div>
                                        <label className="text-[10px] font-bold uppercase text-slate-400">Aspect</label>
                                        <select className="w-full mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" value={klingAspect} onChange={e => setKlingAspect(e.target.value as any)}>
                                            <option value="16:9">16:9</option>
                                            <option value="9:16">9:16</option>
                                            <option value="1:1">1:1</option>
                                        </select>
                                    </div>
                                )}
                            </div>
                            <div>
                                <label className="text-[10px] font-bold uppercase text-slate-400">Negative</label>
                                <input className="w-full mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" placeholder="Optional" value={klingNeg} onChange={e => setKlingNeg(e.target.value)} />
                            </div>
                         </div>
                     )}
                     {/* Veo Params */}
                     {isVeo && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                 <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400">Aspect</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" value={veoAspect} onChange={e => setVeoAspect(e.target.value as any)}>
                                        <option value="16:9">16:9</option>
                                        <option value="9:16">9:16</option>
                                    </select>
                                </div>
                                 <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400">Seed</label>
                                    <input className="w-full mt-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs" placeholder="Random" value={veoSeed} onChange={e => setVeoSeed(e.target.value)} />
                                </div>
                            </div>
                        </div>
                     )}
                 </div>
             </div>

             {/* Context / Reference */}
             <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
                 <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400">Context</h2>
                     {videoNeedsImage && (
                        <span className={`h-2 w-2 rounded-full ${finalReferenceUrl ? "bg-emerald-500" : "bg-rose-500"}`} />
                    )}
                 </div>
                 
                 <div className="space-y-4">
                     <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Subject / Product</label>
                        <select
                            className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={selectedId}
                            onChange={(e) => { setSelectedId(e.target.value); setReferenceUploadPreview(null); setReferenceUploadedUrl(null); }}
                        >
                            <option value="custom">Custom</option>
                            {products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                     </div>
                     
                     {selectedId !== "custom" && selectedProduct && (
                         <div className="flex gap-3 items-center rounded-lg bg-slate-50 p-2 border border-slate-100">
                             {selectedProduct.image_url && (
                                 // eslint-disable-next-line @next/next/no-img-element
                                 <img src={selectedProduct.image_url} className="h-10 w-10 rounded object-cover" alt="" />
                             )}
                             <span className="text-xs font-semibold text-slate-700">{selectedProduct.name}</span>
                         </div>
                     )}
                     
                     <div className="space-y-2">
                         <label className="text-xs font-medium text-slate-600">Reference Source</label>
                         {selectedId === "custom" ? (
                             <div className="space-y-2">
                                <input 
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs"
                                    placeholder="Video Reference URL..."
                                    value={customVideoUrl}
                                    onChange={(e) => { setCustomVideoUrl(e.target.value); setReferenceUploadedUrl(null); }}
                                />
                                <label className="flex w-full items-center justify-center rounded-lg border border-dashed border-slate-300 p-4 text-xs text-slate-500 hover:bg-slate-50 cursor-pointer transition">
                                    <input type="file" accept="image/*" className="hidden" onChange={e => handleReferenceUpload(e.target.files)} />
                                    {referenceUploadPreview ? "Change Image" : "Upload Image"}
                                </label>
                             </div>
                         ) : (
                             <p className="text-xs text-slate-400 italic">Using product image as reference.</p>
                         )}
                         
                         {referenceUploadPreview && (
                             <div className="relative rounded-lg overflow-hidden border border-slate-200">
                                 {/* eslint-disable-next-line @next/next/no-img-element */}
                                 <img src={referenceUploadPreview} className="w-full h-32 object-cover" alt="" />
                             </div>
                         )}
                     </div>
                 </div>
             </div>
          </div>

          {/* Column 2: Creation */}
          <div className="flex flex-col gap-6 h-[calc(100vh-120px)]">
             <div className="flex-1 flex flex-col rounded-xl border border-slate-200 bg-white p-1 shadow-sm overflow-hidden">
                 <div className="flex items-center justify-between p-3 border-b border-slate-100 bg-slate-50/50">
                     <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">Director</h2>
                     <div className="flex items-center gap-2">
                        <PromptAssistant 
                            onAccept={(newPrompts) => {
                                setVideoPrompts(prev => {
                                    const prefix = prev.trim() ? prev.trim() + "\n" : "";
                                    return prefix + newPrompts.join("\n");
                                });
                            }}
                        />
                         <div className="h-4 w-px bg-slate-200" />
                          <select 
                            className="bg-transparent text-xs font-medium text-slate-600 focus:outline-none"
                            value={videoParallel}
                            onChange={(e) => setVideoParallel(Number(e.target.value))}
                        >
                            {RUN_PARALLEL_OPTIONS.map(s => <option key={s} value={s}>Parallel {s}x</option>)}
                         </select>
                     </div>
                </div>
                
                {batchVideoMode ? (
                    <div className="flex-1 p-6 space-y-6">
                        <div className="p-4 rounded-lg bg-indigo-50 border border-indigo-100">
                            <h3 className="text-sm font-bold text-indigo-900 mb-2">Batch Mode Active</h3>
                            <p className="text-xs text-indigo-700">One prompt will be applied to all uploaded images.</p>
                        </div>
                        <div className="space-y-2">
                             <label className="text-xs font-bold uppercase text-slate-500">Batch Prompt</label>
                             <textarea 
                                className="w-full rounded-lg border border-slate-200 p-3 text-sm"
                                rows={3}
                                placeholder="Describe the motion..."
                                value={batchVideoPrompt}
                                onChange={(e) => setBatchVideoPrompt(e.target.value)}
                             />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase text-slate-500">Images ({batchVideoImages.length})</label>
                            <div className="grid grid-cols-4 gap-2">
                                <label className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-slate-300 hover:bg-slate-50 cursor-pointer">
                                    <span className="text-xl text-slate-400">+</span>
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={e => handleBatchVideoUpload(e.target.files)} />
                                </label>
                                {batchVideoPreviews.map((src, i) => (
                                    <div key={i} className="rounded-lg overflow-hidden border border-slate-200 bg-slate-100">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={src} className="h-full w-full object-cover" alt="" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <textarea 
                        className="flex-1 w-full resize-none p-4 text-sm outline-none text-slate-700 placeholder:text-slate-300 font-mono leading-relaxed"
                        placeholder="One video prompt per line..."
                        value={videoPrompts}
                        onChange={(e) => setVideoPrompts(e.target.value)}
                    />
                )}

                <div className="p-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 cursor-pointer select-none">
                            <input type="checkbox" checked={batchVideoMode} onChange={e => setBatchVideoMode(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500" />
                            Batch Mode
                        </label>
                     </div>
                     <button
                        onClick={batchVideoMode ? startBatchVideoRun : startVideoRun}
                        disabled={batchVideoMode ? !canStartBatch : !canStartVideo}
                        className="px-6 py-2 bg-slate-900 text-white text-sm font-semibold rounded-lg hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
                    >
                        {videoSomethingRunning ? "Running..." : "Start Generation"}
                    </button>
                </div>
             </div>
          </div>

          {/* Column 3: Feed */}
          <div className="flex flex-col gap-4 h-[calc(100vh-120px)]">
              {/* Active Video Card */}
              {activeVideoRun ? (
                  <div className="flex flex-col flex-1 rounded-xl border border-slate-200 bg-white shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100">
                           <div className="flex items-center justify-between mb-2">
                             <span className="font-semibold text-sm text-slate-900">{activeVideoRun.name}</span>
                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ring-1 ring-inset ${statusColor(activeVideoRun.status)}`}>
                                 {activeVideoRun.status}
                             </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 rounded-full overflow-hidden">
                             <div className="h-full bg-slate-900 transition-all duration-500" style={{ width: `${activeVideoRun.progress.total > 0 ? Math.round((activeVideoRun.progress.done / activeVideoRun.progress.total) * 100) : 0}%` }} />
                        </div>
                      </div>

                      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30">
                          {activeVideoRun.videos.length > 0 ? (
                              <div className="space-y-3">
                                  <div className="rounded-lg overflow-hidden bg-black shadow-lg">
                                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                      <video 
                                        src={activeVideoRun.videos[activeVideoRun.activeIdx].url} 
                                        controls 
                                        playsInline 
                                        className="w-full aspect-video object-contain" 
                                      />
                                  </div>
                                  <div className="flex items-center justify-between px-1">
                                     <button onClick={() => stepActiveVideo(activeVideoRun.id, -1)} className="p-1 hover:bg-slate-100 rounded text-slate-500">←</button>
                                     <span className="text-xs font-medium text-slate-600">{activeVideoRun.activeIdx + 1} of {activeVideoRun.videos.length}</span>
                                     <button onClick={() => stepActiveVideo(activeVideoRun.id, 1)} className="p-1 hover:bg-slate-100 rounded text-slate-500">→</button>
                                 </div>
                                 <div className="bg-white p-3 rounded-lg border border-slate-100 text-xs text-slate-600 leading-relaxed">
                                     {activeVideoRun.videos[activeVideoRun.activeIdx].prompt}
                                 </div>
                                 
                                 <div className="grid grid-cols-4 gap-2 pt-2 border-t border-slate-100">
                                     {activeVideoRun.videos.map((vid, idx) => (
                                         <button
                                            key={vid.id}
                                            onClick={() => {
                                                 setVideoRuns(prev => prev.map(r => r.id === activeVideoRun.id ? { ...r, activeIdx: idx } : r));
                                            }}
                                            className={`aspect-video rounded overflow-hidden border bg-black ${activeVideoRun.activeIdx === idx ? 'border-slate-900 ring-1 ring-slate-900' : 'border-slate-200 opacity-70 hover:opacity-100'}`}
                                         >
                                             {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                             <video src={vid.url} className="h-full w-full object-cover pointer-events-none" />
                                         </button>
                                     ))}
                                 </div>
                              </div>
                          ) : (
                              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                 <div className="h-8 w-8 border-2 border-slate-200 border-t-slate-400 rounded-full animate-spin" />
                                 <span className="text-xs">Generating video...</span>
                             </div>
                          )}
                      </div>
                  </div>
              ) : (
                  <div className="flex-1 rounded-xl border border-dashed border-slate-200 bg-slate-50/50 flex items-center justify-center text-slate-400 text-sm">
                    No active video run
                </div>
              )}

              {/* Queue */}
              <div className="h-1/3 rounded-xl border border-slate-200 bg-white p-4 overflow-y-auto shadow-sm">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">Recent Runs</h3>
                  <div className="space-y-2">
                    {videoRuns.map(run => (
                        <div key={run.id} 
                             onClick={() => setActiveVideoRunId(run.id)}
                             className={`group p-3 rounded-lg border cursor-pointer transition ${activeVideoRunId === run.id ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-100 hover:border-slate-300'}`}
                        >
                            <div className="flex justify-between items-center">
                                <span className="font-semibold text-xs">{run.name}</span>
                                <span className={`text-[9px] uppercase font-bold ${activeVideoRunId === run.id ? 'text-slate-400' : 'text-slate-400'}`}>{run.status}</span>
                            </div>
                            <div className="mt-1 flex justify-between text-[10px] opacity-80">
                                <span>{run.videos.length} vids</span>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); deleteVideoRun(run.id); }}
                                    className="hover:text-red-400"
                                >
                                    Dismiss
                                </button>
                            </div>
                        </div>
                    ))}
                    {videoRuns.length === 0 && <p className="text-xs text-slate-400 italic">History empty.</p>}
                </div>
              </div>
          </div>

        </div>
      </div>
      
       {/* Toast Notification */}
      {saveToast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all transform translate-y-0 ${saveToast.type === 'success' ? 'bg-slate-900 text-white' : 'bg-rose-600 text-white'}`}>
          {saveToast.message}
        </div>
      )}
    </div>
  );
}