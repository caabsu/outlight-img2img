export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { createClient } from "@supabase/supabase-js";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";
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
  knowledgeBaseId?: string;
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
    visualStyle: string;
    colorPalette: string[];
    keyElements: string[];
  };
  concepts: Array<{
    name: string;
    description: string;
    prompts: Record<string, string>;
  }>;
};

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

async function fetchKnowledge(knowledgeBaseId: string): Promise<string> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data, error } = await supabase
    .from("knowledge_bases")
    .select("content")
    .eq("id", knowledgeBaseId)
    .single();
  if (error || !data?.content) return "";
  return data.content;
}

function buildAIPrompt(
  product: any,
  theme: string,
  quantity: number,
  aspectRatios: string[],
  knowledge: string
): string {
  const ratioList = aspectRatios.join(", ");
  const priceNote = product.shopify_price ? `$${product.shopify_price}` : "N/A";

  return `You are a creative advertising agent. Given a product and a creative theme, produce a complete ad campaign brief with image generation prompts.

INPUTS:
- Product: ${product.name}, Type: ${product.shopify_product_type || "general"}, Vendor: ${product.shopify_vendor || "N/A"}, Price: ${priceNote}
- Product image: ${product.image_url || "N/A"}
- Theme: "${theme}"
- Quantity: ${quantity} concepts
- Aspect ratios: ${ratioList}
${knowledge ? `- Knowledge base: "${knowledge}"` : ""}

OUTPUT FORMAT (strict JSON, no markdown fences):
{
  "brief": {
    "productAnalysis": "...",
    "themeInterpretation": "...",
    "targetMood": ["...", "..."],
    "visualStyle": "...",
    "colorPalette": ["...", "..."],
    "keyElements": ["...", "..."]
  },
  "concepts": [
    {
      "name": "...",
      "description": "...",
      "prompts": {
        ${aspectRatios.map((r) => `"${r}": "Detailed prompt for ${r} format..."`).join(",\n        ")}
      }
    }
  ]
}

RULES:
1. Each concept must be a DISTINCT creative direction inspired by the theme
2. Prompts must be highly detailed (lighting, composition, materials, atmosphere, camera angle)
3. 9:16 prompts must account for vertical framing with upper/lower negative space for text overlays
4. 1:1 prompts must be centered, balanced compositions
5. Reference the product by description, not by name (image AI doesn't know product names)
6. Incorporate the product's visual attributes from the reference image
7. Apply knowledge base style guidelines implicitly
8. Creative variance should scale with theme specificity
9. Generate exactly ${quantity} concepts
10. Return ONLY valid JSON, no markdown code fences`;
}

async function callAIForCampaign(
  product: any,
  theme: string,
  quantity: number,
  aspectRatios: string[],
  knowledge: string
): Promise<CampaignPlan> {
  const prompt = buildAIPrompt(product, theme, quantity, aspectRatios, knowledge);

  // Try Gemini first
  if (process.env.GEMINI_API_KEY) {
    const modelsToTry = ["gemini-3-pro-preview", "gemini-2.5-flash"];
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

    for (const modelName of modelsToTry) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
        });
        const text = result.response.text();
        const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const parsed = JSON.parse(cleaned) as CampaignPlan;
        if (parsed.brief && Array.isArray(parsed.concepts)) {
          return parsed;
        }
      } catch (e: any) {
        console.error(`[Ad Agent] Gemini (${modelName}) failed:`, e.message);
      }
    }
  }

  // Fallback to OpenAI
  if (process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: "You are a creative advertising agent. Return only valid JSON." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = completion.choices[0].message.content || "{}";
      const parsed = JSON.parse(content) as CampaignPlan;
      if (parsed.brief && Array.isArray(parsed.concepts)) {
        return parsed;
      }
    } catch (e: any) {
      console.error("[Ad Agent] OpenAI failed:", e.message);
    }
  }

  throw new Error("No AI provider available. Please configure GEMINI_API_KEY or OPENAI_API_KEY.");
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

  // Set aspect ratio for models that support it
  if (modelDef.aspectRatioOptions) {
    options.aspect_ratio = aspectRatio;
  }
  // Set quality/resolution from modelOptions
  if (modelOptions?.quality) {
    options.quality = modelOptions.quality;
  }
  if (modelOptions?.resolution) {
    options.image_size = modelOptions.resolution;
  }
  // GPT 1.5 specific: map aspect ratio to size
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
  const { modelId, quantity, theme, productId, aspectRatios, knowledgeBaseId, profileId, modelOptions } = body;

  // Validate
  if (!modelId || !theme || !productId || !profileId) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeQuantity = Math.max(1, Math.min(10, quantity || 3));
  const safeRatios = aspectRatios?.length ? aspectRatios : ["1:1", "9:16"];

  // Get origin for internal API calls
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

        const knowledge = knowledgeBaseId ? await fetchKnowledge(knowledgeBaseId) : "";
        if (knowledge) {
          send({ type: "thought", message: "Knowledge base loaded" });
        }

        // Phase 2: IDEATE
        send({ type: "phase", phase: "ideate", message: `Generating ${safeQuantity} creative concepts...` });
        send({ type: "action", message: "Calling AI to plan campaign..." });

        const campaign = await callAIForCampaign(product, theme, safeQuantity, safeRatios, knowledge);

        // Stream brief thoughts
        if (campaign.brief) {
          send({ type: "thought", message: `Visual style: ${campaign.brief.visualStyle}` });
          if (campaign.brief.colorPalette?.length) {
            send({ type: "thought", message: `Color palette: ${campaign.brief.colorPalette.join(", ")}` });
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

        // Build task list
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

        // Worker pool
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
            let succeeded = false;

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
                succeeded = true;
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
