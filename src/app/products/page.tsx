"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type Product = { id: string; name: string; slug: string; image_url: string };

function safeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState<{ id?: string; name: string; slug: string; image_url: string }>({
    name: "",
    slug: "",
    image_url: "",
  });
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedProduct = useMemo(() => products.find((p) => p.id === form.id), [products, form.id]);

  useEffect(() => {
    loadProducts();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadProducts() {
    try {
      setLoading(true);
      const res = await fetch("/api/products");
      const json = await res.json();
      if (res.ok) setProducts(json.products || []);
      else setToast({ message: json.error || "Failed to load products", type: "error" });
    } finally {
      setLoading(false);
    }
  }

  function startNew() {
    setForm({ name: "", slug: "", image_url: "" });
    setError(null);
  }

  function editProduct(product: Product) {
    setForm(product);
    setError(null);
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
      if (!form.id && json.product?.id) {
        setForm({ ...payload, id: json.product.id });
      }
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
      if (form.id === id) startNew();
      await loadProducts();
    } catch (err: any) {
      setToast({ message: err?.message || "Delete failed", type: "error" });
    }
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-10">
        <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-amber-50 via-white to-slate-50 p-10 shadow-sm">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-amber-500">Product Library</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900">
                Centralize hero references and metadata.
              </h1>
              <p className="mt-4 text-base text-slate-600">
                Products feed both Image and Video studios. Keep slugs clean and provide a consistent hero reference per SKU.
              </p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-600">
                <Link href="/image" className="underline">
                  Go to Image Studio
                </Link>
                <Link href="/video" className="underline">
                  Go to Video Studio
                </Link>
              </div>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-white/80 p-5 text-sm text-slate-600 shadow-inner">
              <p className="text-xs uppercase tracking-wide text-slate-400">Inventory</p>
              <p className="mt-2 text-3xl font-semibold text-slate-900">{products.length}</p>
              <p className="mt-1 text-xs text-slate-500">Products configured</p>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr),360px]">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-semibold text-slate-900">Catalog</h2>
              <button
                className="rounded-full border border-slate-200 px-4 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                onClick={startNew}
              >
                New Product
              </button>
            </div>
            {loading ? (
              <p className="mt-6 text-sm text-slate-500">Loading...</p>
            ) : products.length === 0 ? (
              <p className="mt-6 text-sm text-slate-500">No products yet.</p>
            ) : (
              <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {products.map((product) => (
                  <div
                    key={product.id}
                    className="rounded-xl border border-slate-200 p-4 text-sm text-slate-600 shadow-sm"
                  >
                    {product.image_url && (
                      <div className="aspect-square overflow-hidden rounded-lg border border-slate-100">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={product.image_url} alt={product.name} className="h-full w-full object-cover" />
                      </div>
                    )}
                    <p className="mt-3 text-base font-semibold text-slate-900">{product.name}</p>
                    <p className="text-xs uppercase tracking-wide text-slate-500">{product.slug}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:bg-slate-50"
                        onClick={() => editProduct(product)}
                      >
                        Edit
                      </button>
                      <button
                        className="rounded-full border border-slate-200 px-3 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        onClick={() => deleteProduct(product.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm space-y-4">
            <h2 className="text-xl font-semibold text-slate-900">
              {form.id ? "Edit Product" : "Create Product"}
            </h2>
            {error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
            <label className="text-xs font-semibold text-slate-500">
              Name
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              />
            </label>
            <label className="text-xs font-semibold text-slate-500">
              Slug
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={form.slug}
                onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
                placeholder={form.name ? safeName(form.name) : "floor-lamp-pro"}
              />
            </label>
            <label className="text-xs font-semibold text-slate-500">
              Image URL
              <input
                className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm"
                value={form.image_url}
                onChange={(e) => setForm((prev) => ({ ...prev, image_url: e.target.value }))}
                placeholder="https://..."
              />
            </label>
            {selectedProduct?.image_url && (
              <div className="aspect-square overflow-hidden rounded-xl border border-slate-200">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedProduct.image_url} alt={selectedProduct.name} className="h-full w-full object-cover" />
              </div>
            )}
            <button
              onClick={saveProduct}
              disabled={saving}
              className="w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              {saving ? "Saving..." : form.id ? "Update Product" : "Create Product"}
            </button>
          </div>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-lg">
          {toast.message}
        </div>
      )}
    </div>
  );
}
