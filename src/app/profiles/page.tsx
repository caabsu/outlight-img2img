"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type ProfileRole = "Graphic Designer" | "Catalog Manager" | "Video Editor" | "Creative Strategist" | "Admin";
type Profile = { id: string; name: string; role: ProfileRole; client_id?: string };

export default function ProfilesPage() {
  const [clientId, setClientId] = useState("");
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [profilesLoading, setProfilesLoading] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [newProfileRole, setNewProfileRole] = useState<ProfileRole>("Graphic Designer");
  const [adminKey, setAdminKey] = useState("");
  const [error, setError] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const router = useRouter();

  useEffect(() => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("ol_client_id") : null;
    const id = stored || crypto.randomUUID();
    if (!stored) localStorage.setItem("ol_client_id", id);
    setClientId(id);
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [clientId]);

  async function loadProfiles() {
    try {
      setProfilesLoading(true);
      const res = await fetch("/api/profiles");
      const json = await res.json();
      if (res.ok) setProfiles(json.profiles || []);
    } finally {
      setProfilesLoading(false);
    }
  }

  async function createProfile() {
    setError("");
    if (!newProfileName.trim()) {
      setError("Add a profile name");
      return;
    }
    const payload: any = {
      clientId,
      name: newProfileName.trim(),
      role: newProfileRole,
    };
    if (newProfileRole === "Admin") payload.adminPassword = adminKey;
    const res = await fetch("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to create profile");
      return;
    }
    setProfiles((prev) => [...prev, json.profile]);
    localStorage.setItem("ol_active_profile", json.profile.id);
    setShowAddModal(false);
    router.push("/image");
  }

  function selectProfile(id: string, role: ProfileRole) {
    if (role === "Admin") {
      const entered = window.prompt("Enter admin password to use this admin profile");
      if (!entered || entered !== (process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "gmltn123")) {
        setError("Invalid admin password");
        return;
      }
    }
    localStorage.setItem("ol_active_profile", id);
    router.push("/image");
  }

  async function deleteProfile(id: string) {
    const entered = window.prompt("Enter admin password to delete this profile");
    if (!entered || entered !== (process.env.NEXT_PUBLIC_ADMIN_PASSWORD || "gmltn123")) {
      setError("Invalid admin password");
      return;
    }
    const res = await fetch("/api/profiles", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ profileId: id, adminPassword: entered }),
    });
    const json = await res.json();
    if (!res.ok) {
      setError(json.error || "Failed to delete profile");
      return;
    }
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    const active = localStorage.getItem("ol_active_profile");
    if (active === id) localStorage.removeItem("ol_active_profile");
  }

  return (
    <div className="min-h-screen bg-[#fcfcfc] dark:bg-black flex items-center justify-center p-4">
      <div className="w-full max-w-3xl rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Select a profile</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Profiles persist on this device. No password needed unless you choose Admin.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          {profiles.map((p) => (
            <div
              key={p.id}
              className="flex items-center justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 text-left shadow-sm"
            >
              <button
                onClick={() => selectProfile(p.id, p.role)}
                className="text-left"
              >
                <span className="block text-sm font-semibold text-slate-900 dark:text-slate-100">{p.name}</span>
                <span className="block text-xs text-slate-500 dark:text-slate-400">{p.role}</span>
              </button>
              <button
                onClick={() => deleteProfile(p.id)}
                className="text-xs text-rose-500 hover:text-rose-600"
                title="Delete profile"
              >
                Delete
              </button>
            </div>
          ))}
          {profiles.length === 0 && (
            <div className="col-span-2 text-sm text-slate-500 dark:text-slate-400">No profiles yet.</div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Add new profile</h3>
            {profilesLoading && <span className="text-[10px] text-slate-400">loading...</span>}
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="w-full rounded-md border border-indigo-200 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/30 px-3 py-2 text-sm font-semibold text-indigo-700 dark:text-indigo-200 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition flex items-center justify-center gap-2"
          >
            <span className="h-5 w-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-sm">+</span>
            Add profile
          </button>
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900 dark:text-white">New profile</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-full p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="space-y-3">
              <input
                className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                placeholder="Profile name"
                value={newProfileName}
                onChange={(e) => setNewProfileName(e.target.value)}
              />
              <select
                className="w-full rounded-md border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100"
                value={newProfileRole}
                onChange={(e) => setNewProfileRole(e.target.value as ProfileRole)}
              >
                {["Graphic Designer", "Catalog Manager", "Video Editor", "Creative Strategist", "Admin"].map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
              {newProfileRole === "Admin" && (
                <input
                  type="password"
                  className="w-full rounded-md border border-amber-200 dark:border-amber-700 bg-white dark:bg-slate-900 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                  placeholder="Admin password"
                  value={adminKey}
                  onChange={(e) => setAdminKey(e.target.value)}
                />
              )}
              {error && <p className="text-sm text-rose-500">{error}</p>}
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowAddModal(false)}
                className="rounded-md border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                Cancel
              </button>
              <button
                onClick={createProfile}
                className="rounded-md bg-slate-900 dark:bg-slate-50 px-3 py-2 text-sm font-semibold text-white dark:text-slate-900 shadow-sm hover:bg-slate-800 dark:hover:bg-slate-200 transition"
              >
                Save profile
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
