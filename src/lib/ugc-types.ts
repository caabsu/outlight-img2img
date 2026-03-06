export type UgcSafeMode = "safe" | "fast";
export type UgcScriptMode = "generate" | "upload";
export type UgcProductSource = "catalog" | "upload";
export type UgcStageId = "script" | "scene" | "dialogue" | "broll";

export type UgcWorkflowSettings = {
  safeMode: UgcSafeMode;
  dialogueSeconds: number;
  clipDurationSeconds: number;
  sceneVariationCount: number;
  bRollClipCount: number;
  imageModelId: string;
  videoModelId: string;
  imageAspectRatio: "9:16";
  imageResolution: "2K";
  videoAspectRatio: "9:16";
  videoDurationSeconds: number;
  videoSound: boolean;
};

export type UgcAgentPromptPack = {
  strategist: string;
  sceneArchitect: string;
  dialogueDirector: string;
  bRollDirector: string;
  safetyCoordinator: string;
};

export type UgcProductInput = {
  source: UgcProductSource;
  id?: string | null;
  name: string;
  imageUrl?: string | null;
  category?: string | null;
  vendor?: string | null;
  appearanceNotes?: string;
};

export type UgcScriptInput = {
  mode: UgcScriptMode;
  text: string;
  totalSeconds: number;
  tone: string;
  audience: string;
  primaryBenefit: string;
  offer: string;
  cta: string;
};

export type UgcPlanRequest = {
  campaignName: string;
  knowledge: string;
  product: UgcProductInput;
  script: UgcScriptInput;
  settings: UgcWorkflowSettings;
  promptPack: UgcAgentPromptPack;
  overrideInstructions?: string;
};

export type UgcScriptBeat = {
  id: string;
  startSecond: number;
  endSecond: number;
  text: string;
  delivery: string;
  visualCue: string;
};

export type UgcScriptOption = {
  id: string;
  title: string;
  rationale: string;
  hook: string;
  cta: string;
  dialogue: string;
  estimatedSeconds: number;
  beats: UgcScriptBeat[];
};

export type UgcAvatarOption = {
  id: string;
  label: string;
  persona: string;
  wardrobe: string;
  castingRationale: string;
  voiceStyle: string;
};

export type UgcSceneVariation = {
  id: string;
  title: string;
  summary: string;
  environment: string;
  avatarId: string;
  camera: string;
  lighting: string;
  prompt: string;
};

export type UgcDialogueClipPlan = {
  id: string;
  index: number;
  startSecond: number;
  endSecond: number;
  spokenText: string;
  objective: string;
  movement: string;
  camera: string;
  prompt: string;
};

export type UgcBrollImagePlan = {
  id: string;
  index: number;
  title: string;
  objective: string;
  angle: string;
  lens: string;
  lighting: string;
  withoutHuman: boolean;
  prompt: string;
};

export type UgcBrollClipPlan = {
  id: string;
  index: number;
  imagePlanId: string;
  title: string;
  durationSeconds: number;
  prompt: string;
};

export type UgcApprovalGate = {
  id: UgcStageId;
  label: string;
  required: boolean;
  reason: string;
};

export type UgcArchitectureAgent = {
  id: string;
  name: string;
  responsibility: string;
  inputs: string[];
  outputs: string[];
  systemPrompt: string;
};

export type UgcWorkflowPlan = {
  productAnalysis: string;
  selectedScriptId: string;
  scriptOptions: UgcScriptOption[];
  avatarOptions: UgcAvatarOption[];
  sceneVariations: UgcSceneVariation[];
  dialogueClips: UgcDialogueClipPlan[];
  bRollImagePlans: UgcBrollImagePlan[];
  bRollClipPlans: UgcBrollClipPlan[];
  approvalGates: UgcApprovalGate[];
  architecture: {
    agents: UgcArchitectureAgent[];
    notes: string[];
  };
  summary: {
    estimatedDurationSeconds: number;
    totalDialogueClips: number;
    totalBrollClips: number;
    sceneVariationCount: number;
  };
};

export const DEFAULT_UGC_WORKFLOW_SETTINGS: UgcWorkflowSettings = {
  safeMode: "safe",
  dialogueSeconds: 20,
  clipDurationSeconds: 5,
  sceneVariationCount: 4,
  bRollClipCount: 4,
  imageModelId: "nanobanana-2",
  videoModelId: "kling-3.0",
  imageAspectRatio: "9:16",
  imageResolution: "2K",
  videoAspectRatio: "9:16",
  videoDurationSeconds: 5,
  videoSound: false,
};

export const DEFAULT_UGC_PROMPT_PACK: UgcAgentPromptPack = {
  strategist:
    "You are the Script Strategist agent for direct-response UGC ads. Write short, conversational dialogue that sounds native to creator content, fits the requested runtime, leads with a hook in the first three seconds, keeps every line shootable by a single on-camera talent, and ends with a clear CTA.",
  sceneArchitect:
    "You are the Scene Architect agent. Analyze the chosen script and product to cast the most credible avatar, wardrobe, prop styling, and environment. Every scene must feel commercially usable, product-forward, 9:16 first, and coherent enough to support both dialogue and b-roll variants.",
  dialogueDirector:
    "You are the Dialogue Director agent. Split the approved script into contiguous 5-second clip prompts. Preserve the exact spoken words, add natural gestures, expression, and camera movement, and keep continuity across clips so they can be stitched in order without visual drift.",
  bRollDirector:
    "You are the B-roll Director agent. Derive supporting shots from the approved base scene and script. Generate alternate angles, detail shots, before/after states, empty-room variants, and product-only coverage that make editorial sense and can cut around the dialogue track.",
  safetyCoordinator:
    "You are the Safe Mode coordinator. When approvals are required, summarize what changed, wait for the user's explicit approval or disapproval, and treat the user's latest corrective instruction as the highest-priority override for the next action.",
};
