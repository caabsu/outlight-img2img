export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { getModelById } from "@/lib/models";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/* ========================= TYPES ========================= */

type AdGenerateRequest = {
  modelId: string;
  quantity: number;
  theme: string;
  productId: string;
  aspectRatios: string[];
  profileId: string;
  concurrency?: number;
  modelOptions?: {
    quality?: string;
    resolution?: string;
    size?: string;
    background?: string;
    nsfw_checker?: string | boolean;
  };
};

type SSEEvent =
  | { type: "phase"; phase: string; message: string }
  | { type: "thought"; message: string }
  | { type: "action"; message: string }
  | { type: "concept"; index: number; concept: { name: string; description: string; headline?: string; tagline?: string; prompts: Record<string, string> } }
  | { type: "image"; conceptIndex: number; ratio: string; url: string; prompt: string }
  | { type: "error"; message: string; conceptIndex?: number }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; summary: any }
  | { type: "cancelled" };

type CampaignPlan = {
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
  concepts: Array<{
    name: string;
    description: string;
    headline?: string;
    tagline?: string;
    prompts: Record<string, string>;
  }>;
};

/* ========================= SYSTEM PROMPT ========================= */

const AD_STUDIO_BASE_PROMPT = `You are the creative director of Ad Studio for an ecommerce brand that sells lights and lighting products (lamps, pendants, chandeliers, sconces, LED fixtures, etc). Your role is to produce FINISHED static Facebook/Instagram ad creatives — not just product photos, but complete advertisements with text overlay specifications.

## CRITICAL: These Are Finished Ads, Not Product Photos
Every image prompt MUST describe a COMPLETE ADVERTISEMENT that includes:
1. The product (the lighting fixture) as the hero, photographed/rendered in a lifestyle setting
2. TEXT OVERLAY ZONES — you must specify where text appears and what it says
3. A CTA (call-to-action) element like "Shop Now" or "Order Today"

## Typography & Text Overlay Mandate
Every single prompt MUST include explicit text overlay instructions:
- **Product name** — specify placement (top-center, bottom-left, etc), approximate font style (modern sans-serif, elegant serif, etc), and color
- **Price** — if provided, specify where the price tag/badge appears
- **CTA button** — describe a button or text element like "Shop Now", "Discover More", "Order Today" with placement and style
- **Tagline** — a short catchy phrase that appears on the ad

Example text overlay section in a prompt:
"...TEXT OVERLAYS: Top-center in clean white modern sans-serif typography reading '[PRODUCT NAME]'. Bottom-right a rounded pill button in warm amber reading 'Shop Now'. Price '$XX' in a small badge top-right corner. Tagline '[tagline]' in italicized light font below the product name..."

## Product-First Prompts
- Always describe the actual product's physical appearance: its shape, materials, finish, how it emits light
- Reference the product name naturally in the scene description
- Include the product's price point in the ad layout if provided
- The product should be the HERO — it must be prominently featured, well-lit, and clearly visible

## Aspect Ratio Consistency
- 1:1 and 9:16 prompts for the SAME concept must show the SAME creative idea, SAME color palette, SAME mood, SAME product styling
- The only difference is framing: 1:1 is square/centered, 9:16 adds vertical space above and below for text
- 9:16: Leave generous top 15-20% and bottom 15-20% for text overlays. Product sits in the middle 60%.
- 1:1: Product centered. Text overlays integrated into the composition with less negative space.
- Think of it as cropping the same scene differently, NOT creating two different scenes

## Theme Handling
- The creative theme is the user's primary creative input — treat it as sacred
- Interpret the theme through multiple creative lenses to generate distinct concepts
- Each concept must feel like a different creative director's interpretation of the same brief
- Balance between literal and abstract interpretations of the theme

## Prompt Writing
- Write prompts as vivid, cinematic scene descriptions (150-250 words each to accommodate text overlay specs)
- Lead with composition and camera angle, then subject, environment, lighting, materials, atmosphere
- Use specific photographic terminology: focal length, depth of field, exposure, color grading
- Be specific with materials (matte, glossy, brushed aluminum, raw linen, brass, copper)
- Be specific with lighting (golden hour, warm ambient glow, diffused studio, neon rim)
- Be specific with atmosphere (cozy, modern, minimalist, luxurious, industrial)
- ALWAYS end each prompt with a detailed TEXT OVERLAYS section

## Output Quality
- Each concept should evoke a distinct emotional response
- Each concept gets a headline (short, punchy ad headline) and tagline (supporting copy line)
- These headline/tagline values should match what you specify in the text overlay instructions`;

