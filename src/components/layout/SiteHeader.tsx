"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMemo } from "react";

const NAV_LINKS = [
  { label: "Overview", href: "/" },
  { label: "Image Studio", href: "/image" },
  { label: "Video Studio", href: "/video" },
  { label: "Products", href: "/products" },
  { label: "Library", href: "/library" },
];

export function SiteHeader() {
  const pathname = usePathname();
  const activeHref = useMemo(() => {
    if (!pathname) return "/";
    if (pathname.startsWith("/image")) return "/image";
    if (pathname.startsWith("/video")) return "/video";
    if (pathname.startsWith("/products")) return "/products";
    if (pathname.startsWith("/library")) return "/library";
    return "/";
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-indigo-600 text-white text-lg font-bold">
            O
          </span>
          Outlight Studio
        </Link>
        <nav className="flex items-center gap-1 text-sm font-medium text-slate-600">
          {NAV_LINKS.map((item) => {
            const isActive = activeHref === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-full px-3 py-1.5 transition-colors ${
                  isActive ? "bg-slate-900 text-white" : "hover:bg-slate-100"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
