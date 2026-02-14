// src/lib/ad-types.ts
// Shared types for Ad Studio

export type AdConcept = {
  name: string;
  description: string;
  headline?: string;
  tagline?: string;
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
    styleDirection: string;
    colorPalette: string[];
    keyElements: string[];
    moodBoard: string;
    creativeRationale: string;
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

export type AdFeedbackSubmission = {
  productId: string;
  profileId: string;
  conceptName: string;
  conceptDescription?: string;
  rating: number;
  reason?: string;
  aspectRatiosGenerated?: string[];
  theme?: string;
  modelId?: string;
};

export type AdFeedback = {
  id: string;
  product_id: string;
  profile_id: string;
  concept_name: string;
  concept_description: string | null;
  rating: number;
  reason: string | null;
  aspect_ratios_generated: string[] | null;
  theme: string | null;
  model_id: string | null;
  created_at: string;
};

export type AdLearning = {
  id: string;
  product_id: string | null;
  learning: string;
  category: string;
  source_feedback_id: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};