function buildSystemPrompt(learnings: string[]): string {
  if (learnings.length === 0) return AD_STUDIO_BASE_PROMPT;

  // Group learnings by category for structured presentation
  const byCategory: Record<string, string[]> = {};
  for (const l of learnings) {
    const match = l.match(/^\[(\w+)\]\s*(.*)/);
    if (match) {
      const cat = match[1];
      const text = match[2];
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(text);
    } else {
      if (!byCategory["general"]) byCategory["general"] = [];
      byCategory["general"].push(l);
    }
  }

  const rulesBlock = Object.entries(byCategory)
    .map(([category, items]) => {
      const label = category.replace(/_/g, " ").toUpperCase();
      return `### ${label}\n${items.map((item) => `- ${item}`).join("\n")}`;
    })
    .join("\n\n");

  return `${AD_STUDIO_BASE_PROMPT}

## ⚠️ MANDATORY KNOWLEDGE BASE — YOU MUST FOLLOW THESE RULES

The following rules were learned from real user feedback on previous campaigns. These are NOT optional suggestions — they are hard constraints that you MUST obey in every concept and every prompt you generate. Violating any of these rules is a critical failure.

Before writing each prompt, mentally check it against EVERY rule below. If a prompt would violate any rule, rewrite it until it complies.

${rulesBlock}

**COMPLIANCE REQUIREMENT**: When writing the "creativeRationale" field in the brief, explicitly mention which knowledge base rules most influenced your creative decisions. This proves you read and applied them.`;
}

/* ========================= HELPERS ========================= */

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function fetchProduct(productId: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,slug,image_url,shopify_vendor,shopify_product_type,shopify_price,shopify_images")
    .eq("id", productId)
    .single();
  if (error) throw new Error(`Failed to fetch product: ${error.message}`);
  if (!data) throw new Error("Product not found");
  return data;
}

async function fetchLearnings(): Promise<string[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ad_studio_learnings")
    .select("learning, category")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return data.map((l: { learning: string; category: string }) => `[${l.category}] ${l.learning}`);
}

function buildUserMessage(
  product: any,
  theme: string,
  quantity: number,
  aspectRatios: string[],
  learnings: string[]
): string {
  const ratioList = aspectRatios.join(", ");
  const priceNote = product.shopify_price ? `$${product.shopify_price}` : "N/A";

  let learningsReminder = "";
  if (learnings.length > 0) {
    learningsReminder = `\n\nREMINDER: You MUST comply with ALL ${learnings.length} rules in your MANDATORY KNOWLEDGE BASE (from your system instructions). Double-check every prompt against those rules before finalizing. In your "creativeRationale", cite specific rules you applied.`;
  }

  return `Create an ad campaign for this lighting product:

PRODUCT:
- Name: ${product.name}
- Type: ${product.shopify_product_type || "lighting fixture"}
- Vendor: ${product.shopify_vendor || "N/A"}
- Price: ${priceNote}
- Product image URL: ${product.image_url || "N/A"}

CREATIVE THEME: "${theme}"

REQUIREMENTS:
- Generate exactly ${quantity} distinct creative concepts
- Each concept needs prompts for these aspect ratios: ${ratioList}
- Each prompt should be 150-250 words including text overlay specifications
- Every prompt MUST end with a TEXT OVERLAYS section specifying product name, price (if available), CTA, and tagline placement
- The product "${product.name}" must be the hero of every ad — clearly visible, well-lit, prominent
- 1:1 and 9:16 for the same concept must show the SAME scene, just reframed
- Each concept needs a headline and tagline that match the text overlays in the prompts${learningsReminder}

Return ONLY valid JSON (no markdown fences) in this exact format:
{
  "brief": {
    "productAnalysis": "Concise analysis of the product's visual identity and market positioning",
    "themeInterpretation": "How you interpret the creative theme and its emotional resonance",
    "targetMood": ["mood1", "mood2", "mood3"],
    "styleDirection": "The overarching visual style direction for this campaign",
    "colorPalette": ["color1", "color2", "color3", "color4"],
    "keyElements": ["element1", "element2", "element3"],
    "moodBoard": "A vivid description of the mood board — reference films, photographers, art movements, textures, and color worlds that define the visual territory",
    "creativeRationale": "Why this creative direction will resonate with the audience and elevate the product — MUST reference specific knowledge base rules you applied"
  },
  "concepts": [
    {
      "name": "Concept Name",
      "description": "Brief concept description",
      "headline": "Short punchy ad headline (2-6 words)",
      "tagline": "Supporting tagline copy (5-12 words)",
      "prompts": {
        ${aspectRatios.map((r) => `"${r}": "Detailed 150-250 word prompt for ${r} format including TEXT OVERLAYS section..."`).join(",\n        ")}
      }
    }
  ]
}`;
}

