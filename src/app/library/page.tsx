"use client";

import { useEffect, useState } from "react";
import { MODEL_LIST } from "@/lib/models";
import { pushStudioIntent } from "@/lib/studio-intent";

type Product = { id: string; name: string };
type LibraryItem = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  model_name: string;
  prompt: string;
};
type SavedImage = {
  id: string;
  image_data: string;
  prompt: string;
  model_name: string;
  product_id: string | null;
  product_name: string | null;
};

export default function LibraryPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [prompts, setPrompts] = useState<LibraryItem[]>([]);
  const [promptsLoading, setPromptsLoading] = useState(false);
  const [promptSearch, setPromptSearch] = useState("");
  const [promptProduct, setPromptProduct] = useState<string>("");
  const [images, setImages] = useState<SavedImage[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const [imageProduct, setImageProduct] = useState("");
  const [imageModel, setImageModel] = useState("");
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    loadProducts();
    loadPrompts();
    loadImages();
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  async function loadProducts() {
    const res = await fetch("/api/products");
    const json = await res.json();
    if (res.ok) setProducts(json.products || []);
  }

  async function loadPrompts() {
    try {
      setPromptsLoading(true);
      const params = new URLSearchParams();
      if (promptProduct) params.set("productId", promptProduct);
      const res = await fetch(`/api/prompts?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load prompts");
      let items: LibraryItem[] = json.prompts || [];
      if (promptSearch.trim()) {
        const q = promptSearch.toLowerCase();
        items = items.filter((item) => item.prompt.toLowerCase().includes(q));
      }
      setPrompts(items);
    } catch (err: any) {
      setToast({ message: err?.message || "Failed to load prompts", type: "error" });
    } finally {
      setPromptsLoading(false);
    }
  }

  async function deletePrompt(id: string) {
    if (!confirm("Remove this prompt?")) return;
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      setToast({ message: json.error || "Delete failed", type: "error" });
      return;
    }
    await loadPrompts();
  }

  async function loadImages() {
    try {
      setImagesLoading(true);
      const params = new URLSearchParams();
      if (imageProduct) params.set("productId", imageProduct);
      if (imageModel) params.set("modelName", imageModel);
      const res = await fetch(`/api/saved-images?${params.toString()}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load images");
      setImages(json.images || []);
    } catch (err: any) {
      setToast({ message: err?.message || "Failed to load images", type: "error" });
    } finally {
      setImagesLoading(false);
    }
  }

  async function deleteImage(id: string) {
    if (!confirm("Delete this image?")) return;
    const res = await fetch(`/api/saved-images/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      setToast({ message: json.error || "Delete failed", type: "error" });
      return;
    }
    await loadImages();
  }

  function sendPromptToStudio(text: string) {
    pushStudioIntent({ type: "prompts", prompts: [text] });
    setToast({ message: "Prompt sent to Image Studio", type: "success" });
  }

  function sendImageToStudio(id: string) {
    pushStudioIntent({ type: "reference", id });
    setToast({ message: "Reference queued for Image Studio", type: "success" });
  }

  return (
    <div className="px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-10">
        <section className="rounded-3xl border border-slate-200 dark:border-slate-800 bg-gradient-to-br from-slate-50 via-white to-sky-50 dark:from-slate-950 dark:via-slate-900 dark:to-sky-950/20 p-10 shadow-sm">
          <div className="grid gap-8 lg:grid-cols-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.4em] text-sky-500 dark:text-sky-400">Creative Library</p>
              <h1 className="mt-4 text-4xl font-semibold tracking-tight text-slate-900 dark:text-white">
                Central prompts and approved visuals.
              </h1>
              <p className="mt-4 text-base text-slate-600 dark:text-slate-300">
                Push prompts and references directly into Image Studio. Clear filters to see entire history or drill down per product.
              </p>
            </div>
            <div className="rounded-2xl border border-slate-100 dark:border-slate-800 bg-white/80 dark:bg-slate-900/50 p-5 text-sm text-slate-600 dark:text-slate-400 shadow-inner">
              <p className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Usage tips</p>
              <ul className="mt-2 list-disc space-y-1 pl-4">
                <li>Use "Send to Studio" to preload prompts or references.</li>
                <li>Filter by product to prep seasonal campaigns.</li>
                <li>Delete outdated items to keep the library lean.</li>
              </ul>
            </div>
          </div>
        </section>

        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr),minmax(0,1fr)]">
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Prompt Library</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Saved instructions with product context.</p>
              </div>
              <div className="flex gap-2">
                <select
                  className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1 text-sm text-slate-900 dark:text-slate-100"
                  value={promptProduct}
                  onChange={(e) => {
                    setPromptProduct(e.target.value);
                    loadPrompts();
                  }}
                >
                  <option value="">All products</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                <input
                  className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  placeholder="Search..."
                  value={promptSearch}
                  onChange={(e) => setPromptSearch(e.target.value)}
                  onBlur={loadPrompts}
                />
              </div>
            </div>
            {promptsLoading ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading prompts...</p>
            ) : prompts.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No prompts saved.</p>
            ) : (
              <div className="mt-6 space-y-3">
                {prompts.map((item) => (
                  <div key={item.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm text-slate-600 dark:text-slate-300 shadow-sm">
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span>{item.product_name || "Custom"}</span>
                      <span>{item.model_name}</span>
                    </div>
                    <p className="mt-2 text-slate-900 dark:text-slate-100">{item.prompt}</p>
                    <div className="mt-3 flex gap-2">
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => sendPromptToStudio(item.prompt)}
                      >
                        Send to Studio
                      </button>
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => navigator.clipboard.writeText(item.prompt)}
                      >
                        Copy
                      </button>
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => deletePrompt(item.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-slate-900 dark:text-white">Saved Images</h2>
                <p className="text-sm text-slate-500 dark:text-slate-400">Approved references and results.</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <select
                  className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1 text-sm text-slate-900 dark:text-slate-100"
                  value={imageProduct}
                  onChange={(e) => {
                    setImageProduct(e.target.value);
                    loadImages();
                  }}
                >
                  <option value="">All products</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.name}
                    </option>
                  ))}
                </select>
                <select
                  className="rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-1 text-sm text-slate-900 dark:text-slate-100"
                  value={imageModel}
                  onChange={(e) => {
                    setImageModel(e.target.value);
                    loadImages();
                  }}
                >
                  <option value="">All models</option>
                  {MODEL_LIST.map((model) => (
                    <option key={model.id} value={`${model.label}-${model.version}`}>
                      {model.label}-{model.version}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {imagesLoading ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">Loading images...</p>
            ) : images.length === 0 ? (
              <p className="mt-4 text-sm text-slate-500 dark:text-slate-400">No images saved yet.</p>
            ) : (
              <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {images.map((image) => (
                  <div key={image.id} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3 text-sm text-slate-600 dark:text-slate-300 shadow-sm">
                    <div className="overflow-hidden rounded-lg border border-slate-100 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={image.image_data} alt={image.prompt} className="h-40 w-full object-cover" />
                    </div>
                    <p className="mt-3 text-slate-900 dark:text-slate-100 line-clamp-2" title={image.prompt}>
                      {image.prompt}
                    </p>
                    <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      <span>{image.product_name || "Custom"}</span> - <span>{image.model_name}</span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => sendImageToStudio(image.id)}
                      >
                        Send to Studio
                      </button>
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => navigator.clipboard.writeText(image.prompt)}
                      >
                        Copy Prompt
                      </button>
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                        onClick={() => {
                          const a = document.createElement("a");
                          a.href = image.image_data;
                          a.download = `library_${image.id}.png`;
                          document.body.appendChild(a);
                          a.click();
                          a.remove();
                        }}
                      >
                        Download
                      </button>
                      <button
                        className="rounded-full border border-slate-200 dark:border-slate-700 px-3 py-1 text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30"
                        onClick={() => deleteImage(image.id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-4 py-3 text-sm text-slate-900 dark:text-slate-100 shadow-lg">
          {toast.message}
        </div>
      )}
    </div>
  );
}