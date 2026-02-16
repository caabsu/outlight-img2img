export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

function getSupabase() {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
}

type SSEEvent =
  | { type: "thought"; message: string }
  | { type: "complete"; removed: number; kept: number }
  | { type: "error"; message: string };

export async function POST(req: Request) {
  const body = await req.json();
  const { productId } = body;
  // productId is optional — if omitted, cleans up all learnings

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
        const supabase = getSupabase();

        // Fetch all active learnings
        send({ type: "thought", message: "Loading knowledge base..." });

        let query = supabase
          .from("ad_studio_learnings")
          .select("id, product_id, learning, category, is_active, created_at")
          .eq("is_active", true)
          .order("created_at", { ascending: true });

        if (productId) {
          query = query.or(`product_id.eq.${productId},product_id.is.null`);
        }

        const { data: learnings, error: fetchError } = await query;

        if (fetchError || !learnings) {
          send({ type: "error", message: "Failed to load learnings" });
          controller.close();
          return;
        }

        if (learnings.length === 0) {
          send({ type: "thought", message: "Knowledge base is empty — nothing to clean up" });
          send({ type: "complete", removed: 0, kept: 0 });
          controller.close();
          return;
        }

        send({ type: "thought", message: `Found ${learnings.length} active learning${learnings.length !== 1 ? "s" : ""}` });
        send({ type: "thought", message: "Analyzing for duplicates, contradictions, and consolidation opportunities..." });

        // Build the full list for Claude to analyze
        const learningsList = learnings.map((l, i) => ({
          index: i,
          id: l.id,
          category: l.category,
          learning: l.learning,
          scope: l.product_id ? "product-specific" : "global",
        }));

        const anthropic = new Anthropic();

        const response = await anthropic.messages.create({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 8192,
          system: `You are a knowledge base curator for an AI ad generation system. You analyze a list of learnings (insights from past ad campaign feedback) and produce a cleaned-up version.

Your goals:
1. REMOVE exact or near-duplicates (keep the better-worded one)
2. MERGE closely related learnings into a single, clearer learning
3. REMOVE contradictory or outdated learnings (keep the more recent/specific one)
4. REWRITE remaining learnings for clarity and conciseness
5. CORRECT any category assignments that seem wrong
6. Keep total count manageable — aim for roughly 60-80% of the original count, or fewer if heavily duplicated

Categories: "composition", "typography", "color", "mood", "product_placement", "text_overlay", "aspect_ratio", "general"

Format your response EXACTLY like this:

ANALYSIS: [1-2 paragraph analysis of what you found — duplicates, issues, consolidation opportunities]

REMOVED: [comma-separated list of indices that should be deactivated, e.g. "2, 5, 8, 12"]

KEPT:
[
  {"index": 0, "learning": "cleaned up text...", "category": "composition"},
  {"index": 1, "learning": "cleaned up text...", "category": "mood"},
  {"index": -1, "learning": "merged learning from indices 3+7...", "category": "color"}
]

Use index: -1 for newly merged learnings. Use the original index for learnings that are kept (potentially reworded).`,
          messages: [
            {
              role: "user",
              content: `Here are the current active learnings to analyze and clean up:

${JSON.stringify(learningsList, null, 2)}

Analyze these learnings and produce a cleaned-up version. Remove duplicates, merge related insights, fix categories, and rewrite for clarity.`,
            },
          ],
        });

        const textBlock = response.content.find((b) => b.type === "text");
        if (!textBlock || textBlock.type !== "text") {
          send({ type: "error", message: "No response from AI analysis" });
          controller.close();
          return;
        }

        const fullText = textBlock.text;

        // Extract analysis
        const analysisMatch = fullText.match(/ANALYSIS:\s*([\s\S]*?)(?=\nREMOVED:|$)/i);
        if (analysisMatch?.[1]) {
          send({ type: "thought", message: `Analysis: ${analysisMatch[1].trim()}` });
        }

        // Extract removed indices
        const removedMatch = fullText.match(/REMOVED:\s*([\s\S]*?)(?=\nKEPT:|$)/i);
        const removedIndices: number[] = [];
        if (removedMatch?.[1]) {
          const cleaned = removedMatch[1].trim();
          if (cleaned && cleaned !== "none" && cleaned !== "[]") {
            for (const part of cleaned.split(",")) {
              const n = parseInt(part.trim());
              if (!isNaN(n) && n >= 0 && n < learnings.length) {
                removedIndices.push(n);
              }
            }
          }
        }

        // Extract kept learnings
        const keptMatch = fullText.match(/KEPT:\s*([\s\S]*)/i);
        let keptLearnings: Array<{ index: number; learning: string; category: string }> = [];

        if (keptMatch?.[1]) {
          const jsonStr = keptMatch[1].replace(/```json/g, "").replace(/```/g, "").trim();
          try {
            keptLearnings = JSON.parse(jsonStr);
          } catch {
            const arrayMatch = keptMatch[1].match(/\[[\s\S]*\]/);
            if (arrayMatch) {
              try {
                keptLearnings = JSON.parse(arrayMatch[0]);
              } catch {
                send({ type: "thought", message: "Warning: could not fully parse cleanup results" });
              }
            }
          }
        }

        if (removedIndices.length === 0 && keptLearnings.length === 0) {
          send({ type: "thought", message: "Knowledge base looks clean — no changes needed" });
          send({ type: "complete", removed: 0, kept: learnings.length });
          controller.close();
          return;
        }

        // Apply changes
        // 1. Deactivate removed learnings
        if (removedIndices.length > 0) {
          const idsToRemove = removedIndices
            .filter((i) => i < learnings.length)
            .map((i) => learnings[i].id);

          if (idsToRemove.length > 0) {
            send({ type: "thought", message: `Deactivating ${idsToRemove.length} duplicate/redundant learning${idsToRemove.length !== 1 ? "s" : ""}...` });
            await supabase
              .from("ad_studio_learnings")
              .update({ is_active: false })
              .in("id", idsToRemove);
          }
        }

        // 2. Update reworded learnings (those with original indices)
        let updatedCount = 0;
        let insertedCount = 0;

        for (const kept of keptLearnings) {
          if (kept.index >= 0 && kept.index < learnings.length) {
            // Update existing
            const original = learnings[kept.index];
            if (kept.learning !== original.learning || kept.category !== original.category) {
              await supabase
                .from("ad_studio_learnings")
                .update({
                  learning: kept.learning,
                  category: kept.category || original.category,
                })
                .eq("id", original.id);
              updatedCount++;
            }
          } else if (kept.index === -1) {
            // Insert new merged learning
            await supabase.from("ad_studio_learnings").insert({
              product_id: productId || null,
              learning: kept.learning,
              category: kept.category || "general",
              is_active: true,
            });
            insertedCount++;
          }
        }

        const totalRemoved = removedIndices.length;
        const totalKept = learnings.length - totalRemoved + insertedCount;

        const parts: string[] = [];
        if (totalRemoved > 0) parts.push(`${totalRemoved} removed`);
        if (updatedCount > 0) parts.push(`${updatedCount} reworded`);
        if (insertedCount > 0) parts.push(`${insertedCount} merged`);
        send({ type: "thought", message: `Cleanup complete: ${parts.join(", ")}. ${totalKept} learnings remain.` });

        send({ type: "complete", removed: totalRemoved, kept: totalKept });
      } catch (err: any) {
        console.error("[Learnings Cleanup] Error:", err);
        send({ type: "error", message: err.message || "Cleanup failed" });
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
