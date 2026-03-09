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
  type UgcShotType,
  type UgcStoryRole,
  type UgcWorkflowPlan,
} from "@/lib/ugc-types";

const MAX_SCENE_VARIATIONS = 8;
const MAX_BROLL_CLIPS = 8;
const REMOTE_PLANNER_TIMEOUT_MS = 55000;
// Speech rate — 170 WPM from AIUGC-master, ≈ 2.83 wps.
// Adjusted to 3.0 for TikTok/Reels pacing (slightly faster than standard speech).
const WORDS_PER_SECOND = 3.0;
const WORDS_PER_MINUTE = WORDS_PER_SECOND * 60; // 180 WPM
const SPEECH_PADDING_SECONDS = 0.75; // Breathing room after each clip
const MIN_DIALOGUE_CLIP_SECONDS = 2;
const MAX_DIALOGUE_CLIP_SECONDS = 8;
const MIN_WORDS_PER_BEAT = 5; // Minimum words before merging with neighbor
const SPEECH_BUDGET_RATIO = 0.9; // 90% of target duration for speech

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
  // AIUGC-master formula: (word_count / wpm) * 60, rounded to 2 decimals
  const seconds = (words / Math.max(WORDS_PER_MINUTE, 1)) * 60;
  return Math.round(seconds * 100) / 100;
}

// ---------------------------------------------------------------------------
// Story role detection — marker-based classification
// Inspired by AIUGC-master's beat role system
// ---------------------------------------------------------------------------

const PROBLEM_MARKERS = /\b(problem|ugly|hate|bad|worst|annoying|frustrated|struggle|issue|broken|terrible|awful|wrong|dark|bothered|bugged|drove me crazy|gave up|nothing worked|did not work|burned|skeptic)\b/i;
const PRODUCT_MOMENT_MARKERS = /\b(got this|tried this|found this|switched to|started using|turned it on|put it|installed|set it up|ordered|bought|picked up|unboxed|opened)\b/i;
const PROOF_MARKERS = /\b(difference|changed|works|actually|noticed|felt|looks|feels|surprised|compliment|asked me|texts|dms|people|everyone|reaction|result|before.?after|transform)\b/i;
const CTA_MARKERS_ROLE = /\b(do what you want|that is it|that is all|just saying|take it or leave|anyway|yeah|whatever|I do not know)\b/i;

// AIUGC-master visual markers for shot type classification
const VISUAL_MARKERS = /\b(show|close-up|close up|detail|before|after|texture|angle|b-roll|look at|see this|watch|right here|check this)\b/i;
const PROBLEM_VISUAL_MARKERS = /\b(dark|flat|missing|felt off|feels off|awkward|uninviting|bad lighting)\b/i;
const PRODUCT_REVEAL_MARKERS = /\b(turned it on|turn it on|turned on|switched it on|switched on|lit up|transform|transformed|brand called|got this lamp|got this light)\b/i;
const PROOF_VISUAL_MARKERS = /\b(warm|glowy|glow|hotel feeling|changed the room|transformed|where did you get|texts|texts since|asked me about|comments|dms)\b/i;

// AIUGC-master compression scoring markers
const CTA_SCORE_MARKERS = /\b(shop|buy|learn more|order|try|tap|click)\b/i;
const IMPACT_SCORE_MARKERS = /\b(before|after|same house|different|again|dark|night|glow|warm)\b/i;

function detectStoryRole(
  text: string,
  index: number,
  totalBeats: number,
  productName: string,
): UgcStoryRole {
  const t = text.toLowerCase();

  // First beat is always hook
  if (index === 0) return "hook";
  // Last beat is always cta/exit
  if (index === totalBeats - 1) return "cta";

  // Product name mention + action verb = product moment
  if (t.includes(productName.toLowerCase()) && PRODUCT_MOMENT_MARKERS.test(t)) return "product_moment";
  // Product moment markers even without name
  if (PRODUCT_MOMENT_MARKERS.test(t) && index > 0 && index < totalBeats - 1) return "product_moment";

  // Problem markers (usually early in script)
  if (PROBLEM_MARKERS.test(t) && index <= Math.ceil(totalBeats / 2)) return "problem";

  // Proof markers (usually later in script)
  if (PROOF_MARKERS.test(t) && index >= Math.floor(totalBeats / 3)) return "proof";

  // CTA markers
  if (CTA_MARKERS_ROLE.test(t)) return "cta";

  // Default: support (filler/transition)
  return "support";
}

/**
 * Check if a beat supports a visual cutaway based on AIUGC-master logic.
 * Different story roles have different visual marker sets.
 */
function supportsVisualCutaway(text: string, storyRole: UgcStoryRole): boolean {
  if (VISUAL_MARKERS.test(text)) return true;
  if (storyRole === "problem") return PROBLEM_VISUAL_MARKERS.test(text);
  if (storyRole === "product_moment") return PRODUCT_REVEAL_MARKERS.test(text);
  if (storyRole === "proof" || storyRole === "support") {
    return PROBLEM_VISUAL_MARKERS.test(text) || PROOF_VISUAL_MARKERS.test(text) || PRODUCT_REVEAL_MARKERS.test(text);
  }
  return false;
}

/**
 * Determine shot type based on story role and content.
 * Matches AIUGC-master's _shot_type_for_text() logic:
 * - hook and cta always A-roll
 * - explicit visual markers → b_roll
 * - visual cutaway support + duration >= 3.2s → hybrid
 */
function assignShotType(
  text: string,
  storyRole: UgcStoryRole,
  index: number,
  durationSeconds = 4,
): UgcShotType {
  // Opening and closing are always direct-to-camera
  if (index === 0 || storyRole === "hook" || storyRole === "cta") return "a_roll";

  // Explicit visual markers → B-roll
  if (VISUAL_MARKERS.test(text)) return "b_roll";

  // Visual cutaway support + sufficient duration → hybrid
  if (supportsVisualCutaway(text, storyRole) && durationSeconds >= 3.2) return "hybrid";

  return "a_roll";
}

/**
 * Score a sentence for compression priority.
 * Matches AIUGC-master's _score_sentence() system.
 */
function scoreSentence(sentence: string, productName: string, brandName: string): number {
  const lower = sentence.toLowerCase();
  let score = 0;

  // Product name mention: +6.0
  if (productName && lower.includes(productName.toLowerCase())) score += 6.0;

  // Brand name mention: +4.0
  if (brandName && lower.includes(brandName.toLowerCase())) score += 4.0;

  // CTA markers: +5.0
  if (CTA_SCORE_MARKERS.test(lower)) score += 5.0;

  // Impact markers: +3.0
  if (IMPACT_SCORE_MARKERS.test(lower)) score += 3.0;

  // Proof markers: +4.0
  if (PROOF_MARKERS.test(lower)) score += 4.0;

  // Problem markers: +4.0
  if (PROBLEM_MARKERS.test(lower)) score += 4.0;

  // Word count preference — optimal ~10 words: up to +2.5
  const words = countWords(sentence);
  score += Math.max(0, 2.5 - Math.abs(words - 10) * 0.2);

  return score;
}

/**
 * Compress script dialogue to fit within a word budget.
 * Uses AIUGC-master's greedy selection algorithm with protected segments.
 */
