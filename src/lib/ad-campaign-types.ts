import type { AdConcept, AdImage, LogEntry, AdWorkflowMode } from "@/lib/ad-types";

export type AgentStatus = "idle" | "running" | "done" | "error" | "cancelled";

export type AdCampaign = {
  id: string;
  name: string;
  startedAt: number;
  mode: AdWorkflowMode;
  theme: string;
  adaptationBrief: string;
  modelId: string;
  quantity: number;
  speed: number;
  aspectRatios: string[];
  profileId: string;
  productId: string;
  productName: string;
  sourceAdUrl: string | null;
  sourceAdUrls: string[];
  diversity: "tight" | "balanced" | "exploratory";
  modelOptions: Record<string, string>;
  status: AgentStatus;
  concepts: AdConcept[];
  images: AdImage[];
  logEntries: LogEntry[];
  progress: { done: number; total: number };
  feedbackRatings: Record<number, number>;
  selectedImages: Set<string>;
  controller: AbortController | null;
};

export type LaunchAdCampaignInput = {
  mode: AdWorkflowMode;
  theme: string;
  adaptationBrief: string;
  modelId: string;
  quantity: number;
  speed: number;
  aspectRatios: string[];
  profileId: string;
  productId: string;
  productName: string;
  sourceAdUrl: string | null;
  sourceAdUrls: string[];
  diversity: "tight" | "balanced" | "exploratory";
  modelOptions: Record<string, string>;
};
