"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Shared layout primitive for the 3-column studio pages (Image / Video).
// Lets the Config (left) and Prompt (center) columns be drag-resized and
// collapsed to a thin rail, so the Output column can take the remaining
// width — essential on small laptops where the left sidebar already eats
// ~240px of horizontal space.

const COLLAPSED_PX = 44;

type Range = [number, number];

function clamp(value: number, [min, max]: Range) {
  return Math.max(min, Math.min(max, value));
}

export type StudioColumnsOptions = {
  /** Default width of the config (left) column in px. */
  configWidth?: number;
  /** Default width of the prompt (center) column in px. */
  promptWidth?: number;
  configRange?: Range;
  promptRange?: Range;
  /** Min viewport width (px) at which the multi-column template applies. */
  breakpoint?: number;
};

export function useStudioColumns(storageKey: string, opts: StudioColumnsOptions = {}) {
  const {
    configWidth: defConfig = 300,
    promptWidth: defPrompt = 540,
    configRange = [220, 460],
    promptRange = [380, 1100],
    breakpoint = 1024,
  } = opts;

  const [configWidth, setConfigWidth] = useState(defConfig);
  const [promptWidth, setPromptWidth] = useState(defPrompt);
  const [configCollapsed, setConfigCollapsed] = useState(false);
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const [isWide, setIsWide] = useState(true);
  const loadedRef = useRef(false);

  // Restore persisted layout
  useEffect(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.configWidth === "number") setConfigWidth(clamp(s.configWidth, configRange));
        if (typeof s.promptWidth === "number") setPromptWidth(clamp(s.promptWidth, promptRange));
        if (typeof s.configCollapsed === "boolean") setConfigCollapsed(s.configCollapsed);
        if (typeof s.promptCollapsed === "boolean") setPromptCollapsed(s.promptCollapsed);
      }
    } catch {
      /* ignore */
    }
    loadedRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  // Persist layout
  useEffect(() => {
    if (!loadedRef.current) return;
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({ configWidth, promptWidth, configCollapsed, promptCollapsed })
      );
    } catch {
      /* ignore */
    }
  }, [storageKey, configWidth, promptWidth, configCollapsed, promptCollapsed]);

  // Track viewport so the fixed template only applies on wide screens
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${breakpoint}px)`);
    const update = () => setIsWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [breakpoint]);

  const gridTemplateColumns = isWide
    ? `${configCollapsed ? COLLAPSED_PX : configWidth}px ${
        promptCollapsed ? COLLAPSED_PX : promptWidth
      }px minmax(0,1fr)`
    : undefined;

  const startResize = useCallback(
    (which: "config" | "prompt", e: React.MouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = which === "config" ? configWidth : promptWidth;
      const range = which === "config" ? configRange : promptRange;
      const setter = which === "config" ? setConfigWidth : setPromptWidth;

      const onMove = (ev: MouseEvent) => {
        setter(clamp(startW + (ev.clientX - startX), range));
      };
      const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configWidth, promptWidth]
  );

  const reset = useCallback(() => {
    setConfigWidth(defConfig);
    setPromptWidth(defPrompt);
    setConfigCollapsed(false);
    setPromptCollapsed(false);
  }, [defConfig, defPrompt]);

  return {
    isWide,
    gridTemplateColumns,
    configWidth,
    promptWidth,
    configCollapsed,
    promptCollapsed,
    setConfigCollapsed,
    setPromptCollapsed,
    toggleConfig: () => setConfigCollapsed((v) => !v),
    togglePrompt: () => setPromptCollapsed((v) => !v),
    startResize,
    reset,
  };
}

/** Drag handle pinned to the right edge of a column (wide screens only). */
export function ColumnResizeHandle({
  onMouseDown,
  title = "Drag to resize",
  breakpointClass = "lg:block",
}: {
  onMouseDown: (e: React.MouseEvent) => void;
  title?: string;
  /** Tailwind display class that matches the page breakpoint (e.g. "xl:block"). */
  breakpointClass?: string;
}) {
  return (
    <div
      className={`absolute right-0 top-0 bottom-0 z-20 hidden w-3 cursor-col-resize group ${breakpointClass}`}
      style={{ transform: "translateX(50%)" }}
      onMouseDown={onMouseDown}
      title={title}
    >
      <div className="absolute inset-y-0 left-1/2 w-1 -translate-x-1/2 rounded-full bg-transparent transition-colors group-hover:bg-brand" />
    </div>
  );
}

/** Small chevron button placed inside a column header to collapse it. */
export function CollapseToggle({
  onClick,
  title = "Collapse",
  breakpointClass = "lg:inline-flex",
}: {
  onClick: () => void;
  title?: string;
  breakpointClass?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`hidden rounded-md p-1 text-ink-3 transition hover:bg-canvas-2 hover:text-ink ${breakpointClass}`}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
        <path
          fillRule="evenodd"
          d="M12.79 5.23a.75.75 0 01-.02 1.06L9.06 10l3.71 3.71a.75.75 0 11-1.06 1.06l-4.25-4.25a.75.75 0 010-1.06l4.25-4.25a.75.75 0 011.08.02z"
          clipRule="evenodd"
        />
      </svg>
    </button>
  );
}

/** Thin vertical rail shown in place of a collapsed column. */
export function CollapsedRail({
  label,
  onExpand,
  heightClass = "h-[calc(100vh-120px)]",
}: {
  label: string;
  onExpand: () => void;
  heightClass?: string;
}) {
  return (
    <div className={`${heightClass} ui-card flex flex-col items-center gap-3 py-3`}>
      <button
        onClick={onExpand}
        title={`Expand ${label}`}
        aria-label={`Expand ${label}`}
        className="rounded-md p-1 text-ink-3 transition hover:bg-canvas-2 hover:text-brand"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
          <path
            fillRule="evenodd"
            d="M7.21 14.77a.75.75 0 01.02-1.06L10.94 10 7.23 6.29a.75.75 0 111.06-1.06l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.08-.02z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      <span className="select-none text-[11px] font-bold uppercase tracking-[0.1em] text-ink-3 [writing-mode:vertical-rl]">
        {label}
      </span>
    </div>
  );
}
