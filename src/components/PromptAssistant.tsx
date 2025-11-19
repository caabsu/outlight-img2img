"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

type PromptAssistantProps = {
  onAccept: (prompts: string[], mode: "append" | "replace") => void;
  className?: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  content: string;
};

export function PromptAssistant({ onAccept, className = "" }: PromptAssistantProps) {
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

  async function handleGenerate() {
    if (!instructions.trim()) return;
    setLoading(true);
    setGenerated([]);
    setSource(null);
    
    // Get content from selected KB
    const selectedKb = knowledgeBases.find(kb => kb.id === selectedKbId);
    const knowledgeContent = selectedKb ? selectedKb.content : "";

    try {
      const res = await fetch("/api/prompt-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledge: knowledgeContent, instructions, count }),
      });
      const json = await res.json();
      if (res.ok) {
        setGenerated(json.prompts || []);
        setSource(json.source || null);
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

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 px-4 py-2 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100 ${className}`}
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm transition-all">
          <div
            className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl ring-1 ring-slate-900/5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
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
                  <h3 className="text-base font-semibold text-slate-900">AI Prompt Engineer</h3>
                  <p className="text-xs text-slate-500">Generate creative variations from your instructions.</p>
                </div>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
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
                    <label className="mb-1.5 block text-sm font-medium text-slate-700">
                      Scene Description
                    </label>
                    <textarea
                      className="w-full rounded-xl border border-slate-200 p-3 text-sm shadow-sm focus:border-indigo-500 focus:ring-indigo-500"
                      rows={4}
                      placeholder="Describe the product, environment, lighting, and mood..."
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      autoFocus
                    />
                  </div>
                  
                  <div>
                    <button
                      onClick={() => setShowKnowledge(!showKnowledge)}
                      className="flex items-center gap-2 text-xs font-medium text-slate-500 hover:text-slate-800"
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
                      <div className="mt-3 space-y-2 animate-in slide-in-from-top-2 fade-in duration-200 rounded-xl bg-slate-50 p-3 border border-slate-100">
                          <div className="flex items-center justify-between">
                              <label className="text-xs font-semibold text-slate-600">Active Knowledge Base</label>
                              <Link href="/knowledge" className="text-[10px] font-medium text-indigo-600 hover:underline">
                                  Manage &rarr;
                              </Link>
                          </div>
                          <select 
                            className="w-full rounded-lg border border-slate-200 px-2 py-2 text-xs"
                            value={selectedKbId}
                            onChange={(e) => setSelectedKbId(e.target.value)}
                          >
                              <option value="">(None)</option>
                              {knowledgeBases.map(kb => (
                                  <option key={kb.id} value={kb.id}>{kb.name}</option>
                              ))}
                          </select>
                          {selectedKbId && (
                              <div className="max-h-[60px] overflow-y-auto rounded border border-slate-200 bg-white p-2">
                                  <p className="text-[10px] text-slate-500">
                                      {knowledgeBases.find(k => k.id === selectedKbId)?.content.slice(0, 150)}...
                                  </p>
                              </div>
                          )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-6 rounded-xl bg-slate-50 p-4 border border-slate-100">
                   <div>
                      <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Variations
                      </label>
                      <div className="flex items-center justify-between gap-4">
                          <span className="text-sm font-medium text-slate-900">{count}</span>
                          <input
                            type="range"
                            min="1"
                            max="20"
                            value={count}
                            onChange={(e) => setCount(Number(e.target.value))}
                            className="h-2 flex-1 cursor-pointer rounded-lg appearance-none bg-slate-200 accent-indigo-600"
                          />
                      </div>
                   </div>
                   
                   <div className="pt-4 border-t border-slate-200">
                       <button
                        onClick={handleGenerate}
                        disabled={loading || !instructions.trim()}
                        className="w-full rounded-xl bg-slate-900 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-slate-800 disabled:opacity-50 transition-all"
                      >
                        {loading ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                            Generating...
                          </div>
                        ) : (
                          "Generate Prompts"
                        )}
                      </button>
                   </div>
                </div>
              </div>

              {generated.length > 0 && (
                <div className="mt-6 space-y-3 border-t border-slate-100 pt-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <h4 className="text-sm font-semibold text-slate-900">Generated Results</h4>
                        {source && (
                            <span className={`text-[10px] px-2 py-0.5 rounded-full border ${source.includes("Fallback") ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"}`}>
                                via {source}
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={handleCopy}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900"
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
                      <div className="h-4 w-px bg-slate-200" />
                      <button
                        onClick={() => {
                          onAccept(generated, "append");
                          setIsOpen(false);
                        }}
                        className="rounded-lg px-3 py-1.5 text-xs font-medium text-indigo-600 hover:bg-indigo-50"
                      >
                        Append All
                      </button>
                      <button
                        onClick={() => {
                          onAccept(generated, "replace");
                          setIsOpen(false);
                        }}
                        className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
                      >
                        Replace All
                      </button>
                    </div>
                  </div>
                  <div className="grid max-h-[300px] gap-3 overflow-y-auto pr-1">
                    {generated.map((prompt, idx) => (
                      <div
                        key={idx}
                        className="group relative rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-600 shadow-sm hover:border-indigo-200 hover:shadow-md transition-all"
                      >
                        <p className="pr-16">{prompt}</p>
                        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => {
                                onAccept([prompt], "append");
                                // Don't close, allow picking more
                              }}
                              className="rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100"
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
