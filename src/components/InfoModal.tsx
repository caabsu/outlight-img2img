"use client";

export function InfoModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 dark:bg-black/80 p-4 backdrop-blur-sm transition-opacity">
      <div className="w-full max-w-3xl overflow-hidden rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-900/5 dark:ring-slate-50/10" onClick={(e) => e.stopPropagation()}>
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/50 px-6 py-4">
           <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900">
                <span className="font-bold">O</span>
              </div>
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">How Outlight Studio Works</h2>
           </div>
           <button onClick={onClose} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-600 dark:hover:text-slate-300 transition">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                 <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
           </button>
        </div>

        {/* Content */}
        <div className="max-h-[70vh] overflow-y-auto p-8">
           <div className="grid gap-8 md:grid-cols-2">
              
              {/* Section 1: Workflow */}
              <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-xs">1</span>
                      Define Product
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      Start by creating a <strong>Product</strong> entity. This anchors your generation to a consistent subject/SKU. Upload a "Hero Image" to serve as the ground-truth reference for Image-to-Image and Video pipelines.
                  </p>
              </div>

              <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-xs">2</span>
                      Prompt Engineering
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      Use the <strong>AI Assistant</strong> (powered by Gemini 3.0 Pro) to expand simple ideas into professional photography briefs. It respects your "Brand Knowledge Base" to ensure style consistency.
                  </p>
              </div>

              <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-xs">3</span>
                      Image Studio
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      Generate high-fidelity visuals using <strong>Nano Banana</strong> or <strong>Seedream</strong> models. Use the "Context" panel to attach your Product reference or custom uploads. Save winning shots to the Library.
                  </p>
              </div>

              <div className="space-y-4">
                  <h3 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider text-indigo-600 dark:text-indigo-400">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 dark:bg-indigo-900/30 text-xs">4</span>
                      Video Studio
                  </h3>
                  <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
                      Animate your assets with <strong>Kling</strong>, <strong>Veo</strong>, or <strong>Sora</strong>. Supports Image-to-Video (using your generated or product images) and Text-to-Video. Batch mode allows processing multiple images with one prompt.
                  </p>
              </div>

           </div>
           
           <div className="mt-8 rounded-xl bg-slate-50 dark:bg-slate-950/50 p-6 border border-slate-100 dark:border-slate-800">
               <h4 className="mb-2 text-sm font-semibold text-slate-900 dark:text-slate-50">Pro Tips</h4>
               <ul className="list-disc pl-4 text-sm text-slate-600 dark:text-slate-400 space-y-1">
                   <li><strong>Reference Strength:</strong> Use clear, well-lit product images for best Image-to-Image results.</li>
                   <li><strong>Batch Video:</strong> Great for creating multiple angles of motion for a single campaign concept.</li>
                   <li><strong>Library:</strong> Saved images can be instantly sent back to the Studio for refinement using the "Use as Reference" feature.</li>
               </ul>
           </div>
        </div>

        {/* Footer */}
        <div className="bg-slate-50 dark:bg-slate-950/50 p-4 flex justify-end">
            <button onClick={onClose} className="px-6 py-2 bg-slate-900 dark:bg-slate-50 text-white dark:text-slate-900 text-sm font-semibold rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition shadow-sm">
                Got it
            </button>
        </div>

      </div>
    </div>
  );
}