async function callAIForCampaign(
  product: any,
  theme: string,
  quantity: number,
  aspectRatios: string[],
  learnings: string[]
): Promise<CampaignPlan> {
  const anthropic = new Anthropic();

  const userMessage = buildUserMessage(product, theme, quantity, aspectRatios, learnings);
  const systemPrompt = buildSystemPrompt(learnings);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 16384,
    system: systemPrompt,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const raw = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();

  // Try direct parse first
  let parsed: CampaignPlan | null = null;
  try {
    parsed = JSON.parse(raw) as CampaignPlan;
  } catch {
    // Claude may have added text before/after the JSON object — extract it
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const jsonStr = raw.slice(firstBrace, lastBrace + 1);
      try {
        parsed = JSON.parse(jsonStr) as CampaignPlan;
      } catch {
        // Try fixing common issues: trailing commas before closing brackets
        const fixed = jsonStr
          .replace(/,\s*}/g, "}")
          .replace(/,\s*]/g, "]");
        parsed = JSON.parse(fixed) as CampaignPlan;
      }
    } else {
      throw new Error("No JSON object found in Claude response");
    }
  }

  if (!parsed || !parsed.brief || !Array.isArray(parsed.concepts)) {
    throw new Error("Invalid campaign plan structure from Claude");
  }

  return parsed;
}

