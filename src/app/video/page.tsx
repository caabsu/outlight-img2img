"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import { MODEL_LIST } from "@/lib/models";
import { PromptAssistant } from "@/components/PromptAssistant";
import {
  loadVideoStudioSession,
  debouncedSaveVideoSession,
  serializeVideoRun,
  deserializeVideoRun,
  type VideoStudioSession,
} from "@/lib/session-storage";

// Lazy-initialized Supabase client for large file uploads (bypasses Vercel's 4.5MB API limit)
// Can't initialize at module scope because env vars aren't available during build-time prerendering
let _supabaseClient: ReturnType<typeof createClient> | null = null;
function getSupabaseClient() {
  if (!_supabaseClient) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Supabase credentials not configured");
    _supabaseClient = createClient(url, key);
  }
  return _supabaseClient;
}

type Product = {
  id: string;
  name: string;
  slug: string;
  image_url: string;
  shopify_id?: string | null;
  shopify_vendor?: string | null;
  shopify_product_type?: string | null;
  shopify_images?: string[] | null;
};
type ProductViewMode = "grid" | "compact" | "list";

// Product Selector Modal Component (similar to Image Studio)
function ProductSelectorModal({
  products,
  onSelect,
  onClose,
  searchQuery,
  setSearchQuery,
}: {
  products: Product[];
  onSelect: (imageUrl: string) => void;
  onClose: () => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}) {
  const [viewMode, setViewMode] = useState<ProductViewMode>("grid");
  const [selectedImages, setSelectedImages] = useState<string[]>([]);
  const [expandedProduct, setExpandedProduct] = useState<Product | null>(null);

  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.slug?.toLowerCase().includes(q) ||
        p.shopify_vendor?.toLowerCase().includes(q) ||
        p.shopify_product_type?.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  const handleSelectImage = (imageUrl: string) => {
    onSelect(imageUrl);
  };

  const handleAddMultiple = () => {
    selectedImages.forEach((url) => onSelect(url));
    setSelectedImages([]);
    onClose();
  };

  const toggleImageSelection = (imageUrl: string) => {
    setSelectedImages((prev) =>
      prev.includes(imageUrl) ? prev.filter((u) => u !== imageUrl) : [...prev, imageUrl]
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl flex flex-col max-h-[90vh] rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/10 dark:ring-slate-50/10 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-4 flex-1">
            <h3 className="text-lg font-bold text-slate-900 dark:text-white tracking-tight">
              Product Library
            </h3>
            <span className="text-xs text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">
              {filteredProducts.length} products
            </span>
          </div>

          {/* View Mode Toggle */}
          <div className="flex items-center gap-2 mr-4">
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 p-0.5">
              <button
                onClick={() => setViewMode("grid")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "grid"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                title="Grid view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("compact")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "compact"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                title="Compact view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zM11 4.5a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 0111 4.5zm0 4a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5A.75.75 0 0111 8.5zm0 5a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5a.75.75 0 01-.75-.75zm0 4a.75.75 0 01.75-.75h6.5a.75.75 0 010 1.5h-6.5a.75.75 0 01-.75-.75z" clipRule="evenodd" />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition ${
                  viewMode === "list"
                    ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
                    : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300"
                }`}
                title="List view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
                </svg>
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M5.47 5.47a.75.75 0 011.06 0L12 10.94l5.47-5.47a.75.75 0 111.06 1.06L13.06 12l5.47 5.47a.75.75 0 11-1.06 1.06L12 13.06l-5.47 5.47a.75.75 0 01-1.06-1.06L10.94 12 5.47 6.53a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Search Bar */}
        <div className="px-6 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
          <div className="relative max-w-md">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              type="text"
              placeholder="Search by name, vendor, or type..."
              className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white pl-10 pr-4 py-2.5 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 placeholder:text-slate-400"
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Multi-select action bar */}
        {selectedImages.length > 0 && (
          <div className="px-6 py-2 bg-indigo-50 dark:bg-indigo-900/20 border-b border-indigo-100 dark:border-indigo-900/30 flex items-center justify-between">
            <span className="text-sm text-indigo-700 dark:text-indigo-300">
              {selectedImages.length} image{selectedImages.length > 1 ? "s" : ""} selected
            </span>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedImages([])}
                className="text-xs text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Clear
              </button>
              <button
                onClick={handleAddMultiple}
                className="bg-indigo-600 text-white text-xs font-medium px-3 py-1 rounded-md hover:bg-indigo-700 transition"
              >
                Add Selected
              </button>
            </div>
          </div>
        )}

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50 dark:bg-slate-950/50">
          {filteredProducts.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center text-center">
              <div className="mb-4 rounded-full bg-slate-100 dark:bg-slate-800 p-4">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-slate-400">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
              </div>
              <p className="text-sm font-medium text-slate-900 dark:text-slate-100">No products found</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">Try a different search term</p>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-4">
              {filteredProducts.map((product) => (
                <div key={product.id} className="group relative">
                  <button
                    onClick={() => handleSelectImage(product.image_url)}
                    className="w-full flex flex-col gap-2 text-left outline-none"
                  >
                    <div className="relative aspect-square w-full overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-all group-hover:border-indigo-500 dark:group-hover:border-indigo-500 group-hover:shadow-md group-hover:ring-2 group-hover:ring-indigo-500/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={product.image_url}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                        alt=""
                        loading="lazy"
                      />
                      <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <div className="bg-white/90 dark:bg-black/80 text-indigo-600 dark:text-indigo-400 rounded-full p-1.5 shadow-lg">
                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                            <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                          </svg>
                        </div>
                      </div>
                      {product.shopify_id && (
                        <span className="absolute top-1.5 left-1.5 bg-emerald-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded">
                          Shopify
                        </span>
                      )}
                      {product.shopify_images && product.shopify_images.length > 1 && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedProduct(product);
                          }}
                          className="absolute top-1.5 right-1.5 bg-black/60 text-white text-[9px] font-medium px-1.5 py-0.5 rounded hover:bg-black/80 transition"
                        >
                          +{product.shopify_images.length - 1}
                        </button>
                      )}
                    </div>
                    <div className="px-0.5">
                      <p className="truncate text-xs font-medium text-slate-700 dark:text-slate-200 group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                        {product.name}
                      </p>
                      {product.shopify_vendor && (
                        <p className="truncate text-[10px] text-slate-400">{product.shopify_vendor}</p>
                      )}
                    </div>
                  </button>
                </div>
              ))}
            </div>
          ) : viewMode === "compact" ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleSelectImage(product.image_url)}
                  className="flex items-center gap-3 p-2 rounded-lg border border-transparent hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition text-left group"
                >
                  <div className="h-10 w-10 flex-none rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      {product.name}
                    </p>
                    <p className="text-[10px] text-slate-400 truncate">{product.shopify_vendor || product.slug}</p>
                  </div>
                  {product.shopify_id && <span className="w-2 h-2 rounded-full bg-emerald-500 flex-none" />}
                </button>
              ))}
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredProducts.map((product) => (
                <button
                  key={product.id}
                  onClick={() => handleSelectImage(product.image_url)}
                  className="w-full flex items-center gap-4 py-3 px-2 -mx-2 rounded-lg hover:bg-indigo-50/50 dark:hover:bg-indigo-900/20 transition text-left group"
                >
                  <div className="h-12 w-12 flex-none rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400">
                      {product.name}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{product.slug}</p>
                  </div>
                  <div className="hidden sm:block text-right">
                    <p className="text-xs text-slate-500 dark:text-slate-400">{product.shopify_vendor || "-"}</p>
                    <p className="text-xs text-slate-400">{product.shopify_product_type || "-"}</p>
                  </div>
                  {product.shopify_id ? (
                    <span className="flex-none rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                      Shopify
                    </span>
                  ) : (
                    <span className="flex-none rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-medium text-slate-600 dark:text-slate-400">
                      Manual
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Expanded Product Images Modal */}
        {expandedProduct && expandedProduct.shopify_images && (
          <div className="absolute inset-0 z-10 bg-black/80 flex items-center justify-center p-6">
            <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-800">
                <h4 className="font-semibold text-slate-900 dark:text-white">{expandedProduct.name}</h4>
                <button
                  onClick={() => setExpandedProduct(null)}
                  className="p-1 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                  </svg>
                </button>
              </div>
              <div className="p-4 overflow-y-auto max-h-[calc(80vh-60px)]">
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Select an image ({expandedProduct.shopify_images.length} available)
                </p>
                <div className="grid grid-cols-3 gap-3">
                  {expandedProduct.shopify_images.map((img, idx) => (
                    <button
                      key={idx}
                      onClick={() => {
                        handleSelectImage(img);
                        setExpandedProduct(null);
                      }}
                      className="group aspect-square overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-500 hover:ring-2 hover:ring-indigo-500/20 transition"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={img} alt="" className="h-full w-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type VideoProvider = "kling" | "veo" | "sora";
type VideoModelKind = "veo" | "storyboard" | "sora-t2v" | "sora-i2v" | "kling26";

type VideoModelOption = {
  id: string;
  provider: VideoProvider;
  label: string;
  kind: VideoModelKind;
  requiresImage?: boolean;
};

type VeoRatio = "16:9" | "9:16";

type VideoItem = { id: string; prompt: string; url: string };
type RunStatus = "idle" | "running" | "done" | "cancelled" | "error";
type VideoRun = {
  id: string;
  name: string;
  productName?: string;
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
  referenceUrls: string[]; // Multiple reference URLs for Kling 2.6
  kling26: {
    duration: "5" | "10";
    aspect: "16:9" | "9:16" | "1:1";
    sound: boolean;
  };
  veo: {
    aspect: VeoRatio;
    seed: string;
    startFrame: string; // URL or data URI
    endFrame: string;   // URL or data URI (optional)
  };
  sora: {
    frames: "10" | "15" | "25";
    aspect: "portrait" | "landscape";
    size: "standard" | "high";
    removeWatermark: boolean;
    shots: string;
    imageUrl: string;
  };
  batchImages?: string[];
};

const VIDEO_MODEL_GROUPS: Array<{ label: string; options: VideoModelOption[] }> = [
  {
    label: "Kling (KIE)",
    options: [
      { id: "kling-2.6", provider: "kling", label: "Kling 2.6 (Auto I2V/T2V)", kind: "kling26" },
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
    label: "Sora (OpenAI)",
    options: [
      { id: "sora-2-pro-text-to-video", provider: "sora", label: "Sora 2 Pro Text-to-Video", kind: "sora-t2v" },
      { id: "sora-2-pro-image-to-video", provider: "sora", label: "Sora 2 Pro Image-to-Video", kind: "sora-i2v", requiresImage: true },
      { id: "sora-2-pro-storyboard", provider: "sora", label: "Sora 2 Pro Storyboard", kind: "storyboard", requiresImage: true },
    ],
  },
];

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
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

export default function VideoStudioPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [customVideoUrl, setCustomVideoUrl] = useState("");
  const [customVideoUrls, setCustomVideoUrls] = useState<string[]>([]);
  const [customVideoUploads, setCustomVideoUploads] = useState<string[]>([]);
  const [referenceUploadPreview, setReferenceUploadPreview] = useState<string | null>(null);
  const [videoModel, setVideoModel] = useState<string>(VIDEO_MODEL_GROUPS[0].options[0].id);
  const [showRefProductModal, setShowRefProductModal] = useState(false);
  const [refSearchQuery, setRefSearchQuery] = useState("");
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
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
  const [expandedVideo, setExpandedVideo] = useState(false);

  // Computed ref sources (all unique images from uploads and URLs)
  const refSources = useMemo(() => {
    const list = [
      ...customVideoUploads,
      ...(customVideoUrl.trim() ? [customVideoUrl.trim()] : []),
      ...customVideoUrls.map((u) => u.trim()).filter(Boolean),
    ];
    const seen = new Set<string>();
    return list.filter((src) => {
      if (seen.has(src)) return false;
      seen.add(src);
      return true;
    });
  }, [customVideoUploads, customVideoUrl, customVideoUrls]);

  // Auto-select new refs when added
  useEffect(() => {
    setSelectedRefs(() => refSources.slice(0, 6));
  }, [refSources]);

  function removeUploadSrc(src: string) {
    setCustomVideoUploads((prev) => prev.filter((u) => u !== src));
    setCustomVideoUrls((prev) => prev.filter((u) => u !== src));
  }

  const resolvedVideoReferenceUrl = selectedRefs[0] || "";

  const isKling = videoModelDef.provider === "kling";
  const isVeo = videoModelDef.provider === "veo";
  const isSora = videoModelDef.provider === "sora";

  // Kling 2.6 states
  const [kling26Duration, setKling26Duration] = useState<"5" | "10">("5");
  const [kling26Aspect, setKling26Aspect] = useState<"16:9" | "9:16" | "1:1">("16:9");
  const [kling26Sound, setKling26Sound] = useState<boolean>(false);

  const [veoAspect, setVeoAspect] = useState<VeoRatio>("16:9");
  const [veoSeed, setVeoSeed] = useState("");
  const [veoStartFrame, setVeoStartFrame] = useState<string>(""); // URL or data URI for start frame
  const [veoEndFrame, setVeoEndFrame] = useState<string>(""); // URL or data URI for end frame
  const [veoFrameTarget, setVeoFrameTarget] = useState<"start" | "end" | null>(null); // Which frame to set when selecting from products

  const [soraFrames, setSoraFrames] = useState<"10" | "15" | "25">("15");
  const [soraAspect, setSoraAspect] = useState<"portrait" | "landscape">("landscape");
  const [soraSize, setSoraSize] = useState<"standard" | "high">("standard");
  const [soraRemoveWatermark, setSoraRemoveWatermark] = useState(false);
  const [soraShotsText, setSoraShotsText] = useState(
    `5|Establishing shot of the scene\n10|Add detail or talent`
  );
  const [soraImageUrl, setSoraImageUrl] = useState("");

  const isSoraT2V = videoModelDef.kind === "sora-t2v";
  const isSoraI2V = videoModelDef.kind === "sora-i2v";
  const isSoraStoryboard = isSora && videoModelDef.kind === "storyboard";

  // Clamp soraFrames to 15 when switching to T2V/I2V (25s is storyboard-only)
  useEffect(() => {
    if ((isSoraT2V || isSoraI2V) && soraFrames === "25") {
      setSoraFrames("15");
    }
  }, [isSoraT2V, isSoraI2V, soraFrames]);

  const trimmedSoraImageUrl = soraImageUrl.trim();
  const finalReferenceUrl = isSora ? trimmedSoraImageUrl || resolvedVideoReferenceUrl : resolvedVideoReferenceUrl;
  const videoNeedsImage = videoModelDef.requiresImage === true;
  const videoSomethingRunning = videoRuns.some((run) => run.status === "running");
  const canStartVideo = videoPromptLines.length > 0 && (!videoNeedsImage || !!finalReferenceUrl);
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

  // Session restoration flag
  const sessionRestoredRef = useRef(false);
  const allVideoModelIds = useMemo(
    () => VIDEO_MODEL_GROUPS.flatMap((g) => g.options.map((o) => o.id)),
    []
  );

  // Restore session from localStorage on mount
  useEffect(() => {
    if (sessionRestoredRef.current) return;
    sessionRestoredRef.current = true;

    const session = loadVideoStudioSession();
    if (!session) return;

    // Restore state from session
    if (session.promptsText) setVideoPrompts(session.promptsText);
    if (session.videoModel && allVideoModelIds.includes(session.videoModel)) {
      setVideoModel(session.videoModel);
    }
    // Kling 2.6 settings
    if (session.kling26Duration) setKling26Duration(session.kling26Duration as any);
    if (session.kling26Aspect) setKling26Aspect(session.kling26Aspect as any);
    if (typeof session.kling26Sound === "boolean") setKling26Sound(session.kling26Sound);
    if (session.veoAspect) setVeoAspect(session.veoAspect as any);
    if (session.soraFrames) setSoraFrames(session.soraFrames as any);
    if (session.soraAspect) setSoraAspect(session.soraAspect as any);
    if (session.soraSize) setSoraSize(session.soraSize as any);
    if (typeof session.soraRemoveWatermark === "boolean") setSoraRemoveWatermark(session.soraRemoveWatermark);
    if (typeof session.videoParallel === "number") setVideoParallel(session.videoParallel);
    if (session.customUrl) setCustomVideoUrl(session.customUrl);
    if (session.batchVideoImages?.length) setBatchVideoImages(session.batchVideoImages);

    // Restore runs (deserialize Set and mark running as cancelled)
    if (session.videoRuns?.length) {
      const restoredRuns = session.videoRuns.map(deserializeVideoRun);
      setVideoRuns(restoredRuns);
      if (session.activeVideoRunId) {
        setActiveVideoRunId(session.activeVideoRunId);
      } else if (restoredRuns.length > 0) {
        setActiveVideoRunId(restoredRuns[restoredRuns.length - 1].id);
      }
    }
  }, [allVideoModelIds]);

  // Save session to localStorage when state changes
  useEffect(() => {
    if (!sessionRestoredRef.current) return; // Don't save during initial load

    const session: VideoStudioSession = {
      version: 1,
      savedAt: Date.now(),
      promptsText: videoPrompts,
      videoModel,
      kling26Duration,
      kling26Aspect,
      kling26Sound,
      veoAspect,
      soraFrames,
      soraAspect,
      soraSize,
      soraRemoveWatermark,
      videoParallel,
      customUrl: customVideoUrl,
      batchVideoImages: batchVideoImages.filter((u) => !u.startsWith("data:")), // Don't save large data URIs
      videoRuns: videoRuns.map(serializeVideoRun),
      activeVideoRunId,
    };

    debouncedSaveVideoSession(session);
  }, [
    videoPrompts,
    videoModel,
    kling26Duration,
    kling26Aspect,
    kling26Sound,
    veoAspect,
    soraFrames,
    soraAspect,
    soraSize,
    soraRemoveWatermark,
    videoParallel,
    customVideoUrl,
    batchVideoImages,
    videoRuns,
    activeVideoRunId,
  ]);

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

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
          if (expandedVideo) setExpandedVideo(false);
          if (referenceUploadPreview) setReferenceUploadPreview(null);
          if (showRefProductModal) setShowRefProductModal(false);
      }
      // Arrow key navigation in expanded video modal
      if (expandedVideo && activeVideoRun) {
        if (event.key === "ArrowLeft" && activeVideoRun.activeIdx > 0) {
          stepActiveVideo(activeVideoRun.id, -1);
        }
        if (event.key === "ArrowRight" && activeVideoRun.activeIdx < activeVideoRun.videos.length - 1) {
          stepActiveVideo(activeVideoRun.id, 1);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [referenceUploadPreview, showRefProductModal, expandedVideo, activeVideoRun]);

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
    // Clear old images immediately to prevent using stale session data
    setBatchVideoImages([]);
    try {
      // Convert files to data URLs for previews
      const previews = await filesToDataUrls(files);
      setBatchVideoPreviews(previews);

      // Upload each image directly to Supabase (bypasses Vercel's 4.5MB limit)
      const urls: string[] = [];
      for (const dataUrl of previews) {
        const url = await uploadToStorage(dataUrl);
        urls.push(url);
      }

      setBatchVideoImages(urls);
      setSaveToast({ message: `${urls.length} images uploaded`, type: "success" });
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
      const dataUrls = await filesToDataUrls(files);
      setCustomVideoUploads((prev) => [...prev, ...dataUrls]);
      setSaveToast({ message: `${dataUrls.length} image${dataUrls.length > 1 ? "s" : ""} added`, type: "success" });
    } catch (error: any) {
      setSaveToast({ message: error?.message || "Failed to load images", type: "error" });
    }
  }

  // Upload a data URI directly to Supabase storage (bypasses Vercel's 4.5MB API limit)
  async function uploadToStorage(dataUrl: string): Promise<string> {
    // If already an HTTP URL, return as-is
    if (dataUrl.startsWith("http://") || dataUrl.startsWith("https://")) {
      return dataUrl;
    }

    // Parse data URI
    const match = /^data:([^;]+);base64,(.*)$/i.exec(dataUrl);
    if (!match) {
      throw new Error("Invalid data URL format");
    }

    const mimeType = match[1] || "image/png";
    const base64Data = match[2];

    // Convert base64 to Blob
    const byteCharacters = atob(base64Data);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: mimeType });

    // Determine file extension
    const extMap: Record<string, string> = {
      "image/png": "png",
      "image/jpeg": "jpg",
      "image/jpg": "jpg",
      "image/webp": "webp",
      "image/gif": "gif",
    };
    const ext = extMap[mimeType] || "png";
    const filename = `${crypto.randomUUID()}.${ext}`;
    const filePath = `uploads/${filename}`;

    // Upload directly to Supabase
    const { error: uploadError } = await getSupabaseClient().storage
      .from("reference-images")
      .upload(filePath, blob, {
        contentType: mimeType,
        upsert: false,
      });

    if (uploadError) {
      throw new Error(uploadError.message || "Upload failed");
    }

    // Get public URL
    const { data: urlData } = getSupabaseClient().storage
      .from("reference-images")
      .getPublicUrl(filePath);

    if (!urlData?.publicUrl) {
      throw new Error("Failed to get public URL");
    }

    return urlData.publicUrl;
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
    // Note: addRun() handles removing oldest run if at capacity

    const run: VideoRun = {
      id: crypto.randomUUID(),
      name: `${videoModelDef.label} - ${new Date().toLocaleTimeString()}`,
      productName: "Custom",
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
      productId: null,
      customUrl: finalReferenceUrl || null,
      referenceUrl: finalReferenceUrl || null,
      referenceUrls: [...selectedRefs],
      kling26: { duration: kling26Duration, aspect: kling26Aspect, sound: kling26Sound },
      veo: { aspect: veoAspect, seed: veoSeed, startFrame: veoStartFrame, endFrame: veoEndFrame },
      sora: { frames: soraFrames, aspect: soraAspect, size: soraSize, removeWatermark: soraRemoveWatermark, shots: soraShotsText, imageUrl: trimmedSoraImageUrl },
    };

    addRun(run);
    void executeVideoRun(run, context);
  }

  function startBatchVideoRun() {
    if (!canStartBatch) {
      setSaveToast({ message: "Provide a prompt and upload images.", type: "error" });
      return;
    }
    // Note: addRun() handles removing oldest run if at capacity

    const run: VideoRun = {
      id: crypto.randomUUID(),
      name: `${videoModelDef.label} Batch - ${new Date().toLocaleTimeString()}`,
      productName: "Custom",
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
      productId: null,
      customUrl: finalReferenceUrl || null,
      referenceUrl: finalReferenceUrl || null,
      referenceUrls: [...selectedRefs],
      kling26: { duration: kling26Duration, aspect: kling26Aspect, sound: kling26Sound },
      veo: { aspect: veoAspect, seed: veoSeed, startFrame: veoStartFrame, endFrame: veoEndFrame },
      sora: { frames: soraFrames, aspect: soraAspect, size: soraSize, removeWatermark: soraRemoveWatermark, shots: soraShotsText, imageUrl: trimmedSoraImageUrl },
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
        // Batch mode: one prompt with multiple images
        const prompt = run.prompts[0];
      (context.batchImages || []).forEach((imageUrl, index) => {
        tasks.push(async () => {
          let provider: VideoProvider = "kling";
          let body: any = {};
          if (runIsKling) {
            // Kling 2.6 uses image_urls array and sound parameter
            provider = "kling";
            body = {
              provider,
              model: "kling-2.6/image-to-video", // Always I2V for batch mode (has images)
              mode: "kling26",
              prompt,
              duration: context.kling26.duration,
              aspect_ratio: context.kling26.aspect,
              sound: context.kling26.sound,
              image_urls: [imageUrl],
            };
          } else if (runIsVeo) {
            provider = "veo";
            // In batch mode, each image becomes a separate video
            // Upload data URL to storage if needed (Veo requires public HTTP URLs)
            const uploadedUrl = imageUrl.startsWith("data:") ? await uploadToStorage(imageUrl) : imageUrl;
            const imgs = [uploadedUrl];

            // Parse seed (must be 10000-99999 if provided)
            let seedVal: number | undefined;
            if (context.veo.seed.trim()) {
              const parsed = Number(context.veo.seed);
              if (parsed >= 10000 && parsed <= 99999) {
                seedVal = parsed;
              }
            }

            body = {
              provider,
              model: run.modelId,
              prompt,
              aspectRatio: context.veo.aspect,
              imageUrls: imgs,
              ...(seedVal ? { seeds: seedVal } : {}),
            };
          } else if (runIsSora) {
            provider = "sora";
            const soraKind = modelOption.kind;
            const soraInput: any = {
              n_frames: soraKind === "storyboard" ? context.sora.frames : (context.sora.frames === "25" ? "15" : context.sora.frames),
              aspect_ratio: context.sora.aspect,
            };
            if (soraKind === "sora-t2v") {
              // Text-to-Video: prompt only, no image_urls, no shots
            } else if (soraKind === "sora-i2v") {
              // Image-to-Video: prompt + image
              const uploadedUrl = imageUrl.startsWith("data:") ? await uploadToStorage(imageUrl) : imageUrl;
              soraInput.image_urls = [uploadedUrl];
            } else {
              // Storyboard: prompt + image + shots
              const uploadedUrl = imageUrl.startsWith("data:") ? await uploadToStorage(imageUrl) : imageUrl;
              soraInput.image_urls = [uploadedUrl];
              const shots = context.sora.shots
                .split(/\r?\n/)
                .map((row) => row.trim())
                .filter(Boolean)
                .map((row) => {
                  const [durStr, ...rest] = row.split("|");
                  const duration = Math.max(1, Number(durStr.trim() || "1"));
                  const scene = rest.join("|").trim() || prompt;
                  return { duration, scene };
                });
              soraInput.shots = shots;
            }
            body = {
              provider,
              model: run.modelId,
              prompt,
              input: soraInput,
            };
          }

          console.log("[VideoRun][batch] Sora request body:", JSON.stringify(body, null, 2));
          const res = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            console.error("[VideoRun][batch] Error response:", res.status, JSON.stringify(json));
            throw new Error(json.error || "Generation failed");
          }
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
            // Kling 2.6 auto-selects I2V or T2V based on reference image availability
            // Supports multiple images via context.referenceUrls
            provider = "kling";
            let imageUrls = context.referenceUrls?.length > 0 ? context.referenceUrls : (context.referenceUrl ? [context.referenceUrl] : []);

            // Upload any data URLs to storage (Kling requires public HTTP URLs)
            if (imageUrls.some((url) => url.startsWith("data:"))) {
              imageUrls = await Promise.all(imageUrls.map((url) => uploadToStorage(url)));
            }

            const hasImage = imageUrls.length > 0;
            body = {
              provider,
              model: hasImage ? "kling-2.6/image-to-video" : "kling-2.6/text-to-video",
              mode: "kling26",
              prompt: line,
              duration: context.kling26.duration,
              aspect_ratio: context.kling26.aspect,
              sound: context.kling26.sound,
              ...(hasImage ? { image_urls: imageUrls } : {}),
            };
          } else if (runIsVeo) {
            provider = "veo";
            // Veo 3.1: Build image array from dedicated start/end frame inputs
            // 0 images = TEXT_2_VIDEO, 1 image = start frame, 2 images = start→end transition
            let imgs: string[] = [];
            if (context.veo.startFrame) imgs.push(context.veo.startFrame);
            if (context.veo.endFrame) imgs.push(context.veo.endFrame);

            // Upload any data URLs to storage (Veo requires public HTTP URLs, not data URIs)
            if (imgs.some((url) => url.startsWith("data:"))) {
              imgs = await Promise.all(imgs.map((url) => uploadToStorage(url)));
            }

            // Parse seed (must be 10000-99999 if provided)
            let seedVal: number | undefined;
            if (context.veo.seed.trim()) {
              const parsed = Number(context.veo.seed);
              if (parsed >= 10000 && parsed <= 99999) {
                seedVal = parsed;
              }
            }

            body = {
              provider,
              model: run.modelId,
              prompt: line,
              aspectRatio: context.veo.aspect,
              ...(imgs.length > 0 ? { imageUrls: imgs } : {}),
              ...(seedVal ? { seeds: seedVal } : {}),
            };
          } else if (runIsSora) {
            provider = "sora";
            const soraKind = modelOption.kind;
            // Resolve image URLs and upload data URIs to storage
            let soraImgUrls = context.sora.imageUrl
              ? [context.sora.imageUrl]
              : context.referenceUrl
              ? [context.referenceUrl]
              : [];
            if (soraImgUrls.some((url) => url.startsWith("data:"))) {
              soraImgUrls = await Promise.all(soraImgUrls.map((url) => uploadToStorage(url)));
            }
            const soraInput: any = {
              n_frames: soraKind === "storyboard" ? context.sora.frames : (context.sora.frames === "25" ? "15" : context.sora.frames),
              aspect_ratio: context.sora.aspect,
            };
            if (soraKind === "sora-t2v") {
              // Text-to-Video: prompt only, no image_urls, no shots
            } else if (soraKind === "sora-i2v") {
              // Image-to-Video: prompt + image
              if (soraImgUrls.length > 0) soraInput.image_urls = soraImgUrls;
            } else {
              // Storyboard: prompt + image + shots
              if (soraImgUrls.length > 0) soraInput.image_urls = soraImgUrls;
              const shots = context.sora.shots
                .split(/\r?\n/)
                .map((row) => row.trim())
                .filter(Boolean)
                .map((row) => {
                  const [durStr, ...rest] = row.split("|");
                  const duration = Math.max(1, Number(durStr.trim() || "1"));
                  const scene = rest.join("|").trim() || line;
                  return { duration, scene };
                });
              soraInput.shots = shots;
            }
            body = {
              provider,
              model: run.modelId,
              prompt: line,
              input: soraInput,
            };
          }

          console.log("[VideoRun] Sora request body:", JSON.stringify(body, null, 2));
          const res = await fetch("/api/video/generate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
          const json = await res.json().catch(() => ({}));
          if (!res.ok) {
            console.error("[VideoRun] Error response:", res.status, JSON.stringify(json));
            throw new Error(json.error || `Generation failed (${index + 1})`);
          }
          pushVideo({ id: crypto.randomUUID(), prompt: line, url: json.videoUrl });
          incProgress();
        });
      });
    }

    try {
      // Veo API has rate limits - force sequential execution to avoid errors
      const effectiveSpeed = runIsVeo ? 1 : Math.max(1, Math.min(run.speed, MAX_CONCURRENT_REQUESTS));
      await runWithLimit(effectiveSpeed, tasks);
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
    <div className="min-h-screen bg-[#fcfcfc] dark:bg-black p-4 lg:p-6">
      <div className="mx-auto max-w-[1800px]">
        <div className="mb-6 flex items-center justify-between">
           <div className="flex items-center gap-3">
               <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Video Studio</h1>
               <div className="h-4 w-px bg-slate-200 dark:bg-slate-800" />
               <div className="flex gap-1 text-xs font-medium text-slate-500 dark:text-slate-400">
                   <span>Runs: {videoRuns.length}</span>
                   <span className="text-slate-300 dark:text-slate-600">•</span>
                   <span>Active: {videoRuns.filter(r => r.status === "running").length}</span>
               </div>
           </div>
           <Link href="/library" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
             View Library &rarr;
           </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[320px_640px_minmax(0,1fr)] items-start">
          
          {/* Column 1: Configuration */}
          <div className="space-y-6">
             {/* Model Select */}
             <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                 <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Model</h2>
                 <div className="space-y-4">
                     {VIDEO_MODEL_GROUPS.map(group => (
                         <div key={group.label}>
                             <p className="mb-2 text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500 opacity-70">{group.label}</p>
                             <div className="space-y-2">
                                 {group.options.map(option => (
                                     <button
                                        key={option.id}
                                        onClick={() => setVideoModel(option.id)}
                                        className={`w-full flex items-center justify-between p-2.5 rounded-lg border text-left text-sm transition-all ${ 
                                            videoModel === option.id
                                            ? "border-indigo-600 dark:border-indigo-500 ring-1 ring-indigo-600 dark:ring-indigo-500 bg-indigo-50/50 dark:bg-indigo-500/10 text-indigo-900 dark:text-indigo-300"
                                            : "border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 text-slate-700 dark:text-slate-300"
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
                 <div className="mt-4 border-t border-slate-100 dark:border-slate-800 pt-4">
                     {/* Kling 2.6 Params */}
                     {isKling && (
                         <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Duration</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100" value={kling26Duration} onChange={e => setKling26Duration(e.target.value as any)}>
                                        <option value="5">5s</option>
                                        <option value="10">10s</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Aspect</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100" value={kling26Aspect} onChange={e => setKling26Aspect(e.target.value as any)}>
                                        <option value="16:9">16:9</option>
                                        <option value="9:16">9:16</option>
                                        <option value="1:1">1:1</option>
                                    </select>
                                </div>
                            </div>
                            <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                                <input type="checkbox" checked={kling26Sound} onChange={e => setKling26Sound(e.target.checked)} className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500" />
                                Generate with Sound
                            </label>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                                {finalReferenceUrl ? "Image provided: using Image-to-Video" : "No image: using Text-to-Video"}
                            </p>
                         </div>
                     )}
                     {/* Veo 3.1 Params */}
                     {isVeo && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-2 gap-2">
                                 <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Aspect Ratio</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100" value={veoAspect} onChange={e => setVeoAspect(e.target.value as any)}>
                                        <option value="16:9">16:9 (Landscape HD)</option>
                                        <option value="9:16">9:16 (Portrait)</option>
                                    </select>
                                </div>
                                 <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Seed (optional)</label>
                                    <input type="number" min="10000" max="99999" className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100" placeholder="10000-99999" value={veoSeed} onChange={e => setVeoSeed(e.target.value)} />
                                </div>
                            </div>
                        </div>
                     )}
                     {/* Sora Params */}
                     {isSora && (
                        <div className="space-y-3">
                            <div className="grid grid-cols-3 gap-2">
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Duration</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100" value={soraFrames} onChange={e => setSoraFrames(e.target.value as any)}>
                                        <option value="10">10s</option>
                                        <option value="15">15s</option>
                                        {isSoraStoryboard && <option value="25">25s</option>}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Aspect</label>
                                    <select className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100" value={soraAspect} onChange={e => setSoraAspect(e.target.value as any)}>
                                        <option value="landscape">Landscape</option>
                                        <option value="portrait">Portrait</option>
                                    </select>
                                </div>
                            </div>
                            {isSoraStoryboard && (
                              <div>
                                <label className="text-[10px] font-bold uppercase text-slate-400 dark:text-slate-500">Shots (duration|scene per line)</label>
                                <textarea
                                  className="w-full mt-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 font-mono"
                                  rows={3}
                                  placeholder={"5|Establishing shot of the scene\n10|Close-up with detail"}
                                  value={soraShotsText}
                                  onChange={e => setSoraShotsText(e.target.value)}
                                />
                              </div>
                            )}
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                                {isSoraT2V && "Text-to-Video mode (prompt only, no image)"}
                                {isSoraI2V && "Image-to-Video mode (prompt + reference image)"}
                                {isSoraStoryboard && "Storyboard mode (prompt + image + shot timeline)"}
                            </p>
                        </div>
                     )}
                 </div>
             </div>

             {/* Context / Reference */}
             <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
                 <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Context</h2>
                    <div className="flex items-center gap-2">
                      {!isVeo && selectedRefs.length > 0 && (
                        <span className="text-[10px] text-slate-500 dark:text-slate-400">
                          {selectedRefs.length} selected
                        </span>
                      )}
                      {isVeo && (veoStartFrame || veoEndFrame) && (
                        <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                          {veoStartFrame && veoEndFrame ? "Frame Transition" : "Image-to-Video"}
                        </span>
                      )}
                      {videoNeedsImage && (
                        <span className={`h-2 w-2 rounded-full ${selectedRefs.length > 0 ? "bg-emerald-500" : "bg-rose-500"}`} />
                      )}
                    </div>
                 </div>

                 <div className="space-y-4">
                     {/* Veo: Start Frame / End Frame slots */}
                     {isVeo && (
                       <div className="space-y-3">
                         <div className="flex items-center justify-between">
                           <p className="text-[10px] text-slate-500 dark:text-slate-400">
                             Add frames to control video generation.
                           </p>
                           <button
                             onClick={() => {
                               setVeoFrameTarget("start");
                               setShowRefProductModal(true);
                             }}
                             className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                           >
                             Browse Products
                           </button>
                         </div>
                         <div className="grid grid-cols-2 gap-3">
                           {/* Start Frame */}
                           <div className="space-y-1.5">
                             <div className="flex items-center justify-between">
                               <label className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">Start Frame</label>
                               {!veoStartFrame && (
                                 <button
                                   onClick={() => {
                                     setVeoFrameTarget("start");
                                     setShowRefProductModal(true);
                                   }}
                                   className="text-[9px] text-indigo-500 hover:text-indigo-600 dark:text-indigo-400"
                                 >
                                   Products
                                 </button>
                               )}
                             </div>
                             {veoStartFrame ? (
                               <div className="relative group aspect-video rounded-lg overflow-hidden border-2 border-emerald-500 ring-2 ring-emerald-500/20">
                                 <img src={veoStartFrame} alt="Start frame" className="w-full h-full object-cover" />
                                 <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                                   <button
                                     onClick={() => setVeoStartFrame("")}
                                     className="p-1.5 rounded-full bg-rose-500 text-white hover:bg-rose-600"
                                   >
                                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                       <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                     </svg>
                                   </button>
                                 </div>
                                 <div className="absolute bottom-1 left-1 bg-emerald-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">START</div>
                               </div>
                             ) : (
                               <label className="aspect-video flex flex-col items-center justify-center rounded-lg border-2 border-dashed border-slate-300 dark:border-slate-600 hover:border-emerald-400 dark:hover:border-emerald-500 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition">
                                 <input
                                   type="file"
                                   accept="image/*"
                                   className="hidden"
                                   onChange={async (e) => {
                                     const files = e.target.files;
                                     if (files && files[0]) {
                                       const reader = new FileReader();
                                       reader.onload = () => setVeoStartFrame(reader.result as string);
                                       reader.readAsDataURL(files[0]);
                                     }
                                     e.target.value = "";
                                   }}
                                 />
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-400">
                                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                 </svg>
                                 <span className="text-[10px] text-slate-400 mt-1">Upload</span>
                               </label>
                             )}
                           </div>

                           {/* End Frame */}
                           <div className="space-y-1.5">
                             <div className="flex items-center justify-between">
                               <label className="text-[10px] font-bold uppercase text-slate-500 dark:text-slate-400">End Frame <span className="font-normal normal-case opacity-60">(opt.)</span></label>
                               {!veoEndFrame && (
                                 <button
                                   onClick={() => {
                                     setVeoFrameTarget("end");
                                     setShowRefProductModal(true);
                                   }}
                                   className="text-[9px] text-indigo-500 hover:text-indigo-600 dark:text-indigo-400"
                                 >
                                   Products
                                 </button>
                               )}
                             </div>
                             {veoEndFrame ? (
                               <div className="relative group aspect-video rounded-lg overflow-hidden border-2 border-indigo-500 ring-2 ring-indigo-500/20">
                                 <img src={veoEndFrame} alt="End frame" className="w-full h-full object-cover" />
                                 <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
                                   <button
                                     onClick={() => setVeoEndFrame("")}
                                     className="p-1.5 rounded-full bg-rose-500 text-white hover:bg-rose-600"
                                   >
                                     <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                                       <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                     </svg>
                                   </button>
                                 </div>
                                 <div className="absolute bottom-1 left-1 bg-indigo-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded">END</div>
                               </div>
                             ) : (
                               <label className={`aspect-video flex flex-col items-center justify-center rounded-lg border-2 border-dashed ${veoStartFrame ? "border-slate-300 dark:border-slate-600 hover:border-indigo-400 dark:hover:border-indigo-500" : "border-slate-200 dark:border-slate-700"} hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition`}>
                                 <input
                                   type="file"
                                   accept="image/*"
                                   className="hidden"
                                   onChange={async (e) => {
                                     const files = e.target.files;
                                     if (files && files[0]) {
                                       const reader = new FileReader();
                                       reader.onload = () => setVeoEndFrame(reader.result as string);
                                       reader.readAsDataURL(files[0]);
                                     }
                                     e.target.value = "";
                                   }}
                                 />
                                 <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-slate-400">
                                   <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                 </svg>
                                 <span className="text-[10px] text-slate-400 mt-1">Upload</span>
                               </label>
                             )}
                           </div>
                         </div>

                         {/* Veo mode indicator */}
                         <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                           {!veoStartFrame && !veoEndFrame && "Text-to-Video mode (no frames)"}
                           {veoStartFrame && !veoEndFrame && "Image-to-Video mode (video unfolds from start frame)"}
                           {veoStartFrame && veoEndFrame && "Frame Transition mode (animates from start to end)"}
                           {!veoStartFrame && veoEndFrame && "⚠️ Add a start frame to use transition mode"}
                         </p>
                       </div>
                     )}

                     {/* Kling/Sora: Reference Images Grid */}
                     {!isVeo && (
                       <>
                         <div className="space-y-2">
                            <div className="flex items-center justify-between">
                              <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Reference Images</label>
                              <button
                                onClick={() => setShowRefProductModal(true)}
                                className="text-[10px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 font-medium"
                              >
                                Browse Products
                              </button>
                            </div>

                            {/* Image Grid */}
                            <div className="grid grid-cols-3 gap-2">
                              {/* Upload Button */}
                              <label className="aspect-square flex items-center justify-center rounded-lg border-2 border-dashed border-slate-200 dark:border-slate-700 hover:border-indigo-400 dark:hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition">
                                <input
                                  type="file"
                                  accept="image/*"
                                  multiple
                                  className="hidden"
                                  onChange={(e) => handleReferenceUpload(e.target.files)}
                                />
                                <div className="text-center">
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5 mx-auto text-slate-400">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                                  </svg>
                                  <span className="text-[9px] text-slate-400 mt-0.5 block">Upload</span>
                                </div>
                              </label>

                              {/* Existing References */}
                              {refSources.map((src, idx) => {
                                const isSelected = selectedRefs.includes(src);
                                return (
                                  <div key={idx} className="relative group">
                                    <button
                                      onClick={() => {
                                        setSelectedRefs((prev) =>
                                          prev.includes(src)
                                            ? prev.filter((s) => s !== src)
                                            : [...prev, src]
                                        );
                                      }}
                                      className={`aspect-square w-full rounded-lg border-2 overflow-hidden transition ${
                                        isSelected
                                          ? "border-indigo-500 ring-2 ring-indigo-500/20"
                                          : "border-slate-200 dark:border-slate-700 opacity-60 hover:opacity-100"
                                      }`}
                                    >
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={src}
                                        alt=""
                                        className="h-full w-full object-cover"
                                      />
                                      {isSelected && (
                                        <div className="absolute top-1 left-1 bg-indigo-500 text-white rounded-full p-0.5">
                                          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                            <path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" />
                                          </svg>
                                        </div>
                                      )}
                                    </button>
                                    {/* Preview & Remove buttons */}
                                    <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition">
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setReferenceUploadPreview(src);
                                        }}
                                        className="bg-black/60 text-white rounded p-0.5 hover:bg-black/80"
                                        title="Preview"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                          <path d="M10 12.5a2.5 2.5 0 100-5 2.5 2.5 0 000 5z" />
                                          <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 010-1.186A10.004 10.004 0 0110 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0110 17c-4.257 0-7.893-2.66-9.336-6.41zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
                                        </svg>
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeUploadSrc(src);
                                        }}
                                        className="bg-rose-500/80 text-white rounded p-0.5 hover:bg-rose-600"
                                        title="Remove"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                          <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                        </svg>
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                         </div>

                         {/* URL Input */}
                         <div className="space-y-2">
                            <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Add by URL</label>
                            <input
                              className="w-full rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 text-xs bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                              placeholder="Paste image URL and press Enter..."
                              value={customVideoUrl}
                              onChange={(e) => setCustomVideoUrl(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && customVideoUrl.trim()) {
                                  setCustomVideoUrls((prev) => [...prev, customVideoUrl.trim()]);
                                  setCustomVideoUrl("");
                                }
                              }}
                            />
                         </div>

                         {/* Kling 2.6 multiple images hint */}
                         {isKling && selectedRefs.length > 1 && (
                           <p className="text-[10px] text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-2 py-1 rounded">
                             Kling 2.6 will use all {selectedRefs.length} selected images as reference elements.
                           </p>
                         )}

                         {/* Mode indicator for Kling 2.6 */}
                         {isKling && (
                           <p className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                             {selectedRefs.length > 0 ? "Image-to-Video mode" : "Text-to-Video mode (no images)"}
                           </p>
                         )}
                       </>
                     )}
                 </div>
             </div>
          </div>

          {/* Column 2: Creation */}
          <div className="flex flex-col gap-6 h-[calc(100vh-120px)]">
             <div className="flex-1 flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-1 shadow-sm overflow-hidden">
                 <div className="flex items-center justify-between p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50">
                     <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">Director</h2>
                     <div className="flex items-center gap-2">
                        <PromptAssistant 
                            onAccept={(newPrompts, mode) => {
                                if (mode === "replace") {
                                    setVideoPrompts(newPrompts.join("\n"));
                                } else {
                                    setVideoPrompts(prev => {
                                        const prefix = prev.trim() ? prev.trim() + "\n" : "";
                                        return prefix + newPrompts.join("\n");
                                    });
                                }
                            }}
                        />
                         <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                          {isVeo ? (
                            <span className="text-xs text-slate-400 dark:text-slate-500" title="Veo API requires sequential execution">Sequential</span>
                          ) : (
                            <select
                              className="bg-transparent text-xs font-medium text-slate-600 dark:text-slate-400 focus:outline-none dark:bg-slate-900"
                              value={videoParallel}
                              onChange={(e) => setVideoParallel(Number(e.target.value))}
                            >
                              {RUN_PARALLEL_OPTIONS.map(s => <option key={s} value={s}>Parallel {s}x</option>)}
                            </select>
                          )}
                     </div>
                </div>
                
                {batchVideoMode ? (
                    <div className="flex-1 p-6 space-y-6 overflow-y-auto">
                        <div className="p-4 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800">
                            <h3 className="text-sm font-bold text-indigo-900 dark:text-indigo-300 mb-2">Batch Mode Active</h3>
                            <p className="text-xs text-indigo-700 dark:text-indigo-400">One prompt will be applied to all uploaded images.</p>
                        </div>
                        <div className="space-y-2">
                             <label className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Batch Prompt</label>
                             <textarea 
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-800 p-3 text-sm bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                rows={3}
                                placeholder="Describe the motion..."
                                value={batchVideoPrompt}
                                onChange={(e) => setBatchVideoPrompt(e.target.value)}
                             />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold uppercase text-slate-500 dark:text-slate-400">Images ({batchVideoImages.length})</label>
                            <div className="grid grid-cols-4 gap-2">
                                <label className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer">
                                    <span className="text-xl text-slate-400 dark:text-slate-500">+</span>
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={e => handleBatchVideoUpload(e.target.files)} />
                                </label>
                                {batchVideoPreviews.map((src, i) => (
                                    <div key={i} className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-900">
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img src={src} className="h-full w-full object-cover" alt="" />
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                ) : (
                    <textarea 
                        className="flex-1 w-full resize-none p-4 text-sm outline-none text-slate-700 dark:text-slate-300 placeholder:text-slate-300 dark:placeholder:text-slate-600 font-mono leading-relaxed bg-white dark:bg-slate-900"
                        placeholder="One video prompt per line..."
                        value={videoPrompts}
                        onChange={(e) => setVideoPrompts(e.target.value)}
                    />
                )}

                <div className="p-3 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between">
                     <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-xs font-medium text-slate-600 dark:text-slate-400 cursor-pointer select-none">
                            <input type="checkbox" checked={batchVideoMode} onChange={e => setBatchVideoMode(e.target.checked)} className="rounded border-slate-300 dark:border-slate-700 text-indigo-600 focus:ring-indigo-500" />
                            Batch Mode
                        </label>
                     </div>
                     <button
                        onClick={batchVideoMode ? startBatchVideoRun : startVideoRun}
                        disabled={batchVideoMode ? !canStartBatch : !canStartVideo}
                        className="px-6 py-2 bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition shadow-sm"
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
                  <div className="flex flex-col flex-1 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
                      <div className="p-4 border-b border-slate-100 dark:border-slate-800">
                           <div className="flex items-center justify-between mb-2">
                             <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">{activeVideoRun.name}</span>
                             <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide ring-1 ring-inset ${statusColor(activeVideoRun.status)}`}>
                                 {activeVideoRun.status}
                             </span>
                        </div>
                        <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                             <div className="h-full bg-slate-900 dark:bg-slate-50 transition-all duration-500" style={{ width: `${activeVideoRun.progress.total > 0 ? Math.round((activeVideoRun.progress.done / activeVideoRun.progress.total) * 100) : 0}%` }} />
                        </div>
                        {activeVideoRun.status === "error" && activeVideoRun.error && (
                          <div className="mt-2 p-2 rounded-lg bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-800">
                            <p className="text-xs text-rose-700 dark:text-rose-300 font-mono break-all">{activeVideoRun.error}</p>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50/30 dark:bg-slate-950/30">
                          {activeVideoRun.videos.length > 0 ? (
                              <div className="space-y-3">
                                  <div className="relative rounded-lg overflow-hidden bg-black shadow-lg group">
                                      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                      <video
                                        src={activeVideoRun.videos[activeVideoRun.activeIdx].url}
                                        controls
                                        playsInline
                                        className="w-full aspect-video object-contain"
                                      />
                                      <button
                                        onClick={() => setExpandedVideo(true)}
                                        className="absolute top-2 right-2 p-1.5 rounded-lg bg-black/50 text-white opacity-0 group-hover:opacity-100 hover:bg-black/70 transition"
                                        title="Expand video"
                                      >
                                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                                        </svg>
                                      </button>
                                  </div>
                                  <div className="flex items-center justify-between px-1">
                                     <button onClick={() => stepActiveVideo(activeVideoRun.id, -1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500">←</button>
                                     <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{activeVideoRun.activeIdx + 1} of {activeVideoRun.videos.length}</span>
                                     <button onClick={() => stepActiveVideo(activeVideoRun.id, 1)} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-800 rounded text-slate-500">→</button>
                                 </div>
                                 <div className="bg-white dark:bg-slate-800 p-3 rounded-lg border border-slate-100 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                                     {activeVideoRun.videos[activeVideoRun.activeIdx].prompt}
                                 </div>

                                 <div className="flex justify-end gap-2">
                                    <button 
                                        onClick={() => {
                                            const current = activeVideoRun.videos[activeVideoRun.activeIdx];
                                            const base = safeName(activeVideoRun.productName || "video");
                                            const a = document.createElement("a");
                                            a.href = current.url;
                                            a.download = `${base}_${safeName(activeVideoRun.modelLabel)}_${activeVideoRun.activeIdx + 1}.mp4`;
                                            document.body.appendChild(a);
                                            a.click();
                                            a.remove();
                                        }}
                                        className="bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium px-3 py-1.5 rounded-lg shadow-sm transition"
                                    >
                                        Download MP4
                                    </button>
                                 </div>
                                 
                                 <div className="grid grid-cols-3 gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                                     {activeVideoRun.videos.map((vid, idx) => (
                                         <button
                                            key={vid.id}
                                            onClick={() => {
                                                 setVideoRuns(prev => prev.map(r => r.id === activeVideoRun.id ? { ...r, activeIdx: idx } : r));
                                            }}
                                            className={`relative aspect-video rounded-lg overflow-hidden border-2 bg-black transition ${activeVideoRun.activeIdx === idx ? 'border-indigo-500 ring-2 ring-indigo-500/50' : 'border-slate-200 dark:border-slate-700 opacity-80 hover:opacity-100 hover:border-slate-400 dark:hover:border-slate-500'}`}
                                         >
                                             {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                                             <video src={vid.url} className="h-full w-full object-cover pointer-events-none" />
                                             <span className="absolute bottom-1 right-1 px-1.5 py-0.5 text-[10px] font-bold bg-black/70 text-white rounded">
                                               {idx + 1}
                                             </span>
                                         </button>
                                     ))}
                                 </div>
                              </div>
                          ) : (
                              <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2">
                                 <div className="h-8 w-8 border-2 border-slate-200 dark:border-slate-700 border-t-slate-400 dark:border-t-slate-500 rounded-full animate-spin" />
                                 <span className="text-xs">Generating video...</span>
                             </div>
                          )}
                      </div>
                  </div>
              ) : (
                  <div className="flex-1 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-center text-slate-400 text-sm">
                    No active video run
                </div>
              )}

              {/* Queue */}
              <div className="max-h-[200px] rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 overflow-y-auto shadow-sm">
                  <h3 className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">History</h3>
                  <div className="space-y-1">
                    {videoRuns.map(run => (
                        <div key={run.id} 
                             onClick={() => setActiveVideoRunId(run.id)}
                             className={`group flex items-center justify-between p-2 rounded-md border cursor-pointer transition ${activeVideoRunId === run.id ? 'bg-slate-50 dark:bg-slate-800 border-slate-300 dark:border-slate-600' : 'bg-white dark:bg-slate-900 border-transparent hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                        >
                            <div className="flex items-center gap-2 overflow-hidden">
                                <div className={`h-2 w-2 rounded-full ${run.status === 'running' ? 'bg-emerald-500 animate-pulse' : run.status === 'error' ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600'}`} />
                                <span className="truncate text-xs font-medium text-slate-700 dark:text-slate-300">{run.name}</span>
                                <span className="text-[10px] text-slate-400">({run.videos.length})</span>
                            </div>
                            <button 
                                onClick={(e) => { e.stopPropagation(); deleteVideoRun(run.id); }}
                                className="opacity-0 group-hover:opacity-100 text-[10px] text-slate-400 hover:text-rose-500 px-1"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                    {videoRuns.length === 0 && <p className="text-[10px] text-slate-400 italic">No recent runs.</p>}
                </div>
              </div>
          </div>

        </div>
      </div>
      
      {/* Product Selector Modal */}
      {showRefProductModal && (
        <ProductSelectorModal
          products={products}
          onSelect={(imageUrl) => {
            // If selecting for Veo frame, set the appropriate frame
            if (veoFrameTarget === "start") {
              setVeoStartFrame(imageUrl);
              setVeoFrameTarget(null);
            } else if (veoFrameTarget === "end") {
              setVeoEndFrame(imageUrl);
              setVeoFrameTarget(null);
            } else {
              // Default: add to reference URLs for Kling/Sora
              setCustomVideoUrls((prev) => [...prev, imageUrl]);
            }
            setShowRefProductModal(false);
            setRefSearchQuery("");
          }}
          onClose={() => {
            setShowRefProductModal(false);
            setRefSearchQuery("");
            setVeoFrameTarget(null);
          }}
          searchQuery={refSearchQuery}
          setSearchQuery={setRefSearchQuery}
        />
      )}

      {/* Preview Modal for Reference/Product */}
      {referenceUploadPreview && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setReferenceUploadPreview(null)}
        >
          <div
            className="relative max-h-full max-w-5xl overflow-hidden rounded-xl bg-transparent"
            onClick={(e) => e.stopPropagation()}
          >
             <button
              className="absolute top-4 right-4 rounded-full bg-black/50 p-2 text-white hover:bg-black/70"
              onClick={() => setReferenceUploadPreview(null)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={referenceUploadPreview} alt="Preview" className="max-h-[90vh] w-auto rounded-lg shadow-2xl" />
          </div>
        </div>
      )}

      {/* Expanded Video Modal */}
      {expandedVideo && activeVideoRun && activeVideoRun.videos.length > 0 && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setExpandedVideo(false)}
        >
          <div
            className="relative flex flex-col items-center max-w-6xl w-full"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              className="absolute -top-2 -right-2 z-10 rounded-full bg-white/10 p-2 text-white hover:bg-white/20 transition"
              onClick={() => setExpandedVideo(false)}
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>

            {/* Video player */}
            <div className="relative w-full rounded-xl overflow-hidden bg-black shadow-2xl">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={activeVideoRun.videos[activeVideoRun.activeIdx].url}
                controls
                autoPlay
                playsInline
                className="w-full max-h-[80vh] object-contain"
              />
            </div>

            {/* Navigation and info */}
            <div className="flex items-center justify-between w-full mt-4 px-2">
              <button
                onClick={() => stepActiveVideo(activeVideoRun.id, -1)}
                disabled={activeVideoRun.activeIdx === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                Previous
              </button>

              <div className="flex flex-col items-center gap-1">
                <span className="text-white font-medium">
                  {activeVideoRun.activeIdx + 1} of {activeVideoRun.videos.length}
                </span>
                <span className="text-white/60 text-xs max-w-md text-center line-clamp-1">
                  {activeVideoRun.videos[activeVideoRun.activeIdx].prompt}
                </span>
              </div>

              <button
                onClick={() => stepActiveVideo(activeVideoRun.id, 1)}
                disabled={activeVideoRun.activeIdx === activeVideoRun.videos.length - 1}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/10 text-white hover:bg-white/20 disabled:opacity-30 disabled:cursor-not-allowed transition"
              >
                Next
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* Download button */}
            <button
              onClick={() => {
                const current = activeVideoRun.videos[activeVideoRun.activeIdx];
                const base = safeName(activeVideoRun.productName || "video");
                const a = document.createElement("a");
                a.href = current.url;
                a.download = `${base}_${safeName(activeVideoRun.modelLabel)}_${activeVideoRun.activeIdx + 1}.mp4`;
                document.body.appendChild(a);
                a.click();
                a.remove();
              }}
              className="mt-4 px-6 py-2 rounded-lg bg-white text-slate-900 font-medium hover:bg-slate-100 transition"
            >
              Download MP4
            </button>
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