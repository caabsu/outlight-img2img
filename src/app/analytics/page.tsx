"use client";

import { useMemo, useState } from "react";

type ProfileStats = {
  id: string;
  name: string;
  role: string;
  total: number;
  models: Record<string, number>;
};

export default function AnalyticsPage() {
  const [password, setPassword] = useState("");
  const [data, setData] = useState<{ totalsByModel: Record<string, number>; profiles: ProfileStats[] } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/analytics?password=${encodeURIComponent(password)}`);
      const json = await res.json();
      if (!res.ok) {
        setError(json.error || "Unauthorized");
        setData(null);
      } else {
        setData(json);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load analytics");
    } finally {
      setLoading(false);
    }
  }

  const modelTotals = useMemo(() => {
    if (!data) return [];
    return Object.entries(data.totalsByModel || {}).sort((a, b) => b[1] - a[1]);
  }, [data]);

  return (
    <div className="min-h-screen bg-[#fcfcfc] dark:bg-black">
      <div className="mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Analytics</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Usage by model and profile</p>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <input
                type="password"
                className="w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                placeholder="Analytics password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                onClick={load}
                disabled={!password || loading}
                className="rounded-lg bg-slate-900 dark:bg-slate-50 px-4 py-2 text-sm font-semibold text-white dark:text-slate-900 shadow-sm hover:bg-slate-800 dark:hover:bg-slate-200 disabled:opacity-50"
              >
                {loading ? "Loading..." : "View"}
              </button>
            </div>
            {error && <p className="text-sm text-rose-500">{error}</p>}
          </div>

          {data && (
            <div className="mt-6 space-y-6">
              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Totals by model</h2>
                <div className="grid gap-3 sm:grid-cols-3">
                  {modelTotals.map(([model, count]) => (
                    <div
                      key={model}
                      className="rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 px-3 py-2 text-sm text-slate-700 dark:text-slate-200"
                    >
                      <div className="text-xs text-slate-500 dark:text-slate-400">Model</div>
                      <div className="font-semibold">{model}</div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">Calls: {count}</div>
                    </div>
                  ))}
                  {modelTotals.length === 0 && <p className="text-sm text-slate-500 dark:text-slate-400">No usage yet.</p>}
                </div>
              </div>

              <div>
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500 mb-2">Profiles</h2>
                <div className="overflow-hidden rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                  <table className="min-w-full divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-950">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Name</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Role</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Total</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Models</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {data.profiles.map((p) => (
                        <tr key={p.id}>
                          <td className="px-3 py-2 text-slate-800 dark:text-slate-100 font-medium">{p.name}</td>
                          <td className="px-3 py-2 text-slate-500 dark:text-slate-300">{p.role}</td>
                          <td className="px-3 py-2 text-slate-700 dark:text-slate-200">{p.total}</td>
                          <td className="px-3 py-2 text-slate-600 dark:text-slate-300">
                            {Object.entries(p.models || {}).map(([model, count]) => (
                              <span key={model} className="mr-2 inline-flex items-center gap-1 rounded-full border border-slate-200 dark:border-slate-700 px-2 py-0.5 text-[11px]">
                                <span className="font-semibold text-slate-800 dark:text-slate-100">{model}</span>
                                <span className="text-slate-500 dark:text-slate-300">{count}</span>
                              </span>
                            ))}
                            {Object.keys(p.models || {}).length === 0 && <span className="text-slate-400">-</span>}
                          </td>
                        </tr>
                      ))}
                      {data.profiles.length === 0 && (
                        <tr>
                          <td className="px-3 py-3 text-slate-500 dark:text-slate-300" colSpan={4}>
                            No profiles recorded yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
