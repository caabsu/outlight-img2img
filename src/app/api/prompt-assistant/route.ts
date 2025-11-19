import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export const runtime = "nodejs";

// Helper for the fallback logic to avoid contradictions
function getSmartVariance(instructions: string, index: number) {
  const lower = instructions.toLowerCase();
  const isDark = lower.includes("dark") || lower.includes("night") || lower.includes("dim") || lower.includes("shadow");
  const isBright = lower.includes("bright") || lower.includes("sun") || lower.includes("day") || lower.includes("white");

  const darkVariances = [
    "low-key lighting with rim accents",
    "moody atmospheric shadows",
    "cinematic high-contrast noir style",
    "subtle volumetric fog with deep blacks",
    "soft localized glow in a dark environment"
  ];

  const brightVariances = [
    "bright natural sunlight streaming in",
    "soft airy high-key lighting",
    "crisp studio daylight",
    "warm golden hour glow",
    "clean even illumination"
  ];

  const neutralVariances = [
    "neutral balanced studio lighting",
    "soft diffused light from the left",
    "professional 3-point lighting setup",
    "gentle ambient occlusion",
    "sharp commercial product lighting"
  ];

  let pool = neutralVariances;
  if (isDark) pool = darkVariances;
  if (isBright) pool = brightVariances;

  return pool[index % pool.length];
}

function getSmartAngle(instructions: string, index: number) {
  const lower = instructions.toLowerCase();
  if (lower.includes("front") || lower.includes("straight")) {
     return ["straight-on front view", "eye-level symmetrical shot", "direct frontal composition"][index % 3];
  }
  if (lower.includes("top") || lower.includes("above")) {
    return ["top-down flat lay", "high-angle bird's eye view", "directly from above"][index % 3];
  }
  
  const angles = [
    "slightly low angle for grandeur",
    "isometric 45-degree view",
    "close-up macro detail",
    "wide establishing shot",
    "dynamic dutch angle"
  ];
  return angles[index % angles.length];
}

export async function POST(req: Request) {
  try {
    const { knowledge, instructions, count } = await req.json();
    const promptCount = Math.max(1, Math.min(10, Number(count) || 3));

    // 1. Try Google Gemini API
    if (process.env.GEMINI_API_KEY) {
      try {
        const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const systemPrompt = `You are an expert cinematic prompt engineer for Stable Diffusion and Midjourney.
        Your task is to generate ${promptCount} distinct, high-quality image generation prompts based on the user's SCENE DESCRIPTION.
        
        RULES:
        1. STRICTLY adhere to the user's description. Do not contradict it (e.g. if "dark", do not add "bright sun").
        2. INCORPORATE the "Knowledge Base" style guidelines naturally into the description.
        3. Add creative variance to each prompt (lighting, composition, film stock) BUT keep the core subject consistent.
        4. Output ONLY a JSON array of strings. No markdown formatting. Example: ["prompt1", "prompt2"]
        
        Knowledge Base: "${knowledge}"
        Scene Description: "${instructions}"`;

        const result = await model.generateContent(systemPrompt);
        const response = result.response;
        const text = response.text();
        
        // Attempt to parse JSON output
        const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
        const json = JSON.parse(cleanedText);
        if (Array.isArray(json)) {
           return NextResponse.json({ prompts: json.slice(0, promptCount) });
        }
      } catch (e) {
        console.error("Gemini API Error, falling back:", e);
      }
    }

    // 2. Try OpenAI API
    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const completion = await openai.chat.completions.create({
          messages: [
            { role: "system", content: `Generate ${promptCount} detailed image prompts based on the user description. Incorporate the style guide: "${knowledge}". Return strictly a JSON array of strings.` },
            { role: "user", content: instructions },
          ],
          model: "gpt-3.5-turbo",
        });
        
        const content = completion.choices[0].message.content || "[]";
        const parsed = JSON.parse(content);
        if(Array.isArray(parsed)) {
             return NextResponse.json({ prompts: parsed });
        }
      } catch (e) {
        console.error("OpenAI API Error, falling back:", e);
      }
    }

    // 3. Smart Fallback (Rule-based)
    // This runs if no keys are present or if APIs fail.
    const generatedPrompts = Array.from({ length: promptCount }).map((_, i) => {
      const variance = getSmartVariance(instructions, i);
      const angle = getSmartAngle(instructions, i);
      
      // Clean up knowledge base integration
      const styleNote = knowledge && knowledge.length > 5 
        ? ", style adhering to: " + knowledge.replace(/\n/g, ", ") 
        : "";

      // Construct a sentence that flows naturally
      return `${instructions}. The scene features ${variance}. Captured from a ${angle}${styleNote}. High resolution, photorealistic, 8k, detailed textures.`;
    });

    return NextResponse.json({ prompts: generatedPrompts });
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
