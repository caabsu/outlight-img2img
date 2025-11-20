"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type KnowledgeBase = {
  id: string;
  name: string;
  description?: string;
  content: string;
  is_default: boolean;
  created_at: string;
};

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeBase[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ name: string; description: string; content: string }>({
    name: "",
    description: "",
    content: "",
  });
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: "success" | "error" } | null>(null);

  useEffect(() => {
    fetchItems();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  async function fetchItems() {
    setLoading(true);
    try {
      const res = await fetch("/api/knowledge");
      const json = await res.json();
      if (res.ok) {
        setItems(json.items || []);
        if (json.items.length > 0 && !selectedId) {
           // Optional: select first by default
           // setSelectedId(json.items[0].id);
        }
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function handleSelect(item: KnowledgeBase) {
    setSelectedId(item.id);
    setEditForm({
      name: item.name,
      description: item.description || "",
      content: item.content,
    });
  }

  function handleCreateNew() {
    setSelectedId("new");
    setEditForm({ name: "", description: "", content: "" });
  }

  async function handleSave() {
    if (!editForm.name || !editForm.content) {
      setToast({ msg: "Name and Content are required", type: "error" });
      return;
    }
    setIsSaving(true);
    try {
      if (selectedId === "new") {
        const res = await fetch("/api/knowledge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editForm),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setItems((prev) => [...prev, json.item]);
        setSelectedId(json.item.id);
        setToast({ msg: "Created successfully", type: "success" });
      } else {
        const res = await fetch(`/api/knowledge/${selectedId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(editForm),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error);
        setItems((prev) => prev.map((i) => (i.id === selectedId ? json.item : i)));
        setToast({ msg: "Saved successfully", type: "success" });
      }
    } catch (e: any) {
      setToast({ msg: e.message, type: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete() {
    if (!selectedId || selectedId === "new") return;
    if (!confirm("Are you sure you want to delete this knowledge base?")) return;

    setIsSaving(true);
    try {
      const res = await fetch(`/api/knowledge/${selectedId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      setItems((prev) => prev.filter((i) => i.id !== selectedId));
      setSelectedId(null);
      setToast({ msg: "Deleted successfully", type: "success" });
    } catch (e: any) {
      setToast({ msg: e.message, type: "error" });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fcfcfc] dark:bg-black p-4 lg:p-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white tracking-tight">Knowledge Base</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Manage brand guidelines and style contexts.</p>
          </div>
          <Link href="/image" className="text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300">
            &larr; Back to Studio
          </Link>
        </div>

        <div className="grid gap-6 lg:grid-cols-[300px_1fr] h-[calc(100vh-140px)]">
          {/* Sidebar List */}
          <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">Saved Contexts</h2>
              <button
                onClick={handleCreateNew}
                className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/30 px-2 py-1 rounded-md border border-indigo-100 dark:border-indigo-900"
              >
                + New
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading ? (
                <div className="p-4 text-center text-xs text-slate-400">Loading...</div>
              ) : items.length === 0 ? (
                <div className="p-4 text-center text-xs text-slate-400">No knowledge bases yet.</div>
              ) : (
                items.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleSelect(item)}
                    className={`w-full text-left p-3 rounded-lg text-sm transition-all border ${
                      selectedId === item.id
                        ? "bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800 text-indigo-900 dark:text-indigo-300 font-medium"
                        : "bg-transparent border-transparent hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-400"
                    }`}
                  >
                    <div className="truncate">{item.name}</div>
                    {item.description && <div className="truncate text-[10px] text-slate-400 dark:text-slate-500 mt-0.5">{item.description}</div>}
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Editor Area */}
          <div className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm overflow-hidden">
            {selectedId ? (
              <>
                <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                     <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                       {selectedId === "new" ? "Creating New Knowledge Base" : "Editing Knowledge Base"}
                     </span>
                  </div>
                  {selectedId !== "new" && (
                    <button onClick={handleDelete} className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:text-rose-700 dark:hover:text-rose-300 px-3 py-1">
                      Delete
                    </button>
                  )}
                </div>
                
                <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    <div className="grid grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Name</label>
                            <input 
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                placeholder="e.g. Summer Campaign 2025"
                                value={editForm.name}
                                onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))}
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Description (Optional)</label>
                            <input 
                                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2.5 text-sm focus:border-indigo-500 focus:ring-indigo-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                                placeholder="Brief context about usage..."
                                value={editForm.description}
                                onChange={(e) => setEditForm(prev => ({ ...prev, description: e.target.value }))}
                            />
                        </div>
                    </div>
                    
                    <div className="flex-1 flex flex-col min-h-[400px]">
                        <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Content / Instructions</label>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                            This text will be fed to the AI Prompt Engineer as context. Include brand voice, lighting preferences, negative prompts, or specific compositional rules.
                        </p>
                        <textarea 
                            className="flex-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-sm font-mono leading-relaxed focus:border-indigo-500 focus:ring-indigo-500 bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100"
                            placeholder="Example: Always use soft, natural lighting. Our brand colors are pastel. Avoid harsh shadows. Products should be centered."
                            value={editForm.content}
                            onChange={(e) => setEditForm(prev => ({ ...prev, content: e.target.value }))}
                        />
                    </div>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950/50 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 px-6 py-2 rounded-lg text-sm font-semibold hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50 transition-all shadow-sm"
                    >
                        {isSaving ? "Saving..." : "Save Knowledge Base"}
                    </button>
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                <div className="h-12 w-12 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center mb-4 text-slate-300 dark:text-slate-500">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
                    </svg>
                </div>
                <h3 className="text-lg font-medium text-slate-600 dark:text-slate-300 mb-1">Select a Knowledge Base</h3>
                <p className="text-sm max-w-xs dark:text-slate-500">Choose an existing context from the sidebar or create a new one to guide your AI generations.</p>
                <button onClick={handleCreateNew} className="mt-6 text-indigo-600 dark:text-indigo-400 font-medium text-sm hover:underline">Create New</button>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 rounded-lg px-4 py-3 text-sm shadow-lg transition-all ${toast.type === 'success' ? 'bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900' : 'bg-rose-600 text-white'}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}