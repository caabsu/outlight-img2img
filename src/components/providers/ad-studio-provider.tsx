"use client";

import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { LogEntry } from "@/lib/ad-types";
import type { AdCampaign, LaunchAdCampaignInput } from "@/lib/ad-campaign-types";

const MAX_CAMPAIGNS = 10;
const MAX_LIVE_LOG_ENTRIES = 300;

function trimLiveLogEntries(entries: LogEntry[]): LogEntry[] {
  return entries.length > MAX_LIVE_LOG_ENTRIES ? entries.slice(-MAX_LIVE_LOG_ENTRIES) : entries;
}

type AdStudioContextValue = {
  campaigns: AdCampaign[];
  activeCampaignId: string | null;
  hasRunningCampaign: boolean;
  setActiveCampaignId: (campaignId: string | null) => void;
  updateCampaign: (campaignId: string, updater: (campaign: AdCampaign) => AdCampaign) => void;
  launchCampaign: (input: LaunchAdCampaignInput) => string;
  cancelCampaign: (campaignId: string) => void;
  deleteCampaign: (campaignId: string) => void;
  clearAllCampaigns: () => void;
  restoreCampaignState: (campaigns: AdCampaign[], activeCampaignId: string | null) => void;
};

const AdStudioContext = createContext<AdStudioContextValue | null>(null);

