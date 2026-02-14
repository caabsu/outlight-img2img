export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import type { AdFeedbackSubmission } from "@/lib/ad-types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AdFeedbackSubmission;
    const { productId, profileId, conceptName, conceptDescription, rating, reason, aspectRatiosGenerated, theme, modelId } = body;

    if (!productId || !profileId || !conceptName || !rating) {
      return Response.json({ error: "Missing required fields" }, { status: 400 });
    }
    if (rating < 1 || rating > 10) {
      return Response.json({ error: "Rating must be between 1 and 10" }, { status: 400 });
    }

    const supabase = getSupabase();

    // Save feedback
    const { data: feedback, error: feedbackError } = await supabase
      .from("ad_campaign_feedback")
      .insert({
        product_id: productId,
        profile_id: profileId,
        concept_name: conceptName,
        concept_description: conceptDescription || null,
        rating,
        reason: reason || null,
        aspect_ratios_generated: aspectRatiosGenerated || null,
        theme: theme || null,
        model_id: modelId || null,
      })
      .select()
      .single();

    if (feedbackError) {
      console.error("[Feedback] Insert error:", feedbackError);
      return Response.json({ error: "Failed to save feedback" }, { status: 500 });
    }

    // Analyze feedback with Claude to extract learnings (fire-and-forget for speed)
    extractLearnings(feedback.id, productId, conceptName, conceptDescription, rating, reason, theme).catch((err) =>
      console.error("[Feedback] Learning extraction failed:", err)
    );

    return Response.json({ success: true, feedback });
  } catch (err: any) {
    console.error("[Feedback] Error:", err);
    return Response.json({ error: err.message || "Internal error" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const productId = searchParams.get("productId");

  if (!productId) {
    return Response.json({ error: "productId required" }, { status: 400 });
  }

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("ad_campaign_feedback")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    return Response.json({ error: "Failed to fetch feedback" }, { status: 500 });
  }

  return Response.json({ feedback: data });
}

async function extractLearnings(
  feedbackId: string,
  productId: string,
  conceptName: string,
  conceptDescription: string | undefined,
  rating: number,
  reason: string | undefined,
  theme: string | undefined
) {
  if (!reason && rating >= 5) return; // Skip analysis for positive ratings without reasons

  const anthropic = new Anthropic();

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-5-20250929",
    max_tokens: 2048,
    system: `You analyze ad campaign feedback and extract actionable learnings for future ad generation. Output ONLY valid JSON array of learnings. Each learning should be a specific, actionable insight.

Categories: "composition", "typography", "color", "mood", "product_placement", "text_overlay", "aspect_ratio", "general"`,
    messages: [
      {
        role: "user",
        content: `A user rated an ad concept ${rating}/10.

Concept: "${conceptName}"
${conceptDescription ? `Description: "${conceptDescription}"` : ""}
${theme ? `Theme: "${theme}"` : ""}
${reason ? `Reason: "${reason}"` : "No reason provided."}

Based on this feedback, extract 1-3 actionable learnings for improving future ad generation. Focus on what specifically worked (high rating) or didn't work (low rating).

Return ONLY a JSON array like:
[
  {"learning": "specific actionable insight...", "category": "composition"}
]`,
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") return;

  const cleaned = textBlock.text.replace(/```json/g, "").replace(/```/g, "").trim();
  let learnings: Array<{ learning: string; category: string }>;
  try {
    learnings = JSON.parse(cleaned);
  } catch {
    return;
  }

  if (!Array.isArray(learnings) || learnings.length === 0) return;

  const supabase = getSupabase();
  const rows = learnings.map((l) => ({
    product_id: productId,
    learning: l.learning,
    category: l.category || "general",
    source_feedback_id: feedbackId,
    is_active: true,
  }));

  await supabase.from("ad_studio_learnings").insert(rows);
}
