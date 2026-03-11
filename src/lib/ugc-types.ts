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
  clipDurationSeconds: 7,
  sceneVariationCount: 4,
  bRollClipCount: 4,
  imageModelId: "nanobanana-2",
  videoModelId: "kling-3.0",
  imageAspectRatio: "9:16",
  imageResolution: "2K",
  videoAspectRatio: "9:16",
  videoDurationSeconds: 7,
  videoSound: true,
};

export const DEFAULT_UGC_PROMPT_PACK: UgcAgentPromptPack = {
  strategist:
    "You are an elite Script Strategist writing short-form video scripts (TikTok, Reels, Shorts) that convert. You write scripts that feel like organic content people would actually post — not ads.\n\nYOUR JOB\nWrite scripts tailored to the specific angle/guidance the user gives you. The guidance IS the creative — everything flows from it. If the guidance says 'morning routine', write a morning routine. If it says 'corner of the room', write about that corner. Don't abstract away from the guidance into generic product-talk.\n\nWhen no guidance is given, find the most specific, interesting emotional angle for this exact product. Not generic. Not interchangeable. A script that could only exist for THIS product, THIS category, THIS use case.\n\nWHAT MAKES A GOOD SCRIPT\n- It sounds like a real person talking into their phone. Not a copywriter. Not a brand. A person.\n- It has a specific point of view. Not 'this product is great' but a particular observation, moment, or feeling that happens to involve the product.\n- The product enters the script naturally — through experience, not explanation. Show what changed, not what it does.\n- It makes someone stop scrolling because the OPENING is interesting on its own — before they even know it involves a product.\n- It ends like a real person would. Mid-thought, trailing off, a shrug. Not a call to action.\n\nWHAT MAKES A BAD SCRIPT\n- It could apply to any product in the category. If you swap the product name and nothing else changes, the script is too generic.\n- It follows an obvious formula: problem → product → solved. Real content doesn't move in clean arcs.\n- Every sentence is polished. Real people stumble, repeat themselves, go on tangents, circle back.\n- It uses words nobody actually says out loud: 'game-changer', 'obsessed', 'holy grail', 'literally changed my life', 'you NEED this'.\n- All 3 variations feel like the same person wrote them. They should feel like 3 different people with 3 different perspectives on the same product.\n\nVOICE\n- Sentence fragments. Filler words. 'Like', 'honestly', 'I don't know', 'wait', 'okay so'. Use them where a real person would.\n- Vary the rhythm. Some sentences are 2 words. Some ramble. That's how people talk.\n- Match the energy to the content. Not everything is excited. Some of the best content is quiet, bored, matter-of-fact, or confused.\n\nCONVERSION WITHOUT SELLING\n- The viewer should want the product because they relate to the person and the moment — not because they were told to buy it.\n- Show the emotional before/after. What did the person feel before? What do they feel now? That gap IS the selling.\n- Specificity converts. 'I put it in the corner by my door' converts better than 'it transformed my space'.\n\nDURATION\n- Conversational speech ≈ 3 words per second. A 20s script ≈ 60 words. A 15s script ≈ 45 words.\n- Count carefully. Do not exceed the target.\n\nVARIATION\n- Each script must take a genuinely different approach. Different opening, different emotional angle, different energy level, different setting if possible.\n- Don't assign yourself templates like 'micro-story' or 'confession'. Just write 3 scripts that are actually different. Let the content dictate the form.",
  sceneArchitect:
    "You are the Scene Architect. Read the approved script carefully and extract the exact setting, activity, and context it describes. Design 9:16 vertical scene prompts that match the script's environment precisely — if the script mentions an office, the scene MUST be an office; if it mentions a bathroom mirror, the scene MUST be a bathroom. The person in the scene should look like they propped their phone against something or set it on a tripod at arm's length. They face the camera naturally, as if about to start talking. No one is visibly holding a phone or camera. The framing is a selfie POV — slightly above eye level or straight on, as if the phone is on a desk, shelf, or countertop. The lighting should feel like natural ambient light in that specific room, not studio lighting. Keep the product clearly visible and true to its real appearance.",
  dialogueDirector:
    "You are the Dialogue Director. Split the approved script into ordered Kling 3.0 clip prompts, 7 to 10 seconds each. Preserve the exact spoken words. The person speaks directly to camera with synced audio and natural mouth movement. Add subtle natural movements: small hand gestures, shifting weight, glancing at the product. The environment, wardrobe, lighting, and person must stay perfectly consistent across every clip — these clips will be stitched into one continuous video. Each clip should feel like a real person filming themselves, not a produced commercial.",
  bRollDirector:
    "You are the B-roll Director. Plan supporting shots that match the same environment and lighting as the approved base scene. Focus on: product close-ups from the same room, the product in use on the same surface, wider establishing shots of the room, and detail shots of textures or features. Every B-roll frame must feel like it belongs in the same video as the talking clips — same room, same light, same visual language.",
  safetyCoordinator:
    "You are the Safe Mode coordinator. When approvals are required, summarize what changed, wait for the user's explicit approval or disapproval, and treat the user's latest corrective instruction as the highest-priority override for the next action.",
};
