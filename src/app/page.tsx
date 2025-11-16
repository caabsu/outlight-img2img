"use client";

import Link from "next/link";
import { MODEL_LIST } from "@/lib/models";

const TIERS = [
  {
    title: "Image Studio",
    description: "Reference-first workflows with Nano Banana + Seedream controls, run queues, and library saves.",
    href: "/image",
    accent: "from-slate-900 to-slate-700",
  },
  {
    title: "Video Studio",
    description: "Kling, Veo, and Sora orchestration with batch uploads, storyboard scripting, and concurrency limits.",
    href: "/video",
    accent: "from-purple-900 to-indigo-700",
  },
  {
    title: "Products & Library",
    description: "Manage brand heroes and re-use prompts or approved assets across teams.",
    href: "/products",
    accent: "from-amber-500 to-orange-400",
  },
];

export default function HomePage() {
  return (
    <div className="px-4 py-12 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-16">
        <section className="rounded-3xl border border-slate-200 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-700 p-12 text-white shadow-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.4em] text-slate-300">Outlight Studio</p>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight">
            A unified canvas for text-to-image, image-to-image, and multi-model video generation.
          </h1>
          <p className="mt-6 max-w-3xl text-lg text-slate-200">
            Pair structured product data with professional tooling to produce on-brand visuals and motion.
            Image and video engines share a central library, allowing creative teams to move fast without losing context.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <Link
              href="/image"
              className="rounded-full bg-white px-6 py-3 text-sm font-semibold text-slate-900 shadow-lg hover:bg-slate-100"
            >
              Launch Image Studio
            </Link>
            <Link
              href="/video"
              className="rounded-full border border-white/40 px-6 py-3 text-sm font-semibold text-white hover:bg-white/10"
            >
              Explore Video Studio
            </Link>
          </div>
          <div className="mt-10 grid gap-6 text-sm text-slate-200 sm:grid-cols-3">
            <div>
              <p className="text-3xl font-semibold">{MODEL_LIST.length}</p>
              <p className="text-slate-400">Image models live</p>
            </div>
            <div>
              <p className="text-3xl font-semibold">3</p>
              <p className="text-slate-400">Video providers integrated</p>
            </div>
            <div>
              <p className="text-3xl font-semibold">Shared</p>
              <p className="text-slate-400">Product + Library backbone</p>
            </div>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <Link
              key={tier.title}
              href={tier.href}
              className={`rounded-2xl border border-slate-200 bg-gradient-to-br ${tier.accent} p-6 text-white shadow-lg transition hover:-translate-y-1`}
            >
              <h3 className="text-2xl font-semibold">{tier.title}</h3>
              <p className="mt-3 text-sm text-white/80">{tier.description}</p>
              <span className="mt-6 inline-flex items-center text-sm font-semibold">
                Open {tier.title}
                <svg className="ml-2 h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                  <path d="M5 12h14" />
                  <path d="m12 5 7 7-7 7" />
                </svg>
              </span>
            </Link>
          ))}
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-10 shadow-sm">
          <div className="grid gap-10 lg:grid-cols-2">
            <div>
              <h2 className="text-3xl font-semibold text-slate-900">Why we rebuilt the UI</h2>
              <ul className="mt-6 space-y-4 text-slate-600">
                <li>
                  <span className="font-semibold text-slate-900">Structure first:</span> Dedicated routes for image, video,
                  products, and the shared library clarify workflows.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">Scalable layout:</span> Light mode design uses stacked cards
                  and responsive grids so the experience feels at home on both desktop dashboards and laptops.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">Library bridges:</span> Prompts or saved images can be sent
                  directly to Image Studio via the new Studio Intent bridge.
                </li>
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 p-6">
              <h3 className="text-lg font-semibold text-slate-900">Workflow tour</h3>
              <ol className="mt-4 space-y-4 text-sm text-slate-600">
                <li>
                  <span className="font-semibold text-slate-900">1. Products:</span> Maintain hero references and key art per SKU.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">2. Image Studio:</span> Run Nano Banana text-to-image or Seedream
                  edit flows with queue controls.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">3. Video Studio:</span> Promote winning prompts into Kling, Veo,
                  or Sora pipelines.
                </li>
                <li>
                  <span className="font-semibold text-slate-900">4. Library:</span> Archive everything, then push references back
                  into the studios whenever needed.
                </li>
              </ol>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
