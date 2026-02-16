export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

type AnalyzeRequest = {
  feedbackId: string;
  productId: string;
  conceptName: string;
  conceptDescription?: string;
  conceptHeadline?: string;
  conceptTagline?: string;
  conceptPrompts?: Record<string, string>;
  rating: number;
  reason?: string;
  theme?: string;
};

type SSEEvent =
  | { type: "thought"; message: string }
  | { type: "learning"; learning: string; category: string }
  | { type: "complete"; learningCount: number }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  const body = (await req.json()) as AnalyzeRequest;
  const { feedbackId, productId, conceptName, conceptDescription, conceptHeadline, conceptTagline, conceptPrompts, rating, reason, theme } = body;

  if (!feedbackId || !productId || !conceptName || !rating) {
    return new Response(JSON.stringify({ error: "Missing required fields" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

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
        // Phase 1: Context
        send({ type: "thought", message: `Analyzing feedback for "${conceptName}"` });
        send({ type: "thought", message: `Rating: ${rating}/10` });
        if (reason) {
          send({ type: "thought", message: `User feedback: "${reason}"` });
        }
        if (theme) {
          send({ type: "thought", message: `Campaign theme: "${theme}"` });
        }

        const hasPrompts = conceptPrompts && Object.keys(conceptPrompts).length > 0;
        if (hasPrompts) {
          send({ type: "thought", message: `Reviewing ${Object.keys(conceptPrompts!).length} prompt(s) used for this concept...` });
        }

        send({ type: "thought", message: "Running deep prompt analysis to extract learnings..." });

        // Phase 2: Claude analysis with full prompt context
        const anthropic = new Anthropic();

        // Build the prompts section for Claude to analyze
        let promptsBlock = "";
        if (hasPrompts) {
          promptsBlock = Object.entries(conceptPrompts!)
            .map(([ratio, prompt]) => `--- PROMPT FOR ${ratio} ---\n${prompt}`)
            .join("\n\n");
        }

        const systemPrompt = `You are an expert ad creative analyst. You perform deep, structured analysis of ad campaign feedback by examining the ACTUAL PROMPTS that were used to generate the images.

Your job is to trace user complaints or praise back to SPECIFIC prompt language and produce actionable rules for the prompt-writing AI to follow in future campaigns.

## Analysis Process
1. READ the user's feedback and rating carefully
2. EXAMINE each prompt line by line — identify specific phrases, descriptions, or instructions that caused the issue (or succeeded)
3. DIAGNOSE the root cause: Was it a composition instruction? A vague product description? Wrong lighting direction? Missing text overlay spec? Incorrect mood language?
4. PRODUCE learnings that are concrete prompt-writing rules — not vague suggestions

## What Makes a Good Learning
BAD (vague): "Improve product consistency in prompts"
GOOD (specific): "When describing a lighting fixture, always specify the exact fixture type (pendant/sconce/chandelier), material finish (brushed brass/matte black/polished chrome), and dimensions relative to the scene — never use generic terms like 'the light' or 'the product'"

BAD (vague): "Use better color descriptions"
GOOD (specific): "Specify color values using descriptive pairs (e.g., 'warm honey-amber glow' not 'warm light') and always define both the light emission color AND the fixture body color separately in the prompt"

BAD (vague): "Fix text overlay positioning"
GOOD (specific): "In 9:16 prompts, always place the product name in the top 15% of frame and CTA button in the bottom 10% — never place text overlays in the middle 60% where the product sits, as it creates visual clutter"

## Categories
"composition", "typography", "color", "mood", "product_placement", "text_overlay", "aspect_ratio", "prompt_structure", "general"

## Response Format
PROMPT_DIAGNOSIS: [Analyze the specific prompt language that caused the issue. Quote the problematic phrases directly. Explain exactly why they failed or succeeded.]

ANALYSIS: [Broader analysis connecting the feedback to the prompt diagnosis — what pattern does this reveal?]

LEARNINGS:
[
  {"learning": "Concrete, actionable rule for the prompt-writing AI...", "category": "category_name"}
]`;

        // Build user message with full context
        let userContent = `A user rated an ad concept ${rating}/10.

CONCEPT DETAILS:
- Name: "${conceptName}"`;
        if (conceptDescription) userContent += `\n- Description: "${conceptDescription}"`;
        if (conceptHeadline) userContent += `\n- Headline: "${conceptHeadline}"`;
        if (conceptTagline) userContent += `\n- Tagline: "${conceptTagline}"`;
        if (theme) userContent += `\n- Campaign theme: "${theme}"`;
        userContent += `\n\nUSER FEEDBACK (${rating}/10): "${reason || "No reason provided."}"`;

        if (promptsBlock) {
          userContent += `\n\nACTUAL PROMPTS USED TO GENERATE THIS CONCEPT:\n${promptsBlock}`;
        }

        userContent += `\n\nPerform a thorough analysis:
1. ${hasPrompts ? "Examine the prompts and identify specific language that caused the issues (or strengths) the user described" : "Based on the concept details, infer what prompt patterns likely caused the issue"}
2. Trace the user's complaint to root causes in prompt structure, wording, or missing specifications
3. Extract 2-5 actionable, specific learnings that the prompt-writing AI MUST follow in future campaigns
4. Each learning should be a concrete rule — not a vague suggestion`;

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 4096,
          system: systemPrompt,
          messages: [{ role: "user", content: userContent }],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          send({ type: "thought", message: "No analysis generated" });
          send({ type: "complete", learningCount: 0 });
          controller.close();
          return;
        }

        const fullText = textBlock.text;

        // Extract prompt diagnosis section
        const diagnosisMatch = fullText.match(/PROMPT_DIAGNOSIS:\s*([\s\S]*?)(?=\nANALYSIS:|$)/i);
        if (diagnosisMatch?.[1]) {
          send({ type: "thought", message: `Prompt diagnosis: ${diagnosisMatch[1].trim()}` });
        }

        // Extract analysis section
        const analysisMatch = fullText.match(/ANALYSIS:\s*([\s\S]*?)(?=\nLEARNINGS:|$)/i);
        if (analysisMatch?.[1]) {
          send({ type: "thought", message: `Analysis: ${analysisMatch[1].trim()}` });
        }

        // Extract learnings JSON
        const learningsMatch = fullText.match(/LEARNINGS:\s*([\s\S]*)/i);
        let learnings: Array<{ learning: string; category: string }> = [];

        if (learningsMatch?.[1]) {
          const jsonStr = learningsMatch[1].replace(/```json/g, "").replace(/```/g, "").trim();
          try {
            learnings = JSON.parse(jsonStr);
          } catch {
            // Try extracting JSON array from the full text as fallback
            const arrayMatch = fullText.match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              try {
                learnings = JSON.parse(arrayMatch[0]);
              } catch {
                send({ type: "thought", message: "Could not parse learnings from analysis" });
              }
            }
          }
        } else {
          // Fallback: try to extract any JSON array
          const arrayMatch = fullText.match(/\[[\s\S]*\]/);
          if (arrayMatch) {
            try {
              learnings = JSON.parse(arrayMatch[0]);
            } catch {
              send({ type: "thought", message: "Could not parse learnings from analysis" });
            }
          }
        }

        if (!Array.isArray(learnings) || learnings.length === 0) {
          send({ type: "thought", message: "No actionable learnings extracted" });
          send({ type: "complete", learningCount: 0 });
          controller.close();
          return;
        }

        // Phase 3: Stream each learning
        send({ type: "thought", message: `Extracted ${learnings.length} learning${learnings.length > 1 ? "s" : ""}` });

        for (const l of learnings) {
          send({ type: "learning", learning: l.learning, category: l.category || "general" });
        }

        // Phase 4: Save to database
        send({ type: "thought", message: "Saving learnings to database..." });

        const supabase = getSupabase();
        const rows = learnings.map((l) => ({
          product_id: null,
          learning: l.learning,
          category: l.category || "general",
          source_feedback_id: feedbackId,
          is_active: true,
        }));

        const { error: insertError } = await supabase.from("ad_studio_learnings").insert(rows);

        if (insertError) {
          send({ type: "thought", message: "Warning: failed to save some learnings" });
          console.error("[Analyze] Insert error:", insertError);
        } else {
          send({ type: "thought", message: `Saved ${learnings.length} learning${learnings.length > 1 ? "s" : ""} — will be applied to future campaigns` });
        }

        send({ type: "complete", learningCount: learnings.length });
      } catch (err: any) {
        console.error("[Analyze] Error:", err);
        send({ type: "error", message: err.message || "Analysis failed" });
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
