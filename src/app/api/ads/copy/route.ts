export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import { getModelById } from "@/lib/models";
import type { AdConcept, AdSourceAnalysis } from "@/lib/ad-types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

type Product = {
  id: string;
  name: string;
  slug: string;
  image_url: string;
  shopify_vendor?: string | null;
  shopify_product_type?: string | null;
  shopify_price?: string | null;
};

type AdCopyGenerateRequest = {
  modelId: string;
  quantity: number;
  sourceAdUrl: string;
  adaptationBrief?: string;
  diversity?: "tight" | "balanced" | "exploratory";
  productId: string;
  profileId: string;
  concurrency?: number;
  modelOptions?: {
    quality?: string;
    resolution?: string;
  };
};

type SSEEvent =
  | { type: "phase"; phase: string; message: string }
  | { type: "thought"; message: string }
  | { type: "action"; message: string }
  | { type: "concept"; index: number; concept: AdConcept }
  | { type: "image"; conceptIndex: number; ratio: string; url: string; prompt: string }
  | { type: "error"; message: string; conceptIndex?: number }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; summary: any }
  | { type: "cancelled" };

type AdCopyPlan = {
  analysis: AdSourceAnalysis;
  variations: Array<{
    name: string;
    description: string;
    headline?: string;
    tagline?: string;
    editPrompt: string;
  }>;
};

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

async function fetchProduct(productId: string): Promise<Product> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("products")
    .select("id,name,slug,image_url,shopify_vendor,shopify_product_type,shopify_price")
    .eq("id", productId)
    .single();

  if (error) throw new Error(`Failed to fetch product: ${error.message}`);
  if (!data) throw new Error("Product not found");
  return data as Product;
}

function parseDataUrl(url: string): { mime: string; base64: string } | null {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(url);
  if (!match) return null;
  return { mime: match[1] || "image/png", base64: match[2] || "" };
}

function isSupabaseReferenceImageUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const base = new URL(SUPABASE_URL);
    return (
      (parsed.protocol === "https:" || parsed.protocol === "http:") &&
      parsed.hostname === base.hostname &&
      parsed.pathname.includes("/storage/v1/object/public/reference-images/")
    );
  } catch {
    return false;
  }
}

async function ensureHostedReference(origin: string, url: string): Promise<string> {
  if (isSupabaseReferenceImageUrl(url)) return url;

  const body = url.startsWith("data:")
    ? { dataUrl: url }
    : { sourceUrl: url };

  const res = await fetch(`${origin}/api/upload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || "Failed to prepare reference image");
  if (!json?.url) throw new Error("Prepared reference image returned no URL");
  return String(json.url);
}

async function fetchImageAsBase64(url: string): Promise<{ mime: string; base64: string }> {
  const parsed = parseDataUrl(url);
  if (parsed) return parsed;

  const res = await fetch(url, {
    redirect: "follow",
    headers: {
      "User-Agent": "Outlight/1.0 (+ad-copy)",
      Accept: "image/webp,image/png,image/jpeg,image/*,*/*;q=0.8",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Failed to fetch image: ${res.status} ${res.statusText} - ${text.slice(0, 200)}`);
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  let mime = res.headers.get("content-type") || "image/png";
  if (!mime.startsWith("image/")) {
    if (/\.(png)(\?|$)/i.test(url)) mime = "image/png";
    else if (/\.(jpe?g)(\?|$)/i.test(url)) mime = "image/jpeg";
    else if (/\.(webp)(\?|$)/i.test(url)) mime = "image/webp";
    else mime = "image/png";
  }

  return { mime, base64: buffer.toString("base64") };
}

const AD_COPY_SYSTEM_PROMPT = `You are an ecommerce ad-remix creative director.

You will receive:
1. A competitor/reference advertisement image.
2. Our product reference image.
3. Product metadata and an optional adaptation brief.

Your job:
- Identify what the original ad is and how it is structured.
- Preserve the ad's persuasive skeleton and layout logic.
- Replace the competitor product with our product from the product reference image.
- Rewrite all visible copy so the result is tailored to our product.
- Generate multiple variations with controlled but meaningful diversity.

Variation rules:
- Every variation should still feel derived from the original ad, not like a totally unrelated composition.
- Vary emphasis across copy, offer framing, text hierarchy, crop, background treatment, accents, CTA styling, and emotional angle.
- Keep the product swap explicit and practical for an image-edit model.
- Do not ask for exact brand/logo recreation.
- Do not mention competitor brands by name.
- Avoid impossible instructions or contradictory edits.

The "editPrompt" field is for an image-edit model. It must:
- Refer to the first image as the layout/style reference and the second image as the product reference.
- Explicitly instruct the model to replace the featured product with the product from the product reference image.
- Explicitly instruct the model to change the text overlay to the new copy for that variation.
- Preserve the overall ad composition, hierarchy, and readability.
- Be concrete, visual, and operational.

Return ONLY valid JSON with this exact shape:
{
  "analysis": {
    "identifiedAd": "What this ad is selling and the ad type",
    "structure": "How the layout and content blocks are organized",
    "offerStrategy": "What persuasive angle the ad is using",
    "visualSystem": "Color, typography, framing, and visual hierarchy",
    "adaptationStrategy": "How to translate it for our product while keeping the reference recognizable"
  },
  "variations": [
    {
      "name": "Short variation name",
      "description": "1-2 sentence description of the creative twist",
      "headline": "Main ad headline",
      "tagline": "Supporting line or subhead",
      "editPrompt": "Detailed edit prompt for the image model"
    }
  ]
}`;

