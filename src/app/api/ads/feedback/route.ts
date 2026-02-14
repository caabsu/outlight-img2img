export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { createClient } from "@supabase/supabase-js";
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

    // Learning extraction is now handled by the /api/ads/feedback/analyze SSE endpoint
    // which the frontend calls after submission for visible streaming analysis.

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

