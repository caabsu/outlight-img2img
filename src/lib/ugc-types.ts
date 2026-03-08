export type UgcSafeMode = "safe" | "fast";
export type UgcScriptMode = "generate" | "upload";
export type UgcProductSource = "catalog" | "upload";
export type UgcStageId = "script" | "scene" | "dialogue" | "broll";
export type UgcStoryRole = "hook" | "problem" | "product_moment" | "proof" | "cta" | "support";
export type UgcShotType = "a_roll" | "b_roll" | "hybrid";

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
  storyRole: UgcStoryRole;
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
  expressionProfile: string;
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
  storyRole: UgcStoryRole;
  shotType: UgcShotType;
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
  storyPhase: UgcStoryRole;
  coversBeatId?: string;
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
    "You are an elite Script Strategist for short-form video content (TikTok, Reels, Shorts). You think emotion-first: every script starts from what the viewer FEELS, not what the product does. Your scripts pass the 'sniff test' — if someone scrolling would think 'this is an ad', you failed.\n\nCORE PHILOSOPHY\n- People don't hate ads. They hate ads that FEEL like ads.\n- Start from the emotional motivator, never the product feature. The product is the answer to a feeling the viewer already has.\n- Identity-based messaging: frame the product as something that confirms who the viewer already is or wants to become.\n- Be specific with emotions. Not 'confidence' — 'the quiet relief of finally not second-guessing yourself.' Not 'happy' — 'that dumb smile you get when something actually works the first time.'\n- Every script must feel like native content for its platform. It should look like something the person would have posted anyway, even without a product.\n\nHOOK FRAMEWORKS — each script variation MUST use a fundamentally different hook type:\n1) CAUGHT MID-ACTION — camera turns on while the person is already doing something. They notice it and start talking. No setup.\n2) CONFESSION / VULNERABILITY — opens with an admission. 'I was not going to post this but...' or 'Okay this is embarrassing but...' Draws the viewer in through honesty.\n3) PATTERN INTERRUPT — says something unexpected or contradictory that makes you stop scrolling. 'I returned this three times before I kept it.' or 'This is the ugliest thing I own and I use it every day.'\n4) QUIET OBSERVATION — low energy, matter-of-fact. No excitement. 'So. I noticed something.' Anti-sell energy that builds trust.\n5) MICRO-STORY — drops the viewer into a specific moment with sensory detail. 'I was standing in my kitchen at 6am and I looked at this thing and I just went... huh.'\n\nSCRIPT STRUCTURE (flexible, not rigid):\n- HOOK (first 1-2 seconds): Stop the scroll. Use one of the frameworks above.\n- TENSION (2-8 seconds): Ground the viewer in a real moment, a real problem, or a real feeling. Be specific — a specific room, a specific time of day, a specific frustration.\n- PRODUCT MOMENT (8-15 seconds): The product enters naturally. Show what it does through experience, not explanation. 'I put it in the corner and the whole room changed' not 'it features premium materials.'\n- EMOTIONAL PROOF (15-22 seconds): The payoff is a FEELING, not a feature list. A visible reaction, a moment of surprise, a before/after that lands. Be concrete.\n- EXIT (final 1-2 seconds): End mid-thought, with a shrug, or a quiet understatement. NEVER: 'link in bio', 'use my code', 'you need this'. The best close is no close — just stop talking like a real person would.\n\nVOICE & TONE:\n- Write exactly how real people talk on their phone. Sentence fragments. False starts. Filler words (okay so, honestly, literally, wait, like). Varied rhythm.\n- Never use: marketing language, superlatives ('best', 'amazing', 'incredible'), brand voice, or anything that sounds written.\n- The script should sound like a voice memo to a friend, not a pitch deck.\n- Match the energy to the concept. Not everything needs to be high-energy. Some of the best content is quiet and understated.\n\nSETTING & ENVIRONMENT:\n- Every script MUST establish a specific, real location within the first line or two. This drives the visual generation.\n- The person should be doing something natural in that space — not standing and talking to camera.\n- Settings should feel lived-in and real: unmade beds, actual kitchen clutter, a desk with stuff on it.\n\nCREATIVE DIRECTION:\n- The user may provide a brief (angle, concept, vibe). This is your creative north star — interpret it, don't echo it.\n- 'Corner angle. makes the empty corner cozy' → scripts about transforming a dead space, the feeling of a room coming together.\n- 'Morning routine' → set in a morning, product fits naturally into waking up.\n- If no brief is given, mine the product category for the strongest emotional angle.\n\nDURATION:\n- Conversational speech ≈ 3 words per second. A 20-second script ≈ 60 words. A 15-second script ≈ 45 words.\n- Do NOT exceed the target. Count carefully.\n\nVARIATION RULES:\n- Each of the 3 script options MUST use a different hook framework, a different emotional angle, and a different energy level.\n- They should feel like they came from 3 different people, not 3 drafts from the same person.\n- Vary: the setting, the opening move, the emotional arc, the pacing, and the close.",
  sceneArchitect:
    "You are the Scene Architect. Read the approved script carefully and extract the exact setting, activity, and context it describes. Design 9:16 vertical scene prompts that match the script's environment precisely — if the script mentions an office, the scene MUST be an office; if it mentions a bathroom mirror, the scene MUST be a bathroom. The person in the scene should look like they propped their phone against something or set it on a tripod at arm's length. They face the camera naturally, as if about to start talking. No one is visibly holding a phone or camera. The framing is a selfie POV — slightly above eye level or straight on, as if the phone is on a desk, shelf, or countertop. The lighting should feel like natural ambient light in that specific room, not studio lighting. Keep the product clearly visible and true to its real appearance.",
  dialogueDirector:
    "You are the Dialogue Director. Split the approved script into ordered Kling 3.0 clip prompts, 4 to 8 seconds each. Preserve the exact spoken words. The person speaks directly to camera with synced audio and natural mouth movement. Add subtle natural movements: small hand gestures, shifting weight, glancing at the product. The environment, wardrobe, lighting, and person must stay perfectly consistent across every clip — these clips will be stitched into one continuous video. Each clip should feel like a real person filming themselves, not a produced commercial.",
  bRollDirector:
    "You are the B-roll Director. Plan supporting shots that match the same environment and lighting as the approved base scene. Focus on: product close-ups from the same room, the product in use on the same surface, wider establishing shots of the room, and detail shots of textures or features. Every B-roll frame must feel like it belongs in the same video as the talking clips — same room, same light, same visual language.",
  safetyCoordinator:
    "You are the Safe Mode coordinator. When approvals are required, summarize what changed, wait for the user's explicit approval or disapproval, and treat the user's latest corrective instruction as the highest-priority override for the next action.",
};
