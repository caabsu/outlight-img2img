import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const { knowledge, instructions, count } = await req.json();

    const promptCount = Math.max(1, Math.min(10, Number(count) || 3));
    
    // Mocking the AI response for now to ensure immediate functionality without API keys.
    // In a real scenario, this would call OpenAI/Gemini API.
    
    const generatedPrompts = Array.from({ length: promptCount }).map((_, i) => {
      const variance = [
        "soft morning light filtering through sheer curtains",
        "dramatic high-contrast evening shadows",
        "cool cinematic blue tones with rim lighting",
        "warm golden hour sun beams hitting the surface",
        "studio neutral lighting with soft fill"
      ][i % 5];

      const angle = [
        "low angle shot",
        "top-down view",
        "isometric perspective",
        "close-up macro detail",
        "wide angle establishing shot"
      ][i % 5];

      return `place this exact light source to the left at 45 degrees, creating ${variance}. The scene depicts ${instructions}. The composition is a ${angle}, detailed textures, photorealistic, 8k resolution.`;
    });

    return NextResponse.json({ prompts: generatedPrompts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
