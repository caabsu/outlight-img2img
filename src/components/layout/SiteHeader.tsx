"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { InfoModal } from "@/components/InfoModal";
import { ThemeToggle } from "@/components/ThemeToggle";

const NAV_LINKS = [
  { label: "Image Studio", href: "/image" },
  { label: "Video Studio", href: "/video" },
  { label: "UGC Studio", href: "/ugc" },
  { label: "Ad Studio", href: "/ads" },
  { label: "Products", href: "/products" },
  { label: "Knowledge", href: "/knowledge" },
  { label: "Library", href: "/library" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [showInfo, setShowInfo] = useState(false);

  const activeHref = useMemo(() => {
    if (!pathname) return "/image";
    if (pathname.startsWith("/image")) return "/image";
    if (pathname.startsWith("/video")) return "/video";
    if (pathname.startsWith("/ugc")) return "/ugc";
    if (pathname.startsWith("/ads")) return "/ads";
    if (pathname.startsWith("/products")) return "/products";
    if (pathname.startsWith("/knowledge")) return "/knowledge";
    if (pathname.startsWith("/library")) return "/library";
    return "/image";
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-line bg-surface/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-6">
            <Link href="/image" className="flex items-center gap-2.5 font-semibold text-ink">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-on-brand text-lg font-bold font-display shadow-sm">
                O
              </span>
              <span className="font-display text-[17px] tracking-tight">Outlight</span>
            </Link>
            <nav className="hidden md:flex items-center gap-0.5 text-sm font-medium text-ink-2">
              {NAV_LINKS.map((item) => {
                const isActive = activeHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 transition-all ${
                      isActive
                        ? "bg-brand-soft text-brand font-semibold"
                        : "hover:bg-canvas-2 hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowInfo(true)}
              className="flex items-center gap-2 rounded-full border border-line px-3 py-1.5 text-xs font-medium text-ink-2 transition hover:bg-canvas-2 hover:text-ink"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-ink-3">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
              </svg>
              <span className="hidden sm:inline">How it Works</span>
            </button>
            <ThemeToggle />
          </div>
        </div>
      </header>

      <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} />
    </>
  );
}
