"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo, useState } from "react";
import { InfoModal } from "@/components/InfoModal";

const NAV_LINKS = [
  { label: "Image Studio", href: "/image" },
  { label: "Video Studio", href: "/video" },
  { label: "Products", href: "/products" },
  { label: "Library", href: "/library" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const [showInfo, setShowInfo] = useState(false);

  const activeHref = useMemo(() => {
    if (!pathname) return "/image";
    if (pathname.startsWith("/image")) return "/image";
    if (pathname.startsWith("/video")) return "/video";
    if (pathname.startsWith("/products")) return "/products";
    if (pathname.startsWith("/library")) return "/library";
    return "/image";
  }, [pathname]);

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
        <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-8">
            <Link href="/image" className="flex items-center gap-2 font-semibold text-slate-900">
              <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-slate-900 text-white text-lg font-bold shadow-sm">
                O
              </span>
              <span className="tracking-tight">Outlight Studio</span>
            </Link>
            <nav className="hidden md:flex items-center gap-1 text-sm font-medium text-slate-600">
              {NAV_LINKS.map((item) => {
                const isActive = activeHref === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-lg px-3 py-1.5 transition-all ${
                      isActive ? "bg-slate-100 text-slate-900 font-semibold" : "hover:bg-slate-50 hover:text-slate-900"
                    }`}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <button
            onClick={() => setShowInfo(true)}
            className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 hover:text-slate-900"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-slate-400">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            How it Works
          </button>
        </div>
      </header>

      <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} />
    </>
  );
}
