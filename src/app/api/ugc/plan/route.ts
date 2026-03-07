export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import {
  DEFAULT_UGC_PROMPT_PACK,
  type UgcAgentPromptPack,
  type UgcApprovalGate,
  type UgcArchitectureAgent,
  type UgcAvatarOption,
  type UgcBrollClipPlan,
  type UgcBrollImagePlan,
  type UgcDialogueClipPlan,
  type UgcPlanRequest,
  type UgcSceneVariation,
  type UgcScriptBeat,
  type UgcScriptInput,
  type UgcScriptOption,
  type UgcWorkflowPlan,
} from "@/lib/ugc-types";

const MAX_SCENE_VARIATIONS = 8;
const MAX_BROLL_CLIPS = 8;
const REMOTE_PLANNER_TIMEOUT_MS = 55000;
const FAST_TALKING_WORDS_PER_SECOND = 2.85;
const MIN_DIALOGUE_CLIP_SECONDS = 4;
const MAX_DIALOGUE_CLIP_SECONDS = 8;

type UgcAnthropicCreativeScript = {
  id: string;
  title: string;
  rationale: string;
  hook: string;
  cta: string;
  dialogue: string;
};

type UgcAnthropicCreativeAvatar = {
  id: string;
  label: string;
  persona: string;
  wardrobe: string;
  castingRationale: string;
  voiceStyle: string;
};

type UgcAnthropicCreativeScene = {
  id: string;
  title: string;
  summary: string;
  environment: string;
  avatarId: string;
  camera: string;
  lighting: string;
};

type UgcAnthropicCreativeBroll = {
  id: string;
  title: string;
  objective: string;
  angle: string;
  lens: string;
  lighting: string;
  withoutHuman: boolean;
};

