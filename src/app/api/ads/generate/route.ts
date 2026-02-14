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
  modelOptions?: {
    quality?: string;
    resolution?: string;
  };
};

type SSEEvent =
  | { type: "phase"; phase: string; message: string }
  | { type: "thought"; message: string }
  | { type: "action"; message: string }
  | { type: "concept"; index: number; concept: { name: string; description: string; prompts: Record<string, string> } }
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
    prompts: Record<string, string>;
  }>;
};

/* ========================= SYSTEM PROMPT ========================= */

const AD_STUDIO_SYSTEM_PROMPT = `You are the creative director of Ad Studio, a premium advertising creative platform. Your role is to produce outstanding ad campaign briefs with image generation prompts.

## Prompt Writing Best Practices
- Write prompts as vivid, cinematic scene descriptions (120-200 words each)
- Lead with composition and camera angle, then subject, environment, lighting, materials, atmosphere
- Use specific photographic terminology: focal length, depth of field, exposure, color grading
- Reference real-world art movements, photographers, and visual styles when relevant
- Never reference the product by brand name — describe its physical appearance instead
- Include negative space considerations for text overlays in 9:16 formats

## Theme Handling
- The creative theme is the user's primary creative input — treat it as sacred
- Interpret the theme through multiple creative lenses to generate distinct concepts
- Each concept must feel like a different creative director's interpretation of the same brief
- Balance between literal and abstract interpretations of the theme

## Aspect Ratio Guidelines
- 1:1 (Square): Centered, balanced compositions. Product-focused with symmetrical framing. Ideal for social feeds.
- 9:16 (Vertical/Stories): Leave generous upper 20% and lower 20% for text overlays. Product mid-frame. Immersive, full-screen storytelling with vertical flow.

## Output Quality
- Be specific with materials (matte, glossy, brushed aluminum, raw linen)
- Be specific with lighting (golden hour, harsh noon, diffused studio, neon rim)
- Be specific with atmosphere (misty, crisp, humid, dusty)
- Each concept should evoke a distinct emotional response`;

/* ========================= HELPERS ========================= */

async function fetchProduct(productId: string) {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("products")
    .select("id,name,slug,image_url,shopify_vendor,shopify_product_type,shopify_price,shopify_images")
    .eq("id", productId)
    .single();
  if (error) throw new Error(`Failed to fetch product: ${error.message}`);
  if (!data) throw new Error("Product not found");
  return data;
}

function buildUserMessage(
  product: any,
  theme: string,
  quantity: number,
  aspectRatios: string[]
): string {
  const ratioList = aspectRatios.join(", ");
  const priceNote = product.shopify_price ? `$${product.shopify_price}` : "N/A";

  return `Create an ad campaign for this product:

PRODUCT:
- Name: ${product.name}
- Type: ${product.shopify_product_type || "general"}
- Vendor: ${product.shopify_vendor || "N/A"}
- Price: ${priceNote}
- Product image URL: ${product.image_url || "N/A"}

CREATIVE THEME: "${theme}"

REQUIREMENTS:
- Generate exactly ${quantity} distinct creative concepts
- Each concept needs prompts for these aspect ratios: ${ratioList}
- Each prompt should be 120-200 words of vivid, cinematic scene description

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
    "creativeRationale": "Why this creative direction will resonate with the audience and elevate the product"
  },
  "concepts": [
    {
      "name": "Concept Name",
      "description": "Brief concept description",
      "prompts": {
        ${aspectRatios.map((r) => `"${r}": "Detailed 120-200 word prompt for ${r} format..."`).join(",\n        ")}
      }
    }
  ]
}`;
}

async function callAIForCampaign(
  product: any,
  theme: string,
  quantity: number,
  aspectRatios: string[]
): Promise<CampaignPlan> {
  const anthropic = new Anthropic();

  const userMessage = buildUserMessage(product, theme, quantity, aspectRatios);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    system: AD_STUDIO_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const cleaned = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();
  const parsed = JSON.parse(cleaned) as CampaignPlan;

  if (!parsed.brief || !Array.isArray(parsed.concepts)) {
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
  if (modelId === "gpt-1.5") {
    const sizeMap: Record<string, string> = {
      "1:1": "1024x1024",
      "9:16": "1024x1536",
      "16:9": "1536x1024",
    };
    options.gpt_size = sizeMap[aspectRatio] || "auto";
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
  const { modelId, quantity, theme, productId, aspectRatios, profileId, modelOptions } = body;

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
          message: `Product: ${product.name} (${product.shopify_product_type || "general"})`,
        });
        if (product.shopify_vendor) {
          send({ type: "thought", message: `Vendor: ${product.shopify_vendor}` });
        }
        send({ type: "thought", message: `Theme: "${theme}"` });

        // Phase 2: IDEATE
        send({ type: "phase", phase: "ideate", message: `Generating ${safeQuantity} creative concepts with Claude...` });
        send({ type: "action", message: "Calling Claude to plan campaign..." });

        const campaign = await callAIForCampaign(product, theme, safeQuantity, safeRatios);

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

        const maxConcurrency = getModelById(modelId)?.maxConcurrency || 3;
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

            let retries = 1;

            for (let attempt = 0; attempt <= retries; attempt++) {
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
                if (attempt < retries) {
                  send({
                    type: "action",
                    message: `Retrying "${task.concept.name}" (${task.ratio})...`,
                  });
                } else {
                  send({
                    type: "error",
                    message: `Failed: ${task.concept.name} (${task.ratio}) — ${err.message}`,
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
