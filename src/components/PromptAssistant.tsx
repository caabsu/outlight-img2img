"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type PromptAssistantProps = {
  onAccept: (prompts: string[], mode: "append" | "replace") => void;
  onStartRun?: (prompts: string[], references: string[]) => void;
  availableReferences?: string[];
  modelLabel?: string;
  productName?: string;
  requiresReference?: boolean;
  className?: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  content: string;
};

type ThreadMessage = {
  role: "user" | "assistant";
  content: string;
};

export function PromptAssistant({
  onAccept,
  onStartRun,
  availableReferences = [],
  modelLabel = "",
  productName = "Custom",
  requiresReference = false,
  className = "",
}: PromptAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showKnowledge, setShowKnowledge] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) {
      fetchKnowledgeBases();
    }
  }, [isOpen]);

  async function fetchKnowledgeBases() {
    try {
      const res = await fetch("/api/knowledge");
      const json = await res.json();
      if (res.ok) {
        setKnowledgeBases(json.items || []);
      }
    } catch (e) {
      console.error("Failed to load knowledge bases", e);
    }
  }

  const [instructions, setInstructions] = useState("");
  const [count, setCount] = useState(3);
  const [generated, setGenerated] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [source, setSource] = useState<string | null>(null);
  const [selectedRefs, setSelectedRefs] = useState<string[]>([]);
  const [followUp, setFollowUp] = useState("");
  const [sessionInstructions, setSessionInstructions] = useState("");
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);

  const hasBaseInstructions = instructions.trim().length > 0 || sessionInstructions.trim().length > 0;

  async function handleGenerate(opts?: { mode?: "fresh" | "refine" }) {
    const base = instructions.trim() || sessionInstructions.trim();
    if (!base && !followUp.trim()) return;
    const effectiveInstructions =
      opts?.mode === "refine" && followUp.trim()
        ? `${base || ""}\nFollow-up: ${followUp.trim()}`
        : base || followUp.trim();

    setLoading(true);
    setGenerated([]);
    setSource(null);
    const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);
    const knowledgeContent = selectedKb ? selectedKb.content : "";
    if (instructions.trim()) setSessionInstructions(instructions.trim());

    const payload = {
      knowledge: knowledgeContent,
      instructions: effectiveInstructions,
      count,
      references: selectedRefs,
      context: {
        model: modelLabel,
        product: productName,
        requiresReference,
      },
      thread: [...threadMessages, { role: "user", content: effectiveInstructions }],
    };

    try {
      const res = await fetch("/api/prompt-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        setGenerated(json.prompts || []);
        setSource(json.source || null);
        setThreadMessages((prev) => [
          ...prev,
          { role: "user", content: effectiveInstructions },
          { role: "assistant", content: (json.prompts || []).join("\n") || "No prompts returned." },
        ]);
      }
    } catch (error) {
      console.error("Failed to generate prompts", error);
    } finally {
      setLoading(false);
    }
  }

  function handleCopy() {
    const text = generated.join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => {
    setSelectedRefs((prev) => {
      if (availableReferences.length === 0) return [];
      const next = prev.filter((p) => availableReferences.includes(p));
      return next.length ? next : availableReferences.slice(0, 6);
    });
  }, [availableReferences]);

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 transition hover:bg-indigo-100 dark:hover:bg-indigo-900/50 ${className}`}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 011.32 1.32l-.8 1.599 1.582 3.954a1 1 0 01-1.322 1.322l-3.954-1.582-1.599.8a1 1 0 01-1.32-1.32l.8-1.599L10 4.323V3a1 1 0 011-1zm-5 8.274l-.818 2.552c-.25.781.707 1.446 1.42 1.048l2.325-1.297 1.297 2.325c.398.713 1.39.57 1.64-.22l.818-2.552 2.552-.818c.781-.25.64-1.242-.22-1.64l-2.325-1.297-1.297-2.325c-.398-.713-1.048-.713-1.446 0l-1.297 2.325-2.325 1.297c-.713.398-.57 1.048.22 1.64l2.552.818z"
            clipRule="evenodd"
          />
        </svg>
        AI Assistant
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm transition-all">
          <div
            className="w-full max-w-2xl rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/5 dark:ring-slate-50/10"
            onClick={(e) => e.stopPropagation()}
          >
           <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-6 py-4">
             <div className="flex items-center gap-3">
               <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                 <svg
                   xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className="h-5 w-5"
                  >
                    <path d="M15.98 1.804a1 1 0 00-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 000 1.96l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.96 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.96l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 00-1.898 0l-.683 2.051a1 1 0 01-.918.918l-2.051.683a1 1 0 000 1.898l2.051.683a1 1 0 01.918.918l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.918-.918l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.918-.918l-.683-2.051z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-base font-semibold text-slate-900 dark:text-slate-50">AI Prompt Engineer</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">Generate creative variations from your instructions.</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  strokeWidth={2}
                  stroke="currentColor"
                  className="h-5 w-5"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-6 space-y-6">
              <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
                <div className="space-y-4">
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-slate-700 dark:text-slate-300">
                      Base Objective
                    </label>
                    <textarea
                      className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 p-3 text-sm text-slate-900 dark:text-slate-100 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 placeholder:text-slate-400"
                      rows={4}
                      placeholder="Describe the product, environment, lighting, and mood..."
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      autoFocus
                    />
                  </div>

                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">Chat-style follow-up</p>
                      <button
                        onClick={() => {
                          setFollowUp("");
                          setGenerated([]);
                          setSessionInstructions("");
                          setThreadMessages([]);
                          setInstructions("");
                        }}
                        className="text-[11px] font-semibold text-rose-500 hover:underline"
                      >
                        Reset session
                      </button>
                    </div>
                    <div className="max-h-44 overflow-y-auto space-y-2 pr-1">
                      {threadMessages.length === 0 && (
                        <p className="text-[12px] text-slate-500 dark:text-slate-400">No conversation yet. Generate once, then refine here.</p>
                      )}
                      {threadMessages.map((msg, idx) => (
                        <div
                          key={idx}
                          className={`rounded-lg px-3 py-2 text-sm leading-relaxed ${
                            msg.role === "user"
                              ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900/50"
                              : "bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
                          }`}
                        >
                          <span className="block text-[11px] font-semibold uppercase tracking-wide mb-1 text-slate-500 dark:text-slate-400">
                            {msg.role === "user" ? "You" : "Assistant"}
                          </span>
                          <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        className="flex-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-indigo-500"
                        placeholder="e.g., Switch to daytime, keep camera angle, add soft skylight."
                        value={followUp}
                        onChange={(e) => setFollowUp(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !loading) handleGenerate({ mode: "refine" });
                        }}
                      />
                      <button
                        onClick={() => handleGenerate({ mode: "refine" })}
                        disabled={loading || (!hasBaseInstructions && !followUp.trim())}
                        className="rounded-lg bg-indigo-600 text-white px-3 py-2 text-xs font-semibold shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                      >
                        Send
                      </button>
                    </div>
                  </div>

                  <div>
                    <button
                      onClick={() => setShowKnowledge(!showKnowledge)}
                      className="flex items-center gap-2 text-xs font-medium text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition"
                    >
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 transition-transform ${showKnowledge ? "rotate-90" : ""}`}
                      >
                        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
                      </svg>
                      {showKnowledge ? "Hide Knowledge Settings" : "Show Knowledge Settings"}
                    </button>
                    
                    {showKnowledge && (
                      <div className="mt-3 space-y-2 animate-in slide-in-from-top-2 fade-in duration-200 rounded-xl bg-slate-50 dark:bg-slate-950/50 p-3 border border-slate-100 dark:border-slate-800">
                          <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">Active Knowledge Base</label>
                              <Link href="/knowledge" className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400 hover:underline">
                                  Manage &rarr;
                              </Link>
                          </div>
                          <select 
                            className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-2 text-xs text-slate-900 dark:text-slate-100"
                            value={selectedKbId}
                            onChange={(e) => setSelectedKbId(e.target.value)}
                          >
                              <option value="">(None)</option>
                              {knowledgeBases.map(kb => (
                                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                              ))}
                          </select>
                          {selectedKbId && (
                              <div className="max-h-[60px] overflow-y-auto rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-2">
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400">
                                      {knowledgeBases.find(k => k.id === selectedKbId)?.content.slice(0, 150)}...
                                  </p>
                              </div>
                          )}
                      </div>
                    )}
                  </div>

                  <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Reference context</p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">Feed the assistant the same images used for generation.</p>
                      </div>
                      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        <button
                          className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[10px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                          onClick={() => setSelectedRefs(availableReferences.slice(0, 8))}
                          disabled={availableReferences.length === 0}
                        >
                          Use all
                        </button>
                        <button
                          className="rounded border border-slate-200 dark:border-slate-700 px-2 py-1 text-[10px] font-semibold hover:bg-slate-50 dark:hover:bg-slate-800"
                          onClick={() => setSelectedRefs([])}
                          disabled={availableReferences.length === 0}
                        >
                          Clear
                        </button>
                        <span>{selectedRefs.length} selected</span>
                      </div>
                    </div>
                    {availableReferences.length === 0 ? (
                      <p className="text-xs text-slate-500 dark:text-slate-400">No reference images available yet.</p>
                    ) : (
                      <div className="flex gap-2 overflow-x-auto pb-1">
                        {availableReferences.map((src) => {
                          const selected = selectedRefs.includes(src);
                          return (
                            <button
                              key={src}
                              onClick={() => {
                                setSelectedRefs((prev) =>
                                  prev.includes(src) ? prev.filter((s) => s !== src) : [...prev, src].slice(0, 8)
                                );
                              }}
                              className={`relative h-16 w-16 flex-none rounded-lg overflow-hidden border transition ${
                                selected
                                  ? "border-indigo-500 ring-1 ring-indigo-500"
                                  : "border-slate-200 dark:border-slate-700 hover:border-indigo-200"
                              }`}
                              title={selected ? "Remove from context" : "Include as context"}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={src} alt="" className="h-full w-full object-cover" />
                              {selected && (
                                <span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white text-xs font-semibold">
                                  Use
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                    <div className="rounded-lg bg-slate-50 dark:bg-slate-900 p-2 text-[11px] text-slate-500 dark:text-slate-400 border border-slate-100 dark:border-slate-800">
                      <p className="font-semibold text-slate-600 dark:text-slate-300">AI instructions</p>
                      <p>
                        {`Model: ${modelLabel || "Current selection"}. Product: ${productName}. ${
                          requiresReference ? "References required for best results." : "References optional but recommended."
                        }`}
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-6 rounded-xl bg-slate-50 dark:bg-slate-950/50 p-4 border border-slate-100 dark:border-slate-800">
                   <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                        Variations
                      </label>
                      <div className="flex items-center justify-between gap-4">
                          <span className="text-sm font-medium text-slate-900 dark:text-slate-100">{count}</span>
                          <input
                            type="range"
                            min="1"
                            max="20"
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                            className="h-2 flex-1 cursor-pointer rounded-lg appearance-none bg-slate-200 dark:bg-slate-700 accent-indigo-600"
                          />
                      </div>
                   </div>
                   
                   <div className="pt-4 border-t border-slate-200 dark:border-slate-800 space-y-2">
                     <button
                        onClick={() => handleGenerate({ mode: "fresh" })}
                        disabled={loading || !hasBaseInstructions}
                        className="w-full rounded-xl bg-slate-900 dark:bg-indigo-600 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-slate-800 dark:hover:bg-indigo-500 disabled:opacity-50 transition-all"
                      >
                        {loading ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Working...
                          </div>
                        ) : (
                          "Generate Fresh Set"
                        )}
                      </button>
                      <button
                        onClick={() => handleGenerate({ mode: "refine" })}
                        disabled={loading || (!hasBaseInstructions && !followUp.trim())}
                        className="w-full rounded-xl bg-indigo-50 dark:bg-indigo-950/30 py-2.5 text-sm font-semibold text-indigo-700 dark:text-indigo-200 shadow-sm hover:bg-indigo-100 dark:hover:bg-indigo-900/50 disabled:opacity-50 transition-all border border-indigo-100 dark:border-indigo-900/50"
                      >
                        Refine with Follow-up
                      </button>
                   </div>
                </div>
              </div>

              {generated.length > 0 && (
                <div className="mt-6 space-y-3 border-t border-slate-100 dark:border-slate-800 pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900 dark:text-slate-50">Generated Results</h4>
                        {source && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${source.includes("Fallback") 
                              ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400" 
                              : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                            }`}>
                                via {source}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition"
                      >
                        {copied ? (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3 w-3">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                            Copied
                          </>
                        ) : (
                          "Copy All"
                        )}
                      </button>
                      <div className="h-4 w-px bg-slate-200 dark:bg-slate-700" />
                      <button
                        onClick={() => {
                          onAccept(generated, "append");
                          setIsOpen(false);
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition"
                      >
                        Append All
                      </button>
                      <button
                        onClick={() => {
                          onAccept(generated, "replace");
                          setIsOpen(false);
                        }}
                        className="rounded-lg bg-indigo-50 dark:bg-indigo-950/30 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
                      >
                        Replace All
                      </button>
                      {onStartRun && (
                        <button
                          onClick={() => {
                            onAccept(generated, "replace");
                            onStartRun(generated, selectedRefs);
                            setIsOpen(false);
                          }}
                          disabled={generated.length === 0 || (requiresReference && selectedRefs.length === 0)}
                          className="rounded-lg bg-slate-900 dark:bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-slate-800 dark:hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition"
                        >
                          Apply & Start Generation
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="grid max-h-[300px] gap-3 overflow-y-auto pr-1">
                    {generated.map((prompt, idx) => (
                      <div
                        key={idx}
                        className="group relative rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/50 p-3 text-sm text-slate-600 dark:text-slate-300 shadow-sm hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-md transition-all"
                      >
                        <p className="pr-16">{prompt}</p>
                        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => {
                                onAccept([prompt], "append");
                                // Don't close, allow picking more
                              }}
                              className="rounded-lg bg-indigo-50 dark:bg-indigo-900 px-3 py-1.5 text-xs font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-800 transition"
                            >
                              Add
                            </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