export function AdStudioProvider({ children }: { children: ReactNode }) {
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [activeCampaignId, setActiveCampaignId] = useState<string | null>(null);
  const campaignCountRef = useRef(0);

  const updateCampaign = useCallback(
    (campaignId: string, updater: (campaign: AdCampaign) => AdCampaign) => {
      setCampaigns((prev) => prev.map((campaign) => (campaign.id === campaignId ? updater(campaign) : campaign)));
    },
    []
  );

  const scheduleCampaignUpdate = useCallback(
    (campaignId: string, updater: (campaign: AdCampaign) => AdCampaign) => {
      startTransition(() => {
        updateCampaign(campaignId, updater);
      });
    },
    [updateCampaign]
  );

  const appendCampaignLog = useCallback(
    (campaignId: string, entry: LogEntry) => {
      scheduleCampaignUpdate(campaignId, (campaign) => ({
        ...campaign,
        logEntries: trimLiveLogEntries([...campaign.logEntries, entry]),
      }));
    },
    [scheduleCampaignUpdate]
  );

  const runCampaignSSE = useCallback(
    async (campaign: AdCampaign) => {
      const campaignId = campaign.id;

      try {
        const endpoint = campaign.mode !== "campaign" ? "/api/ads/copy" : "/api/ads/generate";
        const payload =
          campaign.mode !== "campaign"
            ? {
                modelId: campaign.modelId,
                quantity: campaign.quantity,
                aspectRatios: campaign.aspectRatios,
                workflowMode: campaign.mode,
                sourceAdUrl: campaign.sourceAdUrl,
                sourceAdUrls: campaign.sourceAdUrls,
                adaptationBrief: campaign.adaptationBrief,
                diversity: campaign.diversity,
                productId: campaign.productId,
                profileId: campaign.profileId,
                concurrency: campaign.speed,
                modelOptions: Object.keys(campaign.modelOptions).length > 0 ? campaign.modelOptions : undefined,
              }
            : {
                modelId: campaign.modelId,
                quantity: campaign.quantity,
                theme: campaign.theme,
                productId: campaign.productId,
                aspectRatios: campaign.aspectRatios,
                profileId: campaign.profileId,
                concurrency: campaign.speed,
                modelOptions: Object.keys(campaign.modelOptions).length > 0 ? campaign.modelOptions : undefined,
              };

        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: campaign.controller?.signal,
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: "Unknown error" }));
          throw new Error(err.error || `HTTP ${res.status}`);
        }

        const reader = res.body?.getReader();
        if (!reader) {
          throw new Error("Generation stream was unavailable");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let sawComplete = false;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const event = JSON.parse(line.slice(6));
              switch (event.type) {
                case "phase":
                  appendCampaignLog(campaignId, {
                    type: "phase",
                    phase: event.phase,
                    message: event.message,
                    timestamp: Date.now(),
                  });
                  break;
                case "thought":
                  appendCampaignLog(campaignId, {
                    type: "thought",
                    message: event.message,
                    timestamp: Date.now(),
                  });
                  break;
                case "action":
                  appendCampaignLog(campaignId, {
                    type: "action",
                    message: event.message,
                    timestamp: Date.now(),
                  });
                  break;
                case "concept":
                  scheduleCampaignUpdate(campaignId, (current) => ({
                    ...current,
                    concepts: [...current.concepts, event.concept],
                  }));
                  break;
                case "image":
                  scheduleCampaignUpdate(campaignId, (current) => ({
                    ...current,
                    images: [
                      ...current.images,
                      { conceptIndex: event.conceptIndex, ratio: event.ratio, url: event.url, prompt: event.prompt },
                    ],
                  }));
                  break;
                case "progress":
                  scheduleCampaignUpdate(campaignId, (current) => ({
                    ...current,
                    progress: { done: event.done, total: event.total },
                  }));
                  break;
                case "error":
                  appendCampaignLog(campaignId, {
                    type: "error",
                    message: event.message,
                    timestamp: Date.now(),
                  });
                  break;
                case "complete":
                  sawComplete = true;
                  scheduleCampaignUpdate(campaignId, (current) => ({
                    ...current,
                    status: "done",
                    controller: null,
                  }));
                  break;
              }
            } catch {
              // Skip malformed events
            }
          }
        }

        scheduleCampaignUpdate(campaignId, (current) => {
          if (current.status !== "running") return current;
          if (sawComplete) return { ...current, status: "done", controller: null };
          return {
            ...current,
            status: "error",
            controller: null,
            logEntries: trimLiveLogEntries([
              ...current.logEntries,
              {
                type: "error" as const,
                message:
                  current.progress.total > 0 && current.progress.done < current.progress.total
                    ? "Generation stream ended before all images were returned. Retry with fewer ads or lower speed."
                    : "Generation stream ended unexpectedly before completion.",
                timestamp: Date.now(),
              },
            ]),
          };
        });
      } catch (err: any) {
        if (err?.name === "AbortError") {
          scheduleCampaignUpdate(campaignId, (current) => ({
            ...current,
            status: "cancelled",
            controller: null,
            logEntries: trimLiveLogEntries([
              ...current.logEntries,
              { type: "phase" as const, phase: "cancelled", message: "Campaign cancelled by user", timestamp: Date.now() },
            ]),
          }));
        } else {
          scheduleCampaignUpdate(campaignId, (current) => ({
            ...current,
            status: "error",
            controller: null,
            logEntries: trimLiveLogEntries([
              ...current.logEntries,
              { type: "error" as const, message: err?.message || "Unknown error", timestamp: Date.now() },
            ]),
          }));
        }
      }
    },
    [appendCampaignLog, scheduleCampaignUpdate]
  );

  const launchCampaign = useCallback(
    (input: LaunchAdCampaignInput) => {
      campaignCountRef.current += 1;
      const controller = new AbortController();
      const isRemixMode = input.mode !== "campaign";
      const campaignId = crypto.randomUUID();
      const campaign: AdCampaign = {
        id: campaignId,
        name: `${isRemixMode ? (input.mode === "bulk-copy" ? "Bulk Copy" : "Ad Copy") : "Campaign"} #${campaignCountRef.current}`,
        startedAt: Date.now(),
        mode: input.mode,
        theme: input.theme,
        adaptationBrief: input.adaptationBrief,
        modelId: input.modelId,
        quantity: input.quantity,
        speed: input.speed,
        aspectRatios: [...input.aspectRatios],
        profileId: input.profileId,
        productId: input.productId,
        productName: input.productName,
        sourceAdUrl: input.sourceAdUrl,
        sourceAdUrls: [...input.sourceAdUrls],
        diversity: input.diversity,
        modelOptions: { ...input.modelOptions },
        status: "running",
        concepts: [],
        images: [],
        logEntries: [],
        progress: { done: 0, total: 0 },
        feedbackRatings: {},
        selectedImages: new Set(),
        controller,
      };

      setCampaigns((prev) => {
        let next = prev;
        if (next.length >= MAX_CAMPAIGNS) {
          const nonRunning = next.filter((item) => item.status !== "running");
          if (nonRunning.length > 0) {
            next = next.filter((item) => item.id !== nonRunning[0].id);
          }
        }
        return [...next, campaign];
      });
      setActiveCampaignId(campaignId);

      void runCampaignSSE(campaign);
      return campaignId;
    },
    [runCampaignSSE]
  );

  const cancelCampaign = useCallback((campaignId: string) => {
    setCampaigns((prev) =>
      prev.map((campaign) => {
        if (campaign.id === campaignId && campaign.controller) {
          campaign.controller.abort();
        }
        return campaign;
      })
    );
  }, []);

  const deleteCampaign = useCallback((campaignId: string) => {
    setCampaigns((prev) => {
      const target = prev.find((campaign) => campaign.id === campaignId);
      if (target?.controller) target.controller.abort();
      const remaining = prev.filter((campaign) => campaign.id !== campaignId);
      setTimeout(() => {
        setActiveCampaignId((current) => {
          if (current !== campaignId) return current;
          return remaining.length > 0 ? remaining[remaining.length - 1].id : null;
        });
      }, 0);
      return remaining;
    });
  }, []);

  const clearAllCampaigns = useCallback(() => {
    setCampaigns((prev) => {
      for (const campaign of prev) {
        if (campaign.controller) {
          campaign.controller.abort();
        }
      }
      return [];
    });
    setActiveCampaignId(null);
  }, []);

  const restoreCampaignState = useCallback((restoredCampaigns: AdCampaign[], nextActiveCampaignId: string | null) => {
    setCampaigns(restoredCampaigns);
    setActiveCampaignId(nextActiveCampaignId || restoredCampaigns[0]?.id || null);
    campaignCountRef.current = restoredCampaigns.length;
  }, []);

  const value = useMemo<AdStudioContextValue>(
    () => ({
      campaigns,
      activeCampaignId,
      hasRunningCampaign: campaigns.some((campaign) => campaign.status === "running"),
      setActiveCampaignId,
      updateCampaign,
      launchCampaign,
      cancelCampaign,
      deleteCampaign,
      clearAllCampaigns,
      restoreCampaignState,
    }),
    [
      campaigns,
      activeCampaignId,
      updateCampaign,
      launchCampaign,
      cancelCampaign,
      deleteCampaign,
      clearAllCampaigns,
      restoreCampaignState,
    ]
  );

  return <AdStudioContext.Provider value={value}>{children}</AdStudioContext.Provider>;
}

export function useAdStudio() {
  const context = useContext(AdStudioContext);
  if (!context) {
    throw new Error("useAdStudio must be used within an AdStudioProvider");
  }
  return context;
}
