// src/lib/models.ts

export type Provider = "nanobanana" | "seedream";

export type ModelDef = {
  id: string;            // internal id used by UI
  label: string;         // shown in the dropdown
  version: string;       // for display
  provider: Provider;
  // provider-specific name (e.g., KIE model string or internal alias)
  providerName: string;
  // UI capability flags (only Seedream needs these now)
  supportsSize?: boolean;
  supportsResolution?: boolean;
  supportsMaxImages?: boolean;
  supportsSeed?: boolean;
};

export const MODEL_LIST: ModelDef[] = [
  {
    id: "nanobanana-v1",
    label: "Nano Banana",
    version: "v1",
    provider: "nanobanana",
    providerName: process.env.NEXT_PUBLIC_NANO_BANANA_MODEL_NAME || "model",
  },
  {
    id: "seedream-v4-edit",
    label: "Seedream",
    version: "v4-edit",
    provider: "seedream",
    providerName: "bytedance/seedream-v4-edit",
    supportsSize: true,
    supportsResolution: true,
    supportsMaxImages: true,
    supportsSeed: true,
  },
];

export const IMAGE_SIZES = [
  "square",
  "square_hd",
  "portrait_4_3",
  "portrait_3_2",
  "portrait_16_9",
  "landscape_4_3",
  "landscape_3_2",
  "landscape_16_9",
  "landscape_21_9",
] as const;

export const IMAGE_RESOLUTIONS = ["1K", "2K", "4K"] as const;

export function getModelById(id: string): ModelDef | undefined {
  return MODEL_LIST.find((m) => m.id === id);
}
