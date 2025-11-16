"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { MODEL_LIST } from "@/lib/models";

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
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-10">
        <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-purple-50 via-white to-indigo-50 p-10 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr),320px] lg:items-center">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-purple-500">Outlight Video Studio</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">
                Multi-model video generation with production oversight.
              </h1>
              <p className="mt-4 text-base text-slate-600">
                Move between Kling, Veo, and Sora workflows with structured prompts, reference stewardship, and clean run history.
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
            <dl className="grid grid-cols-2 gap-4 rounded-2xl border border-purple-100 bg-white/70 p-5 text-sm text-slate-600 shadow-inner">
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Models</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">
                  {VIDEO_MODEL_GROUPS.reduce((acc, g) => acc + g.options.length, 0)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-slate-400">Image Models</dt>
                <dd className="mt-1 text-2xl font-semibold text-slate-900">{MODEL_LIST.length}</dd>
              </div>
            </dl>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[420px,1fr]">
          <div className="space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">Video Model</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Select Engine</h2>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                  {videoModelDef.label}
                </span>
              </div>
              <div className="mt-5 space-y-4">
                {VIDEO_MODEL_GROUPS.map((group) => (
                  <div key={group.label}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{group.label}</p>
                    <div className="mt-2 space-y-2">
                      {group.options.map((option) => {
                        const active = option.id === videoModel;
                        return (
                          <button
                            key={option.id}
                            onClick={() => setVideoModel(option.id)}
                            className={`w-full rounded-xl border px-4 py-3 text-left text-sm transition ${
                              active
                                ? "border-slate-900 bg-slate-900 text-white shadow-sm"
                                : "border-slate-200 hover:border-slate-300"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span>{option.label}</span>
                              <span className="text-xs uppercase tracking-wide opacity-70">{option.kind}</span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-5">
              {(() => {
                if (videoModelDef.provider === "kling") {
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">Kling Controls</h3>
                        <span className="text-xs text-slate-500">{videoModelDef.kind}</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <label className="text-xs font-semibold text-slate-500">
                          Duration
                          <select
                            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                            value={klingDuration}
                            onChange={(e) => setKlingDuration(e.target.value as "5" | "10")}
                          >
                            <option value="5">5s</option>
                            <option value="10">10s</option>
                          </select>
                        </label>
                        {isKlingText && (
                          <label className="text-xs font-semibold text-slate-500">
                            Aspect
                            <select
                              className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                              value={klingAspect}
                              onChange={(e) => setKlingAspect(e.target.value as "16:9" | "9:16" | "1:1")}
                            >
                              <option value="16:9">16:9</option>
                              <option value="9:16">9:16</option>
                              <option value="1:1">1:1</option>
                            </select>
                          </label>
                        )}
                      </div>
                      <label className="text-xs font-semibold text-slate-500">
                        Negative Prompt
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          placeholder="Optional"
                          value={klingNeg}
                          onChange={(e) => setKlingNeg(e.target.value)}
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-500">
                        CFG Scale
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={klingCfg}
                          onChange={(e) => setKlingCfg(e.target.value)}
                        />
                      </label>
                    </>
                  );
                }
                if (videoModelDef.provider === "veo") {
                  return (
                    <>
                      <div className="flex items-center justify-between">
                        <h3 className="text-sm font-semibold text-slate-900">Veo Controls</h3>
                        <span className="text-xs text-slate-500">{videoModelDef.label}</span>
                      </div>
                      <label className="text-xs font-semibold text-slate-500">
                        Aspect Ratio
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={veoAspect}
                          onChange={(e) => setVeoAspect(e.target.value as VeoRatio)}
                        >
                          <option value="16:9">16:9</option>
                          <option value="9:16">9:16</option>
                          <option value="Auto">Auto</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">
                        Mode
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={veoGenType}
                          onChange={(e) => setVeoGenType(e.target.value as VeoGenType)}
                        >
                          <option value="TEXT_2_VIDEO">Text to Video</option>
                          <option value="FIRST_AND_LAST_FRAMES_2_VIDEO">First + Last Frames</option>
                          <option value="REFERENCE_2_VIDEO">Reference to Video</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">
                        Seed (optional)
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          placeholder="10000"
                          value={veoSeed}
                          onChange={(e) => setVeoSeed(e.target.value)}
                        />
                      </label>
                      <label className="text-xs font-semibold text-slate-500">
                        Secondary Image URL
                        <input
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          placeholder="https://..."
                          value={veoSecondImage}
                          onChange={(e) => setVeoSecondImage(e.target.value)}
                        />
                      </label>
                    </>
                  );
                }
                return (
                  <>
                    <div className="flex items-center justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">Sora Storyboard</h3>
                      <span className="text-xs text-slate-500">{videoModelDef.label}</span>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <label className="text-xs font-semibold text-slate-500">
                        Frames
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={soraFrames}
                          onChange={(e) => setSoraFrames(e.target.value as "10" | "15" | "25")}
                        >
                          <option value="10">10</option>
                          <option value="15">15</option>
                          <option value="25">25</option>
                        </select>
                      </label>
                      <label className="text-xs font-semibold text-slate-500">
                        Aspect
                        <select
                          className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                          value={soraAspect}
                          onChange={(e) => setSoraAspect(e.target.value as "portrait" | "landscape")}
                        >
                          <option value="landscape">Landscape</option>
                          <option value="portrait">Portrait</option>
                        </select>
                      </label>
                    </div>
                    <label className="text-xs font-semibold text-slate-500">
                      Shot Script
                      <textarea
                        className="mt-1 h-28 w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm"
                        value={soraShotsText}
                        onChange={(e) => setSoraShotsText(e.target.value)}
                      />
                    </label>
                    <label className="text-xs font-semibold text-slate-500">
                      Reference Image URL
                      <input
                        className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                        placeholder="https://..."
                        value={soraImageUrl}
                        onChange={(e) => setSoraImageUrl(e.target.value)}
                      />
                    </label>
                  </>
                );
              })()}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-400">
                    Reference
                  </p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Product Context</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    Required for Kling image-to-video and Sora storyboard. Optional for Veo text runs.
                  </p>
                </div>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    videoNeedsImage && !finalReferenceUrl
                      ? "bg-rose-50 text-rose-700"
                      : "bg-emerald-50 text-emerald-700"
                  }`}
                >
                  {videoNeedsImage && !finalReferenceUrl ? "Needs reference" : "Ready"}
                </span>
              </div>
              <select
                className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={selectedId}
                onChange={(e) => {
                  setSelectedId(e.target.value);
                  setReferenceUploadPreview(null);
                  setReferenceUploadedUrl(null);
                }}
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
                        className="h-28 w-full object-cover"
                      />
                    </div>
                  )}
                </div>
              )}
              <label className="text-xs font-semibold text-slate-500">
                Custom Reference URL
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="https://..."
                  value={customVideoUrl}
                  onChange={(e) => {
                    setCustomVideoUrl(e.target.value);
                    setReferenceUploadedUrl(null);
                    setReferenceUploadPreview(null);
                  }}
                  disabled={selectedId !== "custom"}
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Upload Reference (creates public URL)
                <label className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 hover:border-slate-400">
                  <input type="file" accept="image/*" className="hidden" onChange={(e) => handleReferenceUpload(e.target.files)} />
                  Drop file or click to upload
                </label>
              </label>
              {referenceUploadPreview && (
                <div className="overflow-hidden rounded-xl border border-slate-200">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={referenceUploadPreview} alt="Reference preview" className="h-28 w-full object-cover" />
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Batch Mode</h3>
                <label className="flex items-center gap-2 text-xs text-slate-500">
                  <input
                    type="checkbox"
                    checked={batchVideoMode}
                    onChange={(e) => setBatchVideoMode(e.target.checked)}
                  />
                  Enable
                </label>
              </div>
              <p className="text-sm text-slate-500">
                Upload multiple reference frames to generate one video per image with the same prompt.
              </p>
              <label className="text-xs font-semibold text-slate-500">
                Batch Prompt
                <input
                  className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                  placeholder="Describe the scene..."
                  value={batchVideoPrompt}
                  onChange={(e) => setBatchVideoPrompt(e.target.value)}
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">
                Upload Images
                <label className="mt-1 flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-slate-50 px-3 py-6 text-center text-sm text-slate-500 hover:border-slate-400">
                  <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => handleBatchVideoUpload(e.target.files)} />
                  {batchVideoUploading ? "Uploading..." : "Drop files or click to upload"}
                </label>
              </label>
              {batchVideoPreviews.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {batchVideoPreviews.map((preview, idx) => (
                    <div key={idx} className="overflow-hidden rounded-xl border border-slate-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={preview} alt={`Batch ${idx + 1}`} className="h-20 w-full object-cover" />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="space-y-8">
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Prompts</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">Video Direction</h2>
                  <p className="text-xs text-slate-500">One line per video.</p>
                </div>
                <label className="text-xs text-slate-500">
                  Parallel
                  <select
                    className="ml-2 rounded-full border border-slate-200 px-3 py-1 text-sm"
                    value={videoParallel}
                    onChange={(e) => setVideoParallel(Number(e.target.value))}
                  >
                    {RUN_PARALLEL_OPTIONS.map((val) => (
                      <option key={val} value={val}>
                        {val}x
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <textarea
                className="mt-4 h-48 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm"
                placeholder="Kling camera push-in on a chrome floor lamp..."
                value={videoPrompts}
                onChange={(e) => setVideoPrompts(e.target.value)}
              />
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button
                  onClick={startVideoRun}
                  disabled={!canStartVideo || videoSomethingRunning}
                  className={`rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm transition ${
                    canStartVideo && !videoSomethingRunning ? "bg-slate-900 hover:bg-slate-800" : "bg-slate-300 cursor-not-allowed"
                  }`}
                >
                  {videoSomethingRunning ? "Running..." : `Generate ${videoPromptLines.length || ""}`}
                </button>
                <button
                  onClick={startBatchVideoRun}
                  disabled={!batchVideoMode || !canStartBatch}
                  className={`rounded-full border px-4 py-2 text-sm ${
                    batchVideoMode && canStartBatch
                      ? "border-slate-900 text-slate-900"
                      : "border-slate-200 text-slate-400 cursor-not-allowed"
                  }`}
                >
                  Run Batch ({batchVideoImages.length})
                </button>
                <span className="text-xs text-slate-400">Limit {MAX_VIDEO_RUNS} concurrent runs.</span>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Active Run</p>
                  <h2 className="mt-1 text-xl font-semibold text-slate-900">
                    {activeVideoRun ? activeVideoRun.name : "No runs yet"}
                  </h2>
                  {activeVideoRun && (
                    <p className="text-xs uppercase tracking-wide text-slate-500">
                      {activeVideoRun.status} - {activeVideoRun.progress.done}/{activeVideoRun.progress.total}
                    </p>
                  )}
                </div>
                {activeVideoRun && (
                  <div className="flex gap-2">
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={() => cancelVideoRun(activeVideoRun.id)}
                    >
                      Cancel
                    </button>
                    <button
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                      onClick={() => deleteVideoRun(activeVideoRun.id)}
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
              {activeVideoRun ? (
                <>
                  {activeVideoRun.videos.length > 0 ? (
                    <div className="mt-4 space-y-3">
                      <div className="rounded-2xl border border-slate-100 bg-black/5 p-3">
                        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                        <video
                          className="h-[320px] w-full rounded-xl bg-black object-cover"
                          src={activeVideoRun.videos[activeVideoRun.activeIdx].url}
                          controls
                          playsInline
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <button onClick={() => stepActiveVideo(activeVideoRun.id, -1)}>Previous</button>
                        <span>
                          {activeVideoRun.activeIdx + 1} / {activeVideoRun.videos.length}
                        </span>
                        <button onClick={() => stepActiveVideo(activeVideoRun.id, 1)}>Next</button>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <button
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                          onClick={() => {
                            const current = activeVideoRun.videos[activeVideoRun.activeIdx];
                            const base = safeName(activeVideoRun.name || "video");
                            const a = document.createElement("a");
                            a.href = current.url;
                            a.download = `${base}_${activeVideoRun.activeIdx + 1}.mp4`;
                            document.body.appendChild(a);
                            a.click();
                            a.remove();
                          }}
                        >
                          Download
                        </button>
                        <button
                          className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-white"
                          onClick={() => {
                            const updated = activeVideoRun.selectedIdx.has(activeVideoRun.activeIdx);
                            toggleVideoSelection(activeVideoRun.id, activeVideoRun.activeIdx);
                            setSaveToast({
                              message: updated ? "Frame removed from selection" : "Frame tagged for download",
                              type: "success",
                            });
                          }}
                        >
                          Toggle Select
                        </button>
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        {activeVideoRun.videos.map((vid, idx) => {
                          const isSelected = activeVideoRun.selectedIdx.has(idx);
                          return (
                            <button
                              key={vid.id}
                              className={`rounded-xl border p-1 ${isSelected ? "border-slate-900" : "border-slate-200"}`}
                              onClick={() => {
                                setActiveVideoRun(activeVideoRun.id);
                                setVideoRuns((prev) =>
                                  prev.map((run) => (run.id === activeVideoRun.id ? { ...run, activeIdx: idx } : run))
                                );
                              }}
                            >
                              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                              <video src={vid.url} className="h-16 w-full rounded-lg bg-black object-cover" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ) : (
                    <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500">
                      Waiting for first video...
                    </div>
                  )}
                </>
              ) : (
                <div className="mt-4 rounded-2xl border border-dashed border-slate-200 p-6 text-center text-slate-500">
                  No runs yet. Start one to monitor results.
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-slate-900">Run Queue</h2>
                <span className="text-xs text-slate-500">{videoRuns.length} total</span>
              </div>
              {videoRuns.length === 0 ? (
                <p className="mt-4 text-sm text-slate-500">Runs will appear here with status and progress.</p>
              ) : (
                <div className="mt-4 space-y-3">
                  {videoRuns.map((run) => (
                    <div
                      key={run.id}
                      className={`rounded-2xl border px-4 py-3 text-sm shadow-sm ${
                        run.id === activeVideoRun?.id ? "border-slate-900 bg-slate-50" : "border-slate-200 bg-white"
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <button className="font-semibold text-slate-900 hover:underline" onClick={() => setActiveVideoRun(run.id)}>
                            {run.name}
                          </button>
                          <p className="text-xs text-slate-500">
                            {run.prompts.length} prompt(s) - {run.modelLabel}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          <span
                            className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold text-white ${run.status === "running"
                              ? "bg-emerald-500"
                              : run.status === "done"
                              ? "bg-slate-900"
                              : run.status === "error"
                              ? "bg-rose-500"
                              : "bg-slate-400"
                            }`}
                          >
                            {run.status}
                          </span>
                          <button className="text-xs text-slate-500 hover:text-slate-900" onClick={() => cancelVideoRun(run.id)}>
                            Cancel
                          </button>
                          <button className="text-xs text-slate-500 hover:text-rose-600" onClick={() => deleteVideoRun(run.id)}>
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 h-1.5 rounded-full bg-slate-200">
                        <div
                          className="h-1.5 rounded-full bg-slate-900"
                          style={{
                            width:
                              run.progress.total === 0 ? "0%" : `${Math.round((run.progress.done / run.progress.total) * 100)}%`,
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
      {saveToast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg">
          {saveToast.message}
        </div>
      )}
    </div>
  );
}
