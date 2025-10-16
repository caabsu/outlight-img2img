"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MODEL_LIST,
  getModelById,
  IMAGE_RESOLUTIONS,
  IMAGE_SIZES,
} from "@/lib/models";

type Product = { id: string; name: string; slug: string; image_url: string };
type GenImage = { id: string; prompt: string; imageDataUrl: string };
type LibraryItem = {
  id: string;
  product_id: string | null;
  product_name: string | null;
  model_name: string;
  prompt: string;
  created_at: string;
};

function safeName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9-_]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

function downloadDataUrl(dataUrl: string, filename: string) {
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export default function Home() {
  // Products / reference
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedId, setSelectedId] = useState<string>("custom");
  const [customUrl, setCustomUrl] = useState<string>("");

  // Model selection
  const [modelId, setModelId] = useState<string>("nanobanana-v1");
  const modelDef = useMemo(() => getModelById(modelId)!, [modelId]);
  const modelNameDisplay = `${modelDef.label}-${modelDef.version}`;

  // Seedream-only knobs
  const [sdSize, setSdSize] = useState<(typeof IMAGE_SIZES)[number]>("square");
  const [sdRes, setSdRes] = useState<(typeof IMAGE_RESOLUTIONS)[number]>("1K");
  const [sdMax, setSdMax] = useState<number>(1); // 1–6
  const [sdSeed, setSdSeed] = useState<number | "">("");

  // Prompts / generation
  const [promptsText, setPromptsText] = useState<string>("");
  const promptLines = useMemo(
    () => promptsText.split(/\r?\n/).map((s) => s.trim()).filter(Boolean),
    [promptsText]
  );

  const [images, setImages] = useState<GenImage[]>([]);
  const [activeIdx, setActiveIdx] = useState<number>(0);
  const [selectedIdx, setSelectedIdx] = useState<Set<number>>(new Set());

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [serverDebug, setServerDebug] = useState<any>(null); // show server-side debug details
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });

  // Prompt Library
  const [libOpen, setLibOpen] = useState(false);
  const [libSearch, setLibSearch] = useState("");
  const [libItems, setLibItems] = useState<LibraryItem[]>([]);
  const [libLoading, setLibLoading] = useState(false);

  const controllerRef = useRef<AbortController | null>(null);

  const selected = useMemo(() => products.find((p) => p.id === selectedId), [products, selectedId]);
  const productName = selected ? selected.name : "Custom";
  const referenceUrl = selectedId === "custom" ? customUrl : selected?.image_url;

  // Load products once
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/products");
        const json = await res.json();
        setProducts(json.products || []);
      } catch {
        // ignore for MVP
      }
    })();
  }, []);

  // Helpers
  function toggleSelect(i: number) {
    const copy = new Set(selectedIdx);
    if (copy.has(i)) copy.delete(i);
    else copy.add(i);
    setSelectedIdx(copy);
  }

  function downloadSelected() {
    if (selectedIdx.size === 0) return;
    const baseProduct = safeName(productName || "product");
    const baseModel = safeName(modelNameDisplay);
    Array.from(selectedIdx).forEach((i) => {
      const id = images[i]?.id || `${Date.now()}-${i + 1}`;
      const filename = `${baseProduct}_${baseModel}_${id}.png`;
      downloadDataUrl(images[i].imageDataUrl, filename);
    });
  }

  async function onGenerate() {
    if (!referenceUrl || promptLines.length === 0) return;

    setLoading(true);
    setError(null);
    setServerDebug(null);
    setImages([]);
    setActiveIdx(0);
    setSelectedIdx(new Set());
    setProgress({ done: 0, total: promptLines.length });

    const ac = new AbortController();
    controllerRef.current = ac;

    try {
      for (let lineIdx = 0; lineIdx < promptLines.length; lineIdx++) {
        const onePrompt = promptLines[lineIdx];

        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId,
            productId: selectedId !== "custom" ? selectedId : null,
            customUrl: selectedId === "custom" ? customUrl : null,
            prompt: onePrompt,
            options: modelDef.provider === "seedream"
              ? {
                  image_size: sdSize,
                  image_resolution: sdRes,
                  max_images: sdMax,
                  seed: sdSeed === "" ? null : sdSeed,
                }
              : undefined,
          }),
          signal: ac.signal,
        });

        const json = await res.json();
        if (!res.ok) {
          setServerDebug(json.debug ?? null);
          throw new Error(json.error || `Generation failed for line ${lineIdx + 1}`);
        } else {
          setServerDebug(null);
        }

        const newImg: GenImage = {
          id: crypto.randomUUID(),
          prompt: onePrompt,
          imageDataUrl: json.imageDataUrl, // URL or data URL
        };
        setImages((prev) => {
          const next = [...prev, newImg];
          if (next.length === 1) setActiveIdx(0);
          return next;
        });

        setProgress((p) => ({ done: p.done + 1, total: p.total }));
      }
    } catch (e: any) {
      if (e?.name === "AbortError") setError("Generation cancelled.");
      else setError(e?.message || "Something went wrong.");
    } finally {
      setLoading(false);
      controllerRef.current = null;
    }
  }

  function onCancel() {
    controllerRef.current?.abort();
  }

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
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  async function deletePrompt(id: string) {
    if (!id) return;
    const ok = confirm("Delete this prompt?");
    if (!ok) return;
    const res = await fetch(`/api/prompts/${id}`, { method: "DELETE" });
    const json = await res.json();
    if (!res.ok) {
      alert(json.error || "Failed to delete prompt.");
      return;
    }
    setLibItems((prev) => prev.filter((p) => p.id !== id));
  }

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <main className="min-h-screen p-6">
      <div className="mx-auto max-w-6xl space-y-6">
        {/* Header */}
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Outlight — Image Generator (MVP)</h1>
          <div className="text-xs text-neutral-400">
            {progress.total > 0 ? <span>{progress.done}/{progress.total} • {pct}%</span> : <span>Ready</span>}
          </div>
        </header>

        {/* Two columns: Left (controls + reference), Right (prompt + results) */}
        <section className="grid md:grid-cols-3 gap-6">
          {/* LEFT COLUMN */}
          <div className="space-y-3 md:col-span-1">
            {/* Model */}
            <div>
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
            <div>
              <label className="text-sm text-neutral-300">Product</label>
              <select
                className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                value={selectedId}
                onChange={(e) => setSelectedId(e.target.value)}
              >
                <option value="custom">Custom (use your own image)</option>
                {products.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Custom URL */}
            {selectedId === "custom" && (
              <div className="space-y-2">
                <label className="text-sm text-neutral-300">Custom image URL</label>
                <input
                  placeholder="https://..."
                  className="w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                  value={customUrl}
                  onChange={(e) => setCustomUrl(e.target.value)}
                />
              </div>
            )}

            {/* Seedream-only controls */}
            {modelDef.provider === "seedream" && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-neutral-400">Image size</label>
                  <select
                    className="mt-1 w-full rounded-md bg-neutral-900 border border-neutral-800 p-2"
                    value={sdSize}
                    onChange={(e) => setSdSize(e.target.value as any)}
                  >
                    {IMAGE_SIZES.map((s) => (
                      <option key={s} value={s}>{s}</option>
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
                      <option key={r} value={r}>{r}</option>
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
            )}

            {/* Reference preview */}
            <div>
              <label className="text-sm text-neutral-300">Reference preview</label>
              <div className="rounded-xl overflow-hidden border border-neutral-800 mt-1 max-w-sm">
                <div className="aspect-square bg-neutral-950">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  {referenceUrl ? (
                    <img src={referenceUrl} alt="Reference" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-neutral-600 text-sm">—</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT COLUMN — prompt + results (main image stays directly below prompt) */}
          <div className="md:col-span-2 space-y-6">
            {/* Prompt area */}
            <div className="space-y-3">
              <label className="text-sm text-neutral-300">Prompt (each line = one image)</label>
              <textarea
                className="w-full h-64 rounded-md bg-neutral-900 border border-neutral-800 p-3"
                placeholder={`place this floor lamp light on a modern house, living room. glass windows
place this floor lamp on a studio-like space, extremely zoomed in to show the texture of the lights.`}
                value={promptsText}
                onChange={(e) => setPromptsText(e.target.value)}
              />
              <div className="flex items-center gap-2">
                <button
                  className="rounded-md bg-white/10 hover:bg-white/15 border border-neutral-700 px-4 py-2 disabled:opacity-50"
                  onClick={onGenerate}
                  disabled={loading || !referenceUrl || promptLines.length === 0}
                >
                  {loading ? "Generating…" : `Generate ${promptLines.length || ""}`}
                </button>
                {loading && (
                  <button
                    className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2"
                    onClick={onCancel}
                  >
                    Cancel
                  </button>
                )}
                {images.length > 0 && (
                  <button
                    className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2 disabled:opacity-50"
                    onClick={downloadSelected}
                    disabled={selectedIdx.size === 0}
                    title="Download selected"
                  >
                    Download selected ({selectedIdx.size})
                  </button>
                )}
                <button
                  className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-2"
                  onClick={openLibrary}
                  title="Open Prompt Library"
                >
                  Prompt Library
                </button>

                {error && <span className="text-sm text-red-400">{error}</span>}
              </div>

              {serverDebug && (
                <details className="mt-2 rounded border border-red-900/40 bg-red-900/10 p-2 text-xs text-red-200">
                  <summary className="cursor-pointer">Show Gemini debug</summary>
                  <pre className="mt-2 whitespace-pre-wrap break-words">
                    {JSON.stringify(serverDebug, null, 2)}
                  </pre>
                </details>
              )}

              {progress.total > 0 && (
                <div className="h-1 w-full bg-neutral-800 rounded">
                  <div className="h-1 bg-white/70 rounded" style={{ width: `${pct}%`, transition: "width .2s ease" }} />
                </div>
              )}
            </div>

            {/* Results directly under prompt */}
            {images.length > 0 && (
              <div className="grid md:grid-cols-3 gap-4 items-start">
                {/* Thumbnails — tight squares */}
                <div className="md:col-span-1 self-start grid grid-cols-3 gap-[2px] place-content-start">
                  {images.map((img, i) => {
                    const isActive = i === activeIdx;
                    const isSelected = selectedIdx.has(i);
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
                          onClick={() => setActiveIdx(i)}
                        />
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(i)}
                          className="absolute top-1 left-1 w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent
                                     checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                          title={isSelected ? "Deselect" : "Select"}
                        />
                      </div>
                    );
                  })}
                </div>

                {/* Main viewer + per-image actions */}
                <div className="md:col-span-2">
                  <div className="relative rounded-xl overflow-hidden border border-neutral-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={images[activeIdx].imageDataUrl} alt={`Main ${activeIdx + 1}`} className="w-full h-auto" />
                    <div className="absolute top-2 right-2 flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={selectedIdx.has(activeIdx)}
                        onChange={() => toggleSelect(activeIdx)}
                        className="w-4 h-4 appearance-none border border-white/70 rounded-sm bg-transparent
                                   checked:bg-white checked:shadow-[inset_0_0_0_2px_rgba(0,0,0,1)]"
                        title={selectedIdx.has(activeIdx) ? "Deselect" : "Select"}
                      />
                      <button
                        onClick={() => {
                          const baseProduct = safeName(productName || "product");
                          const baseModel = safeName(modelNameDisplay);
                          const id = images[activeIdx]?.id || `${Date.now()}-${activeIdx + 1}`;
                          const filename = `${baseProduct}_${baseModel}_${id}.png`;
                          downloadDataUrl(images[activeIdx].imageDataUrl, filename);
                        }}
                        className="rounded-md bg-black/60 hover:bg-black/75 border border-white/30 text-white text-sm px-3 py-1"
                        title="Download image"
                      >
                        ⬇︎ Download
                      </button>
                    </div>
                  </div>

                  {/* Prompt card + per-image actions */}
                  <div className="mt-3 rounded-lg border border-neutral-800 bg-neutral-900/40 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="shrink-0 text-sm font-medium text-neutral-100">Prompt</div>
                      <div className="flex gap-2">
                        <button
                          className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                          onClick={() => copyPromptToClipboard(images[activeIdx].prompt)}
                          title="Copy prompt to clipboard"
                        >
                          Copy
                        </button>
                        <button
                          className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                          onClick={() => saveSinglePrompt(images[activeIdx].prompt)}
                          title="Save this prompt to library"
                        >
                          Save
                        </button>
                        <button
                          className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-xs"
                          onClick={() => downloadPromptTxt(images[activeIdx].prompt, images[activeIdx].id)}
                          title="Download prompt as .txt"
                        >
                          Download .txt
                        </button>
                      </div>
                    </div>

                    <p className="mt-2 text-[13px] leading-relaxed text-neutral-200 whitespace-pre-wrap break-words">
                      {images[activeIdx].prompt}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Prompt Library Panel */}
      {libOpen && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex">
          <div className="ml-auto h-full w-full max-w-xl bg-neutral-950 border-l border-neutral-800 p-4 flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold">Prompt Library</h2>
              <button
                className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3 py-1"
                onClick={() => setLibOpen(false)}
              >
                Close
              </button>
            </div>

            <div className="flex gap-2 mb-3">
              <input
                className="flex-1 rounded-md bg-neutral-900 border border-neutral-800 p-2"
                placeholder="Search prompts…"
                value={libSearch}
                onChange={(e) => setLibSearch(e.target.value)}
              />
              <button
                className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-3"
                onClick={openLibrary}
              >
                Search
              </button>
            </div>

            <div className="flex-1 overflow-auto space-y-2">
              {libLoading && <div className="text-sm text-neutral-400">Loading…</div>}
              {!libLoading && libItems.length === 0 && (
                <div className="text-sm text-neutral-500">No prompts yet.</div>
              )}
              {libItems.map((it) => (
                <div key={it.id} className="rounded-md border border-neutral-800 p-2 hover:bg-white/5">
                  <div className="text-xs text-neutral-500 mb-1">
                    {it.product_name || "Any"} • {it.model_name} • {new Date(it.created_at).toLocaleString()}
                  </div>
                  <div className="text-sm whitespace-pre-wrap">{it.prompt}</div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex gap-2">
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                        onClick={() => setPromptsText((prev) => (prev ? prev + "\n" + it.prompt : it.prompt))}
                      >
                        Insert
                      </button>
                      <button
                        className="rounded-md bg-white/5 hover:bg-white/10 border border-neutral-700 px-2 py-1 text-sm"
                        onClick={() => setPromptsText(it.prompt)}
                      >
                        Replace
                      </button>
                    </div>

                    <button
                      className="rounded-md bg-red-500/10 hover:bg-red-500/20 border border-red-500/40 text-red-300 px-2 py-1 text-sm"
                      onClick={() => deletePrompt(it.id)}
                      title="Delete this saved prompt"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
