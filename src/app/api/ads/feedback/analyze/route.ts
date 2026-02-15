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
  const { feedbackId, productId, conceptName, conceptDescription, rating, reason, theme } = body;

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

        send({ type: "thought", message: "Running AI analysis to extract learnings..." });

        // Phase 2: Claude analysis
        const anthropic = new Anthropic();

        const systemPrompt = `You analyze ad campaign feedback and extract actionable learnings for future ad generation.

First, write a brief analysis paragraph explaining your reasoning about what this feedback tells us. Consider:
- What the rating implies about quality
- What specific aspects the user liked or disliked
- How this should influence future ad generation

Then output learnings as a JSON array.

Categories: "composition", "typography", "color", "mood", "product_placement", "text_overlay", "aspect_ratio", "general"

Format your response EXACTLY like this:
ANALYSIS: [your reasoning paragraph here]

LEARNINGS:
[
  {"learning": "specific actionable insight...", "category": "composition"}
]`;

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 2048,
          system: systemPrompt,
          messages: [
            {
              role: "user",
              content: `A user rated an ad concept ${rating}/10.

Concept: "${conceptName}"
${conceptDescription ? `Description: "${conceptDescription}"` : ""}
${theme ? `Theme: "${theme}"` : ""}
${reason ? `Reason: "${reason}"` : "No reason provided."}

Analyze this feedback and extract 1-3 actionable learnings for improving future ad generation. Focus on what specifically worked (high rating) or didn't work (low rating).`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          send({ type: "thought", message: "No analysis generated" });
          send({ type: "complete", learningCount: 0 });
          controller.close();
          return;
        }

        const fullText = textBlock.text;

        // Extract analysis section
        const analysisMatch = fullText.match(/ANALYSIS:\s*([\s\S]*?)(?=\nLEARNINGS:|$)/i);
        if (analysisMatch?.[1]) {
          const analysisParagraph = analysisMatch[1].trim();
          // Stream the analysis as a thought
          send({ type: "thought", message: `AI analysis: ${analysisParagraph}` });
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
          product_id: productId,
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
