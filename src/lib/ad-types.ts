// src/lib/ad-types.ts
// Shared types for Ad Studio

export type AdConcept = {
  name: string;
  description: string;
  prompts: Record<string, string>; // { "1:1": "...", "9:16": "..." }
};

export type AdImage = {
  conceptIndex: number;
  ratio: string;
  url: string;
  prompt: string;
};

export type AdCampaignResult = {
  brief: {
    productAnalysis: string;
    themeInterpretation: string;
    targetMood: string[];
    visualStyle: string;
    colorPalette: string[];
    keyElements: string[];
  };
  concepts: AdConcept[];
  totalImages: number;
  successCount: number;
  failCount: number;
};

export type LogEntry = {
  type: "phase" | "thought" | "action" | "error";
  phase?: string;
  message: string;
  timestamp: number;
};
