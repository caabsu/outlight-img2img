"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { InfoModal } from "@/components/InfoModal";
import { ThemeToggle } from "@/components/ThemeToggle";

type IconProps = { className?: string };
const I = {
  image: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-4.5-4.5L5 21" /></svg>
  ),
  video: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="14" height="14" rx="3" /><path d="m16 9 6-3.5v13L16 15" /></svg>
  ),
  ugc: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></svg>
  ),
  ads: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11v2a1 1 0 0 0 1 1h3l5 4V6L7 10H4a1 1 0 0 0-1 1Z" /><path d="M16 9a3 3 0 0 1 0 6" /></svg>
  ),
  products: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m7.5 4 9 0 4 8-8.5 8L3 11.5 7.5 4Z" /><circle cx="12" cy="10" r="1.6" /></svg>
  ),
  knowledge: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2V5Z" /><path d="M18 17H6" /></svg>
  ),
  library: (p: IconProps) => (
    <svg {...p} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
  ),
};

const NAV = [
  { label: "Image", href: "/image", icon: I.image },
  { label: "Video", href: "/video", icon: I.video },
  { label: "UGC", href: "/ugc", icon: I.ugc },
  { label: "Ads", href: "/ads", icon: I.ads },
  { label: "Products", href: "/products", icon: I.products },
  { label: "Knowledge", href: "/knowledge", icon: I.knowledge },
  { label: "Library", href: "/library", icon: I.library },
];

export function Sidebar() {
  const pathname = usePathname();
  const [showInfo, setShowInfo] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  const isActive = (href: string) => (pathname ? pathname.startsWith(href) : href === "/image");

  const NavLinks = ({ onNavigate }: { onNavigate?: () => void }) => (
    <nav className="flex flex-col gap-1">
      {NAV.map((item) => {
        const active = isActive(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              active ? "bg-brand-soft text-brand" : "text-ink-2 hover:bg-canvas-2 hover:text-ink"
            }`}
          >
            {active && <span className="absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-brand" />}
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span>{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );

  const Brand = (
    <Link href="/image" className="flex items-center gap-2.5" onClick={() => setMobileOpen(false)}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-on-brand text-[15px] font-bold font-display shadow-sm">O</span>
      <span className="font-display text-[17px] font-bold tracking-tight text-ink">Outlight</span>
    </Link>
  );

  const Footer = (
    <div className="mt-auto flex flex-col gap-1 border-t border-line pt-3">
      <button
        onClick={() => { setShowInfo(true); setMobileOpen(false); }}
        className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-2 transition hover:bg-canvas-2 hover:text-ink"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-[18px] w-[18px] shrink-0"><path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
        How it works
      </button>
      <div className="flex items-center justify-between rounded-lg px-3 py-1.5">
        <span className="text-xs font-medium text-ink-3">Theme</span>
        <ThemeToggle />
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface/90 px-4 backdrop-blur">
        {Brand}
        <button
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          className="grid h-9 w-9 place-items-center rounded-lg border border-line text-ink-2 hover:bg-canvas-2 hover:text-ink"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 flex h-full w-72 flex-col gap-4 border-r border-line bg-surface p-4 shadow-xl animate-fade-in">
            <div className="flex items-center justify-between">
              {Brand}
              <button onClick={() => setMobileOpen(false)} aria-label="Close menu" className="grid h-8 w-8 place-items-center rounded-lg text-ink-2 hover:bg-canvas-2 hover:text-ink">✕</button>
            </div>
            <NavLinks onNavigate={() => setMobileOpen(false)} />
            {Footer}
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className="hidden lg:flex sticky top-0 h-screen w-60 shrink-0 flex-col gap-5 border-r border-line bg-surface px-3 py-5">
        <div className="px-2">{Brand}</div>
        <NavLinks />
        {Footer}
      </aside>

      <InfoModal isOpen={showInfo} onClose={() => setShowInfo(false)} />
    </>
  );
}
