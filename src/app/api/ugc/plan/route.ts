export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
import type {
  UgcAgentPromptPack,
  UgcApprovalGate,
  UgcArchitectureAgent,
  UgcAvatarOption,
  UgcBrollClipPlan,
  UgcBrollImagePlan,
  UgcDialogueClipPlan,
  UgcPlanRequest,
  UgcSceneVariation,
  UgcScriptBeat,
  UgcScriptInput,
  UgcScriptOption,
  UgcWorkflowPlan,
} from "@/lib/ugc-types";

const MAX_SCENE_VARIATIONS = 8;
const MAX_BROLL_CLIPS = 8;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanText(value: string | undefined | null) {
  return (value || "").replace(/\s+/g, " ").trim();
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

function makeId(prefix: string, index: number) {
  return `${prefix}-${index + 1}`;
}

function inferEnvironment(scriptText: string, category: string) {
  const corpus = `${scriptText} ${category}`.toLowerCase();
  if (/(office|desk|meeting|slack|presentation|zoom|workday)/.test(corpus)) {
    return "sunlit founder office with a clean desk and lived-in startup energy";
  }
  if (/(bathroom|shower|mirror|skincare|serum|cream|routine)/.test(corpus)) {
    return "bright bathroom vanity with soft natural daylight and premium toiletry styling";
  }
  if (/(kitchen|cook|coffee|breakfast|drink|snack|meal)/.test(corpus)) {
    return "warm kitchen counter setup with practical morning light and believable countertop clutter";
  }
  if (/(gym|workout|run|protein|fitness|recovery)/.test(corpus)) {
    return "modern gym corner with matte equipment, sweat realism, and directional side light";
  }
  if (/(car|commute|travel|airport|carry-on)/.test(corpus)) {
    return "parked car interior with soft windshield light and handheld creator framing";
  }
  return "tasteful home-studio apartment corner with natural window light and creator-friendly depth";
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
  const clipCount = Math.max(1, Math.ceil(totalSeconds / clipDurationSeconds));
  if (sentences.length <= clipCount) {
    return Array.from({ length: clipCount }, (_, index) => ({
      id: makeId("clip-segment", index),
      text: sentences[index] || sentences[sentences.length - 1] || dialogue,
    }));
  }

  const targetWords = Math.max(1, Math.ceil(countWords(dialogue) / clipCount));
  const clips: Array<{ id: string; text: string }> = [];
  let current: string[] = [];
  let currentWords = 0;

  sentences.forEach((sentence) => {
    const words = countWords(sentence);
    if (clips.length < clipCount - 1 && current.length > 0 && currentWords + words > targetWords) {
      clips.push({ id: makeId("clip-segment", clips.length), text: current.join(" ") });
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += words;
  });

  if (current.length > 0) {
    clips.push({ id: makeId("clip-segment", clips.length), text: current.join(" ") });
  }

  while (clips.length < clipCount) {
    clips.push({ id: makeId("clip-segment", clips.length), text: clips[clips.length - 1]?.text || dialogue });
  }

  return clips.slice(0, clipCount);
}

function buildGeneratedScripts(input: UgcScriptInput, productName: string, category: string, knowledge: string) {
  const audience = cleanText(input.audience) || "mobile-first shoppers";
  const benefit = cleanText(input.primaryBenefit) || "solves the problem faster and more cleanly";
  const offerSentence = cleanText(input.offer) ? `Right now, ${cleanText(input.offer)}.` : "";
  const ctaSentence = cleanText(input.cta) || "Tap in and try it for yourself.";
  const tone = cleanText(input.tone) || "confident, native creator energy";
  const knowledgeHint = knowledge ? ` ${knowledge.replace(/\s+/g, " ").trim()}` : "";

  const variants = [
    {
      title: "Problem / Solution",
      rationale: "Fast direct-response structure that opens with friction and resolves it with a specific product claim.",
      hook: `If you're ${audience}, this fixes the part everyone complains about.`,
      dialogue:
        `If you're ${audience}, this is the ${category || "product"} I would start with. I grabbed ${productName} because ${benefit}. It looks premium, feels easy to use, and it makes the routine feel way less annoying. ${offerSentence} ${ctaSentence}${knowledgeHint}`.trim(),
    },
    {
      title: "Creator Testimonial",
      rationale: "A more credible first-person recommendation built for creator-style trust and retention.",
      hook: `I did not expect ${productName} to be this good.`,
      dialogue:
        `I did not expect ${productName} to become part of my daily routine, but here we are. The biggest reason is simple: ${benefit}. It gives me the polished result without making the process feel high-maintenance. ${offerSentence} ${ctaSentence}${knowledgeHint}`.trim(),
    },
    {
      title: "Demo Lead",
      rationale: "Balances proof and visual direction so the workflow naturally produces usable product and b-roll shots.",
      hook: `Watch how fast this changes the outcome.`,
      dialogue:
        `Watch how fast ${productName} changes the outcome. You can see the product, the texture, and the result immediately, which is exactly why I keep reaching for it. For ${audience}, it feels practical and elevated at the same time because it ${benefit}. ${offerSentence} ${ctaSentence}${knowledgeHint}`.trim(),
    },
  ];

  return variants.map((variant, index) => {
    const estimatedSeconds = estimateDurationSeconds(variant.dialogue, input.totalSeconds);
    return {
      id: makeId("script", index),
      title: variant.title,
      rationale: `${variant.rationale} Tone target: ${tone}.`,
      hook: variant.hook,
      cta: ctaSentence,
      dialogue: variant.dialogue,
      estimatedSeconds,
      beats: buildScriptBeats(variant.dialogue, estimatedSeconds),
    } satisfies UgcScriptOption;
  });
}

function buildAvatarOptions(productName: string, audience: string, category: string): UgcAvatarOption[] {
  const audienceLabel = cleanText(audience) || "performance shoppers";
  return [
    {
      id: "avatar-1",
      label: "Credible Creator",
      persona: `A relatable creator who feels native to ${audienceLabel} and speaks with practical confidence.`,
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
  category: string
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
    const avatar = avatarOptions[index % avatarOptions.length];
    const camera = cameraDirections[index % cameraDirections.length];
    const lighting = lightingDirections[index % lightingDirections.length];
    const title = `Base Scene ${index + 1}`;
    const summary =
      index === 0
        ? "Most conversion-safe version with clean product visibility and a direct creator setup."
        : index === 1
          ? "Slightly more premium framing with more deliberate camera language."
          : index === 2
            ? "Warmer, more lived-in take for higher social-native credibility."
            : "Alternate performance-safe variation that preserves continuity for clip batching.";

    return {
      id: makeId("scene", index),
      title,
      summary,
      environment: baseEnvironment,
      avatarId: avatar.id,
      camera,
      lighting,
      prompt: `Generate a 9:16, ${settings.imageResolution} UGC base scene for ${productName}. Use ${avatar.label}: ${avatar.persona} Wearing ${avatar.wardrobe}. Environment: ${baseEnvironment}. Camera: ${camera}. Lighting: ${lighting}. The scene must visibly feature the product and preserve ${productAppearance}. Compose for vertical talking-head performance creative with enough space for hand gestures and product presentation. Keep the background commercially clean, believable, and consistent enough to support multiple 5-second dialogue clips.`,
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
    const startSecond = index * settings.clipDurationSeconds;
    const endSecond = startSecond + settings.clipDurationSeconds;
    const objective = objectives[Math.min(index, objectives.length - 1)];
    const movement = movements[index % movements.length];
    const camera = cameras[index % cameras.length];
    return {
      id: makeId("dialogue-clip", index),
      index,
      startSecond,
      endSecond,
      spokenText: segment.text,
      objective,
      movement,
      camera,
      prompt: `Use the selected base scene as the starting image. Create a ${settings.clipDurationSeconds}-second ${settings.videoAspectRatio} UGC clip for ${productName}. The talent must say exactly: "${segment.text}" Keep continuity with the approved room, wardrobe, and avatar. Movement: ${movement} Camera: ${camera}. Environment continuity: ${selectedEnvironment}. Objective: ${objective}. Keep mouth-sync credible, gestures natural, and commercial pacing clean enough to stitch with adjacent clips.`,
    };
  });
}

function buildBrollImagePlans(
  script: UgcScriptOption,
  productName: string,
  productAppearance: string,
  settings: UgcPlanRequest["settings"]
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
    return {
      id: makeId("broll-image", index),
      index,
      title: shot.title,
      objective: shot.objective,
      angle: shot.angle,
      lens: shot.lens,
      lighting: shot.lighting,
      withoutHuman: shot.withoutHuman,
      prompt: `Create a ${settings.imageAspectRatio}, ${settings.imageResolution} starting frame for a B-roll video about ${productName}. Preserve exact product appearance: ${productAppearance}. Shot intent: ${shot.objective}. Angle: ${shot.angle}. Lens: ${shot.lens}. Lighting: ${shot.lighting}. ${
        shot.withoutHuman
          ? "Remove the human talent unless hands are essential."
          : "Keep the talent secondary and the product primary."
      } This image will be used as the starting frame for a short commercial B-roll clip, so design the frame with clear motion potential and edit-ready composition. Reference the script claim: "${script.hook}"`,
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
  return {
    agents: [
      {
        id: "agent-strategist",
        name: "Script Strategist",
        responsibility: "Creates selectable UGC dialogue options and chooses the strongest runtime-safe structure.",
        inputs: ["Product context", "Audience", "Benefit", "Offer", "Knowledge notes"],
        outputs: ["Script options", "Hook/CTA framing", "Beat map"],
        systemPrompt: promptPack.strategist,
      },
      {
        id: "agent-scene",
        name: "Scene Architect",
        responsibility: "Casts avatar candidates and prepares base-scene prompts that match the approved script.",
        inputs: ["Approved script", "Product appearance", "Visual constraints", "Knowledge notes"],
        outputs: ["Avatar options", "Base scene prompts", "Environment continuity notes"],
        systemPrompt: promptPack.sceneArchitect,
      },
      {
        id: "agent-dialogue",
        name: "Dialogue Director",
        responsibility: "Converts the approved script into ordered 5-second talking-head clip prompts.",
        inputs: ["Approved script", "Selected base scene", "Clip duration", "Safe-mode overrides"],
        outputs: ["Sequential clip prompts", "Gesture directions", "Camera directions"],
        systemPrompt: promptPack.dialogueDirector,
      },
      {
        id: "agent-broll",
        name: "B-roll Director",
        responsibility: "Produces alternate-angle seed images and B-roll video prompts that cut around the dialogue.",
        inputs: ["Selected base scene", "Script claims", "Editorial needs", "Approval overrides"],
        outputs: ["B-roll image prompts", "B-roll clip prompts"],
        systemPrompt: promptPack.bRollDirector,
      },
      {
        id: "agent-safe",
        name: "Safe Mode Coordinator",
        responsibility: "Enforces approval gates and treats the latest user correction as the top priority override.",
        inputs: ["Stage status", "User approval", "Disapproval rationale", "Next-step override"],
        outputs: ["Approval checklist", "Execution holds", "Override instructions"],
        systemPrompt: promptPack.safetyCoordinator,
      },
    ],
    notes: [
      "Planning runs first and emits a stable contract for the page: scripts, avatars, base scenes, dialogue clips, and B-roll coverage.",
      "Dialogue rendering is image-to-video only, using the approved base scene as the continuity anchor for every 5-second batch.",
      "B-roll is deliberately a separate agent path so coverage prompts can diverge in angle, distance, lighting, and empty-scene variants without polluting talking-head continuity.",
      safeMode === "safe"
        ? "Safe mode inserts blocking approvals between plan, scene selection, dialogue generation, and B-roll generation."
        : "Fast mode removes blocking approvals and executes the pipeline sequentially.",
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
            cta: cleanText(input.script.cta) || "Tap in and try it now.",
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
  const avatarOptions = buildAvatarOptions(productName, input.script.audience, category);
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
      estimatedDurationSeconds: selectedScript.estimatedSeconds,
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
${JSON.stringify(input.promptPack, null, 2)}

BASELINE PLAN
${JSON.stringify(baseline, null, 2)}

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

async function tryOpenAiPlan(input: UgcPlanRequest, baseline: UgcWorkflowPlan) {
  if (!process.env.OPENAI_API_KEY) return null;

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const completion = await openai.chat.completions.create({
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
    });
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
        tone: cleanText(body.script?.tone),
        audience: cleanText(body.script?.audience),
        primaryBenefit: cleanText(body.script?.primaryBenefit),
        offer: cleanText(body.script?.offer),
        cta: cleanText(body.script?.cta),
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
        videoSound: Boolean(body.settings?.videoSound),
      },
      promptPack: {
        strategist: cleanText(body.promptPack?.strategist),
        sceneArchitect: cleanText(body.promptPack?.sceneArchitect),
        dialogueDirector: cleanText(body.promptPack?.dialogueDirector),
        bRollDirector: cleanText(body.promptPack?.bRollDirector),
        safetyCoordinator: cleanText(body.promptPack?.safetyCoordinator),
      },
      overrideInstructions: cleanText(body.overrideInstructions),
    };

    const baseline = buildFallbackPlan(input);
    const geminiPlan = await tryGeminiPlan(input, baseline);
    const openAiPlan = geminiPlan ? null : await tryOpenAiPlan(input, baseline);
    const refined = geminiPlan || openAiPlan;
    const source = geminiPlan ? "gemini" : openAiPlan ? "openai" : "heuristic";

    return NextResponse.json({
      plan: refined || baseline,
      source,
    });
  } catch (error: any) {
    console.error("UGC plan route error:", error);
    return NextResponse.json({ error: error?.message || "Failed to build workflow plan" }, { status: 500 });
  }
}
