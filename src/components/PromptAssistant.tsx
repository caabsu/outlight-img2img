"use client";

import { useState, useEffect } from "react";

type PromptAssistantProps = {
  onAccept: (prompts: string[]) => void;
  className?: string;
};

export function PromptAssistant({ onAccept, className = "" }: PromptAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [knowledge, setKnowledge] = useState(
    "Our brand style emphasizes clean lines, natural lighting, and authentic textures. Avoid oversaturated colors. Products should be the focal point."
  );

  useEffect(() => {
    const saved = localStorage.getItem("outlight_knowledge");
    if (saved) setKnowledge(saved);
  }, []);

  useEffect(() => {
    localStorage.setItem("outlight_knowledge", knowledge);
  }, [knowledge]);

  const [instructions, setInstructions] = useState("");
  const [count, setCount] = useState(3);
  const [generated, setGenerated] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function handleGenerate() {
    if (!instructions.trim()) return;
    setLoading(true);
    setGenerated([]);
    try {
      const res = await fetch("/api/prompt-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ knowledge, instructions, count }),
      });
      const json = await res.json();
      if (res.ok) {
        setGenerated(json.prompts || []);
      }
    } catch (error) {
      console.error("Failed to generate prompts", error);
    } finally {
      setLoading(false);
    }
  }

  if (!isOpen) {
    return (
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
    );
  }

  return (
    <div className={`rounded-xl border border-indigo-100 bg-white shadow-lg ${className}`}>
      <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
        <h3 className="text-sm font-semibold text-slate-900">Prompt Assistant</h3>
        <button
          onClick={() => setIsOpen(false)}
          className="text-xs text-slate-400 hover:text-slate-600"
        >
          Close
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">
            Scene Instructions (High Priority)
          </label>
          <textarea
            className="w-full rounded-lg border border-slate-200 p-2 text-sm focus:border-indigo-500 focus:ring-indigo-500"
            rows={3}
            placeholder="Describe the scene, mood, and subjects..."
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>

        <div>
          <div className="flex items-center justify-between">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Knowledge Document
            </label>
            <span className="text-[10px] text-slate-400">Editable</span>
          </div>
          <textarea
            className="w-full rounded-lg border border-slate-200 bg-slate-50 p-2 text-xs text-slate-600 focus:bg-white focus:border-indigo-500"
            rows={3}
            value={knowledge}
            onChange={(e) => setKnowledge(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-4">
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-slate-500">
              Count: {count}
            </label>
            <input
              type="range"
              min="1"
              max="10"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
              className="h-2 w-full cursor-pointer rounded-lg appearance-none bg-slate-200 accent-indigo-600"
            />
          </div>
          <button
            onClick={handleGenerate}
            disabled={loading || !instructions.trim()}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            {loading ? "Thinking..." : "Generate"}
          </button>
        </div>

        {generated.length > 0 && (
          <div className="space-y-2 border-t border-slate-100 pt-4">
             <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-900">Results</span>
                <button 
                    onClick={() => onAccept(generated)}
                    className="text-xs text-indigo-600 hover:underline"
                >
                    Use All
                </button>
             </div>
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {generated.map((prompt, idx) => (
                <div
                  key={idx}
                  className="group relative rounded-lg border border-slate-100 bg-slate-50 p-2 text-xs text-slate-700 hover:border-indigo-200 hover:bg-indigo-50"
                >
                  <p>{prompt}</p>
                  <button
                    onClick={() => onAccept([prompt])}
                    className="absolute right-2 top-2 opacity-0 transition group-hover:opacity-100 rounded bg-white px-2 py-1 text-[10px] font-medium text-indigo-600 shadow-sm border border-slate-100 hover:border-indigo-300"
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
