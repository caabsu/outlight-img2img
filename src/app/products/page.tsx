"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Product = {
  id: string;
  name: string;
  slug: string;
  image_url: string;
  shopify_id?: string | null;
  shopify_handle?: string | null;
  shopify_vendor?: string | null;
  shopify_product_type?: string | null;
  shopify_status?: string | null;
  shopify_images?: string[] | null;
  shopify_sku?: string | null;
  shopify_price?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type ViewMode = "grid" | "compact" | "list";
type SourceFilter = "all" | "shopify" | "manual";

type SyncStatus = {
  configured: boolean;
  syncedProducts?: number;
  lastSync?: string | null;
  storeDomain?: string;
};

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function formatDate(dateStr: string | null | undefined) {
  if (!dateStr) return "Never";
  const date = new Date(dateStr);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [form, setForm] = useState<{ id?: string; name: string; slug: string; image_url: string }>({
    name: "",
    slug: "",
    image_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  // Filtered products based on search
  const filteredProducts = useMemo(() => {
    if (!searchQuery.trim()) return products;
    const q = searchQuery.toLowerCase();
    return products.filter(
      (p) =>
        p.name?.toLowerCase().includes(q) ||
        p.slug?.toLowerCase().includes(q) ||
        p.shopify_vendor?.toLowerCase().includes(q) ||
        p.shopify_product_type?.toLowerCase().includes(q) ||
        p.shopify_sku?.toLowerCase().includes(q)
    );
  }, [products, searchQuery]);

  // Stats
  const stats = useMemo(() => {
    const shopifyCount = products.filter((p) => p.shopify_id).length;
    const manualCount = products.filter((p) => !p.shopify_id).length;
    return { total: products.length, shopify: shopifyCount, manual: manualCount };
  }, [products]);

  useEffect(() => {
    loadProducts();
    loadSyncStatus();
  }, [sourceFilter]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadProducts() {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (sourceFilter !== "all") params.set("source", sourceFilter);
      const res = await fetch(`/api/products?${params.toString()}`);
      const json = await res.json();
      if (res.ok) setProducts(json.products || []);
      else setToast({ message: json.error || "Failed to load products", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  async function loadSyncStatus() {
    try {
      const res = await fetch("/api/shopify/sync");
      const json = await res.json();
      setSyncStatus(json);
    } catch {
      setSyncStatus(null);
    }
  }

  async function syncShopify() {
    try {
      setSyncing(true);
      const res = await fetch("/api/shopify/sync", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Sync failed");
      setToast({
        message: `Synced: ${json.stats.created} new, ${json.stats.updated} updated, ${json.stats.skipped} skipped`,
        type: "success",
      });
      await loadProducts();
      await loadSyncStatus();
    } catch (err: any) {
      setToast({ message: err?.message || "Sync failed", type: "error" });
    } finally {
      setSyncing(false);
    }
  }

  function startNew() {
    setForm({ name: "", slug: "", image_url: "" });
    setError(null);
    setShowForm(true);
    setSelectedProduct(null);
  }

  function editProduct(product: Product) {
    setForm({
      id: product.id,
      name: product.name,
      slug: product.slug,
      image_url: product.image_url,
    });
    setError(null);
    setShowForm(true);
    setSelectedProduct(product);
  }

  function viewProduct(product: Product) {
    setSelectedProduct(product);
    setShowForm(false);
  }

  async function saveProduct() {
    try {
      setSaving(true);
      setError(null);
      const payload = {
        name: form.name.trim(),
        slug: (form.slug || safeName(form.name)).trim(),
        image_url: form.image_url.trim(),
      };
      if (!payload.name || !payload.slug || !payload.image_url) {
        setError("Name, slug, and image URL are required.");
        return;
      }

      const res = await fetch(form.id ? `/api/products/${form.id}` : "/api/products", {
        method: form.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Save failed");
      setToast({ message: form.id ? "Product updated" : "Product created", type: "success" });
      setShowForm(false);
      await loadProducts();
    } catch (err: any) {
      setError(err?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  }

  async function deleteProduct(id: string) {
    if (!confirm("Delete this product?")) return;
    try {
      const res = await fetch(`/api/products/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Delete failed");
      setToast({ message: "Product removed", type: "success" });
      if (selectedProduct?.id === id) setSelectedProduct(null);
      await loadProducts();
    } catch (err: any) {
      setToast({ message: err?.message || "Delete failed", type: "error" });
    }
  }

  return (
    <div className="min-h-screen bg-canvas">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between">
            <div className="flex items-center gap-4">
              <h1 className="text-lg font-semibold text-slate-900 dark:text-white">Products</h1>
              <span className="hidden sm:inline-flex items-center rounded-full bg-slate-100 dark:bg-slate-800 px-2.5 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-400">
                {stats.total} total
              </span>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/image"
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Image Studio
              </Link>
              <Link
                href="/video"
                className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
              >
                Video Studio
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        {/* Stats & Sync Section */}
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Total Products
            </p>
            <p className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">{stats.total}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              From Shopify
            </p>
            <p className="mt-2 text-3xl font-semibold text-emerald-600 dark:text-emerald-400">{stats.shopify}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Manual
            </p>
            <p className="mt-2 text-3xl font-semibold text-indigo-600 dark:text-indigo-400">{stats.manual}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  Shopify Sync
                </p>
                {syncStatus?.configured ? (
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    Last: {formatDate(syncStatus.lastSync)}
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">Not configured</p>
                )}
              </div>
              <button
                onClick={syncShopify}
                disabled={syncing || !syncStatus?.configured}
                className="flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition"
              >
                {syncing ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                      <path
                        fillRule="evenodd"
                        d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H3.989a.75.75 0 00-.75.75v4.242a.75.75 0 001.5 0v-2.43l.31.31a7 7 0 0011.712-3.138.75.75 0 00-1.449-.39zm1.23-3.723a.75.75 0 00.219-.53V2.929a.75.75 0 00-1.5 0v2.43l-.31-.31A7 7 0 003.239 8.188a.75.75 0 101.448.389 5.5 5.5 0 019.201-2.466l.312.311H11.767a.75.75 0 000 1.5h4.243a.75.75 0 00.53-.219l.002-.002z"
                        clipRule="evenodd"
                      />
                    </svg>
                    Sync
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Toolbar */}
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-1 items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 max-w-md">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"
              >
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                type="text"
                placeholder="Search products..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-10 pr-4 py-2 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500"
              />
            </div>

            {/* Source Filter */}
            <select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
            >
              <option value="all">All Sources</option>
              <option value="shopify">Shopify Only</option>
              <option value="manual">Manual Only</option>
            </select>
          </div>

          <div className="flex items-center gap-3">
            {/* View Mode Toggle */}
            <div className="flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "grid"
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
                title="Grid view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path
                    fillRule="evenodd"
                    d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zm0 9A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zm9-9A2.25 2.25 0 0011 4.25v2.5A2.25 2.25 0 0013.25 9h2.5A2.25 2.25 0 0018 6.75v-2.5A2.25 2.25 0 0015.75 2h-2.5zm0 9A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("compact")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "compact"
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
                title="Compact view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path
                    fillRule="evenodd"
                    d="M2 3.75A.75.75 0 012.75 3h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 3.75zm0 4.167a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75zm0 4.166a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75zm0 4.167a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                  viewMode === "list"
                    ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
                    : "text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                }`}
                title="List view"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
                </svg>
              </button>
            </div>

            {/* Add Product Button */}
            <button
              onClick={startNew}
              className="flex items-center gap-2 rounded-lg bg-slate-900 dark:bg-white px-4 py-2 text-sm font-medium text-white dark:text-slate-900 shadow-sm hover:bg-slate-800 dark:hover:bg-slate-100 transition"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              Add Product
            </button>
          </div>
        </div>

        {/* Main Content */}
        <div className="grid gap-6 lg:grid-cols-[1fr,400px]">
          {/* Products Grid/List */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 min-h-[500px]">
            {loading ? (
              <div className="flex items-center justify-center h-64">
                <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-slate-600" />
              </div>
            ) : filteredProducts.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-slate-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">No products found</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {searchQuery ? "Try a different search" : "Add a product or sync from Shopify"}
                </p>
              </div>
            ) : viewMode === "grid" ? (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => (
                  <div
                    key={product.id}
                    onClick={() => viewProduct(product)}
                    className={`group cursor-pointer rounded-xl border transition ${
                      selectedProduct?.id === product.id
                        ? "border-indigo-500 ring-2 ring-indigo-500/20"
                        : "border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600"
                    }`}
                  >
                    <div className="aspect-square overflow-hidden rounded-t-xl bg-slate-100 dark:bg-slate-800">
                      {product.image_url ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={product.image_url}
                          alt={product.name}
                          className="h-full w-full object-cover transition-transform group-hover:scale-105"
                          loading="lazy"
                        />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor" className="w-12 h-12 text-slate-300 dark:text-slate-600">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75A1.5 1.5 0 002.25 6v12a1.5 1.5 0 001.5 1.5zm10.5-11.25h.008v.008h-.008V8.25zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{product.name}</p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{product.slug}</p>
                        </div>
                        {product.shopify_id && (
                          <span className="flex-none rounded-full bg-emerald-100 dark:bg-emerald-900/30 px-2 py-0.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">
                            Shopify
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            ) : viewMode === "compact" ? (
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => viewProduct(product)}
                    className={`flex items-center gap-3 rounded-lg p-2 text-left transition ${
                      selectedProduct?.id === product.id
                        ? "bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-500"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800 border border-transparent"
                    }`}
                  >
                    <div className="h-10 w-10 flex-none rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      {product.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-white truncate">{product.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{product.shopify_vendor || product.slug}</p>
                    </div>
                    {product.shopify_id && (
                      <span className="flex-none w-2 h-2 rounded-full bg-emerald-500" title="Shopify" />
                    )}
                  </button>
                ))}
              </div>
            ) : (
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredProducts.map((product) => (
                  <button
                    key={product.id}
                    onClick={() => viewProduct(product)}
                    className={`w-full flex items-center gap-4 py-3 text-left transition ${
                      selectedProduct?.id === product.id
                        ? "bg-indigo-50 dark:bg-indigo-900/20 -mx-4 px-4 rounded-lg"
                        : "hover:bg-slate-50 dark:hover:bg-slate-800/50 -mx-4 px-4 rounded-lg"
                    }`}
                  >
                    <div className="h-12 w-12 flex-none rounded-lg bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      {product.image_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.image_url} alt="" className="h-full w-full object-cover" loading="lazy" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900 dark:text-white">{product.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">{product.slug}</p>
                    </div>
                    <div className="hidden sm:block text-right">
                      <p className="text-xs text-slate-500 dark:text-slate-400">{product.shopify_vendor || "-"}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">{product.shopify_product_type || "-"}</p>
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

          {/* Sidebar: Product Details or Form */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6">
            {showForm ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">
                    {form.id ? "Edit Product" : "New Product"}
                  </h2>
                  <button
                    onClick={() => setShowForm(false)}
                    className="rounded-full p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <p className="rounded-lg bg-rose-50 dark:bg-rose-950/30 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
                    {error}
                  </p>
                )}

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Name</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Slug</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                    value={form.slug}
                    onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                    placeholder={form.name ? safeName(form.name) : "product-slug"}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1">Image URL</label>
                  <input
                    className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-white"
                    value={form.image_url}
                    onChange={(e) => setForm((prev) => ({ ...prev, image_url: e.target.value }))}
                    placeholder="https://..."
                  />
                </div>

                {form.image_url && (
                  <div className="aspect-square overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={form.image_url} alt="Preview" className="h-full w-full object-cover" />
                  </div>
                )}

                <button
                  onClick={saveProduct}
                  disabled={saving}
                  className="w-full rounded-lg bg-slate-900 dark:bg-white px-4 py-2.5 text-sm font-medium text-white dark:text-slate-900 shadow-sm hover:bg-slate-800 dark:hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed transition"
                >
                  {saving ? "Saving..." : form.id ? "Update Product" : "Create Product"}
                </button>
              </div>
            ) : selectedProduct ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900 dark:text-white">Product Details</h2>
                  <button
                    onClick={() => setSelectedProduct(null)}
                    className="rounded-full p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                      <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                    </svg>
                  </button>
                </div>

                <div className="aspect-square overflow-hidden rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                  {selectedProduct.image_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={selectedProduct.image_url} alt={selectedProduct.name} className="h-full w-full object-cover" />
                  ) : (
                    <div className="h-full w-full flex items-center justify-center">
                      <span className="text-sm text-slate-400">No image</span>
                    </div>
                  )}
                </div>

                <div>
                  <h3 className="text-xl font-semibold text-slate-900 dark:text-white">{selectedProduct.name}</h3>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">{selectedProduct.slug}</p>
                </div>

                {selectedProduct.shopify_id && (
                  <div className="rounded-lg bg-emerald-50 dark:bg-emerald-900/20 p-3 space-y-2">
                    <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Shopify Product</p>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      {selectedProduct.shopify_vendor && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Vendor:</span>
                          <span className="ml-1 text-slate-700 dark:text-slate-300">{selectedProduct.shopify_vendor}</span>
                        </div>
                      )}
                      {selectedProduct.shopify_product_type && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Type:</span>
                          <span className="ml-1 text-slate-700 dark:text-slate-300">{selectedProduct.shopify_product_type}</span>
                        </div>
                      )}
                      {selectedProduct.shopify_sku && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">SKU:</span>
                          <span className="ml-1 text-slate-700 dark:text-slate-300">{selectedProduct.shopify_sku}</span>
                        </div>
                      )}
                      {selectedProduct.shopify_price && (
                        <div>
                          <span className="text-slate-500 dark:text-slate-400">Price:</span>
                          <span className="ml-1 text-slate-700 dark:text-slate-300">${selectedProduct.shopify_price}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Additional Images */}
                {selectedProduct.shopify_images && selectedProduct.shopify_images.length > 1 && (
                  <div>
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300 mb-2">
                      All Images ({selectedProduct.shopify_images.length})
                    </p>
                    <div className="grid grid-cols-4 gap-2">
                      {selectedProduct.shopify_images.map((img, idx) => (
                        <div key={idx} className="aspect-square overflow-hidden rounded-lg border border-slate-200 dark:border-slate-700">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={img} alt="" className="h-full w-full object-cover" loading="lazy" />
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-2">
                  <button
                    onClick={() => editProduct(selectedProduct)}
                    className="flex-1 rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => deleteProduct(selectedProduct.id)}
                    className="rounded-lg border border-rose-200 dark:border-rose-800 px-4 py-2 text-sm font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-64 text-center">
                <div className="rounded-full bg-slate-100 dark:bg-slate-800 p-4 mb-4">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-8 h-8 text-slate-400">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.042 21.672L13.684 16.6m0 0l-2.51 2.225.569-9.47 5.227 7.917-3.286-.672zm-7.518-.267A8.25 8.25 0 1120.25 10.5M8.288 14.212A5.25 5.25 0 1117.25 10.5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-slate-900 dark:text-white">Select a product</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Click on a product to view details
                </p>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all ${
            toast.type === "success"
              ? "bg-slate-900 dark:bg-white text-white dark:text-slate-900"
              : "bg-rose-600 text-white"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