async function callGenerateAPI(
  origin: string,
  modelId: string,
  profileId: string,
  productId: string,
  prompt: string,
  aspectRatio: string,
  modelOptions?: AdGenerateRequest["modelOptions"]
): Promise<string> {
  const options: Record<string, any> = {};

  const modelDef = getModelById(modelId);
  if (!modelDef) throw new Error(`Unknown model: ${modelId}`);

  if (modelDef.aspectRatioOptions) {
    options.aspect_ratio = aspectRatio;
  }
  if (modelOptions?.quality) {
    options.quality = modelOptions.quality;
  }
  if (modelOptions?.resolution) {
    options.image_size = modelOptions.resolution;
  }
  if (modelOptions?.background) {
    options.gpt_background = modelOptions.background;
  }
  if (modelId === "gpt-1.5") {
    if (modelOptions?.size) {
      options.gpt_size = modelOptions.size;
    } else {
      const sizeMap: Record<string, string> = {
        "1:1": "1024x1024",
        "9:16": "1024x1536",
        "16:9": "1536x1024",
      };
      options.gpt_size = sizeMap[aspectRatio] || "auto";
    }
  }
  if (modelId === "gpt-2") {
    options.nsfw_checker = modelOptions?.nsfw_checker === true || modelOptions?.nsfw_checker === "true";
  }

  const body = {
    modelId,
    profileId,
    productId,
    prompt,
    options,
  };

  const res = await fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Generation failed (${res.status})`);
  }

  const result = await res.json();
  if (!result.imageDataUrl) throw new Error("No image returned");
  return result.imageDataUrl;
}

/* ========================= ROUTE ========================= */

export async function POST(req: Request) {
  const body = (await req.json()) as AdGenerateRequest;
  const { modelId, quantity, theme, productId, aspectRatios, profileId, concurrency, modelOptions } = body;

  if (!modelId || !theme || !productId || !profileId) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeQuantity = Math.max(1, Math.min(10, quantity || 3));
  const safeRatios = (aspectRatios?.length ? aspectRatios : ["1:1", "9:16"]).filter((r) =>
    ["1:1", "9:16"].includes(r)
  );
  if (safeRatios.length === 0) safeRatios.push("1:1");

  const url = new URL(req.url);
  const origin = url.origin;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // Stream may be closed
        }
      };

      try {
        // Phase 1: ANALYZE
        send({ type: "phase", phase: "analyze", message: "Analyzing product and theme..." });

        const product = await fetchProduct(productId);
        send({
          type: "thought",
          message: `Product: ${product.name} (${product.shopify_product_type || "lighting"})`,
        });
        if (product.shopify_vendor) {
          send({ type: "thought", message: `Vendor: ${product.shopify_vendor}` });
        }
        if (product.shopify_price) {
          send({ type: "thought", message: `Price: $${product.shopify_price}` });
        }
        send({ type: "thought", message: `Theme: "${theme}"` });

        // Fetch learnings from previous campaigns
        const learnings = await fetchLearnings();
        if (learnings.length > 0) {
          send({ type: "thought", message: `Applying ${learnings.length} learnings from previous campaigns` });
          for (const l of learnings) {
            send({ type: "thought", message: `Learning: ${l}` });
          }
        }

        // Phase 2: IDEATE
        send({ type: "phase", phase: "ideate", message: `Generating ${safeQuantity} creative concepts with Claude...` });
        send({ type: "action", message: "Calling Claude to plan campaign..." });

        const campaign = await callAIForCampaign(product, theme, safeQuantity, safeRatios, learnings);

        // Stream richer brief thoughts
        if (campaign.brief) {
          send({ type: "thought", message: `Theme interpretation: ${campaign.brief.themeInterpretation}` });
          if (campaign.brief.moodBoard) {
            send({ type: "thought", message: `Mood board: ${campaign.brief.moodBoard}` });
          }
          if (campaign.brief.styleDirection) {
            send({ type: "thought", message: `Style direction: ${campaign.brief.styleDirection}` });
          }
          if (campaign.brief.creativeRationale) {
            send({ type: "thought", message: `Creative rationale: ${campaign.brief.creativeRationale}` });
          }
          if (campaign.brief.colorPalette?.length) {
            send({ type: "thought", message: `Color palette: ${campaign.brief.colorPalette.join(", ")}` });
          }
          if (campaign.brief.targetMood?.length) {
            send({ type: "thought", message: `Target mood: ${campaign.brief.targetMood.join(", ")}` });
          }
        }

        // Phase 3: CRAFT - stream concepts
        send({ type: "phase", phase: "craft", message: "Crafting image prompts..." });
        campaign.concepts.forEach((c, i) => {
          send({ type: "concept", index: i, concept: c });
          send({ type: "action", message: `Concept ${i + 1}: "${c.name}" — ${c.description}` });
        });
        send({ type: "thought", message: `${campaign.concepts.length} concepts with ${safeRatios.length} format(s) each` });

        // Phase 4: GENERATE
        const totalImages = campaign.concepts.length * safeRatios.length;
        send({ type: "phase", phase: "generate", message: `Generating ${totalImages} images...` });

        const tasks: Array<{
          ci: number;
          concept: (typeof campaign.concepts)[0];
          ratio: string;
          prompt: string;
        }> = [];
        for (const [ci, concept] of campaign.concepts.entries()) {
          for (const ratio of safeRatios) {
            const prompt = concept.prompts[ratio];
            if (prompt) {
              tasks.push({ ci, concept, ratio, prompt });
            }
          }
        }

        const modelMax = getModelById(modelId)?.maxConcurrency || 3;
        const maxConcurrency = concurrency ? Math.min(Math.max(1, concurrency), modelMax) : modelMax;
        let cursor = 0;
        let done = 0;
        let successCount = 0;
        let failCount = 0;
        const generatedImages: Array<{ conceptIndex: number; ratio: string; url: string; prompt: string }> = [];

        const worker = async () => {
          while (cursor < tasks.length) {
            const idx = cursor++;
            const task = tasks[idx];
            send({ type: "action", message: `Generating "${task.concept.name}" at ${task.ratio}...` });

            const maxRetries = 3;

            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              try {
                const imageUrl = await callGenerateAPI(
                  origin,
                  modelId,
                  profileId,
                  productId,
                  task.prompt,
                  task.ratio,
                  modelOptions
                );

                generatedImages.push({
                  conceptIndex: task.ci,
                  ratio: task.ratio,
                  url: imageUrl,
                  prompt: task.prompt,
                });

                send({
                  type: "image",
                  conceptIndex: task.ci,
                  ratio: task.ratio,
                  url: imageUrl,
                  prompt: task.prompt,
                });

                successCount++;
                break;
              } catch (err: any) {
                if (attempt < maxRetries) {
                  const delay = Math.min(10000, 1000 * 2 ** attempt);
                  send({
                    type: "action",
                    message: `Retrying "${task.concept.name}" (${task.ratio}) — attempt ${attempt + 2}/${maxRetries + 1}...`,
                  });
                  await sleep(delay);
                } else {
                  send({
                    type: "error",
                    message: `Failed after ${maxRetries + 1} attempts: ${task.concept.name} (${task.ratio}) — ${err.message}`,
                    conceptIndex: task.ci,
                  });
                  failCount++;
                }
              }
            }

            done++;
            send({ type: "progress", done, total: totalImages });
          }
        };

        await Promise.all(Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () => worker()));

        // Phase 5: FINALIZE
        send({
          type: "phase",
          phase: "complete",
          message: `Campaign complete: ${campaign.concepts.length} concepts, ${successCount} images`,
        });
        send({
          type: "complete",
          summary: {
            brief: campaign.brief,
            concepts: campaign.concepts,
            totalImages,
            successCount,
            failCount,
          },
        });
      } catch (err: any) {
        console.error("[Ad Agent] Error:", err);
        send({ type: "error", message: err.message || "An unexpected error occurred" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