type UgcAnthropicCreativePlan = {
  productAnalysis: string;
  selectedScriptId: string;
  scriptOptions: UgcAnthropicCreativeScript[];
  avatarOptions: UgcAnthropicCreativeAvatar[];
  sceneVariations: UgcAnthropicCreativeScene[];
  bRollImagePlans: UgcAnthropicCreativeBroll[];
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanText(value: string | undefined | null) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function finishSentence(value: string | undefined | null) {
  const trimmed = cleanText(value);
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function splitSentences(text: string) {
  const normalized = cleanText(text);
  if (!normalized) return [];
  const parts = normalized
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : [normalized];
}

function countWords(text: string) {
  return cleanText(text).split(/\s+/).filter(Boolean).length;
}

function estimateDurationSeconds(text: string, fallbackSeconds: number) {
  const words = countWords(text);
  if (!words) return fallbackSeconds;
  return clamp(Math.round(words / 2.5), 5, 60);
}

function buildBriefFocusLines(brief: string, productName: string, category: string) {
  const normalized = cleanText(brief).toLowerCase();
  const focus = {
    trust: /(testimonial|recommend|review|personal|story|routine)/.test(normalized),
    transformation: /(before|after|transform|difference|change|result)/.test(normalized),
    demo: /(demo|show|visual|proof|on camera|see|angle)/.test(normalized),
    premium: /(premium|luxury|elevated|editorial|high-end)/.test(normalized),
    office: /(office|desk|work|meeting|startup)/.test(normalized),
    lifestyle: /(lifestyle|daily|morning|night|routine)/.test(normalized),
  };

  return [
    focus.transformation
      ? "Show the change quickly and make the payoff feel obvious on camera."
      : focus.office
        ? "Frame it like something that fits naturally into a real work setup."
        : focus.demo
          ? "Lead with the clearest visual proof instead of overexplaining it."
          : "Show the payoff fast and keep the message easy to believe.",
    focus.trust
      ? "Keep the tone personal and specific so it lands like a real recommendation."
      : focus.premium
        ? "Make it feel polished but still native to creator footage."
        : focus.lifestyle
          ? "Make it feel like a natural part of a real routine."
          : "Make it feel like something the creator genuinely uses.",
    focus.premium
      ? "Use concise premium-sounding wording without turning it into brand copy."
      : focus.demo
        ? "Build around one clear demo moment and close with a simple next step."
        : `Keep ${productName} easy to picture in a real ${category || "product"} use case and end with a clean CTA.`,
  ];
}

function makeId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function inferEnvironment(scriptText: string, category: string) {
  const corpus = `${scriptText} ${category}`.toLowerCase();
  if (/(office|desk|meeting|slack|presentation|zoom|workday|founder|startup|co-?working)/.test(corpus)) {
    return "sunlit modern office with a clean desk, laptop and notebook visible, large window with natural daylight, lived-in startup feel with plants and coffee mug";
  }
  if (/(bathroom|shower|mirror|skincare|serum|cream|face|moisturiz|cleanser|wash|vanity)/.test(corpus)) {
    return "bright modern bathroom at the vanity mirror, soft natural daylight from a window, clean marble or white countertop with a few real toiletries, bathroom mirror reflecting warm light";
  }
  if (/(kitchen|cook|coffee|breakfast|drink|snack|meal|smoothie|supplement|vitamin)/.test(corpus)) {
    return "warm kitchen counter with morning light through the window, clean countertop with a cutting board, mugs, and real kitchen items visible, homey and lived-in";
  }
  if (/(gym|workout|run|protein|fitness|recovery|exercise|sweat|yoga|stretch)/.test(corpus)) {
    return "modern home gym or fitness studio corner, matte equipment in background, rubber flooring, directional side light from a window, post-workout energy";
  }
  if (/(car|commute|travel|airport|carry-on|road|drive)/.test(corpus)) {
    return "parked car interior, soft natural light through the windshield, clean dashboard, phone propped on the dash for a selfie angle";
  }
  if (/(bedroom|morning|night|routine|pillow|bed|wake|sleep)/.test(corpus)) {
    return "cozy bedroom with an unmade bed in the background, soft morning light from curtains, nightstand with a lamp and personal items, relaxed atmosphere";
  }
  if (/(living|couch|sofa|lounge|tv|relax|chill|home)/.test(corpus)) {
    return "stylish living room with a sofa and throw pillows in the background, warm ambient light, plants, bookshelf or art on the wall, comfortable and real";
  }
  if (/(outdoor|garden|patio|balcony|park|walk|sun|nature)/.test(corpus)) {
    return "outdoor patio or balcony with greenery, natural sunlight, comfortable seating visible, warm golden-hour feel";
  }
  return "well-lit apartment with natural window light, a few personal items visible in the background, clean but lived-in, warm and inviting atmosphere";
}

function buildScriptBeats(dialogue: string, requestedSeconds: number): UgcScriptBeat[] {
  const sentences = splitSentences(dialogue);
  const totalWords = Math.max(1, countWords(dialogue));
  let cursor = 0;

  return sentences.map((sentence, index) => {
    const words = Math.max(1, countWords(sentence));
    const allocation = clamp(Math.round((words / totalWords) * requestedSeconds), 2, requestedSeconds);
    const startSecond = cursor;
    const endSecond =
      index === sentences.length - 1
        ? requestedSeconds
        : clamp(startSecond + allocation, startSecond + 1, requestedSeconds);
    cursor = endSecond;

    return {
      id: makeId("beat", index),
      startSecond,
      endSecond,
      text: sentence,
      delivery:
        index === 0
          ? "Direct-to-camera hook with urgency."
          : index === sentences.length - 1
            ? "Confident close that lands the CTA."
            : "Conversational proof point with natural creator pacing.",
      visualCue:
        index === 0
          ? "Lean into frame and make immediate eye contact."
          : index === sentences.length - 1
            ? "Hold the product near chest level for the CTA."
            : "Use a small hand gesture while keeping the product visible.",
    };
  });
}

function splitDialogueIntoClips(dialogue: string, totalSeconds: number, clipDurationSeconds: number) {
  const sentences = splitSentences(dialogue);
  const preferredSeconds = clamp(clipDurationSeconds, MIN_DIALOGUE_CLIP_SECONDS, 7);
  const targetWordsPerClip = Math.max(11, Math.round(FAST_TALKING_WORDS_PER_SECOND * preferredSeconds));
  const maxWordsPerClip = Math.max(targetWordsPerClip + 5, 18);

  if (sentences.length === 0) {
    const fallbackDuration = clamp(
      Math.round(Math.max(totalSeconds, MIN_DIALOGUE_CLIP_SECONDS)),
      MIN_DIALOGUE_CLIP_SECONDS,
      MAX_DIALOGUE_CLIP_SECONDS
    );
    return [
      {
        id: makeId("clip-segment", 0),
        text: cleanText(dialogue),
        durationSeconds: fallbackDuration,
        wordCount: countWords(dialogue),
      },
    ];
  }

  const clips: Array<{ id: string; text: string; wordCount: number }> = [];
  let current: string[] = [];
  let currentWords = 0;

  sentences.forEach((sentence) => {
    const words = countWords(sentence);
    if (current.length > 0 && (currentWords >= targetWordsPerClip || currentWords + words > maxWordsPerClip)) {
      clips.push({
        id: makeId("clip-segment", clips.length),
        text: current.join(" "),
        wordCount: currentWords,
      });
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += words;
  });

  if (current.length > 0) {
    clips.push({
      id: makeId("clip-segment", clips.length),
      text: current.join(" "),
      wordCount: currentWords,
    });
  }

  while (clips.length > 1 && clips[clips.length - 1].wordCount < 7) {
    const tail = clips.pop();
    if (!tail) break;
    const previous = clips[clips.length - 1];
    previous.text = `${previous.text} ${tail.text}`.trim();
    previous.wordCount += tail.wordCount;
  }

  return clips.map((clip, index) => ({
    id: clip.id || makeId("clip-segment", index),
    text: clip.text,
    wordCount: clip.wordCount,
    durationSeconds: clamp(
      Math.round(clip.wordCount / FAST_TALKING_WORDS_PER_SECOND),
      MIN_DIALOGUE_CLIP_SECONDS,
      MAX_DIALOGUE_CLIP_SECONDS
    ),
  }));
}

function inferSettingForScript(theme: string, category: string) {
  const corpus = `${theme} ${category}`.toLowerCase();
  if (/(office|work|desk|startup|founder|meeting|b2b)/.test(corpus)) return { place: "at my desk", room: "office" };
  if (/(bathroom|skincare|beauty|serum|face|cream|wash)/.test(corpus)) return { place: "at the mirror", room: "bathroom" };
  if (/(kitchen|cook|coffee|morning|breakfast|supplement|vitamin|drink)/.test(corpus)) return { place: "in the kitchen", room: "kitchen" };
  if (/(gym|fitness|workout|protein|recovery)/.test(corpus)) return { place: "after my workout", room: "gym" };
  if (/(bedroom|morning routine|night routine|sleep)/.test(corpus)) return { place: "in my room", room: "bedroom" };
  if (/(outdoor|walk|nature|garden)/.test(corpus)) return { place: "outside", room: "patio" };
  return { place: "at home", room: "living room" };
}

function buildGeneratedScripts(input: UgcScriptInput, productName: string, category: string, knowledge: string) {
  const theme = cleanText(input.theme) || "creator testimonial";
  const ctaSentence = "Link is in my bio.";
  const knowledgeHint = knowledge ? ` ${finishSentence(knowledge)}` : "";
  const categoryLabel = category || "product";
  const setting = inferSettingForScript(theme, category);
  const briefFocusLines = buildBriefFocusLines(input.description, productName, category);

  const variants = [
    {
      title: "Quick Take",
      rationale: `Fast, punchy ${theme} script set ${setting.place}. Gets to the point in the first line and keeps moving.`,
      hook: `Okay so I have been using ${productName} for about two weeks now and I need to talk about it.`,
      dialogue:
        `Okay so I have been using ${productName} for about two weeks now and I need to talk about it. I am ${setting.place} right now and I literally just used it. ${briefFocusLines[0]} Honestly I was skeptical at first but the difference is noticeable. ${briefFocusLines[1]} If you have been looking for a good ${categoryLabel}, this is the one. ${ctaSentence}${knowledgeHint}`.trim(),
    },
    {
      title: "Honest Review",
      rationale: `Personal creator story angle set ${setting.place} — feels like a genuine recommendation, not an ad.`,
      hook: `I was not planning on making this video but I keep getting asked about this ${categoryLabel}.`,
      dialogue:
        `I was not planning on making this video but I keep getting asked about this ${categoryLabel}. So here is my honest take on ${productName}. I have been using it ${setting.place} and the thing that surprised me is how quickly I noticed a difference. ${briefFocusLines[1]} It is not one of those things you buy and forget about. I actually reach for it every day now. ${briefFocusLines[0]} If you want to try it yourself, ${ctaSentence}${knowledgeHint}`.trim(),
    },
    {
      title: "Show Don't Tell",
      rationale: `Visual-first ${theme} script where the creator demonstrates the product ${setting.place} with proof.`,
      hook: `Let me show you why I switched to ${productName}.`,
      dialogue:
        `Let me show you why I switched to ${productName}. I am ${setting.place} and I am going to show you exactly what I mean. ${briefFocusLines[2]} See? That is the difference. ${briefFocusLines[1]} I have tried a lot of ${categoryLabel} options and this is the one that actually delivers. You can check it out, ${ctaSentence}${knowledgeHint}`.trim(),
    },
  ];

  return variants.map((variant, index) => {
    const estimatedSeconds = estimateDurationSeconds(variant.dialogue, input.totalSeconds);
    return {
      id: makeId("script", index),
      title: variant.title,
      rationale: variant.rationale,
      hook: variant.hook,
      cta: ctaSentence,
      dialogue: variant.dialogue,
      estimatedSeconds,
      beats: buildScriptBeats(variant.dialogue, estimatedSeconds),
    } satisfies UgcScriptOption;
  });
}

function buildAvatarOptions(productName: string, theme: string, category: string): UgcAvatarOption[] {
  const themeLabel = cleanText(theme) || "creator testimonial";
  return [
    {
      id: "avatar-1",
      label: "Credible Creator",
      persona: `A relatable creator who feels right for a ${themeLabel} ad and speaks with practical confidence straight to camera.`,
      wardrobe: "Clean monochrome top, simple jewelry, soft editorial grooming, premium-but-real styling.",
      castingRationale: `Best default option for ${productName} because it balances trust, polish, and conversion intent.`,
      voiceStyle: "Warm, direct, slightly breathy creator delivery.",
    },
    {
      id: "avatar-2",
      label: "Expert Operator",
      persona: `A sharper authority figure who makes ${category || "the product"} feel validated and high-performing.`,
      wardrobe: "Structured knit, tailored layers, neat hair, understated premium accessories.",
      castingRationale: "Useful when the brand needs more technical credibility, premium positioning, or B2B-adjacent authority.",
      voiceStyle: "Clear, assured, concise delivery with founder energy.",
    },
    {
      id: "avatar-3",
      label: "Lifestyle Aspirational",
      persona: "A polished lifestyle face who can sell the result as much as the product itself.",
      wardrobe: "Soft luxury textures, directional outer layer, tasteful makeup, camera-ready skin finish.",
      castingRationale: "Strong when the ad needs to feel trend-forward, premium, or high-LTV social first.",
      voiceStyle: "Bright, persuasive, on-trend creator rhythm.",
    },
  ];
}

function buildSceneVariations(
  script: UgcScriptOption,
  avatarOptions: UgcAvatarOption[],
  productName: string,
  productAppearance: string,
  settings: UgcPlanRequest["settings"],
  category: string,
  overrides: UgcAnthropicCreativeScene[] = []
): UgcSceneVariation[] {
  const baseEnvironment = inferEnvironment(script.dialogue, category);
  const cameraDirections = [
    "handheld chest-up framing with subtle push-in",
    "tripod eye-level framing with product held near lens",
    "three-quarter framing from a slight corner angle",
    "tight medium shot with shallow depth and foreground practicals",
    "over-the-desk vertical framing with confident negative space",
    "slightly lower camera angle for more authority and presence",
  ];
  const lightingDirections = [
    "soft side window light with gentle wrap on skin",
    "neutral daylight with a polished bounce fill",
    "warm golden practicals balanced with clean daylight",
    "editorial softbox treatment that still feels native to UGC",
  ];
  const sceneCount = clamp(settings.sceneVariationCount, 1, MAX_SCENE_VARIATIONS);

  return Array.from({ length: sceneCount }, (_, index) => {
    const override = overrides[index];
    const avatar =
      avatarOptions.find((option) => option.id === cleanText(override?.avatarId)) ||
      avatarOptions[index % avatarOptions.length];
    const camera = cleanText(override?.camera) || cameraDirections[index % cameraDirections.length];
    const lighting = cleanText(override?.lighting) || lightingDirections[index % lightingDirections.length];
    const title = cleanText(override?.title) || `Base Scene ${index + 1}`;
    const summary =
      cleanText(override?.summary) ||
      index === 0
        ? "Most conversion-safe version with clean product visibility and a direct creator setup."
        : index === 1
          ? "Slightly more premium framing with more deliberate camera language."
          : index === 2
            ? "Warmer, more lived-in take for higher social-native credibility."
            : "Alternate performance-safe variation that preserves continuity for clip batching.";
    const environment = cleanText(override?.environment) || baseEnvironment;

    return {
      id: makeId("scene", index),
      title,
      summary,
      environment,
      avatarId: avatar.id,
      camera,
      lighting,
      prompt: `9:16 ${settings.imageResolution} vertical UGC selfie-style photo of a real person about to film a creator video about ${productName}. The product (${productAppearance}) must be clearly visible and true to its real appearance. The person is ${avatar.label}: ${avatar.persona} Wardrobe: ${avatar.wardrobe}. SELFIE FRAMING: The shot looks like the person set their phone on a shelf, desk, or tripod at arm's length. The camera is at eye level or slightly above. The person faces the camera directly, relaxed and natural, as if about to start talking to their audience. No one is holding a phone or camera — hands are free or holding the product. ENVIRONMENT: ${environment}. This must match the script context: "${finishSentence(script.dialogue.slice(0, 200))}". Camera: ${camera}. Lighting: ${lighting} — natural to this specific room, not studio lighting. The overall feel should be an authentic creator selfie, not a produced photoshoot.`,
    };
  });
}

function buildDialogueClips(
  script: UgcScriptOption,
  productName: string,
  selectedEnvironment: string,
  settings: UgcPlanRequest["settings"]
): UgcDialogueClipPlan[] {
  const segments = splitDialogueIntoClips(
    script.dialogue,
    Math.max(script.estimatedSeconds, settings.dialogueSeconds),
    settings.clipDurationSeconds
  );
  const objectives = ["Hook", "Proof", "Demo", "CTA", "Reinforcement", "Close"];
  const movements = [
    "Lean slightly into frame, then settle into a natural chest-level hold of the product.",
    "Use one precise hand gesture and rotate the product toward camera.",
    "Shift weight once and point to a key product detail mid-line.",
    "Finish with a small nod and a product-forward CTA hold.",
  ];
  const cameras = [
    "steady handheld creator framing with a tiny natural sway",
    "locked eye-level framing with a subtle digital push",
    "tight medium vertical framing that favors face plus product",
    "slightly off-center framing so the product can occupy the lower third",
  ];

  return segments.map((segment, index) => {
    const priorDuration = segments
      .slice(0, index)
      .reduce((total, item) => total + item.durationSeconds, 0);
    const startSecond = priorDuration;
    const endSecond = startSecond + segment.durationSeconds;
    const objective = objectives[Math.min(index, objectives.length - 1)];
    const movement = movements[index % movements.length];
    const camera = cameras[index % cameras.length];
    return {
      id: makeId("dialogue-clip", index),
      index,
      startSecond,
      endSecond,
      durationSeconds: segment.durationSeconds,
      wordCount: segment.wordCount,
      spokenText: segment.text,
      objective,
      movement,
      camera,
      prompt: `Use the selected base scene as the starting image for a ${segment.durationSeconds}-second ${settings.videoAspectRatio} UGC video for ${productName}. The person in the image naturally speaks at a relatively fast but believable creator pace, with subtle and natural movements. They say this exact script: "${segment.text}". Keep synced spoken audio, accurate mouth movement, and continuity with the same avatar, wardrobe, room, product placement, and lighting. This clip should feel efficiently delivered, not slow or padded, and should cover the full line cleanly within ${segment.durationSeconds} seconds. Movement: ${movement} Camera behavior: ${camera}. Environment continuity: ${selectedEnvironment}. Objective: ${objective}. The result should feel like believable creator footage and cut cleanly with the clips before and after it.`,
    };
  });
}

function buildBrollImagePlans(
  script: UgcScriptOption,
  productName: string,
  productAppearance: string,
  settings: UgcPlanRequest["settings"],
  overrides: UgcAnthropicCreativeBroll[] = []
): UgcBrollImagePlan[] {
  const shotBlueprints = [
    {
      title: "Product Hero Insert",
      objective: "Show the product in a clean, high-retention hero angle that can open or punctuate a claim.",
      angle: "front three-quarter product angle",
      lens: "50mm commercial lens look",
      lighting: "polished daylight with crisp separation",
      withoutHuman: true,
    },
    {
      title: "Hand Interaction Detail",
      objective: "Show believable creator handling so the product feels tactile and real.",
      angle: "close-up hand-held interaction",
      lens: "85mm detail crop",
      lighting: "soft side light with clean highlights",
      withoutHuman: false,
    },
    {
      title: "Before / After Coverage",
      objective: "Create the empty-scene or alternate-state shot needed for transformation storytelling.",
      angle: "matching angle to the hero scene, slightly wider",
      lens: "35mm natural perspective",
      lighting: "same room lighting with controlled contrast",
      withoutHuman: true,
    },
    {
      title: "Feature Macro",
      objective: "Capture texture, finish, buttons, material, or formula detail for edit rhythm.",
      angle: "macro detail perspective",
      lens: "100mm macro",
      lighting: "specular micro-highlights with premium rolloff",
      withoutHuman: true,
    },
    {
      title: "Lifestyle Cutaway",
      objective: "Show the product in use in a wider contextual setup that supports the spoken proof.",
      angle: "wider lived-in environment cutaway",
      lens: "28mm creator-style wide lens",
      lighting: "ambient natural light with gentle practicals",
      withoutHuman: false,
    },
  ];

  const count = clamp(settings.bRollClipCount, 1, MAX_BROLL_CLIPS);

  return Array.from({ length: count }, (_, index) => {
    const shot = shotBlueprints[index % shotBlueprints.length];
    const override = overrides[index];
    const title = cleanText(override?.title) || shot.title;
    const objective = cleanText(override?.objective) || shot.objective;
    const angle = cleanText(override?.angle) || shot.angle;
    const lens = cleanText(override?.lens) || shot.lens;
    const lighting = cleanText(override?.lighting) || shot.lighting;
    const withoutHuman = typeof override?.withoutHuman === "boolean" ? override.withoutHuman : shot.withoutHuman;
    return {
      id: makeId("broll-image", index),
      index,
      title,
      objective,
      angle,
      lens,
      lighting,
      withoutHuman,
      prompt: `Create a ${settings.imageAspectRatio}, ${settings.imageResolution} starting frame for a B-roll clip about ${productName}. Match the approved room and preserve the exact product appearance: ${productAppearance}. Shot intent: ${objective}. Angle: ${angle}. Lens: ${lens}. Lighting: ${lighting}. ${
        withoutHuman
          ? "Remove the person unless hands are essential, and keep continuity with the same scene."
          : "If a person appears, keep them secondary and the product primary."
      } This image is a starting point for motion, not a final still, so give it clear movement potential and edit-ready composition. Reference the script claim: "${script.hook}"`,
    };
  });
}

function buildBrollClipPlans(
  imagePlans: UgcBrollImagePlan[],
  settings: UgcPlanRequest["settings"]
): UgcBrollClipPlan[] {
  return imagePlans.map((plan, index) => ({
    id: makeId("broll-clip", index),
    index,
    imagePlanId: plan.id,
    title: plan.title,
    durationSeconds: settings.clipDurationSeconds,
    prompt: `Use the approved B-roll start image. Create a ${settings.clipDurationSeconds}-second ${settings.videoAspectRatio} commercial B-roll clip. Objective: ${plan.objective}. Camera behavior should match ${plan.angle} with a ${plan.lens} feeling. Lighting continuity: ${plan.lighting}. Keep the motion clean, premium, and edit-ready for insertion between dialogue clips.`,
  }));
}

function buildApprovalGates(safeMode: UgcPlanRequest["settings"]["safeMode"]): UgcApprovalGate[] {
  const required = safeMode === "safe";
  return [
    {
      id: "script",
      label: "Approve script and downstream plan",
      required,
      reason: required
        ? "Safe mode pauses after planning so the user can redirect the workflow before any generation cost is incurred."
        : "Fast mode can continue immediately after planning.",
    },
    {
      id: "scene",
      label: "Approve selected base scene",
      required,
      reason: required
        ? "The selected scene becomes the continuity anchor for all dialogue and b-roll clips."
        : "Fast mode uses the first preferred scene without blocking.",
    },
    {
      id: "dialogue",
      label: "Approve dialogue clip batch",
      required,
      reason: required
        ? "Dialogue quality and sync issues are most expensive after render, so safe mode requests explicit review."
        : "Fast mode renders dialogue clips without manual confirmation.",
    },
    {
      id: "broll",
      label: "Approve B-roll package",
      required,
      reason: required
        ? "B-roll revisions often require explicit editorial direction, so the user can override shot priorities here."
        : "Fast mode completes B-roll automatically.",
    },
  ];
}

function buildArchitecture(promptPack: UgcAgentPromptPack, safeMode: UgcPlanRequest["settings"]["safeMode"]): {
  agents: UgcArchitectureAgent[];
  notes: string[];
} {
  const leadAgentPrompt = [promptPack.strategist, promptPack.sceneArchitect, promptPack.dialogueDirector]
    .filter(Boolean)
    .join("\n\n");

  return {
    agents: [
      {
        id: "agent-lead",
        name: "Lead Ad Agent",
        responsibility:
          "Owns the main ad path from script options to avatar direction, base scene planning, and ordered talking-clip prompts.",
        inputs: ["Product", "Duration", "Theme", "Description", "Knowledge notes", "Approved overrides"],
        outputs: ["Script options", "Avatar shortlist", "Base scene prompts", "Talking clip prompts"],
        systemPrompt: leadAgentPrompt,
      },
      {
        id: "agent-coverage",
        name: "Coverage Agent",
        responsibility:
          "Branches off after the base scene is chosen to generate alternate-angle B-roll start frames and supporting clip prompts.",
        inputs: ["Approved script", "Approved base scene", "Product appearance", "Edit needs", "User overrides"],
        outputs: ["B-roll image prompts", "B-roll clip prompts", "Coverage notes"],
        systemPrompt: promptPack.bRollDirector,
      },
      ...(safeMode === "safe"
        ? [
            {
              id: "agent-review",
              name: "Review Agent",
              responsibility:
                "Pauses the run at approval gates and treats the latest user correction as the top-priority instruction.",
              inputs: ["Stage status", "User approval", "Disapproval note", "Next-step override"],
              outputs: ["Approval holds", "Next-step overrides", "Revision instructions"],
              systemPrompt: promptPack.safetyCoordinator,
            } satisfies UgcArchitectureAgent,
          ]
        : []),
    ],
    notes: [
      "The lead ad agent handles script writing, casting, scene continuity, and the talking-head clip plan.",
      "The coverage agent stays separate so alternate angles and empty-scene cutaways can diverge without breaking the talking-head continuity.",
      "Dialogue rendering is image-to-video only, using the approved base scene as the continuity anchor for every 5-second batch with spoken audio enabled.",
      safeMode === "safe"
        ? "Safe mode inserts blocking approvals between planning, scene choice, talking clips, and coverage."
        : "Fast mode removes blocking approvals and executes the workflow sequentially.",
    ],
  };
}

function buildFallbackPlan(input: UgcPlanRequest): UgcWorkflowPlan {
  const productName = cleanText(input.product.name) || "the product";
  const category = cleanText(input.product.category) || "creator-friendly product";
  const productAppearance =
    cleanText(input.product.appearanceNotes) ||
    `${productName} should stay visually consistent with its real product form, premium materials, and original brand cues.`;

  const scriptOptions =
    input.script.mode === "upload" && cleanText(input.script.text)
      ? [
          {
            id: "script-1",
            title: "Provided Script",
            rationale: "Uses the exact user-supplied dialogue as the source of truth for downstream planning.",
            hook: splitSentences(input.script.text)[0] || input.script.text,
            cta: "Tap below to try it.",
            dialogue: cleanText(input.script.text),
            estimatedSeconds: estimateDurationSeconds(input.script.text, input.script.totalSeconds),
            beats: buildScriptBeats(
              cleanText(input.script.text),
              estimateDurationSeconds(input.script.text, input.script.totalSeconds)
            ),
          } satisfies UgcScriptOption,
        ]
      : buildGeneratedScripts(input.script, productName, category, input.knowledge);

  const selectedScript = scriptOptions[0];
  const avatarOptions = buildAvatarOptions(productName, input.script.theme || input.script.description, category);
  const sceneVariations = buildSceneVariations(
    selectedScript,
    avatarOptions,
    productName,
    productAppearance,
    input.settings,
    category
  );
  const dialogueClips = buildDialogueClips(
    selectedScript,
    productName,
    sceneVariations[0]?.environment || inferEnvironment(selectedScript.dialogue, category),
    input.settings
  );
  const bRollImagePlans = buildBrollImagePlans(selectedScript, productName, productAppearance, input.settings);
  const bRollClipPlans = buildBrollClipPlans(bRollImagePlans, input.settings);

  return {
    productAnalysis: `${productName} is being positioned as a ${category}. The workflow should preserve its real appearance, make it readable in vertical creator framing, and stage it in a way that supports both direct-to-camera dialogue and clean editorial B-roll. ${productAppearance}`,
    selectedScriptId: selectedScript.id,
    scriptOptions,
    avatarOptions,
    sceneVariations,
    dialogueClips,
    bRollImagePlans,
    bRollClipPlans,
    approvalGates: buildApprovalGates(input.settings.safeMode),
    architecture: buildArchitecture(input.promptPack, input.settings.safeMode),
    summary: {
      estimatedDurationSeconds: dialogueClips[dialogueClips.length - 1]?.endSecond || selectedScript.estimatedSeconds,
      totalDialogueClips: dialogueClips.length,
      totalBrollClips: bRollClipPlans.length,
      sceneVariationCount: sceneVariations.length,
    },
  };
}

function hasAnthropicCreativeShape(plan: any): plan is UgcAnthropicCreativePlan {
  return (
    plan &&
    typeof plan.productAnalysis === "string" &&
    typeof plan.selectedScriptId === "string" &&
    Array.isArray(plan.scriptOptions) &&
    plan.scriptOptions.length > 0 &&
    Array.isArray(plan.avatarOptions) &&
    plan.avatarOptions.length > 0 &&
    Array.isArray(plan.sceneVariations) &&
    plan.sceneVariations.length > 0 &&
    Array.isArray(plan.bRollImagePlans) &&
    plan.bRollImagePlans.length > 0
  );
}

function buildPlanFromAnthropicCreative(
  input: UgcPlanRequest,
  baseline: UgcWorkflowPlan,
  creative: UgcAnthropicCreativePlan
): UgcWorkflowPlan {
  const productName = cleanText(input.product.name) || "the product";
  const category = cleanText(input.product.category) || "creator-friendly product";
  const productAppearance =
    cleanText(input.product.appearanceNotes) ||
    `${productName} should stay visually consistent with its real product form, premium materials, and original brand cues.`;

  const scriptOptions = baseline.scriptOptions.map((fallback, index) => {
    const option = creative.scriptOptions[index];
    const dialogue = cleanText(option?.dialogue) || fallback.dialogue;
    const estimatedSeconds = estimateDurationSeconds(dialogue, input.script.totalSeconds);
    return {
      id: fallback.id,
      title: cleanText(option?.title) || fallback.title,
      rationale: cleanText(option?.rationale) || fallback.rationale,
      hook: cleanText(option?.hook) || splitSentences(dialogue)[0] || fallback.hook,
      cta: cleanText(option?.cta) || fallback.cta,
      dialogue,
      estimatedSeconds,
      beats: buildScriptBeats(dialogue, estimatedSeconds),
    } satisfies UgcScriptOption;
  });

  const avatarOptions = baseline.avatarOptions.map((fallback, index) => {
    const option = creative.avatarOptions[index];
    return {
      id: fallback.id,
      label: cleanText(option?.label) || fallback.label,
      persona: cleanText(option?.persona) || fallback.persona,
      wardrobe: cleanText(option?.wardrobe) || fallback.wardrobe,
      castingRationale: cleanText(option?.castingRationale) || fallback.castingRationale,
      voiceStyle: cleanText(option?.voiceStyle) || fallback.voiceStyle,
    } satisfies UgcAvatarOption;
  });

  const selectedScript =
    scriptOptions.find((option) => option.id === cleanText(creative.selectedScriptId)) || scriptOptions[0];
  const sceneVariations = buildSceneVariations(
    selectedScript,
    avatarOptions,
    productName,
    productAppearance,
    input.settings,
    category,
    creative.sceneVariations
  );
  const dialogueClips = buildDialogueClips(
    selectedScript,
    productName,
    sceneVariations[0]?.environment || inferEnvironment(selectedScript.dialogue, category),
    input.settings
  );
  const bRollImagePlans = buildBrollImagePlans(
    selectedScript,
    productName,
    productAppearance,
    input.settings,
    creative.bRollImagePlans
  );
  const bRollClipPlans = buildBrollClipPlans(bRollImagePlans, input.settings);

  return {
    productAnalysis: cleanText(creative.productAnalysis) || baseline.productAnalysis,
    selectedScriptId: selectedScript.id,
    scriptOptions,
    avatarOptions,
    sceneVariations,
    dialogueClips,
    bRollImagePlans,
    bRollClipPlans,
    approvalGates: buildApprovalGates(input.settings.safeMode),
    architecture: buildArchitecture(input.promptPack, input.settings.safeMode),
    summary: {
      estimatedDurationSeconds: dialogueClips[dialogueClips.length - 1]?.endSecond || selectedScript.estimatedSeconds,
      totalDialogueClips: dialogueClips.length,
      totalBrollClips: bRollClipPlans.length,
      sceneVariationCount: sceneVariations.length,
    },
  };
}

function extractJsonObject(text: string) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

async function withPlannerTimeout<T>(label: string, task: () => Promise<T | null>, timeoutMs = REMOTE_PLANNER_TIMEOUT_MS) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          console.warn(`${label} timed out after ${timeoutMs}ms`);
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function hasPlanShape(plan: any): plan is UgcWorkflowPlan {
  return (
    plan &&
    typeof plan.productAnalysis === "string" &&
    typeof plan.selectedScriptId === "string" &&
    Array.isArray(plan.scriptOptions) &&
    plan.scriptOptions.length > 0 &&
    Array.isArray(plan.avatarOptions) &&
    Array.isArray(plan.sceneVariations) &&
    Array.isArray(plan.dialogueClips) &&
    Array.isArray(plan.bRollImagePlans) &&
    Array.isArray(plan.bRollClipPlans) &&
    Array.isArray(plan.approvalGates) &&
    plan.summary &&
    typeof plan.summary.totalDialogueClips === "number"
  );
}

async function tryGeminiPlan(input: UgcPlanRequest, baseline: UgcWorkflowPlan) {
  if (!process.env.GEMINI_API_KEY) return null;

  const prompt = `You are orchestrating an AI UGC video advertisement workflow.

Improve the baseline workflow plan below. Keep the same top-level JSON shape and keep array lengths unchanged unless an array is empty. Preserve IDs where they already exist. Return only JSON.

INPUTS
- Campaign: ${input.campaignName || "Untitled UGC Workflow"}
- Product: ${JSON.stringify(input.product)}
- Script request: ${JSON.stringify(input.script)}
- Settings: ${JSON.stringify(input.settings)}
- Knowledge: ${input.knowledge || "None"}
- Override instructions: ${input.overrideInstructions || "None"}

AGENT PROMPTS
${JSON.stringify(input.promptPack)}

BASELINE PLAN
${JSON.stringify(baseline)}

RULES
1. Dialogue clips must preserve the exact spoken text in order.
2. Every scene and B-roll image prompt must stay 9:16-first and commercially realistic.
3. B-roll planning is separate from dialogue planning; do not collapse them.
4. If safe mode is enabled, approval gates must stay required.
5. Do not add markdown fences. Return only valid JSON.`;

  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = extractJsonObject(text);
    return hasPlanShape(parsed) ? parsed : null;
  } catch (error) {
    console.error("UGC Gemini plan error:", error);
    return null;
  }
}

async function tryAnthropicPlan(input: UgcPlanRequest, baseline: UgcWorkflowPlan) {
  if (!process.env.ANTHROPIC_API_KEY) return null;

  const prompt = `You are planning the creative layer for an AI UGC video advertisement workflow.

Return only JSON. Do not add markdown fences. Use the exact ids and array counts provided below.

INPUTS
- Campaign: ${input.campaignName || "Untitled UGC Workflow"}
- Product: ${JSON.stringify(input.product)}
- Script request: ${JSON.stringify(input.script)}
- Settings: ${JSON.stringify(input.settings)}
- Knowledge: ${input.knowledge || "None"}
- Override instructions: ${input.overrideInstructions || "None"}

AGENT INTENT
- Strategist: ${cleanText(input.promptPack.strategist) || DEFAULT_UGC_PROMPT_PACK.strategist}
- Scene architect: ${cleanText(input.promptPack.sceneArchitect) || DEFAULT_UGC_PROMPT_PACK.sceneArchitect}
- Dialogue director: ${cleanText(input.promptPack.dialogueDirector) || DEFAULT_UGC_PROMPT_PACK.dialogueDirector}
- B-roll director: ${cleanText(input.promptPack.bRollDirector) || DEFAULT_UGC_PROMPT_PACK.bRollDirector}

RETURN THIS EXACT JSON SHAPE
{
  "productAnalysis": "string",
  "selectedScriptId": "${baseline.selectedScriptId}",
  "scriptOptions": [
    ${baseline.scriptOptions
      .map(
        (option) =>
          `{ "id": "${option.id}", "title": "string", "rationale": "string", "hook": "string", "cta": "string", "dialogue": "string" }`
      )
      .join(",\n    ")}
  ],
  "avatarOptions": [
    ${baseline.avatarOptions
      .map(
        (avatar) =>
          `{ "id": "${avatar.id}", "label": "string", "persona": "string", "wardrobe": "string", "castingRationale": "string", "voiceStyle": "string" }`
      )
      .join(",\n    ")}
  ],
  "sceneVariations": [
    ${baseline.sceneVariations
      .map(
        (scene) =>
          `{ "id": "${scene.id}", "title": "string", "summary": "string", "environment": "string", "avatarId": "avatar-1 | avatar-2 | avatar-3", "camera": "string", "lighting": "string" }`
      )
      .join(",\n    ")}
  ],
  "bRollImagePlans": [
    ${baseline.bRollImagePlans
      .map(
        (plan) =>
          `{ "id": "${plan.id}", "title": "string", "objective": "string", "angle": "string", "lens": "string", "lighting": "string", "withoutHuman": true }`
      )
      .join(",\n    ")}
  ]
}

RULES
1. Keep the dialogue natural, creator-friendly, and easy to say on camera.
2. Treat the user description as directional input for angle, concept, and emphasis. Do not mirror it word-for-word in the dialogue unless the user uploaded exact script text.
3. Match the runtime target by making each script concise but complete.
4. SelectedScriptId must match one of the provided script ids.
5. Scene directions must preserve the referenced product and feel believable for a selfie-style talking ad.
6. B-roll directions must be designed as start frames for motion, not polished final stills.
7. Do not include prompts, beats, dialogue clip batches, approval gates, architecture, or summary fields.
8. Return only valid JSON.`;

  try {
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      timeout: REMOTE_PLANNER_TIMEOUT_MS,
      maxRetries: 0,
    });
    const response = await anthropic.messages.create(
      {
        model: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-6",
        max_tokens: 4096,
        system:
          "You are a production planner for AI UGC video ads. Return only the creative planning layer in valid JSON, keep ids exactly as provided, and optimize for a fast, usable response.",
        messages: [{ role: "user", content: prompt }],
      },
      {
        timeout: REMOTE_PLANNER_TIMEOUT_MS,
      }
    );

    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") return null;

    const parsed = extractJsonObject(textBlock.text);
    return hasAnthropicCreativeShape(parsed) ? buildPlanFromAnthropicCreative(input, baseline, parsed) : null;
  } catch (error) {
    console.error("UGC Anthropic plan error:", error);
    return null;
  }
}

