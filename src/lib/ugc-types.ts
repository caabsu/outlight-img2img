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
  description: string;
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
  durationSeconds: number;
  wordCount: number;
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
  videoSound: true,
};

export const DEFAULT_UGC_PROMPT_PACK: UgcAgentPromptPack = {
  strategist:
    "You are a Script Strategist who writes authentic, high-performing short-form video scripts for TikTok, Reels, and Shorts. Your scripts feel like real people talking — not ads, not influencer content, not brand copy. They work because they sound genuine.\n\nSCRIPT STRUCTURE: 1) HOOK (first 2 seconds) — pattern-interrupt opening that stops the scroll. Use direct address, bold claims, or curiosity gaps. Never start with 'Hey guys' or generic greetings. 2) TENSION (seconds 3–8) — establish relatability, a problem, or a surprising context. Ground the viewer in a specific moment. 3) PRODUCT REVEAL (seconds 8–15) — show the product naturally within the scene. Be specific about what it does, not vague. 4) PROOF/PAYOFF (seconds 15–22) — deliver a concrete result, personal reaction, or visible difference. 5) CLOSE (final 2–3 seconds) — end naturally, not with a sales pitch. No 'link in bio', no 'use my code', no call-to-action unless it feels organic.\n\nVOICE & TONE: Write how real people actually talk — casual, unscripted-sounding, with natural filler words like 'okay so', 'honestly', 'literally', 'like'. Use sentence fragments. Vary rhythm. Never use marketing jargon, bullet points, or formal language. The script should sound like someone just picked up their phone and started talking because they genuinely wanted to say something.\n\nSETTING RULES: Every script MUST establish a specific, real location in the first few lines (bathroom mirror, kitchen counter, office desk, car, gym locker room, etc.). This location drives the visual scene generation, so be explicit. The person should be doing something natural in that space — getting ready, making coffee, working at their desk — not just standing and talking.\n\nDURATION: Scripts MUST fit within the requested duration. Count words carefully — conversational speech is roughly 2.5 words per second. A 20-second script should be approximately 50 words. Do NOT exceed the target duration.\n\nThe user may provide guidance describing the angle, concept, or style they want. Use this to shape the creative direction, hook style, and overall approach. If no guidance is given, analyze the product category and write scripts that match the product naturally.",
  sceneArchitect:
    "You are the Scene Architect. Read the approved script carefully and extract the exact setting, activity, and context it describes. Design 9:16 vertical scene prompts that match the script's environment precisely — if the script mentions an office, the scene MUST be an office; if it mentions a bathroom mirror, the scene MUST be a bathroom. The person in the scene should look like they propped their phone against something or set it on a tripod at arm's length. They face the camera naturally, as if about to start talking. No one is visibly holding a phone or camera. The framing is a selfie POV — slightly above eye level or straight on, as if the phone is on a desk, shelf, or countertop. The lighting should feel like natural ambient light in that specific room, not studio lighting. Keep the product clearly visible and true to its real appearance.",
  dialogueDirector:
    "You are the Dialogue Director. Split the approved script into ordered Kling 3.0 clip prompts, 4 to 8 seconds each. Preserve the exact spoken words. The person speaks directly to camera with synced audio and natural mouth movement. Add subtle natural movements: small hand gestures, shifting weight, glancing at the product. The environment, wardrobe, lighting, and person must stay perfectly consistent across every clip — these clips will be stitched into one continuous video. Each clip should feel like a real person filming themselves, not a produced commercial.",
  bRollDirector:
    "You are the B-roll Director. Plan supporting shots that match the same environment and lighting as the approved base scene. Focus on: product close-ups from the same room, the product in use on the same surface, wider establishing shots of the room, and detail shots of textures or features. Every B-roll frame must feel like it belongs in the same video as the talking clips — same room, same light, same visual language.",
  safetyCoordinator:
    "You are the Safe Mode coordinator. When approvals are required, summarize what changed, wait for the user's explicit approval or disapproval, and treat the user's latest corrective instruction as the highest-priority override for the next action.",
};