function buildDiversityDirective(diversity: NonNullable<AdCopyGenerateRequest["diversity"]>) {
  if (diversity === "tight") {
    return "Keep variations close to the reference ad. Change copy and product placement minimally while preserving the layout almost exactly.";
  }
  if (diversity === "exploratory") {
    return "Create bold diversity while staying recognizably derived from the reference ad. Push copy angle, emphasis, CTA treatment, crop, accents, and mood further.";
  }
  return "Create noticeable but controlled diversity. The variations should feel distinct in marketing angle and execution while still clearly tracing back to the reference ad.";
}

async function callAIForAdCopyPlan({
  product,
  quantity,
  sourceAdUrl,
  adaptationBrief,
  diversity,
}: {
  product: Product;
  quantity: number;
  sourceAdUrl: string;
  adaptationBrief: string;
  diversity: NonNullable<AdCopyGenerateRequest["diversity"]>;
}): Promise<AdCopyPlan> {
  const anthropic = new Anthropic();
  const [sourceAdImage, productImage] = await Promise.all([
    fetchImageAsBase64(sourceAdUrl),
    fetchImageAsBase64(product.image_url),
  ]);

  const priceNote = product.shopify_price ? `$${product.shopify_price}` : "N/A";
  const userText = `Analyze the first image as the competitor/reference ad and the second image as our product reference.

OUR PRODUCT:
- Name: ${product.name}
- Type: ${product.shopify_product_type || "product"}
- Vendor: ${product.shopify_vendor || "N/A"}
- Price: ${priceNote}

ADAPTATION BRIEF:
${adaptationBrief || "No extra brief provided. Infer a strong ecommerce angle from the product and the source ad."}

REQUIRED OUTPUT:
- Generate exactly ${quantity} ad variations.
- ${buildDiversityDirective(diversity)}
- Keep each variation practical for image editing from the source ad.
- Make the new copy specific and ad-ready.
- Treat the source ad as the structural reference and the product image as the swap-in product reference.`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 8192,
    temperature: 0.8,
    system: AD_COPY_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: sourceAdImage.mime,
              data: sourceAdImage.base64,
            },
          } as any,
          {
            type: "image",
            source: {
              type: "base64",
              media_type: productImage.mime,
              data: productImage.base64,
            },
          } as any,
          { type: "text", text: userText },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text response from Claude");
  }

  const raw = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();

  let parsed: AdCopyPlan | null = null;
  try {
    parsed = JSON.parse(raw) as AdCopyPlan;
  } catch {
    const firstBrace = raw.indexOf("{");
    const lastBrace = raw.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      const extracted = raw.slice(firstBrace, lastBrace + 1).replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
      parsed = JSON.parse(extracted) as AdCopyPlan;
    }
  }

  if (!parsed?.analysis || !Array.isArray(parsed.variations)) {
    throw new Error("Invalid ad copy plan structure from Claude");
  }

  return parsed;
}

