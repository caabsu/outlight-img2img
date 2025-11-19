import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { knowledge, instructions, count } = await req.json();

    const promptCount = Math.max(1, Math.min(10, Number(count) || 3));
    
    // In a real scenario, this would call OpenAI/Gemini API.
    // For now, we generate mock prompts based on the instructions without forced prefixes.
    
    const generatedPrompts = Array.from({ length: promptCount }).map((_, i) => {
      const variance = [
        "soft morning light",
        "dramatic high-contrast shadows",
        "cinematic blue tones",
        "warm golden hour beams",
        "studio neutral lighting"
      ][i % 5];

      const angle = [
        "low angle shot",
        "top-down view",
        "isometric perspective",
        "close-up detail",
        "wide establishing shot"
      ][i % 5];

      // Constructing a prompt that respects the user's raw instructions + some creative variance,
      // but strictly adhering to the "no forced prefix" rule.
      return `${instructions}. Lighting: ${variance}. Angle: ${angle}. (Knowledge applied: ${knowledge.slice(0, 20)}...)`;
    });

    return NextResponse.json({ prompts: generatedPrompts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}