function compressScript(dialogue: string, targetWords: number, productName: string, brandName = ""): string {
  const sentences = splitSentences(dialogue);
  if (countWords(dialogue) <= targetWords) return dialogue;

  const speechBudgetSec = (targetWords / WORDS_PER_SECOND) * SPEECH_BUDGET_RATIO;
  const maxBeats = 8;

  // Identify protected segments (hook, cta, product_moment, problem, proof)
  const protectedIndices = new Set<number>();
  // First sentence (hook) is always protected
  if (sentences.length > 0) protectedIndices.add(0);
  // Last sentence (cta) is always protected
  if (sentences.length > 1) protectedIndices.add(sentences.length - 1);

  // Find product moment, problem, proof sentences and protect them
  for (let i = 1; i < sentences.length - 1; i++) {
    const role = detectStoryRole(sentences[i], i, sentences.length, productName);
    if ((role === "product_moment" || role === "problem" || role === "proof") && countWords(sentences[i]) >= 3) {
      protectedIndices.add(i);
    }
  }

  // Build scored items
  const items = sentences.map((sentence, index) => ({
    sentence,
    index,
    score: scoreSentence(sentence, productName, brandName),
    words: countWords(sentence),
    duration: countWords(sentence) / WORDS_PER_SECOND,
    isProtected: protectedIndices.has(index),
  }));

  // Start with protected segments
  const chosen: typeof items = [];
  let currentSpeech = 0;

  for (const item of items) {
    if (item.isProtected) {
      chosen.push(item);
      currentSpeech += item.duration;
    }
  }

  // Build supplement pool (non-protected, sorted by score desc, index asc for ties)
  const supplements = items
    .filter((item) => !item.isProtected)
    .sort((a, b) => b.score - a.score || a.index - b.index);

  // Target segment count
  const preferredClipSeconds = 4.5;
  const targetSegmentCount = Math.max(3, Math.min(maxBeats, Math.round(speechBudgetSec / Math.max(preferredClipSeconds, 1))));

  // Greedy selection
  for (const item of supplements) {
    // Stop if enough segments and budget hit
    if (chosen.length >= targetSegmentCount && currentSpeech >= speechBudgetSec * 0.8) break;

    // Skip if would exceed hard budget with sufficient segments
    if (currentSpeech + item.duration > speechBudgetSec && chosen.length >= Math.max(3, Math.min(targetSegmentCount, 4))) continue;

    // Add if room
    if (currentSpeech + item.duration <= speechBudgetSec) {
      chosen.push(item);
      currentSpeech += item.duration;
    }

    // Hard stop at max beats
    if (chosen.length >= maxBeats) break;
  }

  // Restore original order
  chosen.sort((a, b) => a.index - b.index);

  // Merge tiny segments (< 3 words)
  const merged: string[] = [];
  for (const item of chosen) {
    if (item.words < 3 && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${item.sentence}`;
    } else {
      merged.push(item.sentence);
    }
  }

  return merged.join(" ");
}

function buildProductLines(knowledge: string, productName: string, category: string): { detail: string; reaction: string; specifics: string } {
  const k = cleanText(knowledge).toLowerCase();
  const cat = (category || "").toLowerCase();

  // Extract something real from knowledge if available
  if (k.length > 20) {
    const firstSentence = finishSentence(knowledge.slice(0, 120));
    return {
      detail: firstSentence,
      reaction: `That is the part that actually got me — ${firstSentence.toLowerCase().slice(0, 60)}.`,
      specifics: `The thing nobody talks about is ${firstSentence.toLowerCase().slice(0, 50)}.`,
    };
  }

  // Category-specific spoken lines (not instructions — actual dialogue)
  if (/(skincare|serum|cream|beauty|face|moisturizer|cleanser)/.test(cat))
    return {
      detail: `My skin genuinely looks different. Like, I woke up this morning and the texture was just smoother.`,
      reaction: `I keep touching my face which is gross but it is that soft now.`,
      specifics: `I have tried so many ${category || "skincare"} things that did nothing. This one I actually noticed.`,
    };
  if (/(supplement|vitamin|protein|health|wellness)/.test(cat))
    return {
      detail: `I have way more energy in the afternoon. Like, I am not crashing at 3pm anymore.`,
      reaction: `It sounds dramatic but I genuinely feel a difference on days I skip it.`,
      specifics: `I am pretty skeptical about ${category || "supplements"} in general so the fact that I kept taking it says something.`,
    };
  if (/(tech|app|software|saas|tool|gadget)/.test(cat))
    return {
      detail: `It just works the way you think it should. No setup headache, no learning curve.`,
      reaction: `I keep finding little things it does that save me time and I did not even expect.`,
      specifics: `I have used a lot of ${category || "tools"} like this and most of them overcomplicate everything. This does not.`,
    };
  if (/(food|snack|drink|coffee|tea|beverage)/.test(cat))
    return {
      detail: `The taste is actually good. Not like fake-healthy good, genuinely good.`,
      reaction: `I bought it once thinking it would be mid and now I have it like every day.`,
      specifics: `Most ${category || "food"} stuff that markets itself as better usually tastes worse. Not this.`,
    };
  if (/(fashion|clothing|shoes|wear|outfit|jacket|shirt)/.test(cat))
    return {
      detail: `The fit is insane. Like, I tried it on and immediately ordered another color.`,
      reaction: `People have been asking me where this is from and that never happens.`,
      specifics: `The quality for the price is actually ridiculous. I expected it to feel cheap and it does not.`,
    };
  // Fallback — general product
  return {
    detail: `The difference is actually noticeable. It is not one of those things where you are like did it work? You know it worked.`,
    reaction: `I did not think I would care this much but here I am making a video about it.`,
    specifics: `I have been through a lot of ${category || "stuff"} like this. Most of it is forgettable. This was not.`,
  };
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

function buildScriptBeats(dialogue: string, requestedSeconds: number, productName = ""): UgcScriptBeat[] {
  const sentences = splitSentences(dialogue);
  let cursor = 0;

  const deliveryByRole: Record<UgcStoryRole, string> = {
    hook: "Casual and direct, mid-thought energy.",
    problem: "Slightly frustrated or reflective, grounded.",
    product_moment: "Natural shift in energy — noticing something.",
    proof: "Genuine reaction, not performed.",
    cta: "Winding down, not pitching.",
    support: "Relaxed, conversational.",
  };

  const visualCueByRole: Record<UgcStoryRole, string> = {
    hook: "Settle into frame, eyes on camera.",
    problem: "Slight frown or head tilt, relatable.",
    product_moment: "Glance at product, gesture toward it.",
    proof: "Small smile or raised eyebrows, genuine.",
    cta: "Slight shrug or nod, done talking.",
    support: "Small hand gestures, natural.",
  };

  // AIUGC-master beat timing: duration = speech_duration + padding, clamped to [min, max+1.5]
  const maxDuration = MAX_DIALOGUE_CLIP_SECONDS + 1.5;

  return sentences.map((sentence, index) => {
    const words = Math.max(1, countWords(sentence));
    // Speech duration from AIUGC formula
    const speechDuration = (words / Math.max(WORDS_PER_MINUTE, 1)) * 60;
    const durationTarget = Math.max(
      MIN_DIALOGUE_CLIP_SECONDS,
      Math.min(maxDuration, speechDuration + SPEECH_PADDING_SECONDS)
    );
    // Round to 2 decimals
    const duration = Math.round(durationTarget * 100) / 100;

    const startSecond = Math.round(cursor * 100) / 100;
    const endSecond = Math.round((startSecond + duration) * 100) / 100;
    cursor = endSecond;

    const storyRole = detectStoryRole(sentence, index, sentences.length, productName);

    return {
      id: makeId("beat", index),
      startSecond,
      endSecond,
      text: sentence,
      storyRole,
      delivery: deliveryByRole[storyRole],
      visualCue: visualCueByRole[storyRole],
    };
  });
}

/**
 * AIUGC-master's _split_long_chunk: split text by clause boundaries first,
 * then fall back to word-level splitting.
 */
function splitLongChunk(text: string, maxWords: number): string[] {
  const words = countWords(text);
  if (words <= maxWords) return [text];

  // Try clause-based split first (split on ,;: boundary)
  const clauses = text.split(/(?<=[,;:])\s+/).filter(Boolean);
  if (clauses.length > 1) {
    const groups: string[] = [];
    let current: string[] = [];
    let currentWc = 0;
    for (const clause of clauses) {
      const cw = countWords(clause);
      if (current.length > 0 && currentWc + cw > maxWords) {
        groups.push(current.join(" "));
        current = [clause];
        currentWc = cw;
      } else {
        current.push(clause);
        currentWc += cw;
      }
    }
    if (current.length > 0) groups.push(current.join(" "));
    return groups;
  }

  // Fallback: split words directly in chunks of maxWords
  const allWords = text.split(/\s+/);
  const groups: string[] = [];
  for (let i = 0; i < allWords.length; i += maxWords) {
    groups.push(allWords.slice(i, i + maxWords).join(" "));
  }
  return groups;
}

/**
 * AIUGC-master's clause-first splitting algorithm for dialogue clips.
 *
 * 1. Split text into sentences
 * 2. Split long sentences by clause boundaries (,;:)
 * 3. Group small chunks together to reach target word count
 * 4. Merge tiny beats (< MIN_WORDS_PER_BEAT) with neighbors
 * 5. Duration = speech_duration + SPEECH_PADDING_SECONDS
 */
function splitDialogueIntoClips(dialogue: string, totalSeconds: number, clipDurationSeconds: number) {
  const sentences = splitSentences(dialogue);
  const preferredSeconds = clamp(clipDurationSeconds, MIN_DIALOGUE_CLIP_SECONDS, MAX_DIALOGUE_CLIP_SECONDS);
  // AIUGC-master: sentence_hold_seconds = hero_max_seconds + 1.5
  const sentenceHoldSeconds = MAX_DIALOGUE_CLIP_SECONDS + 1.5;
  const maxWords = Math.max(8, Math.floor((sentenceHoldSeconds / 60) * WORDS_PER_MINUTE));
  const targetWords = Math.max(6, Math.floor((preferredSeconds / 60) * WORDS_PER_MINUTE));

  if (sentences.length === 0) {
    const speechDur = countWords(dialogue) / WORDS_PER_SECOND;
    const fallbackDuration = clamp(
      Math.round((speechDur + SPEECH_PADDING_SECONDS) * 100) / 100,
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

  // Phase 1: Split long sentences by clause boundaries, then group to target
  const rawChunks: string[] = [];
  for (const sentence of sentences) {
    const subChunks = splitLongChunk(sentence, maxWords);
    rawChunks.push(...subChunks);
  }

  // Phase 2: Group small chunks together to reach target word count
  const grouped: Array<{ text: string; wordCount: number }> = [];
  let current: string[] = [];
  let currentWc = 0;

  for (const chunk of rawChunks) {
    const cw = countWords(chunk);
    if (current.length > 0 && currentWc + cw > targetWords) {
      grouped.push({ text: current.join(" "), wordCount: currentWc });
      current = [chunk];
      currentWc = cw;
    } else {
      current.push(chunk);
      currentWc += cw;
    }
  }
  if (current.length > 0) {
    grouped.push({ text: current.join(" "), wordCount: currentWc });
  }

  // Phase 3: Beat merging — merge clips under MIN_WORDS_PER_BEAT with neighbor
  // AIUGC-master: can merge if both roles are identical or either is "support"
  const clips = grouped.map((g, i) => ({ id: makeId("clip-segment", i), ...g }));
  const minSpeechSeconds = 2.0;

  let didMerge = true;
  while (didMerge) {
    didMerge = false;
    for (let i = 0; i < clips.length; i++) {
      const speechDur = clips[i].wordCount / WORDS_PER_SECOND;
      if ((clips[i].wordCount < MIN_WORDS_PER_BEAT || speechDur < minSpeechSeconds) && clips.length > 1) {
        // Merge with shorter neighbor
        const prev = i > 0 ? clips[i - 1] : null;
        const next = i < clips.length - 1 ? clips[i + 1] : null;
        const target = !prev ? next! : !next ? prev : prev.wordCount <= next.wordCount ? prev : next;
        const targetIdx = clips.indexOf(target);

        // Check merged result fits constraints
        const mergedWords = target.wordCount + clips[i].wordCount;
        const mergedDuration = mergedWords / WORDS_PER_SECOND + SPEECH_PADDING_SECONDS;
        if (mergedDuration > sentenceHoldSeconds) continue; // Skip if too long

        if (targetIdx < i) {
          clips[targetIdx].text = `${clips[targetIdx].text} ${clips[i].text}`.trim();
        } else {
          clips[targetIdx].text = `${clips[i].text} ${clips[targetIdx].text}`.trim();
        }
        clips[targetIdx].wordCount = mergedWords;
        clips.splice(i, 1);
        didMerge = true;
        break;
      }
    }
  }

  // Phase 4: Post-merge tiny check — merge clips under 3 words or 1.0s with neighbor
  let didPostMerge = true;
  while (didPostMerge) {
    didPostMerge = false;
    for (let i = 0; i < clips.length; i++) {
      const speechDur = clips[i].wordCount / WORDS_PER_SECOND;
      if ((clips[i].wordCount < 3 || speechDur < 1.0) && clips.length > 1) {
        // Prefer merging with previous
        const targetIdx = i > 0 ? i - 1 : i + 1;
        if (targetIdx < i) {
          clips[targetIdx].text = `${clips[targetIdx].text} ${clips[i].text}`.trim();
        } else {
          clips[targetIdx].text = `${clips[i].text} ${clips[targetIdx].text}`.trim();
        }
        clips[targetIdx].wordCount += clips[i].wordCount;
        clips.splice(i, 1);
        didPostMerge = true;
        break;
      }
    }
  }

  // Phase 5: Assign duration — AIUGC formula: speech_duration + padding, clamped
  const maxDuration = MAX_DIALOGUE_CLIP_SECONDS + 1.5;
  return clips.map((clip, index) => {
    const speechDuration = clip.wordCount / WORDS_PER_SECOND;
    const durationRaw = speechDuration + SPEECH_PADDING_SECONDS;
    const duration = clamp(
      Math.round(durationRaw * 100) / 100,
      MIN_DIALOGUE_CLIP_SECONDS,
      maxDuration
    );
    return {
      id: makeId("clip-segment", index),
      text: clip.text,
      wordCount: clip.wordCount,
      durationSeconds: Math.round(duration),
    };
  });
}

function inferSettingForScript(guidance: string, category: string) {
  const corpus = `${guidance} ${category}`.toLowerCase();
  if (/(office|work|desk|startup|founder|meeting|b2b)/.test(corpus)) return { place: "at my desk", room: "office" };
  if (/(bathroom|skincare|beauty|serum|face|cream|wash)/.test(corpus)) return { place: "at the mirror", room: "bathroom" };
  if (/(kitchen|cook|coffee|morning|breakfast|supplement|vitamin|drink)/.test(corpus)) return { place: "in the kitchen", room: "kitchen" };
  if (/(gym|fitness|workout|protein|recovery)/.test(corpus)) return { place: "after my workout", room: "gym" };
  if (/(bedroom|morning routine|night routine|sleep)/.test(corpus)) return { place: "in my room", room: "bedroom" };
  if (/(outdoor|walk|nature|garden)/.test(corpus)) return { place: "outside", room: "patio" };
  return { place: "at home", room: "living room" };
}

/**
 * Parse the user's creative direction into structured intent.
 * The guidance is a brief — NOT dialogue. We extract the concept,
 * setting, and angle so we can build scripts that interpret the brief
 * rather than parrot it word-for-word.
 */
function parseGuidanceIntent(guidance: string, productName: string, category: string) {
  const g = guidance.toLowerCase();

  // Extract setting hints from guidance
  const settingHints: Record<string, { situation: string; action: string }> = {
    "corner": { situation: "standing in front of this empty corner", action: "just finished setting it up" },
    "cozy": { situation: "at home getting everything set up", action: "making this space feel right" },
    "desk": { situation: "at my desk", action: "reorganizing my setup" },
    "office": { situation: "at work", action: "just rearranged everything" },
    "kitchen": { situation: "in the kitchen", action: "putting things together" },
    "bathroom": { situation: "at the mirror", action: "going through my routine" },
    "bedroom": { situation: "in my room", action: "switching things up" },
    "morning": { situation: "just woke up", action: "starting my morning" },
    "night": { situation: "winding down", action: "doing my night routine" },
    "gym": { situation: "at the gym", action: "just finished working out" },
    "outdoor": { situation: "outside", action: "enjoying the weather" },
    "car": { situation: "in my car", action: "about to head out" },
    "travel": { situation: "on the go", action: "packing up" },
    "gift": { situation: "at home", action: "just opened this" },
    "unbox": { situation: "at home", action: "just got this delivered" },
  };

  let situation = "";
  let action = "";
  for (const [keyword, hint] of Object.entries(settingHints)) {
    if (g.includes(keyword)) {
      situation = hint.situation;
      action = hint.action;
      break;
    }
  }

  // Extract the core concept — what is the angle about?
  // e.g. "Corner angle. makes the empty corner cozy" → concept is about filling/transforming a space
  const conceptPatterns: Array<{ test: RegExp; concept: string; problem: string; payoff: string }> = [
    { test: /(corner|empty|awkward|gap|space|fill)/, concept: "transforming a space", problem: "had this awkward empty space that was bothering me", payoff: "it completely changed the vibe" },
    { test: /(cozy|warm|comfort|homey|inviting)/, concept: "making things cozy", problem: "wanted to make this space feel more like home", payoff: "it actually feels cozy now" },
    { test: /(before.?after|transform|change|makeover|glow.?up)/, concept: "a transformation", problem: "it used to look so different", payoff: "look at the difference" },
    { test: /(problem|solution|fix|solve|issue|struggle)/, concept: "solving a problem", problem: "been dealing with this for a while", payoff: "this actually fixed it" },
    { test: /(routine|daily|every.?day|habit|ritual)/, concept: "a daily routine", problem: "was looking for something that fits into my day", payoff: "it just slots right in" },
    { test: /(compare|versus|vs|better|switch|alternative)/, concept: "a comparison", problem: "tried a bunch of other options first", payoff: "this is the one that actually works" },
    { test: /(cheap|budget|affordable|price|value|worth)/, concept: "value for money", problem: "did not want to spend a fortune", payoff: "the quality for the price is wild" },
    { test: /(surprise|unexpected|did.?not.?expect|shock)/, concept: "a surprise", problem: "honestly did not expect much", payoff: "but then it actually surprised me" },
    { test: /(minimal|clean|simple|sleek|modern)/, concept: "keeping it minimal", problem: "wanted something that does not look out of place", payoff: "it fits perfectly" },
    { test: /(upgrade|level.?up|step.?up|premium|quality)/, concept: "an upgrade", problem: "finally decided to upgrade", payoff: "should have done this sooner" },
    { test: /(first.?time|just.?got|new|unbox|arrived)/, concept: "a first impression", problem: "just got this and had to talk about it", payoff: "the first impression is strong" },
    { test: /(aesthetic|look|style|vibe|design|decor)/, concept: "the aesthetic", problem: "was going for a certain look", payoff: "it nailed the vibe" },
  ];

  let concept = "this product";
  let problem = `started using ${productName} recently`;
  let payoff = "it actually delivered";

  for (const pattern of conceptPatterns) {
    if (pattern.test.test(g)) {
      concept = pattern.concept;
      problem = pattern.problem;
      payoff = pattern.payoff;
      break;
    }
  }

  // If we didn't match a setting from keywords, infer from category
  if (!situation) {
    const s = inferSettingForScript(guidance, category);
    situation = s.place;
    action = `using ${productName}`;
  }

  return { situation, action, concept, problem, payoff };
}

/**
 * Build 3 genuinely different scripts using different hook frameworks,
 * emotional angles, and energy levels. Each script should feel like it
 * came from a different person — not 3 drafts from the same template.
 */
function buildGeneratedScripts(input: UgcScriptInput, productName: string, category: string, knowledge: string) {
  const guidance = cleanText(input.description) || "";
  const categoryLabel = category || "product";
  const setting = inferSettingForScript(guidance, category);
  const lines = buildProductLines(knowledge, productName, category);
  const targetSeconds = input.totalSeconds || 20;
  const hasGuidance = guidance.length > 0;
  const targetWords = Math.round(targetSeconds * 3);

  const intent = hasGuidance
    ? parseGuidanceIntent(guidance, productName, category)
    : { situation: setting.place, action: `using ${productName}`, concept: "this product", problem: `started using ${productName} recently`, payoff: "it actually delivered" };

  // Build emotion-specific details based on the intent
  const emotionDetail = hasGuidance
    ? buildEmotionFromIntent(intent, productName, categoryLabel)
    : buildEmotionFromCategory(productName, categoryLabel, lines);

  // 3 genuinely different frameworks — different hook type, energy, arc
  const frameworks = buildScriptFrameworks(
    targetSeconds, targetWords, productName, categoryLabel,
    intent, emotionDetail, lines, hasGuidance, guidance, setting
  );

  return frameworks.map((variant, index) => {
    // Compress only if dialogue significantly exceeds budget — allow 30% flex for natural flow
    const flexBudget = Math.round(targetWords * 1.3);
    const dialogue = countWords(variant.dialogue) > flexBudget
      ? compressScript(variant.dialogue, flexBudget, productName)
      : variant.dialogue;
    const estimatedSeconds = estimateDurationSeconds(dialogue, input.totalSeconds);
    return {
      id: makeId("script", index),
      title: variant.title,
      rationale: variant.rationale,
      hook: variant.hook,
      cta: variant.cta,
      dialogue,
      estimatedSeconds,
      beats: buildScriptBeats(dialogue, estimatedSeconds, productName),
    } satisfies UgcScriptOption;
  });
}

function buildEmotionFromIntent(
  intent: ReturnType<typeof parseGuidanceIntent>,
  productName: string,
  categoryLabel: string
) {
  return {
    vulnerability: `I ${intent.problem} and honestly it was kind of annoying`,
    microMoment: `I was ${intent.situation} and I looked at it and just went huh`,
    identityShift: `I did not think I was the kind of person who cared about ${intent.concept} but here we are`,
    sensoryDetail: `the second I finished ${intent.action} I could feel the difference`,
    quietPayoff: `${intent.payoff} and I was not expecting that at all`,
  };
}

function buildEmotionFromCategory(
  productName: string,
  categoryLabel: string,
  lines: ReturnType<typeof buildProductLines>
) {
  return {
    vulnerability: `I have been burned by ${categoryLabel} before so I almost did not try this`,
    microMoment: `I was just going about my day and I noticed something was different`,
    identityShift: `I never thought I would be someone who actually cares about ${categoryLabel} but here I am`,
    sensoryDetail: lines.detail,
    quietPayoff: lines.reaction,
  };
}

type EmotionDetail = ReturnType<typeof buildEmotionFromIntent>;
type Intent = ReturnType<typeof parseGuidanceIntent>;
type Lines = ReturnType<typeof buildProductLines>;
type Setting = ReturnType<typeof inferSettingForScript>;

function buildScriptFrameworks(
  targetSeconds: number,
  targetWords: number,
  productName: string,
  categoryLabel: string,
  intent: Intent,
  emotion: EmotionDetail,
  lines: Lines,
  hasGuidance: boolean,
  guidance: string,
  setting: Setting,
) {
  // When guidance exists, scripts are FULLY about the guidance angle.
  // No generic category filler — every line serves the brief.
  // When no guidance, use category/product to drive the angle.

  if (hasGuidance) {
    return buildGuidanceDrivenFrameworks(targetSeconds, targetWords, productName, intent, guidance);
  }
  return buildCategoryDrivenFrameworks(targetSeconds, targetWords, productName, categoryLabel, lines, emotion, setting);
}

/**
 * Guidance-driven scripts: the guidance angle dominates EVERY line.
 * No generic product/category filler — the entire script is about the concept.
 */
function buildGuidanceDrivenFrameworks(
  targetSeconds: number,
  targetWords: number,
  productName: string,
  intent: Intent,
  guidance: string,
) {
  // Short scripts (<=15s)
  if (targetSeconds <= 15) {
    return [
      {
        title: `The ${intent.concept} moment`,
        rationale: `Micro-story — "${guidance}" as a moment the person is living right now.`,
        hook: `Wait.`,
        cta: ``,
        dialogue: trimToWords(`Wait. Look at this. I ${intent.problem} and I just put ${productName} right here. ${intent.payoff}. Like, I am ${intent.situation} right now looking at it.`, targetWords),
      },
      {
        title: `Honest take`,
        rationale: `Confession — "${guidance}" as something they were not sure about until it worked.`,
        hook: `Okay real talk.`,
        cta: ``,
        dialogue: trimToWords(`Okay real talk. I ${intent.problem} and I did not think ${productName} would actually help. But I am ${intent.situation} and ${intent.payoff}. That is it.`, targetWords),
      },
      {
        title: `No big deal`,
        rationale: `Quiet observation — "${guidance}" stated matter-of-factly with no excitement.`,
        hook: `So.`,
        cta: ``,
        dialogue: trimToWords(`So. I ${intent.problem}. Got ${productName}. Put it ${intent.situation}. ${intent.payoff}. I do not know why I am surprised.`, targetWords),
      },
    ];
  }

  // Medium scripts (<=25s)
  if (targetSeconds <= 25) {
    return [
      {
        title: `The ${intent.concept} moment`,
        rationale: `Micro-story — "${guidance}" as a specific scene with sensory detail and emotional arc.`,
        hook: `I was ${intent.situation} the other day and something happened.`,
        cta: ``,
        dialogue: trimToWords(`I was ${intent.situation} the other day and something happened. I ${intent.problem}. Like it was just sitting there bothering me. So I got ${productName} and I was ${intent.action}. And I stepped back and ${intent.payoff}. I keep going back to look at it.`, targetWords),
      },
      {
        title: `The honest version`,
        rationale: `Confession — admits "${guidance}" was a bigger deal than expected.`,
        hook: `I am going to be honest about something.`,
        cta: ``,
        dialogue: trimToWords(`I am going to be honest about something. I ${intent.problem} and it was driving me crazy. I tried a few things and nothing worked. Then I got ${productName} and I was ${intent.action}. And ${intent.payoff}. I did not expect to care this much but here I am ${intent.situation} just staring at it.`, targetWords),
      },
      {
        title: `No hype`,
        rationale: `Anti-sell — "${guidance}" presented with zero enthusiasm, just facts.`,
        hook: `This is not a big thing.`,
        cta: ``,
        dialogue: trimToWords(`This is not a big thing. I ${intent.problem}. I got ${productName}. I was ${intent.action} and now I am ${intent.situation}. ${intent.payoff}. It is not life-changing or whatever. But yeah, it works. Do what you want with that.`, targetWords),
      },
    ];
  }

  // Long scripts (25s+)
  return [
    {
      title: `The ${intent.concept} story`,
      rationale: `Full micro-story — "${guidance}" as a scene you walk into, with emotional buildup and payoff.`,
      hook: `Okay so I need to talk about something.`,
      cta: ``,
      dialogue: trimToWords(`Okay so I need to talk about something. I was ${intent.situation} and I ${intent.problem}. It was one of those things that just bugged me every time I looked at it. I tried a couple of things and nothing really did anything. Then someone mentioned ${productName} and I was like fine, whatever. So I was ${intent.action} and I stepped back and ${intent.payoff}. Like I just stood there for a second. The whole feel of being ${intent.situation} is different now. I did not think I would care this much about ${intent.concept} but here I am making a video about it.`, targetWords),
    },
    {
      title: `The honest version`,
      rationale: `Confession — opens with vulnerability about "${guidance}", builds to a genuine realization.`,
      hook: `I am going to be real with you.`,
      cta: ``,
      dialogue: trimToWords(`I am going to be real with you. I ${intent.problem} and I was kind of embarrassed about how much it bothered me. Like who cares right? But I do, apparently. So I got ${productName} and honestly I was not expecting much. I was ${intent.action} and then I was ${intent.situation} just looking at it. And ${intent.payoff}. It sounds stupid but it actually makes me feel better about the whole space now. I am not going to tell you what to do. But yeah, that is what happened.`, targetWords),
    },
    {
      title: `No hype, just this`,
      rationale: `Anti-sell — matter-of-fact about "${guidance}" with zero enthusiasm, just honest observations.`,
      hook: `I do not usually talk about stuff like this.`,
      cta: ``,
      dialogue: trimToWords(`I do not usually talk about stuff like this. But I ${intent.problem} and it had been bugging me for a while. Not like a huge deal, just one of those things. I ended up getting ${productName}. I was ${intent.action} and now I am ${intent.situation}. ${intent.payoff}. It is not going to change your life. But the thing is, every time I walk by it now it just looks right. And I think that is kind of the whole point. Do what you want with that information.`, targetWords),
    },
  ];
}

/**
 * Category-driven scripts: when no guidance is provided, use the product
 * category and knowledge to create scripts from different emotional angles.
 */
function buildCategoryDrivenFrameworks(
  targetSeconds: number,
  targetWords: number,
  productName: string,
  categoryLabel: string,
  lines: Lines,
  emotion: EmotionDetail,
  setting: Setting,
) {
  if (targetSeconds <= 15) {
    return [
      {
        title: "Caught mid-action",
        rationale: `High energy — camera catches them mid-activity with ${productName}.`,
        hook: `Wait wait wait.`,
        cta: ``,
        dialogue: trimToWords(`Wait wait wait. I am ${setting.place} right now and I just noticed something. ${lines.detail} I got ${productName} like a week ago and yeah. ${lines.reaction}`, targetWords),
      },
      {
        title: "Honest take",
        rationale: `Vulnerable opening about ${categoryLabel} — quiet admission that builds trust.`,
        hook: `Okay I was not going to post this.`,
        cta: ``,
        dialogue: trimToWords(`Okay I was not going to post this. ${emotion.vulnerability}. But ${productName}? ${lines.detail} That is literally it.`, targetWords),
      },
      {
        title: "Just noticed",
        rationale: `Anti-sell energy. No excitement, just an honest observation about ${productName}.`,
        hook: `Hm.`,
        cta: ``,
        dialogue: trimToWords(`Hm. So I have had ${productName} for a bit now. ${lines.detail} I do not know. ${lines.reaction}`, targetWords),
      },
    ];
  }

  if (targetSeconds <= 25) {
    return [
      {
        title: "The moment",
        rationale: `Micro-story — opens with a specific moment ${setting.place} that pulls the viewer in.`,
        hook: `I was ${setting.place} the other day and something happened.`,
        cta: ``,
        dialogue: trimToWords(`I was ${setting.place} the other day and something happened. ${emotion.vulnerability}. So I tried ${productName} and honestly? ${lines.detail} ${lines.reaction} I keep thinking about it.`, targetWords),
      },
      {
        title: "The contradiction",
        rationale: `Pattern interrupt — says something unexpected about ${categoryLabel}.`,
        hook: `Everyone is wrong about ${categoryLabel}.`,
        cta: ``,
        dialogue: trimToWords(`Everyone is wrong about ${categoryLabel}. Like, the whole conversation around it is off. ${emotion.identityShift}. Got ${productName} and ${lines.detail} ${lines.reaction} I am not making a whole thing out of this, it just actually works.`, targetWords),
      },
      {
        title: "No big deal",
        rationale: `Deliberately understated — almost reluctant to share. Builds trust through anti-sell.`,
        hook: `So.`,
        cta: ``,
        dialogue: trimToWords(`So. This is not a big moment or anything. ${emotion.vulnerability}. I ended up with ${productName}. ${lines.detail} It is not life-changing. But ${lines.reaction} And that is kind of the whole point.`, targetWords),
      },
    ];
  }

  return [
    {
      title: "The moment I noticed",
      rationale: `Full micro-story — drops into a sensory moment ${setting.place}, builds to emotional payoff.`,
      hook: `Okay so I need to talk about something.`,
      cta: ``,
      dialogue: trimToWords(`Okay so I need to talk about something. I was ${setting.place} and ${emotion.vulnerability}. I had tried a couple of things before and nothing really did it. Then I got ${productName}. ${lines.detail} And I just stood there for a second like wait. ${lines.reaction} ${emotion.identityShift}. I do not know, I just wanted to share that.`, targetWords),
    },
    {
      title: "The honest version",
      rationale: `Confession — opens with honesty about ${categoryLabel}, builds real trust.`,
      hook: `I am going to be honest about something.`,
      cta: ``,
      dialogue: trimToWords(`I am going to be honest about something. ${emotion.vulnerability}. Like genuinely, most ${categoryLabel} stuff just sits there and you forget about it. But somebody told me about ${productName} and I was like fine whatever. ${lines.detail} And then ${lines.reaction} ${lines.specifics} I am not going to sit here and tell you what to do. But yeah. That happened.`, targetWords),
    },
    {
      title: "No hype, just this",
      rationale: `Anti-sell energy throughout. Deliberately low-key, builds trust by NOT trying to convince.`,
      hook: `I do not really do this.`,
      cta: ``,
      dialogue: trimToWords(`I do not really do this. Talk about things I buy. It feels weird. But I have had ${productName} for a while now and ${emotion.microMoment}. ${lines.detail} It is not going to change your life or whatever. But ${lines.reaction} ${emotion.identityShift}. I do not know. Do what you want with that.`, targetWords),
    },
  ];
}

/** Trim dialogue to approximately the target word count, cutting at sentence boundaries. */
function trimToWords(text: string, targetWords: number): string {
  const sentences = splitSentences(text);
  const result: string[] = [];
  let wordCount = 0;
  // Allow 30% overflow — natural flow matters more than exact count
  const limit = Math.round(targetWords * 1.3);
  for (const sentence of sentences) {
    const words = countWords(sentence);
    if (wordCount + words > limit && result.length > 0) break;
    result.push(sentence);
    wordCount += words;
  }
  return result.join(" ");
}

function buildAvatarOptions(productName: string, guidance: string, category: string): UgcAvatarOption[] {
  return [
    {
      id: "avatar-1",
      label: "Relatable Everyday",
      persona: `A normal, relatable person who uses ${productName} in their real life and talks about it naturally.`,
      wardrobe: "Clean casual top, minimal accessories, natural grooming — looks like they grabbed their phone to film.",
      castingRationale: `Feels trustworthy and authentic for ${productName}. Not polished, just real.`,
      voiceStyle: "Warm, natural, conversational — like talking to a friend.",
    },
    {
      id: "avatar-2",
      label: "Knowledgeable User",
      persona: `Someone who clearly knows ${category || "the product"} well and shares their honest experience with authority.`,
      wardrobe: "Structured but approachable — neat layers, clean hair, understated.",
      castingRationale: "Good when the product needs credibility or the audience is more discerning.",
      voiceStyle: "Clear, confident, measured — not performative.",
    },
    {
      id: "avatar-3",
      label: "Aspirational",
      persona: "Someone whose lifestyle makes you want what they have — the product fits naturally into it.",
      wardrobe: "Put-together, tasteful, camera-ready but not overdone.",
      castingRationale: "Strong when the product benefits from aspirational positioning or visual appeal.",
      voiceStyle: "Bright, easygoing, naturally engaging.",
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

  // AIUGC-master's BASE_IMAGE_VARIATION_PROFILES — 6 exact profiles cycled by index
  // Each candidate must be visibly distinct in expression, pose, crop, and emotional register
  const expressionProfiles = [
    {
      expression: "Relieved half-smile with subtle asymmetry, like the product genuinely improved the space.",
      pose: "Relaxed shoulders and natural arm's-length selfie posture, body opened slightly toward the product.",
      crop: "Phone held just below eye level with the person anchored on the left third so the product reads clearly.",
      emotionalRegister: "quiet relief and a small genuine sense of satisfaction, not performative amazement",
    },
    {
      expression: "Pleasant just-arrived-home expression with soft surprise, not a worried or embarrassed face.",
      pose: "Torso angled toward the product with the head turning back toward the phone as if catching the moment.",
      crop: "Phone slightly farther from the face for more environment, with an off-center crop that reveals the product.",
      emotionalRegister: "the grounded emotional lift of arriving home to a space that suddenly feels welcoming",
    },
    {
      expression: "Thoughtful approving look with relaxed brows and a faint smile, as if noticing the material quality.",
      pose: "Slight lean that gives the product room to read, without stiff shoulders or mannequin posture.",
      crop: "Closer portrait crop with the face and product both in frame, avoiding dead-center symmetry.",
      emotionalRegister: "calm appreciation of the product's effect on texture, materials, and atmosphere",
    },
    {
      expression: "Matter-of-fact confident look with neutral-positive energy, not a repeated frown.",
      pose: "Natural stance with the person subtly stepping aside to let product details stay legible.",
      crop: "Slightly wider selfie crop with believable phone perspective and clear environment context.",
      emotionalRegister: "practical confidence that the space now feels intentional and real",
    },
    {
      expression: "Contented lived-in expression with a soft easy smile, like someone enjoying the mood of the space.",
      pose: "Casual relaxed posture with slight body turn and believable lifestyle ease, not square-on framing.",
      crop: "Warmer side-lit selfie angle with more environment visible so the shot feels lifestyle-led.",
      emotionalRegister: "comfortable lived-in warmth that feels aspirational without becoming glossy or staged",
    },
    {
      expression: "Attentive knowing look with subtle confidence and natural micro-expression.",
      pose: "Person held smaller in frame so the environment depth plays, while keeping natural selfie posture.",
      crop: "Deeper, slightly wider handheld selfie composition that prioritizes environment depth and product visibility.",
      emotionalRegister: "assured satisfaction in seeing the full environment finally read as warm and cohesive",
    },
  ];

  const cameraDirections = [
    "chest-up selfie framing",
    "eye-level, product held near lens",
    "three-quarter angle",
    "medium shot, more room visible",
    "slightly off-center composition",
    "lower angle, more presence",
    "classic selfie, phone on shelf",
    "wider context, environment emphasis",
  ];
  const lightingDirections = [
    "soft side window light",
    "neutral daylight",
    "warm golden practicals",
    "natural ambient, no studio feel",
  ];
  const sceneCount = clamp(settings.sceneVariationCount, 1, MAX_SCENE_VARIATIONS);

  return Array.from({ length: sceneCount }, (_, index) => {
    const override = overrides[index];
    const avatar =
      avatarOptions.find((option) => option.id === cleanText(override?.avatarId)) ||
      avatarOptions[index % avatarOptions.length];
    const camera = cleanText(override?.camera) || cameraDirections[index % cameraDirections.length];
    const lighting = cleanText(override?.lighting) || lightingDirections[index % lightingDirections.length];
    const profile = expressionProfiles[index % expressionProfiles.length];
    const expressionProfile = `${profile.expression}, ${profile.pose}, ${profile.crop}`;
    const title = cleanText(override?.title) || `Base Scene ${index + 1}`;
    const summary =
      cleanText(override?.summary) ||
      index === 0
        ? "Clean, natural framing with clear product visibility."
        : index === 1
          ? "Different angle and expression — more energy."
          : index === 2
            ? "Warmer, more intimate framing."
            : "Alternate composition — different pose and crop.";
    const environment = cleanText(override?.environment) || baseEnvironment;

    // First script line as narrative seed for the scene
    const firstLine = splitSentences(script.dialogue)[0] || "";

    // AIUGC-master layered prompt structure
    const promptParts = [
      // Core frame
      `Ultra-realistic iPhone front-camera UGC frame. It must look like a real smartphone screenshot, not CGI or illustration.`,
      // Product anchor
      `Reference object anchor: ${productName} (${productAppearance}).`,
      // Environment
      `Environment: ${environment}.`,
      // Scene depth architecture
      `Scene depth architecture: Foreground: ${avatar.label} in the close near-field of a front camera, with natural handheld presence; Mid-ground: the immediate lived-in space, arranged so ${productName} is visible and legible; Background: the deeper room or exterior context, with believable light falloff and environmental depth.`,
      // Expression direction
      `Expression direction: ${profile.expression}`,
      `Pose direction: ${profile.pose}`,
      `Camera variation for this candidate: ${profile.crop}`,
      `Emotional register: ${profile.emotionalRegister}`,
      // Lighting
      `${lighting}.`,
      // Persona
      `${avatar.label}: ${avatar.persona}. Wardrobe: ${avatar.wardrobe}.`,
      // Phone camera physics
      `Selfie camera physics: preserve the characteristic close near-field of a front camera, slight smartphone wide-angle compression, and subtle front-camera fisheye at the frame corners.`,
      // Human realism
      `Human realism requirements: subtle asymmetry in expression, believable eye moisture, real pores, natural flyaway hairs, non-identical mouth/brow shapes, and no mannequin face, dead eyes, cloned expression, or generic AI beauty pass.`,
      // Phone camera realism
      `Phone-camera realism requirements: natural skin texture, believable smartphone HDR, realistic edge detail, real-world lighting falloff, subtle handheld imperfections, no synthetic plastic skin, realistic exposure rolloff, and no camera UI visible.`,
      // Variation directive
      `Variation directive: this candidate must be visibly distinct from the other base-image options in expression, pose, crop, and light interaction while keeping the product identical.`,
      // Product constraints
      `Product: ${productName}. Must preserve exactly: product form, silhouette, materials, colors, and branding. Product must stay true to real appearance.`,
      `Product visibility requirement: Keep product immediately readable at glance with clean contrast, practical lighting, unobstructed silhouette.`,
      `Product prominence guidance: The product should be clearly identifiable and on-screen, but integrated into complete lifestyle scene rather than dominating whole frame like catalog hero shot.`,
      `Forbidden mutations: do not change product color, shape, branding, or materials. No one holding a phone.`,
      // Narrative seed
      firstLine ? `Narrative seed from opening script line: "${firstLine}". Use only as scene context, not as literal instruction.` : "",
    ].filter(Boolean);

    return {
      id: makeId("scene", index),
      title,
      summary,
      environment,
      avatarId: avatar.id,
      camera,
      lighting,
      expressionProfile,
      prompt: promptParts.join(" "),
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

  const movementByRole: Record<UgcStoryRole, string> = {
    hook: "settle into frame, natural energy",
    problem: "slight tension, relatable frustration",
    product_moment: "glance at product, natural gesture",
    proof: "subtle reaction, genuine",
    cta: "gentle nod, winding down",
    support: "small hand gesture, relaxed",
  };

  return segments.map((segment, index) => {
    const priorDuration = segments
      .slice(0, index)
      .reduce((total, item) => total + item.durationSeconds, 0);
    const startSecond = priorDuration;
    const endSecond = startSecond + segment.durationSeconds;
    const storyRole = detectStoryRole(segment.text, index, segments.length, productName);
    const shotType = assignShotType(segment.text, storyRole, index, segment.durationSeconds);
    const movement = movementByRole[storyRole];
    return {
      id: makeId("dialogue-clip", index),
      index,
      startSecond,
      endSecond,
      durationSeconds: segment.durationSeconds,
      wordCount: segment.wordCount,
      spokenText: segment.text,
      storyRole,
      shotType,
      objective: storyRole,
      movement,
      camera: "natural",
      prompt: `${segment.durationSeconds}-second ${settings.videoAspectRatio} video from the base scene image. The person says this EXACT line naturally: "${segment.text}". Natural motion, ${movement}. The scene comes to life from the image — same person, same room, same lighting. Spoken audio with synced mouth movement.`,
    };
  });
}

/**
 * Build B-roll shots that are narrative-matched to specific story beats.
 * Each B-roll shot has a purpose in the story — it covers a specific moment
 * rather than being a random angle. Inspired by AIUGC-master's shot graph.
 */
function buildBrollImagePlans(
  script: UgcScriptOption,
  productName: string,
  productAppearance: string,
  settings: UgcPlanRequest["settings"],
  overrides: UgcAnthropicCreativeBroll[] = []
): UgcBrollImagePlan[] {
  // Analyze the script to find narrative moments worth covering with B-roll
  const beats = buildScriptBeats(script.dialogue, script.estimatedSeconds, productName);
  const narrativeShots = matchBrollToBeats(beats, productName);

  const count = clamp(settings.bRollClipCount, 1, MAX_BROLL_CLIPS);

  return Array.from({ length: count }, (_, index) => {
    const narrativeShot = narrativeShots[index % narrativeShots.length];
    const override = overrides[index];
    const title = cleanText(override?.title) || narrativeShot.title;
    const objective = cleanText(override?.objective) || narrativeShot.objective;
    const angle = cleanText(override?.angle) || narrativeShot.angle;
    const lens = cleanText(override?.lens) || narrativeShot.lens;
    const lighting = cleanText(override?.lighting) || narrativeShot.lighting;
    const withoutHuman = typeof override?.withoutHuman === "boolean" ? override.withoutHuman : narrativeShot.withoutHuman;
    return {
      id: makeId("broll-image", index),
      index,
      title,
      objective,
      storyPhase: narrativeShot.storyPhase,
      coversBeatId: narrativeShot.coversBeatId,
      angle,
      lens,
      lighting,
      withoutHuman,
      prompt: `${settings.imageAspectRatio} ${settings.imageResolution} photo of ${productName} (${productAppearance}). Same scene and lighting as the base image but a different, ${angle}. Vary the distance and perspective. ${withoutHuman ? "No person in frame." : "Person can appear but product is the focus."} Be creative with the composition.`,
    };
  });
}

/**
 * Match B-roll shots to narrative beats — each B-roll shot covers a story moment.
 * Returns at least 5 shot blueprints, prioritized by narrative importance.
 */
function matchBrollToBeats(
  beats: UgcScriptBeat[],
  productName: string,
): Array<{
  title: string;
  objective: string;
  storyPhase: UgcStoryRole;
  coversBeatId: string;
  angle: string;
  lens: string;
  lighting: string;
  withoutHuman: boolean;
}> {
  const shots: Array<{
    title: string;
    objective: string;
    storyPhase: UgcStoryRole;
    coversBeatId: string;
    angle: string;
    lens: string;
    lighting: string;
    withoutHuman: boolean;
    priority: number;
  }> = [];

  // Map each story role to a specific B-roll shot type
  const roleToShot: Record<UgcStoryRole, {
    title: string;
    angle: string;
    lens: string;
    withoutHuman: boolean;
    priority: number;
  }> = {
    hook: {
      title: "Scene establish",
      angle: "wider perspective, the room and environment",
      lens: "wide",
      withoutHuman: true,
      priority: 2,
    },
    problem: {
      title: "Before state",
      angle: "the space or situation before the product, empty or incomplete",
      lens: "natural",
      withoutHuman: true,
      priority: 3,
    },
    product_moment: {
      title: "Product reveal",
      angle: "close-up of the product in its real position, the moment it enters the scene",
      lens: "close",
      withoutHuman: false,
      priority: 5,
    },
    proof: {
      title: "After state",
      angle: "the result — the improved space, the visible difference, the product working",
      lens: "medium",
      withoutHuman: true,
      priority: 4,
    },
    cta: {
      title: "Product detail",
      angle: "macro detail, texture or material close-up",
      lens: "macro",
      withoutHuman: true,
      priority: 1,
    },
    support: {
      title: "Alternate angle",
      angle: "different perspective, vary the distance and height creatively",
      lens: "natural",
      withoutHuman: true,
      priority: 0,
    },
  };

  for (const beat of beats) {
    const shotTemplate = roleToShot[beat.storyRole];
    shots.push({
      ...shotTemplate,
      objective: `Covers "${beat.text.slice(0, 60)}..." — ${shotTemplate.title.toLowerCase()} for the ${beat.storyRole} moment`,
      storyPhase: beat.storyRole,
      coversBeatId: beat.id,
      lighting: "same room light, match the base scene",
    });
  }

  // Sort by narrative priority (product_moment > proof > problem > hook > cta > support)
  shots.sort((a, b) => b.priority - a.priority);

  // Deduplicate by story phase — keep highest priority per role
  const seen = new Set<UgcStoryRole>();
  const unique = shots.filter((shot) => {
    if (seen.has(shot.storyPhase)) return false;
    seen.add(shot.storyPhase);
    return true;
  });

  // Ensure at least 5 shots by adding fallback angles if needed
  const fallbacks = [
    { title: "Close-up", angle: "close-up, tight crop on the product", lens: "close", withoutHuman: true, storyPhase: "support" as UgcStoryRole, coversBeatId: "", objective: "Product close-up from a different angle", lighting: "same room light, match the base scene", priority: 0 },
    { title: "Interaction", angle: "hands interacting with the product naturally", lens: "medium", withoutHuman: false, storyPhase: "product_moment" as UgcStoryRole, coversBeatId: "", objective: "The product being touched or used", lighting: "same room light, match the base scene", priority: 0 },
    { title: "Wide room", angle: "wider view showing the full environment", lens: "wide", withoutHuman: true, storyPhase: "hook" as UgcStoryRole, coversBeatId: "", objective: "Full context of the space", lighting: "same room light, match the base scene", priority: 0 },
  ];

  while (unique.length < 5 && fallbacks.length > 0) {
    unique.push(fallbacks.shift()!);
  }

  return unique;
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
    prompt: `${settings.clipDurationSeconds}-second ${settings.videoAspectRatio} B-roll clip from the start image. Gentle, natural motion — the scene comes to life. Keep it smooth and cinematic.`,
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
  const category = cleanText(input.product.category) || "product";
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
              estimateDurationSeconds(input.script.text, input.script.totalSeconds),
              productName
            ),
          } satisfies UgcScriptOption,
        ]
      : buildGeneratedScripts(input.script, productName, category, input.knowledge);

  const selectedScript = scriptOptions[0];
  const avatarOptions = buildAvatarOptions(productName, input.script.description, category);
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
    productAnalysis: `${productName} is a ${category}. The workflow should preserve its real appearance, keep it readable in vertical framing, and stage it naturally for both direct-to-camera talking and supporting B-roll shots. ${productAppearance}`,
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
  const category = cleanText(input.product.category) || "product";
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
      beats: buildScriptBeats(dialogue, estimatedSeconds, productName),
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

  const hasGuidance = !!cleanText(input.script.description);

  const targetSeconds = input.script.totalSeconds || 20;
  const targetWords = Math.round(targetSeconds * 3);

  const prompt = `Write 3 short-form video scripts for the product below.${hasGuidance ? `\n\nCREATIVE DIRECTION: "${input.script.description}"\nThis is the angle. Everything flows from this. Every script must be ABOUT this direction. Interpret it creatively but never drift from it.` : `\n\nNo creative direction provided. Find the most specific, interesting angle for this exact product.`}

PRODUCT
- Name: ${input.product.name}
- Category: ${input.product.category || "general"}
- Vendor: ${input.product.vendor || "unknown"}
- Knowledge: ${input.knowledge || "None"}

CONSTRAINTS
- Duration: ~${targetSeconds} seconds ≈ ${targetWords} words (3 words/second). Flexible — natural flow matters more than exact count, but stay in the ballpark.
- ${input.overrideInstructions ? `OVERRIDE: ${input.overrideInstructions}` : ""}

Write scripts that sound like a real person talking into their phone. Each script should be tailored to the creative direction and product. 3 genuinely different approaches — different person, different angle, different energy. No marketing language. No formulas. No call to action at the end.

Keep same JSON shape and array lengths as the baseline. Preserve IDs. Return only JSON. No markdown fences.

BASELINE PLAN
${JSON.stringify(baseline)}`;

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

  const hasGuidance = !!cleanText(input.script.description);
  const targetSeconds = input.script.totalSeconds || 20;
  const targetWords = Math.round(targetSeconds * 3);

  const prompt = `Write 3 short-form video scripts for the product below.${hasGuidance ? `\n\nCREATIVE DIRECTION: "${input.script.description}"\nThis is the angle. Everything flows from this. Every script must be ABOUT this direction — not a generic product script with this sprinkled in. If this says "corner" the scripts are about a corner. If it says "morning routine" the scripts happen in the morning. Interpret it creatively but never drift away from it.` : `\n\nNo creative direction was provided. Find the most specific, interesting angle for this exact product. Not generic category talk — something particular to THIS product that would make a real person want to film a video about it.`}

PRODUCT
- Name: ${input.product.name}
- Category: ${input.product.category || "general"}
- Vendor: ${input.product.vendor || "unknown"}
- Appearance: ${input.product.appearanceNotes || "standard product appearance"}
- Knowledge: ${input.knowledge || "None provided"}

CONSTRAINTS
- Target duration: ~${targetSeconds} seconds ≈ ${targetWords} words (conversational speech ≈ 3 words/second)
- This is approximate — natural flow and completeness matter more than hitting an exact number. Stay in the general range but don't cut a good script short to hit a word count.
- ${input.overrideInstructions ? `OVERRIDE: ${input.overrideInstructions}` : "No additional overrides."}

WHAT I NEED FROM YOU
Write scripts that sound like a real person talking into their phone — not a copywriter, not a brand, not AI. Each script should:
- Be tailored specifically to the creative direction and this specific product
- Sound speakable — sentence fragments, filler words, natural rhythm, varied pacing
- Open with something that makes someone stop scrolling BEFORE they know it's about a product
- Let the product enter naturally through experience, not explanation
- End like a real person — mid-thought, trailing off, a shrug. No call to action.
- Each of the 3 scripts must feel like a DIFFERENT person wrote it. Different angle, energy, setting, opening move.

DO NOT:
- Write the same script 3 times with surface-level variations
- Use marketing language ("game-changer", "obsessed", "you need this", "holy grail")
- Follow a formula (problem → product → solved) — real content doesn't move in clean arcs
- Write scripts so generic they could apply to any product in the category

Return only valid JSON. No markdown fences.

JSON SHAPE
{
  "productAnalysis": "string — what makes someone actually WANT this, emotionally",
  "selectedScriptId": "script-1",
  "scriptOptions": [
    ${[1, 2, 3].map((n) => `{ "id": "script-${n}", "title": "string — short creative title", "rationale": "string — what angle this takes and why it works", "hook": "string — the opening line", "cta": "string — the natural exit line (NOT a call to action)", "dialogue": "string — the full spoken script, ${targetWords} words max" }`).join(",\n    ")}
  ],
  "avatarOptions": [
    ${baseline.avatarOptions.map((a) => `{ "id": "${a.id}", "label": "string", "persona": "string", "wardrobe": "string", "castingRationale": "string", "voiceStyle": "string" }`).join(",\n    ")}
  ],
  "sceneVariations": [
    ${baseline.sceneVariations.map((s) => `{ "id": "${s.id}", "title": "string", "summary": "string", "environment": "string — specific real place, lived-in details", "avatarId": "avatar-1 | avatar-2 | avatar-3", "camera": "string", "lighting": "string" }`).join(",\n    ")}
  ],
  "bRollImagePlans": [
    ${baseline.bRollImagePlans.map((p) => `{ "id": "${p.id}", "title": "string", "objective": "string — what story moment this covers", "angle": "string", "lens": "string", "lighting": "string", "withoutHuman": boolean }`).join(",\n    ")}
  ]
}`;

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
          "You are a world-class scriptwriter for short-form video. You write scripts that sound like real people — not copywriters, not brands, not AI. Every script you write is tailored to the specific creative direction and product. You never rely on templates or formulas. You find the most interesting, specific, human angle and write from there. Return only valid JSON.",
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