async function tryOpenAiPlan(input: UgcPlanRequest, baseline: UgcWorkflowPlan) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: REMOTE_PLANNER_TIMEOUT_MS,
      maxRetries: 0,
    });
    const completion = await openai.chat.completions.create(
      {
        model: "gpt-4o",
        messages: [
          {
            role: "system",
            content:
              "You are a production planner for AI UGC video ads. Improve the provided workflow plan while keeping the same JSON shape, preserving IDs, preserving ordered dialogue, and returning only JSON.",
          },
          {
            role: "user",
            content: `REQUEST\n${JSON.stringify(input, null, 2)}\n\nBASELINE\n${JSON.stringify(baseline, null, 2)}`,
          },
        ],
        response_format: { type: "json_object" },
      },
      {
        timeout: REMOTE_PLANNER_TIMEOUT_MS,
      }
    );
    const text = completion.choices[0]?.message?.content || "";
    const parsed = extractJsonObject(text);
    return hasPlanShape(parsed) ? parsed : null;
  } catch (error) {
    console.error("UGC OpenAI plan error:", error);
    return null;
  }
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Partial<UgcPlanRequest>;

    if (!body?.product?.name) {
      return NextResponse.json({ error: "Product name is required." }, { status: 400 });
    }

    const input: UgcPlanRequest = {
      campaignName: cleanText(body.campaignName) || "UGC Video Ad Workflow",
      knowledge: cleanText(body.knowledge),
      product: {
        source: body.product?.source || "catalog",
        id: body.product?.id || null,
        name: cleanText(body.product?.name) || "Product",
        imageUrl: cleanText(body.product?.imageUrl),
        category: cleanText(body.product?.category),
        vendor: cleanText(body.product?.vendor),
        appearanceNotes: cleanText(body.product?.appearanceNotes),
      },
      script: {
        mode: body.script?.mode || "generate",
        text: cleanText(body.script?.text),
        totalSeconds: clamp(Number(body.script?.totalSeconds) || 20, 5, 60),
        theme: cleanText(body.script?.theme) || "creator testimonial",
        description: cleanText(body.script?.description),
      },
      settings: {
        safeMode: body.settings?.safeMode === "fast" ? "fast" : "safe",
        dialogueSeconds: clamp(Number(body.settings?.dialogueSeconds) || 20, 5, 60),
        clipDurationSeconds: clamp(Number(body.settings?.clipDurationSeconds) || 5, 3, 10),
        sceneVariationCount: clamp(Number(body.settings?.sceneVariationCount) || 4, 1, MAX_SCENE_VARIATIONS),
        bRollClipCount: clamp(Number(body.settings?.bRollClipCount) || 4, 1, MAX_BROLL_CLIPS),
        imageModelId: cleanText(body.settings?.imageModelId) || "nanobanana-2",
        videoModelId: cleanText(body.settings?.videoModelId) || "kling-3.0",
        imageAspectRatio: "9:16",
        imageResolution: "2K",
        videoAspectRatio: "9:16",
        videoDurationSeconds: clamp(Number(body.settings?.videoDurationSeconds) || 5, 3, 10),
        videoSound: body.settings?.videoSound === undefined ? true : Boolean(body.settings?.videoSound),
      },
      promptPack: {
        strategist: cleanText(body.promptPack?.strategist) || DEFAULT_UGC_PROMPT_PACK.strategist,
        sceneArchitect: cleanText(body.promptPack?.sceneArchitect) || DEFAULT_UGC_PROMPT_PACK.sceneArchitect,
        dialogueDirector: cleanText(body.promptPack?.dialogueDirector) || DEFAULT_UGC_PROMPT_PACK.dialogueDirector,
        bRollDirector: cleanText(body.promptPack?.bRollDirector) || DEFAULT_UGC_PROMPT_PACK.bRollDirector,
        safetyCoordinator:
          cleanText(body.promptPack?.safetyCoordinator) || DEFAULT_UGC_PROMPT_PACK.safetyCoordinator,
      },
      overrideInstructions: cleanText(body.overrideInstructions),
    };

    const baseline = buildFallbackPlan(input);
    const plannerSource = process.env.ANTHROPIC_API_KEY
      ? "anthropic"
      : process.env.OPENAI_API_KEY
        ? "openai"
        : process.env.GEMINI_API_KEY
          ? "gemini"
          : "heuristic";

    const refined =
      plannerSource === "anthropic"
        ? await withPlannerTimeout("UGC Anthropic planner", () => tryAnthropicPlan(input, baseline))
        : plannerSource === "openai"
          ? await withPlannerTimeout("UGC OpenAI planner", () => tryOpenAiPlan(input, baseline))
          : plannerSource === "gemini"
            ? await withPlannerTimeout("UGC Gemini planner", () => tryGeminiPlan(input, baseline))
            : null;

    const source = refined ? plannerSource : "heuristic";

    return NextResponse.json({
      plan: refined || baseline,
      source,
    });
  } catch (error: any) {
    console.error("UGC plan route error:", error);
    return NextResponse.json({ error: error?.message || "Failed to build workflow plan" }, { status: 500 });
  }
}