async function callGenerateAPI({
  origin,
  modelId,
  profileId,
  prompt,
  sourceAdUrl,
  productImageUrl,
  modelOptions,
}: {
  origin: string;
  modelId: string;
  profileId: string;
  prompt: string;
  sourceAdUrl: string;
  productImageUrl: string;
  modelOptions?: AdCopyGenerateRequest["modelOptions"];
}): Promise<string> {
  const options: Record<string, any> = {};
  const modelDef = getModelById(modelId);
  if (!modelDef) throw new Error(`Unknown model: ${modelId}`);

  if (modelOptions?.quality) options.quality = modelOptions.quality;
  if (modelOptions?.resolution) options.image_size = modelOptions.resolution;

  const res = await fetch(`${origin}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId,
      profileId,
      productId: null,
      customUrls: [sourceAdUrl, productImageUrl],
      prompt,
      options,
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" }));
    throw new Error(err.error || `Generation failed (${res.status})`);
  }

  const result = await res.json();
  if (!result.imageDataUrl) throw new Error("No image returned");
  return result.imageDataUrl;
}

export async function POST(req: Request) {
  const body = (await req.json()) as AdCopyGenerateRequest;
  const {
    modelId,
    quantity,
    sourceAdUrl,
    adaptationBrief = "",
    diversity = "balanced",
    productId,
    profileId,
    concurrency,
    modelOptions,
  } = body;

  if (!modelId || !productId || !profileId || !sourceAdUrl) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const safeQuantity = Math.max(1, Math.min(10, quantity || 3));
  const safeDiversity = ["tight", "balanced", "exploratory"].includes(diversity) ? diversity : "balanced";
  const origin = new URL(req.url).origin;

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: SSEEvent) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          // stream closed
        }
      };

      try {
        send({ type: "phase", phase: "analyze", message: "Reading source ad and product reference..." });

        const product = await fetchProduct(productId);
        send({ type: "thought", message: `Product: ${product.name} (${product.shopify_product_type || "product"})` });
        send({ type: "thought", message: `Variation count: ${safeQuantity}` });
        send({ type: "thought", message: `Diversity: ${safeDiversity}` });
        if (adaptationBrief.trim()) {
          send({ type: "thought", message: `Brief: ${adaptationBrief.trim()}` });
        }

        send({ type: "action", message: "Preparing reference images for the selected model..." });
        const [hostedSourceAdUrl, hostedProductImageUrl] = await Promise.all([
          ensureHostedReference(origin, sourceAdUrl),
          ensureHostedReference(origin, product.image_url),
        ]);

        send({ type: "action", message: "Analyzing the uploaded ad's structure and offer mechanics..." });
        const plan = await callAIForAdCopyPlan({
          product,
          quantity: safeQuantity,
          sourceAdUrl,
          adaptationBrief,
          diversity: safeDiversity,
        });

        send({ type: "thought", message: `Analysis: ${plan.analysis.identifiedAd}` });
        send({ type: "thought", message: `Structure: ${plan.analysis.structure}` });
        send({ type: "thought", message: `Offer: ${plan.analysis.offerStrategy}` });
        send({ type: "thought", message: `Style direction: ${plan.analysis.visualSystem}` });
        send({ type: "thought", message: `Creative rationale: ${plan.analysis.adaptationStrategy}` });

        send({ type: "phase", phase: "craft", message: "Planning ad-copy variations..." });
        plan.variations.forEach((variation, index) => {
          const concept: AdConcept = {
            name: variation.name,
            description: variation.description,
            headline: variation.headline,
            tagline: variation.tagline,
            prompts: { variation: variation.editPrompt },
          };
          send({ type: "concept", index, concept });
          send({ type: "action", message: `Variation ${index + 1}: "${variation.name}" — ${variation.description}` });
        });

        send({ type: "phase", phase: "generate", message: `Generating ${plan.variations.length} ad variations...` });

        const tasks = plan.variations.map((variation, index) => ({
          index,
          prompt: variation.editPrompt,
          name: variation.name,
        }));

        const modelMax = getModelById(modelId)?.maxConcurrency || 3;
        const maxConcurrency = concurrency ? Math.min(Math.max(1, concurrency), modelMax) : modelMax;
        let cursor = 0;
        let done = 0;
        let successCount = 0;
        let failCount = 0;

        const worker = async () => {
          while (cursor < tasks.length) {
            const idx = cursor++;
            const task = tasks[idx];
            send({ type: "action", message: `Generating "${task.name}"...` });

            const maxRetries = 3;
            for (let attempt = 0; attempt <= maxRetries; attempt++) {
              try {
                const imageUrl = await callGenerateAPI({
                  origin,
                  modelId,
                  profileId,
                  prompt: task.prompt,
                  sourceAdUrl: hostedSourceAdUrl,
                  productImageUrl: hostedProductImageUrl,
                  modelOptions,
                });

                send({
                  type: "image",
                  conceptIndex: task.index,
                  ratio: "variation",
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
                    message: `Retrying "${task.name}" in ${Math.round(delay / 1000)}s (${attempt + 1}/${maxRetries})...`,
                  });
                  await new Promise((resolve) => setTimeout(resolve, delay));
                  continue;
                }
                failCount++;
                send({ type: "error", message: err?.message || `Failed to generate ${task.name}`, conceptIndex: task.index });
              }
            }

            done++;
            send({ type: "progress", done, total: tasks.length });
          }
        };

        await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

        send({
          type: "phase",
          phase: "complete",
          message: `Ad-copy run complete: ${successCount} generated, ${failCount} failed`,
        });
        send({
          type: "complete",
          summary: {
            analysis: plan.analysis,
            totalImages: tasks.length,
            successCount,
            failCount,
          },
        });
        controller.close();
      } catch (err: any) {
        send({ type: "error", message: err?.message || "Generation failed" });
        controller.close();
      }
    },
    cancel() {
      // no-op
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
