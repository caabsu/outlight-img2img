"use client";

import { useEffect, useMemo, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { MODEL_LIST, getModelById } from "@/lib/models";
import {
  loadAdStudioSession,
  debouncedSaveAdSession,
  serializeAdCampaign,
  deserializeAdCampaign,
  type AdStudioSession,
} from "@/lib/session-storage";
import type { AdConcept, AdImage, LogEntry, AdFeedbackSubmission } from "@/lib/ad-types";

/* ========================= TYPES ========================= */

type Product = {
  id: string;
  name: string;
  slug: string;
  image_url: string;
  shopify_id?: string | null;
  shopify_vendor?: string | null;
  shopify_product_type?: string | null;
  shopify_price?: string | null;
  shopify_images?: string[] | null;
};

type Profile = {
  id: string;
  name: string;
  role: string;
  client_id?: string;
};

type AgentStatus = "idle" | "running" | "done" | "error" | "cancelled";

type AdCampaign = {
  id: string;
  name: string;
  startedAt: number;
  theme: string;
  modelId: string;
  quantity: number;
  speed: number;
  aspectRatios: string[];
  productId: string;
  productName: string;
  modelOptions: Record<string, string>;
  status: AgentStatus;
  concepts: AdConcept[];
  images: AdImage[];
  logEntries: LogEntry[];
  progress: { done: number; total: number };
  feedbackRatings: Record<number, number>;
  selectedImages: Set<string>;
  controller: AbortController | null;
};

const MAX_CAMPAIGNS = 10;

/* ========================= PRODUCT SELECTOR MODAL ========================= */

function ProductSelectorModal({
  products,
  onSelect,
  onClose,
}: {
  products: Product[];
  onSelect: (product: Product) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!search.trim()) return products;
    const q = search.toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.slug?.toLowerCase().includes(q) ||
        p.shopify_vendor?.toLowerCase().includes(q) ||
        p.shopify_product_type?.toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-3xl flex flex-col max-h-[80vh] rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-50/10 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">Select Product</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800">
          <input
            type="text"
            placeholder="Search products..."
            className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white px-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400"
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex-1 overflow-y-auto p-4">
          {filtered.length === 0 ? (
            <div className="flex h-40 items-center justify-center text-sm text-slate-500 dark:text-slate-400">
              No products found
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {filtered.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelect(p)}
                  className="group flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden hover:ring-2 hover:ring-indigo-500 transition"
                >
                  <div className="aspect-square bg-slate-100 dark:bg-slate-700 overflow-hidden">
                    {p.image_url ? (
                      <img src={p.image_url} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">No image</div>
                    )}
                  </div>
                  <div className="p-2.5 text-left">
                    <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{p.name}</div>
                    {p.shopify_product_type && (
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{p.shopify_product_type}</div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ========================= AGENT LOG ========================= */

function AgentLog({
  entries,
  progress,
  status,
}: {
  entries: LogEntry[];
  progress: { done: number; total: number };
  status: AgentStatus;
}) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  if (entries.length === 0 && status === "idle") {
    return (
      <div className="flex items-center justify-center h-full text-sm text-slate-400 dark:text-slate-500">
        Configure your campaign and click Launch to begin
      </div>
    );
  }

  const phaseColors: Record<string, string> = {
    analyze: "bg-blue-500",
    ideate: "bg-purple-500",
    craft: "bg-amber-500",
    generate: "bg-orange-500",
    complete: "bg-emerald-500",
  };

  const briefLabels: Record<string, string> = {
    "Theme interpretation:": "Theme",
    "Mood board:": "Mood Board",
    "Style direction:": "Style",
    "Creative rationale:": "Rationale",
    "Color palette:": "Palette",
    "Target mood:": "Mood",
    "Learning:": "Learning",
  };

  return (
    <div ref={logRef} className="h-full overflow-y-auto space-y-1 p-3 text-sm font-mono">
      {entries.map((entry, i) => {
        const time = new Date(entry.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

        if (entry.type === "phase") {
          return (
            <div key={i} className="flex items-center gap-2 pt-3 pb-1 first:pt-0">
              <span className={`w-2 h-2 rounded-full ${phaseColors[entry.phase || ""] || "bg-slate-400"}`} />
              <span className="font-semibold text-slate-900 dark:text-white uppercase text-xs tracking-wider">
                {entry.phase}
              </span>
              <span className="text-xs text-slate-400 ml-auto">{time}</span>
            </div>
          );
        }
        if (entry.type === "error") {
          return (
            <div key={i} className="pl-4 text-red-600 dark:text-red-400 text-xs">
              {entry.message}
            </div>
          );
        }
        if (entry.type === "action") {
          return (
            <div key={i} className="pl-4 text-slate-700 dark:text-slate-300 text-xs flex items-start gap-1.5">
              <span className="text-slate-400 mt-0.5 shrink-0">&#8594;</span>
              <span>{entry.message}</span>
            </div>
          );
        }

        const matchedLabel = Object.keys(briefLabels).find((prefix) => entry.message.startsWith(prefix));
        if (matchedLabel) {
          const label = briefLabels[matchedLabel];
          const content = entry.message.slice(matchedLabel.length).trim();
          return (
            <div key={i} className="pl-4 text-xs mt-1">
              <span className="inline-block px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 font-semibold mr-1.5 text-[10px] uppercase tracking-wider">
                {label}
              </span>
              <span className="text-slate-600 dark:text-slate-300">{content}</span>
            </div>
          );
        }

        return (
          <div key={i} className="pl-4 text-slate-500 dark:text-slate-400 text-xs">
            {entry.message}
          </div>
        );
      })}

      {status === "running" && progress.total > 0 && (
        <div className="pl-4 pt-2">
          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <div className="flex-1 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${(progress.done / progress.total) * 100}%` }}
              />
            </div>
            <span>{progress.done}/{progress.total}</span>
          </div>
        </div>
      )}

      {status === "running" && (
        <div className="pl-4 pt-1 flex items-center gap-2 text-xs text-slate-400">
          <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Working...</span>
        </div>
      )}
    </div>
  );
}

/* ========================= FEEDBACK ANALYSIS LOG ========================= */

type AnalysisEntry = {
  type: "thought" | "learning" | "error";
  message: string;
  category?: string;
  timestamp: number;
};

function FeedbackAnalysisLog({
  entries,
  status,
}: {
  entries: AnalysisEntry[];
  status: "idle" | "running" | "done" | "error";
}) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [entries]);

  return (
    <div ref={logRef} className="max-h-40 overflow-y-auto space-y-1 pt-2 text-xs font-mono">
      {entries.map((entry, i) => {
        if (entry.type === "learning") {
          return (
            <div key={i} className="flex items-start gap-1.5">
              <span className="inline-block px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 font-semibold text-[10px] uppercase tracking-wider shrink-0">
                {entry.category || "general"}
              </span>
              <span className="text-slate-700 dark:text-slate-300">{entry.message}</span>
            </div>
          );
        }
        if (entry.type === "error") {
          return (
            <div key={i} className="text-red-600 dark:text-red-400">{entry.message}</div>
          );
        }
        // thought
        const isAnalysis = entry.message.startsWith("AI analysis:");
        if (isAnalysis) {
          return (
            <div key={i} className="mt-1">
              <span className="inline-block px-1.5 py-0.5 rounded bg-violet-50 dark:bg-violet-900/30 text-violet-700 dark:text-violet-300 font-semibold text-[10px] uppercase tracking-wider mr-1.5">
                Analysis
              </span>
              <span className="text-slate-600 dark:text-slate-300">{entry.message.slice("AI analysis: ".length)}</span>
            </div>
          );
        }
        return (
          <div key={i} className="text-slate-500 dark:text-slate-400">{entry.message}</div>
        );
      })}

      {status === "running" && (
        <div className="flex items-center gap-1.5 text-slate-400 pt-0.5">
          <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Analyzing...</span>
        </div>
      )}
    </div>
  );
}

/* ========================= FEEDBACK SECTION ========================= */

function FeedbackSection({
  conceptIndex,
  conceptName,
  conceptDescription,
  productId,
  profileId,
  theme,
  modelId,
  aspectRatios,
  submittedRating,
  onSubmit,
}: {
  conceptIndex: number;
  conceptName: string;
  conceptDescription?: string;
  productId: string;
  profileId: string;
  theme: string;
  modelId: string;
  aspectRatios: string[];
  submittedRating: number | null;
  onSubmit: (conceptIndex: number, rating: number) => void;
}) {
  const [rating, setRating] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Analysis state
  const [analysisEntries, setAnalysisEntries] = useState<AnalysisEntry[]>([]);
  const [analysisStatus, setAnalysisStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [showAnalysis, setShowAnalysis] = useState(false);
  const [learningCount, setLearningCount] = useState(0);

  async function runAnalysis(feedbackId: string, submittedReason: string) {
    setAnalysisStatus("running");
    setAnalysisEntries([]);
    setShowAnalysis(true);

    try {
      const res = await fetch("/api/ads/feedback/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          feedbackId,
          productId,
          conceptName,
          conceptDescription,
          rating,
          reason: submittedReason || undefined,
          theme,
        }),
      });

      if (!res.ok) {
        throw new Error("Analysis request failed");
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "thought":
                setAnalysisEntries((prev) => [...prev, { type: "thought", message: event.message, timestamp: Date.now() }]);
                break;
              case "learning":
                setAnalysisEntries((prev) => [
                  ...prev,
                  { type: "learning", message: event.learning, category: event.category, timestamp: Date.now() },
                ]);
                break;
              case "error":
                setAnalysisEntries((prev) => [...prev, { type: "error", message: event.message, timestamp: Date.now() }]);
                setAnalysisStatus("error");
                break;
              case "complete":
                setLearningCount(event.learningCount || 0);
                setAnalysisStatus("done");
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      setAnalysisStatus((prev) => (prev === "running" ? "done" : prev));
    } catch (err: any) {
      setAnalysisStatus("error");
      setAnalysisEntries((prev) => [
        ...prev,
        { type: "error", message: err.message || "Analysis failed", timestamp: Date.now() },
      ]);
    }
  }

  if (submittedRating !== null) {
    return (
      <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold ${
            submittedRating >= 7 ? "bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300" :
            submittedRating >= 4 ? "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300" :
            "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300"
          }`}>
            {submittedRating}/10
          </span>
          <span className="text-xs text-slate-400">Feedback submitted</span>

          {/* Analysis toggle button */}
          {analysisStatus !== "idle" && (
            <button
              onClick={() => setShowAnalysis((v) => !v)}
              className={`ml-auto flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-medium transition ${
                showAnalysis
                  ? "bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300"
                  : "bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700"
              }`}
            >
              {analysisStatus === "running" && (
                <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {analysisStatus === "done" && learningCount > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-emerald-500 text-white text-[9px] font-bold">
                  {learningCount}
                </span>
              )}
              {showAnalysis ? "Hide Analysis" : "View Analysis"}
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className={`w-3.5 h-3.5 transition-transform ${showAnalysis ? "rotate-180" : ""}`}>
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          )}
        </div>

        {/* Analysis log */}
        {showAnalysis && analysisEntries.length > 0 && (
          <FeedbackAnalysisLog entries={analysisEntries} status={analysisStatus} />
        )}
      </div>
    );
  }

  async function handleSubmit() {
    if (rating === null) return;
    setSubmitting(true);
    try {
      const body: AdFeedbackSubmission = {
        productId,
        profileId,
        conceptName,
        conceptDescription,
        rating,
        reason: reason.trim() || undefined,
        aspectRatiosGenerated: aspectRatios,
        theme,
        modelId,
      };
      const res = await fetch("/api/ads/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const data = await res.json();
        const feedbackId = data.feedback?.id;
        onSubmit(conceptIndex, rating);

        // Auto-start analysis SSE
        if (feedbackId) {
          void runAnalysis(feedbackId, reason.trim());
        }
      }
    } catch {
      // Silently fail
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mt-3 pt-3 border-t border-slate-100 dark:border-slate-700/50">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Rate this concept:</span>
        <div className="flex gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
            <button
              key={n}
              onClick={() => setRating(n)}
              className={`w-6 h-6 rounded text-xs font-semibold transition ${
                rating === n
                  ? n >= 7 ? "bg-emerald-500 text-white" : n >= 4 ? "bg-amber-500 text-white" : "bg-red-500 text-white"
                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
              }`}
            >
              {n}
            </button>
          ))}
        </div>
      </div>
      {rating !== null && (
        <div className="flex gap-2 items-end">
          <input
            type="text"
            placeholder="What worked or didn't? (required)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="flex-1 bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 text-xs text-slate-900 dark:text-white rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400"
          />
          <button
            onClick={handleSubmit}
            disabled={submitting || !reason.trim()}
            className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-medium transition shrink-0"
          >
            {submitting ? "..." : "Submit"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ========================= RESULTS GRID ========================= */

function buildImageFilename(
  productName: string,
  conceptIndex: number,
  ratio: string,
  dateStr: string
): string {
  const safeName = productName.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const ratioStr = ratio.replace(":", "x");
  return `${safeName}_${dateStr}_concept-${conceptIndex + 1}_${ratioStr}.png`;
}

function ResultsGrid({
  concepts,
  images,
  aspectRatios,
  selectedImages,
  onToggleSelect,
  onImageClick,
  productName,
  productId,
  profileId,
  theme,
  modelId,
  feedbackRatings,
  onFeedbackSubmit,
  campaignDone,
}: {
  concepts: AdConcept[];
  images: AdImage[];
  aspectRatios: string[];
  selectedImages: Set<string>;
  onToggleSelect: (key: string) => void;
  onImageClick: (img: AdImage) => void;
  productName: string;
  productId: string;
  profileId: string;
  theme: string;
  modelId: string;
  feedbackRatings: Record<number, number>;
  onFeedbackSubmit: (conceptIndex: number, rating: number) => void;
  campaignDone: boolean;
}) {
  if (concepts.length === 0) return null;

  return (
    <div className="space-y-4">
      {concepts.map((concept, ci) => {
        const conceptImages = images.filter((img) => img.conceptIndex === ci);

        return (
          <div
            key={ci}
            className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/50 overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-slate-100 dark:border-slate-700/50">
              <div className="flex items-center justify-between">
                <h4 className="font-semibold text-slate-900 dark:text-white text-sm">
                  Concept {ci + 1}: {concept.name}
                </h4>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{concept.description}</p>
              {(concept.headline || concept.tagline) && (
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {concept.headline && (
                    <span className="inline-block px-2 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300 text-xs font-semibold">
                      {concept.headline}
                    </span>
                  )}
                  {concept.tagline && (
                    <span className="inline-block px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs italic">
                      {concept.tagline}
                    </span>
                  )}
                </div>
              )}
            </div>
            <div className="p-4">
              <div className="flex gap-4 items-start">
                {aspectRatios.map((ratio) => {
                  const img = conceptImages.find((im) => im.ratio === ratio);
                  const isVertical = ratio === "9:16";
                  const aspectClass = isVertical ? "aspect-[9/16]" : "aspect-square";
                  const imgKey = `${ci}-${ratio}`;
                  const isSelected = selectedImages.has(imgKey);

                  return (
                    <div key={ratio} className="flex flex-col items-center gap-2">
                      <div className="relative group">
                        <div
                          className={`${aspectClass} ${isVertical ? "w-36" : "w-48"} rounded-lg overflow-hidden bg-slate-100 dark:bg-slate-700 border border-slate-200 dark:border-slate-600 cursor-pointer hover:ring-2 hover:ring-indigo-500 transition ${isSelected ? "ring-2 ring-indigo-500" : ""}`}
                          onClick={() => img && onImageClick(img)}
                        >
                          {img ? (
                            <img src={img.url} alt={`${concept.name} ${ratio}`} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg className="animate-spin h-5 w-5 text-slate-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                            </div>
                          )}
                        </div>
                        {/* Checkbox overlay */}
                        {img && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleSelect(imgKey); }}
                            className={`absolute top-2 left-2 w-5 h-5 rounded border-2 flex items-center justify-center transition ${
                              isSelected
                                ? "bg-indigo-600 border-indigo-600 text-white"
                                : "bg-white/80 dark:bg-slate-800/80 border-slate-300 dark:border-slate-500 text-transparent hover:border-indigo-400"
                            }`}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                              <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                            </svg>
                          </button>
                        )}
                      </div>
                      <span className="text-xs text-slate-500 dark:text-slate-400 font-medium">{ratio}</span>
                    </div>
                  );
                })}
              </div>
              {campaignDone && productId && profileId && (
                <FeedbackSection
                  conceptIndex={ci}
                  conceptName={concept.name}
                  conceptDescription={concept.description}
                  productId={productId}
                  profileId={profileId}
                  theme={theme}
                  modelId={modelId}
                  aspectRatios={aspectRatios}
                  submittedRating={feedbackRatings[ci] ?? null}
                  onSubmit={onFeedbackSubmit}
                />
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ========================= IMAGE MODAL ========================= */

function ImageModal({
  image,
  conceptName,
  productName,
  conceptIndex,
  onClose,
}: {
  image: AdImage;
  conceptName: string;
  productName: string;
  conceptIndex: number;
  onClose: () => void;
}) {
  const handleDownload = async () => {
    const dateStr = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
    const filename = buildImageFilename(productName, conceptIndex, image.ratio, dateStr);
    try {
      const response = await fetch(image.url);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      window.open(image.url, "_blank");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/80 p-4 backdrop-blur-sm overflow-y-auto" onClick={onClose}>
      <div className="relative max-w-4xl w-full my-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3 sticky top-0 z-10">
          <div>
            <span className="text-white font-medium text-sm">{conceptName}</span>
            <span className="text-white/60 text-sm ml-2">({image.ratio})</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownload}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-medium transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
              </svg>
              Download
            </button>
            <button onClick={onClose} className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white transition">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>
        <div className="rounded-xl overflow-hidden bg-slate-900">
          <img src={image.url} alt={`${conceptName} ${image.ratio}`} className="w-full object-contain mx-auto" />
        </div>
        <div className="mt-3 p-3 rounded-lg bg-white/5 border border-white/10 max-h-24 overflow-y-auto">
          <p className="text-xs text-white/60 leading-relaxed">{image.prompt}</p>
        </div>
      </div>
    </div>
  );
}

/* ========================= KNOWLEDGE PANEL ========================= */

type KnowledgeLearning = {
  id: string;
  product_id: string | null;
  learning: string;
  category: string;
  created_at: string;
};

type CleanupEntry = {
  type: "thought" | "error";
  message: string;
  timestamp: number;
};

function KnowledgePanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const [learnings, setLearnings] = useState<KnowledgeLearning[]>([]);
  const [loading, setLoading] = useState(true);
  const [cleanupStatus, setCleanupStatus] = useState<"idle" | "running" | "done" | "error">("idle");
  const [cleanupEntries, setCleanupEntries] = useState<CleanupEntry[]>([]);
  const [showCleanupLog, setShowCleanupLog] = useState(false);
  const cleanupLogRef = useRef<HTMLDivElement>(null);

  const fetchLearnings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/ads/learnings`);
      if (res.ok) {
        const data = await res.json();
        setLearnings(data.learnings || []);
      }
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLearnings();
  }, [fetchLearnings]);

  useEffect(() => {
    if (cleanupLogRef.current) {
      cleanupLogRef.current.scrollTop = cleanupLogRef.current.scrollHeight;
    }
  }, [cleanupEntries]);

  async function deleteLearning(id: string) {
    setLearnings((prev) => prev.filter((l) => l.id !== id));
    try {
      await fetch(`/api/ads/learnings?id=${id}`, { method: "DELETE" });
    } catch {
      // Refetch on error
      fetchLearnings();
    }
  }

  async function runCleanup() {
    setCleanupStatus("running");
    setCleanupEntries([]);
    setShowCleanupLog(true);

    try {
      const res = await fetch("/api/ads/learnings/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!res.ok) throw new Error("Cleanup request failed");

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "thought":
                setCleanupEntries((prev) => [...prev, { type: "thought", message: event.message, timestamp: Date.now() }]);
                break;
              case "error":
                setCleanupEntries((prev) => [...prev, { type: "error", message: event.message, timestamp: Date.now() }]);
                setCleanupStatus("error");
                break;
              case "complete":
                setCleanupStatus("done");
                // Refetch learnings to show updated list
                fetchLearnings();
                break;
            }
          } catch {
            // Skip
          }
        }
      }
      setCleanupStatus((prev) => (prev === "running" ? "done" : prev));
    } catch (err: any) {
      setCleanupStatus("error");
      setCleanupEntries((prev) => [...prev, { type: "error", message: err.message || "Cleanup failed", timestamp: Date.now() }]);
    }
  }

  const categoryColors: Record<string, string> = {
    composition: "bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300",
    typography: "bg-purple-50 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300",
    color: "bg-pink-50 dark:bg-pink-900/30 text-pink-700 dark:text-pink-300",
    mood: "bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300",
    product_placement: "bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300",
    text_overlay: "bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-300",
    aspect_ratio: "bg-cyan-50 dark:bg-cyan-900/30 text-cyan-700 dark:text-cyan-300",
    general: "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-2xl flex flex-col max-h-[85vh] rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-50/10 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">Knowledge Base</h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Learnings from feedback that guide future campaigns
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={runCleanup}
              disabled={cleanupStatus === "running" || learnings.length === 0}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/30 disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium transition"
            >
              {cleanupStatus === "running" ? (
                <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                  <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.033l.312.311a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.06-7.358a.75.75 0 00-1.5 0v2.033l-.312-.312A7 7 0 002.848 8.926a.75.75 0 001.45.388 5.5 5.5 0 019.201-2.467l.312.311H11.38a.75.75 0 100 1.5h3.634a.75.75 0 00.75-.75V4.275z" clipRule="evenodd" />
                </svg>
              )}
              Clean Up
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
                <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
              </svg>
            </button>
          </div>
        </div>

        {/* Cleanup log */}
        {showCleanupLog && cleanupEntries.length > 0 && (
          <div className="border-b border-slate-100 dark:border-slate-800 shrink-0">
            <button
              onClick={() => setShowCleanupLog((v) => !v)}
              className="w-full flex items-center justify-between px-6 py-2 text-xs font-medium text-violet-700 dark:text-violet-300 bg-violet-50/50 dark:bg-violet-900/10 hover:bg-violet-50 dark:hover:bg-violet-900/20 transition"
            >
              <span className="flex items-center gap-1.5">
                {cleanupStatus === "running" && (
                  <svg className="animate-spin h-3 w-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                )}
                Cleanup Log
              </span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
              </svg>
            </button>
            <div ref={cleanupLogRef} className="max-h-32 overflow-y-auto px-6 py-2 space-y-1">
              {cleanupEntries.map((e, i) => (
                <div key={i} className={`text-xs font-mono ${e.type === "error" ? "text-red-600 dark:text-red-400" : "text-slate-600 dark:text-slate-300"}`}>
                  {e.message}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Learnings list */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40 text-sm text-slate-400">
              <svg className="animate-spin h-5 w-5 mr-2" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          ) : learnings.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center">
              <p className="text-sm text-slate-500 dark:text-slate-400">No learnings yet</p>
              <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">Rate concepts after campaigns to build your knowledge base</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {learnings.map((l) => (
                <div key={l.id} className="group flex items-start gap-3 px-6 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/30 transition">
                  <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider shrink-0 mt-0.5 ${categoryColors[l.category] || categoryColors.general}`}>
                    {l.category.replace("_", " ")}
                  </span>
                  <p className="flex-1 text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
                    {l.learning}
                  </p>
                  <button
                    onClick={() => deleteLearning(l.id)}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500 transition shrink-0"
                    title="Remove learning"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/30 shrink-0">
          <p className="text-[10px] text-slate-400 dark:text-slate-500">
            {learnings.length} active learning{learnings.length !== 1 ? "s" : ""}
            {learnings.length > 0 && " — these are automatically applied to future campaigns"}
          </p>
        </div>
      </div>
    </div>
  );
}

/* ========================= CAMPAIGN HISTORY PANEL ========================= */

function CampaignHistoryPanel({
  campaigns,
  activeCampaignId,
  onSelect,
  onDelete,
  onClearAll,
}: {
  campaigns: AdCampaign[];
  activeCampaignId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onClearAll: () => void;
}) {
  if (campaigns.length === 0) return null;

  const statusDot = (status: AgentStatus) => {
    switch (status) {
      case "running":
        return "bg-amber-500 animate-pulse";
      case "done":
        return "bg-emerald-500";
      case "error":
        return "bg-red-500";
      case "cancelled":
        return "bg-slate-400";
      default:
        return "bg-slate-300";
    }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
          Campaigns
        </label>
        {campaigns.length > 1 && (
          <button
            onClick={onClearAll}
            className="text-[10px] text-red-500 hover:text-red-600 dark:text-red-400 dark:hover:text-red-300 font-medium"
          >
            Clear All
          </button>
        )}
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {campaigns.map((c) => (
          <div
            key={c.id}
            onClick={() => onSelect(c.id)}
            className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg cursor-pointer transition text-left w-full ${
              c.id === activeCampaignId
                ? "bg-indigo-50 dark:bg-indigo-900/20 ring-1 ring-indigo-200 dark:ring-indigo-800"
                : "hover:bg-slate-50 dark:hover:bg-slate-800/50"
            }`}
          >
            <span className={`w-2 h-2 rounded-full shrink-0 ${statusDot(c.status)}`} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium text-slate-900 dark:text-white truncate">{c.name}</div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                {c.productName || "No product"} &middot; {c.images.length} img{c.images.length !== 1 ? "s" : ""}
              </div>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onDelete(c.id);
              }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-red-500 transition shrink-0"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
              </svg>
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ========================= MAIN PAGE ========================= */

export default function AdStudioPage() {
  const router = useRouter();

  // Data
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);

  // Profile management (silent auto-select from localStorage)
  const [clientId, setClientId] = useState<string | null>(null);
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [storedProfileId, setStoredProfileId] = useState<string | null>(null);
  const [profileRestored, setProfileRestored] = useState(false);

  // Inputs
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [theme, setTheme] = useState("");
  const [modelId, setModelId] = useState("nanobanana-3-pro");
  const [quantity, setQuantity] = useState(3);
  const [speed, setSpeed] = useState(3);
  const [includeBothRatios, setIncludeBothRatios] = useState(true);
  const [singleRatio, setSingleRatio] = useState<"1:1" | "9:16">("1:1");
  const [modelOptions, setModelOptions] = useState<Record<string, string>>({});

  // Multi-campaign state
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const campaignCountRef = useRef(0);

  // Derive active campaign
  const activeCampaign = useMemo(
    () => campaigns.find((c) => c.id === activeCampaignId) || null,
    [campaigns, activeCampaignId]
  );

  // Derived state from active campaign
  const status: AgentStatus = activeCampaign?.status || "idle";
  const logEntries: LogEntry[] = activeCampaign?.logEntries || [];
  const concepts: AdConcept[] = activeCampaign?.concepts || [];
  const images: AdImage[] = activeCampaign?.images || [];
  const progress = activeCampaign?.progress || { done: 0, total: 0 };
  const feedbackRatings: Record<number, number> = activeCampaign?.feedbackRatings || {};
  const selectedImages: Set<string> = activeCampaign?.selectedImages || new Set();

  // UI
  const [expandedImage, setExpandedImage] = useState<AdImage | null>(null);
  const [showProductModal, setShowProductModal] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [sessionRestored, setSessionRestored] = useState(false);
  const [rightTab, setRightTab] = useState<"activity" | "results">("activity");
  const [downloading, setDownloading] = useState(false);

  const selectedModel = getModelById(modelId);
  const maxSpeed = selectedModel?.maxConcurrency || 5;
  const activeRatios = includeBothRatios ? ["1:1", "9:16"] : [singleRatio];

  // canLaunch: no longer blocked by running status (parallel campaigns allowed)
  const canLaunch = selectedProduct && theme.trim() && activeProfileId;

  // Auto-switch to results tab when first image arrives on active campaign
  useEffect(() => {
    if (images.length > 0 && rightTab === "activity") {
      setRightTab("results");
    }
  }, [images.length]);

  // --- Campaign update helper ---
  const updateCampaign = useCallback(
    (campaignId: string, updater: (c: AdCampaign) => AdCampaign) => {
      setCampaigns((prev) => prev.map((c) => (c.id === campaignId ? updater(c) : c)));
    },
    []
  );

  // Toggle image selection (scoped to active campaign)
  const toggleSelect = useCallback(
    (key: string) => {
      if (!activeCampaignId) return;
      updateCampaign(activeCampaignId, (c) => {
        const next = new Set(c.selectedImages);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return { ...c, selectedImages: next };
      });
    },
    [activeCampaignId, updateCampaign]
  );

  // Select all / deselect all (scoped to active campaign)
  const allImageKeys = useMemo(() => {
    return images.map((img) => `${img.conceptIndex}-${img.ratio}`);
  }, [images]);

  const allSelected = allImageKeys.length > 0 && allImageKeys.every((k) => selectedImages.has(k));

  const toggleSelectAll = useCallback(() => {
    if (!activeCampaignId) return;
    updateCampaign(activeCampaignId, (c) => {
      if (allSelected) {
        return { ...c, selectedImages: new Set<string>() };
      } else {
        return { ...c, selectedImages: new Set(allImageKeys) };
      }
    });
  }, [activeCampaignId, allSelected, allImageKeys, updateCampaign]);

  // Download selected images
  async function downloadSelected() {
    if (selectedImages.size === 0 || !selectedProduct) return;
    setDownloading(true);
    const dateStr = new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");

    try {
      if (selectedImages.size === 1) {
        const key = Array.from(selectedImages)[0];
        const [ciStr, ratio] = key.split("-");
        const ci = parseInt(ciStr);
        const img = images.find((im) => im.conceptIndex === ci && im.ratio === (ratio === "9" ? "9:16" : "1:1"));
        if (!img) return;
        const filename = buildImageFilename(selectedProduct.name, ci, img.ratio, dateStr);
        const response = await fetch(img.url);
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else {
        const JSZip = (await import("jszip")).default;
        const zip = new JSZip();

        for (const key of selectedImages) {
          const parts = key.split("-");
          const ci = parseInt(parts[0]);
          const ratioKey = parts.slice(1).join("-");
          const ratio = ratioKey === "9:16" ? "9:16" : ratioKey === "1:1" ? "1:1" : ratioKey;
          const img = images.find((im) => im.conceptIndex === ci && im.ratio === ratio);
          if (!img) continue;
          const filename = buildImageFilename(selectedProduct.name, ci, img.ratio, dateStr);
          try {
            const response = await fetch(img.url);
            const blob = await response.blob();
            zip.file(filename, blob);
          } catch {
            // Skip failed downloads
          }
        }

        const zipBlob = await zip.generateAsync({ type: "blob" });
        const safeName = selectedProduct.name.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
        const url = URL.createObjectURL(zipBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${safeName}_${dateStr}_ads.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (err) {
      console.error("Download failed:", err);
    } finally {
      setDownloading(false);
    }
  }

  // Save session
  const saveSession = useCallback(() => {
    const session: AdStudioSession = {
      version: 2,
      savedAt: Date.now(),
      theme,
      modelId,
      quantity,
      speed,
      aspectRatios: includeBothRatios ? { "1:1": true, "9:16": true } : { [singleRatio]: true },
      includeBothRatios,
      selectedProductId: selectedProduct?.id || null,
      modelOptions,
      campaigns: campaigns.map((c) => serializeAdCampaign(c)),
      activeCampaignId,
    };
    debouncedSaveAdSession(session);
  }, [theme, modelId, quantity, speed, includeBothRatios, singleRatio, selectedProduct, modelOptions, campaigns, activeCampaignId]);

  useEffect(() => {
    if (sessionRestored) saveSession();
  }, [sessionRestored, saveSession]);

  // Bootstrap
  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("ol_client_id") : null;
    const storedProfile = typeof window !== "undefined" ? localStorage.getItem("ol_active_profile") : null;
    const id = stored || crypto.randomUUID();
    if (!stored) localStorage.setItem("ol_client_id", id);
    setClientId(id);
    if (storedProfile) setStoredProfileId(storedProfile);
  }, []);

  useEffect(() => {
    if (!clientId) return;
    void loadProfiles();
    void loadProducts();
  }, [clientId]);

  useEffect(() => {
    if (!profiles.length) {
      setProfileRestored(true);
      return;
    }
    const stored = storedProfileId || (typeof window !== "undefined" ? localStorage.getItem("ol_active_profile") : null);
    const found = stored ? profiles.find((p) => p.id === stored) : null;
    setActiveProfileId(found ? found.id : profiles[0].id);
    setProfileRestored(true);
  }, [profiles, storedProfileId]);

  useEffect(() => {
    if (activeProfileId && typeof window !== "undefined") {
      localStorage.setItem("ol_active_profile", activeProfileId);
      setStoredProfileId(activeProfileId);
    }
  }, [activeProfileId]);

  useEffect(() => {
    if (!profilesLoading && profileRestored && !activeProfileId && !storedProfileId) {
      router.push("/profiles");
    }
  }, [profilesLoading, profileRestored, activeProfileId, storedProfileId, router]);

  // Restore session
  useEffect(() => {
    const session = loadAdStudioSession();
    if (session) {
      setTheme(session.theme || "");
      setModelId(session.modelId || "nanobanana-3-pro");
      setQuantity(session.quantity || 3);
      setSpeed(session.speed || 3);
      setIncludeBothRatios(session.includeBothRatios ?? true);
      if (session.includeBothRatios === false && session.aspectRatios) {
        const keys = Object.keys(session.aspectRatios).filter((k) => session.aspectRatios[k]);
        if (keys.length === 1 && (keys[0] === "1:1" || keys[0] === "9:16")) {
          setSingleRatio(keys[0] as "1:1" | "9:16");
        }
      }
      setModelOptions(session.modelOptions || {});

      // v2: restore campaigns
      if (session.campaigns && session.campaigns.length > 0) {
        const restored = session.campaigns.map((sc) => deserializeAdCampaign(sc) as AdCampaign);
        setCampaigns(restored);
        setActiveCampaignId(session.activeCampaignId || restored[0]?.id || null);
        campaignCountRef.current = restored.length;
        // If there are results, show results tab
        const active = restored.find((c) => c.id === session.activeCampaignId) || restored[0];
        if (active?.images?.length) {
          setRightTab("results");
        }
      }

      if (session.selectedProductId) {
        const tryRestore = () => {
          setProducts((prev) => {
            const found = prev.find((p) => p.id === session.selectedProductId);
            if (found) setSelectedProduct(found);
            return prev;
          });
        };
        setTimeout(tryRestore, 500);
      }
    }
    setSessionRestored(true);
  }, []);

  // Restore product after products load + fill productName for migrated campaigns
  useEffect(() => {
    const session = loadAdStudioSession();
    if (session?.selectedProductId && products.length > 0 && !selectedProduct) {
      const found = products.find((p) => p.id === session.selectedProductId);
      if (found) setSelectedProduct(found);
    }
    // Fill missing productName in campaigns from products list
    if (products.length > 0) {
      setCampaigns((prev) => {
        let changed = false;
        const updated = prev.map((c) => {
          if (!c.productName && c.productId) {
            const p = products.find((pr) => pr.id === c.productId);
            if (p) {
              changed = true;
              return { ...c, productName: p.name };
            }
          }
          return c;
        });
        return changed ? updated : prev;
      });
    }
  }, [products, selectedProduct]);

  // Loaders
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

  async function loadProfiles() {
    try {
      setProfilesLoading(true);
      const res = await fetch("/api/profiles");
      const json = await res.json();
      if (res.ok) setProfiles(json.profiles || []);
    } finally {
      setProfilesLoading(false);
    }
  }

  // --- runCampaignSSE (extracted, scoped to a campaign) ---
  async function runCampaignSSE(campaign: AdCampaign) {
    const campaignId = campaign.id;

    try {
      const res = await fetch("/api/ads/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modelId: campaign.modelId,
          quantity: campaign.quantity,
          theme: campaign.theme,
          productId: campaign.productId,
          aspectRatios: campaign.aspectRatios,
          profileId: activeProfileId,
          concurrency: campaign.speed,
          modelOptions: Object.keys(campaign.modelOptions).length > 0 ? campaign.modelOptions : undefined,
        }),
        signal: campaign.controller?.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${res.status}`);
      }

      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "phase":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  logEntries: [...c.logEntries, { type: "phase", phase: event.phase, message: event.message, timestamp: Date.now() }],
                }));
                break;
              case "thought":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  logEntries: [...c.logEntries, { type: "thought", message: event.message, timestamp: Date.now() }],
                }));
                break;
              case "action":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  logEntries: [...c.logEntries, { type: "action", message: event.message, timestamp: Date.now() }],
                }));
                break;
              case "concept":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  concepts: [...c.concepts, event.concept],
                }));
                break;
              case "image":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  images: [...c.images, { conceptIndex: event.conceptIndex, ratio: event.ratio, url: event.url, prompt: event.prompt }],
                }));
                break;
              case "progress":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  progress: { done: event.done, total: event.total },
                }));
                break;
              case "error":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  logEntries: [...c.logEntries, { type: "error", message: event.message, timestamp: Date.now() }],
                }));
                break;
              case "complete":
                updateCampaign(campaignId, (c) => ({
                  ...c,
                  status: "done",
                }));
                break;
            }
          } catch {
            // Skip malformed events
          }
        }
      }

      // If stream ended but status still running, mark done
      updateCampaign(campaignId, (c) => (c.status === "running" ? { ...c, status: "done" } : c));
    } catch (err: any) {
      if (err.name === "AbortError") {
        updateCampaign(campaignId, (c) => ({
          ...c,
          status: "cancelled",
          logEntries: [
            ...c.logEntries,
            { type: "phase" as const, phase: "cancelled", message: "Campaign cancelled by user", timestamp: Date.now() },
          ],
        }));
      } else {
        updateCampaign(campaignId, (c) => ({
          ...c,
          status: "error",
          logEntries: [
            ...c.logEntries,
            { type: "error" as const, message: err.message || "Unknown error", timestamp: Date.now() },
          ],
        }));
      }
    }
  }

  // Launch campaign
  function launchCampaign() {
    if (!canLaunch) return;

    // Auto-evict oldest non-running campaign if at max
    setCampaigns((prev) => {
      if (prev.length >= MAX_CAMPAIGNS) {
        const nonRunning = prev.filter((c) => c.status !== "running");
        if (nonRunning.length > 0) {
          const oldest = nonRunning[0];
          return prev.filter((c) => c.id !== oldest.id);
        }
      }
      return prev;
    });

    campaignCountRef.current += 1;
    const ctrl = new AbortController();
    const newCampaign: AdCampaign = {
      id: crypto.randomUUID(),
      name: `Campaign #${campaignCountRef.current}`,
      startedAt: Date.now(),
      theme,
      modelId,
      quantity,
      speed,
      aspectRatios: [...activeRatios],
      productId: selectedProduct!.id,
      productName: selectedProduct!.name,
      modelOptions: { ...modelOptions },
      status: "running",
      concepts: [],
      images: [],
      logEntries: [],
      progress: { done: 0, total: 0 },
      feedbackRatings: {},
      selectedImages: new Set(),
      controller: ctrl,
    };

    setCampaigns((prev) => [...prev, newCampaign]);
    setActiveCampaignId(newCampaign.id);
    setRightTab("activity");

    // Non-blocking — run in parallel
    void runCampaignSSE(newCampaign);
  }

  // Cancel a specific campaign
  function cancelCampaign(id: string) {
    setCampaigns((prev) =>
      prev.map((c) => {
        if (c.id === id && c.controller) {
          c.controller.abort();
        }
        return c;
      })
    );
  }

  // Delete a specific campaign
  function deleteCampaign(id: string) {
    // Abort if running
    setCampaigns((prev) => {
      const target = prev.find((c) => c.id === id);
      if (target?.controller) target.controller.abort();
      const remaining = prev.filter((c) => c.id !== id);
      // Update active if deleted was active
      if (activeCampaignId === id) {
        const next = remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        // Use setTimeout to avoid setState-in-setState
        setTimeout(() => setActiveCampaignId(next), 0);
      }
      return remaining;
    });
  }

  // Clear all campaigns
  function clearAllCampaigns() {
    setCampaigns((prev) => {
      for (const c of prev) {
        if (c.controller) c.controller.abort();
      }
      return [];
    });
    setActiveCampaignId(null);
  }

  const handleFeedbackSubmit = useCallback(
    (conceptIndex: number, rating: number) => {
      if (!activeCampaignId) return;
      updateCampaign(activeCampaignId, (c) => ({
        ...c,
        feedbackRatings: { ...c.feedbackRatings, [conceptIndex]: rating },
      }));
    },
    [activeCampaignId, updateCampaign]
  );

  const totalImages = quantity * activeRatios.length;

  return (
    <div className="flex h-[calc(100vh-4rem)] overflow-hidden">
      {/* ============ LEFT PANEL — INPUTS (420px) ============ */}
      <div className="w-[420px] shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 overflow-y-auto">
        <div className="p-5 space-y-5">
          {/* Header */}
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold text-slate-900 dark:text-white">Ad Studio</h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                AI-powered creative campaigns with Claude
              </p>
            </div>
            <button
              onClick={() => setShowKnowledge(true)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-medium transition"
              title="View Knowledge Base"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10.75 16.82A7.462 7.462 0 0115 15.5c.71 0 1.396.098 2.046.282A.75.75 0 0018 15.06v-11a.75.75 0 00-.546-.721A9.006 9.006 0 0015 3a8.999 8.999 0 00-4.25 1.065V16.82zM9.25 4.065A8.999 8.999 0 005 3c-.85 0-1.673.118-2.454.339A.75.75 0 002 4.06v11a.75.75 0 00.954.721A7.506 7.506 0 015 15.5c1.579 0 3.042.487 4.25 1.32V4.065z" />
              </svg>
              Knowledge
            </button>
          </div>

          {/* Creative Theme (HERO) */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">
              Creative Theme
            </label>
            <div className="relative">
              <textarea
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                placeholder="Describe your creative vision... e.g., 'Minimalist Scandinavian winter — muted earth tones, soft morning light through frosted glass, raw linen textures, quiet luxury'"
                className="w-full bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white rounded-xl px-4 py-3 focus:outline-none focus:border-indigo-500 dark:focus:border-indigo-400 focus:ring-4 focus:ring-indigo-500/10 placeholder:text-slate-400 resize-none transition-all"
                rows={5}
              />
              <div className="absolute bottom-2 right-3 text-[10px] text-slate-400">
                {theme.length}
              </div>
            </div>
          </div>

          {/* Product Selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Product</label>
            {selectedProduct ? (
              <div className="flex items-center gap-3 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50">
                <div className="w-10 h-10 rounded-lg overflow-hidden bg-slate-200 dark:bg-slate-700 shrink-0">
                  {selectedProduct.image_url && (
                    <img src={selectedProduct.image_url} alt={selectedProduct.name} className="w-full h-full object-cover" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-slate-900 dark:text-white truncate">{selectedProduct.name}</div>
                  {selectedProduct.shopify_product_type && (
                    <div className="text-xs text-slate-500 dark:text-slate-400">{selectedProduct.shopify_product_type}</div>
                  )}
                </div>
                <button
                  onClick={() => setShowProductModal(true)}
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium shrink-0"
                >
                  Change
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowProductModal(true)}
                disabled={productsLoading}
                className="w-full flex items-center justify-center gap-2 p-3.5 rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 text-slate-500 dark:text-slate-400 hover:border-indigo-400 hover:text-indigo-500 transition text-sm"
              >
                {productsLoading ? (
                  <>
                    <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Loading...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    Select Product
                  </>
                )}
              </button>
            )}
          </div>

          {/* Concepts — Prominent number stepper */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Concepts</label>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                disabled={quantity <= 1}
                className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition text-lg font-medium"
              >
                -
              </button>
              <span className="text-2xl font-bold text-slate-900 dark:text-white w-10 text-center tabular-nums">
                {quantity}
              </span>
              <button
                onClick={() => setQuantity((q) => Math.min(10, q + 1))}
                disabled={quantity >= 10}
                className="w-10 h-10 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed transition text-lg font-medium"
              >
                +
              </button>
            </div>
          </div>

          {/* Generation Settings — Compact group */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Generation Settings</label>
            <div className="space-y-2">
              {/* Model */}
              <select
                value={modelId}
                onChange={(e) => {
                  setModelId(e.target.value);
                  setModelOptions({});
                  const newModel = getModelById(e.target.value);
                  const newMax = newModel?.maxConcurrency || 5;
                  setSpeed((s) => Math.min(s, newMax));
                }}
                className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              >
                {MODEL_LIST.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} ({m.version})
                  </option>
                ))}
              </select>

              {/* Quality + Resolution inline */}
              <div className="flex gap-2">
                {selectedModel?.qualityOptions && (
                  <select
                    value={modelOptions.quality || selectedModel.qualityOptions[0]}
                    onChange={(e) => setModelOptions((prev) => ({ ...prev, quality: e.target.value }))}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    {selectedModel.qualityOptions.map((q) => (
                      <option key={q} value={q}>Quality: {q}</option>
                    ))}
                  </select>
                )}
                {selectedModel?.resolutionOptions && (
                  <select
                    value={modelOptions.resolution || selectedModel.resolutionOptions[0]}
                    onChange={(e) => setModelOptions((prev) => ({ ...prev, resolution: e.target.value }))}
                    className="flex-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
                  >
                    {selectedModel.resolutionOptions.map((r) => (
                      <option key={r} value={r}>Res: {r}</option>
                    ))}
                  </select>
                )}
              </div>

              {/* Speed / Concurrency */}
              <div className="flex items-center gap-3">
                <span className="text-xs text-slate-500 dark:text-slate-400 shrink-0">Speed</span>
                <input
                  type="range"
                  min={1}
                  max={maxSpeed}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="flex-1 accent-indigo-500 h-1.5"
                />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 w-8 text-right tabular-nums">{speed}x</span>
              </div>
            </div>
          </div>

          {/* Formats — Toggle switch + pill selector */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-2">Formats</label>
            <div className="space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <span className="text-sm text-slate-700 dark:text-slate-300">Include both 1:1 and 9:16</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={includeBothRatios}
                  onClick={() => setIncludeBothRatios((v) => !v)}
                  className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${
                    includeBothRatios ? "bg-indigo-600" : "bg-slate-200 dark:bg-slate-700"
                  }`}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                      includeBothRatios ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </label>

              {!includeBothRatios && (
                <div className="flex gap-2">
                  {(["1:1", "9:16"] as const).map((ratio) => (
                    <button
                      key={ratio}
                      onClick={() => setSingleRatio(ratio)}
                      className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border transition ${
                        singleRatio === ratio
                          ? "bg-indigo-50 dark:bg-indigo-900/30 border-indigo-300 dark:border-indigo-600 text-indigo-700 dark:text-indigo-300"
                          : "bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-slate-300 dark:hover:border-slate-600"
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Launch Button (always available) */}
          <div className="pt-1">
            <button
              onClick={launchCampaign}
              disabled={!canLaunch}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-700 hover:to-violet-700 disabled:from-slate-300 disabled:to-slate-300 dark:disabled:from-slate-700 dark:disabled:to-slate-700 text-white disabled:text-slate-500 dark:disabled:text-slate-400 font-semibold text-sm transition shadow-sm disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
              Launch Campaign
            </button>

            {/* Cancel button for active running campaign */}
            {activeCampaign?.status === "running" && (
              <button
                onClick={() => cancelCampaign(activeCampaign.id)}
                className="w-full mt-2 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition shadow-sm"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M2 10a8 8 0 1116 0 8 8 0 01-16 0zm5-2.25A.75.75 0 017.75 7h4.5a.75.75 0 01.75.75v4.5a.75.75 0 01-.75.75h-4.5a.75.75 0 01-.75-.75v-4.5z" clipRule="evenodd" />
                </svg>
                Cancel {activeCampaign.name}
              </button>
            )}
          </div>

          {/* Image count summary */}
          {canLaunch && (
            <div className="text-xs text-slate-500 dark:text-slate-400 text-center">
              {quantity} concept{quantity > 1 ? "s" : ""} &times; {activeRatios.length} format{activeRatios.length > 1 ? "s" : ""} = {totalImages} image{totalImages > 1 ? "s" : ""} @ {speed}x speed
            </div>
          )}

          {/* Campaign History Panel */}
          <CampaignHistoryPanel
            campaigns={campaigns}
            activeCampaignId={activeCampaignId}
            onSelect={setActiveCampaignId}
            onDelete={deleteCampaign}
            onClearAll={clearAllCampaigns}
          />
        </div>
      </div>

      {/* ============ RIGHT PANEL — OUTPUT ============ */}
      <div className="flex-1 flex flex-col overflow-hidden bg-slate-50 dark:bg-slate-900">
        {/* Tab bar */}
        <div className="flex items-center gap-0 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
          <button
            onClick={() => setRightTab("activity")}
            className={`px-5 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
              rightTab === "activity"
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            Activity
            {status === "running" && (
              <span className="ml-1.5 inline-block w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
          <button
            onClick={() => setRightTab("results")}
            className={`px-5 py-2.5 text-xs font-semibold uppercase tracking-wider border-b-2 transition ${
              rightTab === "results"
                ? "border-indigo-500 text-indigo-600 dark:text-indigo-400"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
            }`}
          >
            Results
            {images.length > 0 && (
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-indigo-100 dark:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold px-1">
                {images.length}
              </span>
            )}
          </button>

          {/* Status indicator + campaign name */}
          {activeCampaign && status !== "idle" && (
            <div className="flex items-center gap-2 ml-auto pr-4">
              <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[120px]">{activeCampaign.name}</span>
              <span
                className={`inline-block w-2 h-2 rounded-full ${
                  status === "running"
                    ? "bg-amber-500 animate-pulse"
                    : status === "done"
                      ? "bg-emerald-500"
                      : status === "error"
                        ? "bg-red-500"
                        : "bg-slate-400"
                }`}
              />
              <span className="text-xs text-slate-500 dark:text-slate-400 capitalize">{status}</span>
            </div>
          )}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-hidden">
          {/* Activity tab */}
          {rightTab === "activity" && (
            <div className="h-full">
              <AgentLog entries={logEntries} progress={progress} status={status} />
            </div>
          )}

          {/* Results tab */}
          {rightTab === "results" && (
            <div className="h-full flex flex-col overflow-hidden">
              {/* Selection toolbar */}
              {images.length > 0 && (
                <div className="flex items-center gap-3 px-6 py-2.5 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 shrink-0">
                  <button
                    onClick={toggleSelectAll}
                    className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-indigo-600 dark:hover:text-indigo-400 transition"
                  >
                    <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition ${
                      allSelected
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "border-slate-300 dark:border-slate-600"
                    }`}>
                      {allSelected && (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                          <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                        </svg>
                      )}
                    </span>
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>

                  {selectedImages.size > 0 && (
                    <>
                      <span className="text-xs text-slate-400">|</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">{selectedImages.size} selected</span>
                      <button
                        onClick={downloadSelected}
                        disabled={downloading}
                        className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-400 text-white text-xs font-medium transition"
                      >
                        {downloading ? (
                          <svg className="animate-spin h-3.5 w-3.5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
                            <path d="M10.75 2.75a.75.75 0 00-1.5 0v8.614L6.295 8.235a.75.75 0 10-1.09 1.03l4.25 4.5a.75.75 0 001.09 0l4.25-4.5a.75.75 0 00-1.09-1.03l-2.955 3.129V2.75z" />
                            <path d="M3.5 12.75a.75.75 0 00-1.5 0v2.5A2.75 2.75 0 004.75 18h10.5A2.75 2.75 0 0018 15.25v-2.5a.75.75 0 00-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5z" />
                          </svg>
                        )}
                        Download selected{selectedImages.size > 1 ? ` (${selectedImages.size})` : ""}
                      </button>
                    </>
                  )}
                </div>
              )}

              {/* Results grid */}
              <div className="flex-1 overflow-y-auto p-6">
                {concepts.length === 0 && status === "idle" && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-8 h-8 text-slate-400">
                        <path fillRule="evenodd" d="M14.615 1.595a.75.75 0 01.359.852L12.982 9.75h7.268a.75.75 0 01.548 1.262l-10.5 11.25a.75.75 0 01-1.272-.71l1.992-7.302H3.75a.75.75 0 01-.548-1.262l10.5-11.25a.75.75 0 01.913-.143z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">Ready to create</h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md">
                      Enter a creative theme, select a product, and launch your campaign. Claude will analyze your product, ideate concepts, and generate images automatically.
                    </p>
                  </div>
                )}

                {concepts.length === 0 && status === "running" && (
                  <div className="flex flex-col items-center justify-center h-full text-center">
                    <svg className="animate-spin h-8 w-8 text-indigo-500 mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    <p className="text-sm text-slate-500 dark:text-slate-400">Planning your campaign...</p>
                  </div>
                )}

                <ResultsGrid
                  concepts={concepts}
                  images={images}
                  aspectRatios={activeCampaign?.aspectRatios || activeRatios}
                  selectedImages={selectedImages}
                  onToggleSelect={toggleSelect}
                  onImageClick={setExpandedImage}
                  productName={activeCampaign?.productName || selectedProduct?.name || "ad"}
                  productId={activeCampaign?.productId || selectedProduct?.id || ""}
                  profileId={activeProfileId || ""}
                  theme={activeCampaign?.theme || theme}
                  modelId={activeCampaign?.modelId || modelId}
                  feedbackRatings={feedbackRatings}
                  onFeedbackSubmit={handleFeedbackSubmit}
                  campaignDone={status === "done"}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modals */}
      {showProductModal && (
        <ProductSelectorModal
          products={products}
          onSelect={(product) => {
            setSelectedProduct(product);
            setShowProductModal(false);
          }}
          onClose={() => setShowProductModal(false)}
        />
      )}

      {expandedImage && (
        <ImageModal
          image={expandedImage}
          conceptName={concepts[expandedImage.conceptIndex]?.name || "Image"}
          productName={activeCampaign?.productName || selectedProduct?.name || "ad"}
          conceptIndex={expandedImage.conceptIndex}
          onClose={() => setExpandedImage(null)}
        />
      )}

      {showKnowledge && (
        <KnowledgePanel
          onClose={() => setShowKnowledge(false)}
        />
      )}
    </div>
  );
}
