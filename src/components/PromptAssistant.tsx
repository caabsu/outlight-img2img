"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type PromptAssistantProps = {
  onAccept: (prompts: string[], mode: "append" | "replace") => void;
  availableReferences?: string[];
  selectedReferences?: string[];
  onUpdateReferences?: (next: string[]) => void;
  modelLabel?: string;
  productName?: string;
  requiresReference?: boolean;
  className?: string;
  profileId?: string;
};

type KnowledgeBase = {
  id: string;
  name: string;
  content: string;
};

type Attachment = {
  type: "image" | "video";
  url: string; // data URL or regular URL
  mimeType: string;
  name?: string;
};

type ThreadMessage = {
  role: "user" | "assistant";
  content: string;
  attachments?: Attachment[];
};

export function PromptAssistant({
  onAccept,
  availableReferences = [],
  selectedReferences = [],
  onUpdateReferences,
  modelLabel = "",
  productName = "Custom",
  requiresReference = false,
  className = "",
  profileId,
}: PromptAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [knowledgeBases, setKnowledgeBases] = useState<KnowledgeBase[]>([]);
  const [selectedKbId, setSelectedKbId] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const [message, setMessage] = useState("");
  const [count, setCount] = useState(3);
  const [threadMessages, setThreadMessages] = useState<ThreadMessage[]>([]);
  const [generated, setGenerated] = useState<string[]>([]);
  const [source, setSource] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [resultsHeight, setResultsHeight] = useState(280);
  const storageKey = `ol_pa_${profileId || "anon"}`;

  // Convert files to data URLs and create attachment objects
  async function filesToAttachments(files: FileList | null): Promise<Attachment[]> {
    if (!files || files.length === 0) return [];
    const results: Attachment[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isImage = file.type.startsWith("image/");
      const isVideo = file.type.startsWith("video/");
      if (!isImage && !isVideo) continue;
      const url = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      results.push({
        type: isImage ? "image" : "video",
        url,
        mimeType: file.type,
        name: file.name,
      });
    }
    return results;
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  useEffect(() => {
    if (isOpen) {
      void fetchKnowledgeBases();
    }
  }, [isOpen]);

  // hydrate from local storage on profile change
  useEffect(() => {
    try {
      const raw = typeof window !== "undefined" ? localStorage.getItem(storageKey) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed.selectedKbId) setSelectedKbId(parsed.selectedKbId);
        if (typeof parsed.variationCount === "number") setCount(parsed.variationCount);
        if (Array.isArray(parsed.threadMessages)) setThreadMessages(parsed.threadMessages);
      } else {
        setSelectedKbId("");
        setCount(3);
        setThreadMessages([]);
      }
    } catch {
      setSelectedKbId("");
      setCount(3);
      setThreadMessages([]);
    }
  }, [storageKey]);

  // hydrate from server preferences
  useEffect(() => {
    if (!profileId) return;
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(`/api/preferences?profileId=${encodeURIComponent(profileId)}`);
        const json = await res.json();
        if (!res.ok) return;
        if (cancelled) return;
        const prefs = json.preferences || {};
        if (prefs.selected_kb_id !== undefined) setSelectedKbId(prefs.selected_kb_id || "");
        if (typeof prefs.variation_count === "number") setCount(prefs.variation_count);
        if (Array.isArray(prefs.assistant_thread)) setThreadMessages(prefs.assistant_thread);
      } catch {
        // ignore
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  // persist preferences
  useEffect(() => {
    const snapshot = {
      selectedKbId,
      variationCount: count,
      threadMessages,
    };
    try {
      if (typeof window !== "undefined") localStorage.setItem(storageKey, JSON.stringify(snapshot));
    } catch {
      // ignore
    }

    if (!profileId) return;
    const timer = setTimeout(() => {
      void fetch("/api/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          profileId,
          selectedKbId,
          variationCount: count,
          assistantThread: threadMessages,
        }),
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [profileId, selectedKbId, count, threadMessages, storageKey]);

  async function fetchKnowledgeBases() {
    try {
      const res = await fetch("/api/knowledge");
      const json = await res.json();
      if (res.ok) setKnowledgeBases(json.items || []);
    } catch (e) {
      console.error("Failed to load knowledge bases", e);
    }
  }

  function handleCopy() {
    const text = generated.join("\n");
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function resetChat() {
    setMessage("");
    setGenerated([]);
    setSource(null);
    setThreadMessages([]);
  }

  async function sendMessage() {
    const text = message.trim();
    if (!text && attachments.length === 0) return;
    setLoading(true);
    const kb = knowledgeBases.find((k) => k.id === selectedKbId);
    const knowledgeContent = kb ? kb.content : "";

    const currentAttachments = [...attachments];
    const userMessage: ThreadMessage = {
      role: "user",
      content: text,
      attachments: currentAttachments.length > 0 ? currentAttachments : undefined,
    };

    const payload = {
      knowledge: knowledgeContent,
      instructions: text,
      count,
      references: selectedReferences,
      attachments: currentAttachments,
      context: {
        model: modelLabel,
        product: productName,
        requiresReference,
      },
      thread: [...threadMessages, userMessage],
    };

    try {
      const res = await fetch("/api/prompt-assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok) {
        const prompts = json.prompts || [];
        setGenerated(prompts);
        setSource(json.source || null);
        const responseCopy = json.assistantReply
          || (prompts.length === 0
            ? "I couldn't produce prompts this round—want to try a different request or add a reference?"
            : prompts.length < 3
            ? `Got it. I've drafted ${prompts.length} focused prompts. Want me to push toward a new angle or adjust lighting?`
            : `All set. I've generated a small batch of prompts covering varied scenes. Need me to tighten style, lighting, or camera notes?`);
        setThreadMessages((prev) => [
          ...prev,
          userMessage,
          { role: "assistant", content: responseCopy },
        ]);
        setMessage("");
        setAttachments([]);
      }
    } catch (e) {
      console.error("Failed to generate prompts", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button
        onClick={() => setIsOpen(true)}
        className={`flex items-center gap-2 rounded-full border border-indigo-200 dark:border-indigo-800 bg-indigo-50 dark:bg-indigo-950/30 px-4 py-2 text-xs font-semibold text-indigo-700 dark:text-indigo-300 transition hover:bg-indigo-100 dark:hover:bg-indigo-900/50 ${className}`}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 011.32 1.32l-.8 1.599 1.582 3.954a1 1 0 01-1.322 1.322l-3.954-1.582-1.599.8a1 1 0 01-1.32-1.32l.8-1.599L10 4.323V3a1 1 0 011-1zm-5 8.274l-.818 2.552c-.25.781.707 1.446 1.42 1.048l2.325-1.297 1.297 2.325c.398.713 1.39.57 1.64-.22l.818-2.552 2.552-.818c.781-.25.64-1.242-.22-1.64l-2.325-1.297-1.297-2.325c-.398-.713-1.048-.713-1.446 0l-1.297 2.325-2.325 1.297c-.713.398-.57 1.048.22 1.64l2.552.818z"
            clipRule="evenodd"
          />
        </svg>
        AI Assistant
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm transition-all overflow-y-auto">
          <div
            className="w-full max-w-6xl my-4 rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/5 dark:ring-slate-50/10 max-h-[calc(100vh-2rem)] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 px-4 py-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400">
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M15.98 1.804a1 1 0 10-1.96 0l-.24 1.192a1 1 0 01-.784.785l-1.192.238a1 1 0 100 1.96l1.192.238a1 1 0 01.785.785l.238 1.192a1 1 0 001.96 0l.238-1.192a1 1 0 01.785-.785l1.192-.238a1 1 0 000-1.96l-1.192-.238a1 1 0 01-.785-.785l-.238-1.192zM6.949 5.684a1 1 0 10-1.898 0l-.683 2.051a1 1 0 01-.918.918l-2.051.683a1 1 0 000 1.898l2.051.683a1 1 0 01.918.918l.683 2.051a1 1 0 001.898 0l.683-2.051a1 1 0 01.918-.918l2.051-.683a1 1 0 000-1.898l-2.051-.683a1 1 0 01-.918-.918l-.683-2.051z" />
                  </svg>
                </div>
                <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">AI Prompt Engineer</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="rounded-full p-1.5 text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition"
              >
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="h-4 w-4">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="grid gap-4 p-4 lg:grid-cols-[240px_1fr] flex-1 overflow-y-auto min-h-0">
              <div className="space-y-2 lg:overflow-y-auto lg:max-h-full">
                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-2 space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Knowledge base</p>
                    <Link href="/knowledge" className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 hover:underline">
                      Manage
                    </Link>
                  </div>
                  <select
                    className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100"
                    value={selectedKbId}
                    onChange={(e) => setSelectedKbId(e.target.value)}
                  >
                    <option value="">(None)</option>
                    {knowledgeBases.map((kb) => (
                      <option key={kb.id} value={kb.id}>
                        {kb.name}
                      </option>
                    ))}
                  </select>
                  {selectedKbId && (
                    <div className="rounded-md border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 p-1.5 text-[11px] text-slate-600 dark:text-slate-300 max-h-20 overflow-y-auto">
                      {knowledgeBases.find((kb) => kb.id === selectedKbId)?.content}
                    </div>
                  )}
                </div>

                <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-medium text-slate-800 dark:text-slate-200">Variations</p>
                    <span className="text-[11px] text-slate-600 dark:text-slate-300">{count}</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                    className="h-1.5 w-full cursor-pointer rounded-lg appearance-none bg-slate-200 dark:bg-slate-700 accent-indigo-600"
                  />
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">
                    {modelLabel || "Current model"} · {productName} · {requiresReference ? "Ref required" : "Ref optional"}
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-3 min-h-0 flex-1">
                <div className="rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950/60 p-3 flex flex-col gap-2 flex-1 min-h-[200px]">
                  <div className="flex-1 overflow-y-auto space-y-1.5 pr-1">
                    {threadMessages.length === 0 && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">No conversation yet. Send a message to get started.</p>
                    )}
                    {threadMessages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`rounded-lg px-2 py-1.5 text-xs leading-relaxed ${
                          msg.role === "user"
                            ? "bg-indigo-50 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 border border-indigo-100 dark:border-indigo-900/50"
                            : "bg-slate-100 dark:bg-slate-900 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-800"
                        }`}
                      >
                        <span className="block text-[10px] font-semibold uppercase tracking-wide mb-0.5 text-slate-500 dark:text-slate-400">
                          {msg.role === "user" ? "You" : "Assistant"}
                        </span>
                        {msg.attachments && msg.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-1 mb-1">
                            {msg.attachments.map((att, attIdx) => (
                              <div key={attIdx} className="relative">
                                {att.type === "image" ? (
                                  <img
                                    src={att.url}
                                    alt={att.name || "attachment"}
                                    className="h-12 w-12 object-cover rounded border border-slate-200 dark:border-slate-700"
                                  />
                                ) : (
                                  <div className="h-12 w-12 flex flex-col items-center justify-center rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-500">
                                      <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        <span className="whitespace-pre-wrap break-words">{msg.content}</span>
                      </div>
                    ))}
                  </div>

                  {/* Attachment previews */}
                  {attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 p-1.5 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                      {attachments.map((att, idx) => (
                        <div key={idx} className="relative group">
                          {att.type === "image" ? (
                            <img
                              src={att.url}
                              alt={att.name || "attachment"}
                              className="h-10 w-10 object-cover rounded border border-slate-200 dark:border-slate-700"
                            />
                          ) : (
                            <div className="h-10 w-10 flex items-center justify-center rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800">
                              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4 text-slate-500">
                                <path strokeLinecap="round" strokeLinejoin="round" d="m15.75 10.5 4.72-4.72a.75.75 0 0 1 1.28.53v11.38a.75.75 0 0 1-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25h-9A2.25 2.25 0 0 0 2.25 7.5v9a2.25 2.25 0 0 0 2.25 2.25Z" />
                              </svg>
                            </div>
                          )}
                          <button
                            onClick={() => removeAttachment(idx)}
                            className="absolute -top-1 -right-1 h-4 w-4 flex items-center justify-center rounded-full bg-rose-500 text-white text-[10px] opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            ×
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center gap-1.5">
                    <input
                      type="file"
                      id="chat-file-input"
                      className="hidden"
                      multiple
                      accept="image/*,video/*"
                      onChange={async (e) => {
                        const newAttachments = await filesToAttachments(e.target.files);
                        setAttachments((prev) => [...prev, ...newAttachments]);
                        e.target.value = "";
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => document.getElementById("chat-file-input")?.click()}
                      className="rounded-md border border-slate-200 dark:border-slate-700 p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300 transition"
                      title="Attach image or video"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                      </svg>
                    </button>
                    <textarea
                      rows={1}
                      className="flex-1 rounded-md border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-2 py-1.5 text-xs text-slate-900 dark:text-slate-100 focus:border-indigo-500 focus:ring-indigo-500 resize-none"
                      placeholder="Describe what to generate or refine..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void sendMessage();
                        }
                      }}
                    />
                    <button
                      onClick={sendMessage}
                      disabled={loading || (!message.trim() && attachments.length === 0)}
                      className="rounded-md bg-indigo-600 text-white px-3 py-1.5 text-xs font-semibold shadow-sm hover:bg-indigo-500 disabled:opacity-50"
                    >
                      {loading ? "..." : "Send"}
                    </button>
                    <button
                      onClick={resetChat}
                      className="rounded-md border border-rose-200 dark:border-rose-700/50 px-2 py-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30"
                    >
                      Clear
                    </button>
                  </div>
                </div>

                {generated.length > 0 && (
                  <div className="rounded-lg border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950/50 p-2 space-y-2 flex-shrink-0">
                    {/* Resize handle */}
                    <div
                      className="h-1 bg-slate-200 dark:bg-slate-700 hover:bg-indigo-400 dark:hover:bg-indigo-600 rounded-full cursor-ns-resize mx-auto w-16 transition-colors"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startY = e.clientY;
                        const startHeight = resultsHeight;
                        const onMove = (moveEvent: MouseEvent) => {
                          const delta = startY - moveEvent.clientY;
                          setResultsHeight(Math.max(120, Math.min(500, startHeight + delta)));
                        };
                        const onUp = () => {
                          document.removeEventListener("mousemove", onMove);
                          document.removeEventListener("mouseup", onUp);
                        };
                        document.addEventListener("mousemove", onMove);
                        document.addEventListener("mouseup", onUp);
                      }}
                      title="Drag to resize results"
                    />
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <h4 className="text-xs font-semibold text-slate-900 dark:text-slate-50">Results</h4>
                        {source && (
                          <span
                            className={`text-[9px] px-1.5 py-0.5 rounded-full border ${
                              source.includes("Fallback")
                                ? "bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400"
                                : "bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-400"
                            }`}
                          >
                            {source}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={handleCopy}
                          className="flex items-center gap-1 rounded-md border border-slate-200 dark:border-slate-700 px-2 py-1 text-[11px] font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 hover:text-slate-900 dark:hover:text-slate-100 transition"
                        >
                          {copied ? "Copied" : "Copy"}
                        </button>
                        <button
                          onClick={() => {
                            onAccept(generated, "append");
                            setIsOpen(false);
                          }}
                          className="rounded-md px-2 py-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition"
                        >
                          Append
                        </button>
                        <button
                          onClick={() => {
                            onAccept(generated, "replace");
                            setIsOpen(false);
                          }}
                          className="rounded-md bg-indigo-50 dark:bg-indigo-950/30 px-2 py-1 text-[11px] font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition"
                        >
                          Replace
                        </button>
                      </div>
                    </div>
                    <div
                      className="grid gap-1.5 overflow-y-auto pr-1"
                      style={{ maxHeight: `${resultsHeight}px` }}
                    >
                      {generated.map((prompt, idx) => (
                        <div
                          key={idx}
                          className="group relative rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950/50 p-2 text-xs text-slate-600 dark:text-slate-300 shadow-sm hover:border-indigo-200 dark:hover:border-indigo-800 hover:shadow-md transition-all"
                        >
                          <p className="pr-12">{prompt}</p>
                          <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              onClick={() => onAccept([prompt], "append")}
                              className="rounded-md bg-indigo-50 dark:bg-indigo-900 px-2 py-1 text-[10px] font-medium text-indigo-700 dark:text-indigo-300 hover:bg-indigo-100 dark:hover:bg-indigo-800 transition"
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
        </div>
      )}
    </>
  );
}
