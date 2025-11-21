import { NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import OpenAI from "openai";

export const runtime = "nodejs";

// --- Smart Fallback Logic (Simulates AI when no keys are present) ---

const ADJECTIVES = {
  dark: ["shadowy", "dimly lit", "nocturnal", "moody", "low-key", "dusky", "obsidian", "mysterious", "atmospheric", "somber", "deep", "twilight"],
  bright: ["radiant", "sun-drenched", "airy", "luminous", "high-key", "vibrant", "pristine", "gleaming", "daylit", "washed-out", "clear", "brilliant"],
  modern: ["sleek", "minimalist", "contemporary", "polished", "avant-garde", "streamlined", "geometric", "futuristic", "clean", "industrial", "high-tech"],
  natural: ["organic", "earthy", "raw", "botanical", "rustic", "untouched", "biophilic", "authentic", "weathered", "verdant", "floral", "stone"],
  warm: ["golden", "amber-hued", "cozy", "sun-kissed", "rich", "inviting", "sepia-toned", "candlelit", "autumnal", "heated"],
  cool: ["glacial", "steel-blue", "cyborgian", "sterile", "frosty", "industrial", "melancholic", "arctic", "neon-blue", "metallic"]
};

const ENVIRONMENTS = [
  "in a high-end architectural void",
  "set against a textured concrete wall",
  "placed within a lush indoor garden",
  "resting on a polished marble surface",
  "floating in a limitless dark studio",
  "situated in a chic minimalist living space",
  "surrounded by soft velvet drapery",
  "framed by raw industrial steel beams",
  "centered in a vast, empty warehouse",
  "positioned on a wooden podium",
  "submerged in shallow water with ripples",
  "against a backdrop of rolling sand dunes",
  "in a futuristic laboratory setting",
  "amidst a chaotic arrangement of geometric shapes",
  "on a rooftop overlooking a city skyline"
];

function getRandom(arr: string[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateFallbackPrompts(instructions: string, knowledge: string, count: number): string[] {
  const lowerInst = instructions.toLowerCase();
  
  // 1. Analyze Mood/Tone
  const isDark = lowerInst.includes("dark") || lowerInst.includes("night") || lowerInst.includes("black") || lowerInst.includes("shadow");
  const isBright = lowerInst.includes("bright") || lowerInst.includes("day") || lowerInst.includes("white") || lowerInst.includes("sun");
  const isModern = lowerInst.includes("modern") || lowerInst.includes("clean") || lowerInst.includes("minimal");
  
  // 2. Analyze Camera/Angle
  let forcedAngle = "";
  if (lowerInst.includes("front") || lowerInst.includes("straight")) forcedAngle = "straight-on frontal view";
  else if (lowerInst.includes("top") || lowerInst.includes("above") || lowerInst.includes("flat")) forcedAngle = "top-down flat lay composition";
  else if (lowerInst.includes("side") || lowerInst.includes("profile")) forcedAngle = "side profile shot";
  else if (lowerInst.includes("low")) forcedAngle = "imposing low angle shot";
  
  // 3. Extract explicit prefix/suffix from Knowledge Base if present (simple heuristic)
  let prefix = "";
  let suffix = "";
  
  // Simple check if user put "Start with..." in knowledge base
  if (knowledge.toLowerCase().includes("start with")) {
     const match = knowledge.match(/start with ["']?([^"']+)["']?/i);
     if (match && match[1]) prefix = match[1] + " ";
  }
  
  // Treat the rest of knowledge as style keywords
  const styleKeywords = knowledge
    .replace(/start with.*?[.;]/i, "") // remove instructions
    .replace(/always.*?[.;]/i, "")
    .split(/[,.]/)
    .map(s => s.trim())
    .filter(s => s.length > 3 && !s.toLowerCase().includes("instructions"));

  const prompts: string[] = [];
  
  const lightingOptionsDark = [
    "deep shadows with rim lighting", "soft moonlight fill", "contrast chiaroscuro lighting", "minimalist spotlighting",
    "bioluminescent glow", "flickering candlelight", "harsh silhouette backlighting", "subtle ambient occlusion"
  ];
  const lightingOptionsBright = [
    "soft diffused window light", "bright studio global illumination", "warm sunlight shafts", "even commercial lighting",
    "overexposed high-key flash", "dappled light through leaves", "clean clinical white light", "golden hour flare"
  ];
  const lightingOptionsNeutral = [
      "three-point studio setup", "softbox fill", "natural overcast sky", "neutral ring light",
      "balanced ambient light", "cinematic practical lighting", "soft butterfly lighting", "dynamic rembrandt lighting"
  ];
  
  const angleOptions = [
      "wide establishing shot", "close-up detail shot", "isometric view", "dynamic 3/4 angle",
      "dutch angle for tension", "macro lens focus", "panoramic wide view", "worms-eye view"
  ];

  for (let i = 0; i < count; i++) {
    // Select varied descriptors based on mood
    let moodWords = [...(isModern ? ADJECTIVES.modern : [])];
    if (isDark) moodWords = [...moodWords, ...ADJECTIVES.dark];
    else if (isBright) moodWords = [...moodWords, ...ADJECTIVES.bright];
    else moodWords = [...moodWords, ...ADJECTIVES.natural, ...ADJECTIVES.warm, ...ADJECTIVES.cool]; // default mix

    const adj1 = getRandom(moodWords) || "detailed";
    const adj2 = getRandom(moodWords) || "cinematic";
    const env = getRandom(ENVIRONMENTS);
    
    // Determine lighting for this variation
    let lightingPool = lightingOptionsNeutral;
    if (isDark) lightingPool = lightingOptionsDark;
    else if (isBright) lightingPool = lightingOptionsBright;
    
    const lighting = getRandom(lightingPool);

    // Determine angle (use forced if exists, else vary)
    const angle = forcedAngle || getRandom(angleOptions);

    // Assemble the description
    let core = instructions;
    if (!core.endsWith(".")) core += ".";
    
    const styleInjection = styleKeywords.slice(0, Math.min(3, styleKeywords.length)).join(", ");
    
    // Vary sentence structure slightly
    let narrative = "";
    if (i % 3 === 0) {
         narrative = `The scene depicts ${core.toLowerCase().replace(/\.$/, "")}, characterized by a ${adj1} and ${adj2} atmosphere. It is ${env}. Lighting is provided by ${lighting}. Captured as a ${angle}.`;
    } else if (i % 3 === 1) {
         narrative = `A ${adj1} interpretation of ${core.toLowerCase().replace(/\.$/, "")}. The setting is ${env}, illuminated by ${lighting}. Camera angle is a ${angle} for a ${adj2} look.`;
    } else {
         narrative = `Visualizing ${core.toLowerCase().replace(/\.$/, "")} with a ${adj2} vibe. Placed ${env}. The lighting features ${lighting}, emphasizing the ${adj1} details. Shot with a ${angle}.`;
    }
    
    const technical = `8k resolution, photorealistic, highly detailed texture${styleInjection ? ", " + styleInjection : ""}`;

    prompts.push(`${prefix}${narrative} ${technical}${suffix}`);
  }

  return prompts;
}

// --- Main Handler ---

export async function POST(req: Request) {
  try {
    const { knowledge, instructions, count, references = [], context, thread = [] } = await req.json();
    // Allow up to 20 prompts
    const promptCount = Math.max(1, Math.min(20, Number(count) || 3));
    const referenceImages = Array.isArray(references) ? references.filter((r) => typeof r === "string" && r.trim().length > 0).slice(0, 6) : [];
    const safeThread = Array.isArray(thread)
      ? thread
          .map((t) => (t && typeof t === "object" ? { role: t.role, content: t.content } : null))
          .filter((t) => (t?.role === "user" || t?.role === "assistant") && typeof t?.content === "string") as {
          role: "user" | "assistant";
          content: string;
        }[]
      : [];
    const contextNote = [
      context?.product ? `Product: ${context.product}` : null,
      context?.model ? `Model: ${context.model}` : null,
      context?.requiresReference ? "Model requires a visual reference." : null,
    ]
      .filter(Boolean)
      .join(" | ");
    const threadNote =
      safeThread.length > 0
        ? safeThread.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n---\n")
        : "No prior conversation.";

    const parsedReferences = referenceImages
      .map((src) => {
        const match = /^data:([^;]+);base64,(.*)$/i.exec(src);
        if (!match) return null;
        return {
          mime: match[1],
          base64: match[2],
          asDataUrl: src,
        };
      })
      .filter(Boolean) as { mime: string; base64: string; asDataUrl: string }[];

    // 1. Google Gemini
    if (process.env.GEMINI_API_KEY) {
      const modelsToTry = ["gemini-3-pro-preview", "gemini-2.5-flash"];
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

      for (const modelName of modelsToTry) {
        try {
          const model = genAI.getGenerativeModel({ model: modelName });

          const textPrompt = `You are a professional Prompt Engineer for commercial image generation.

USER REQUEST:
"${instructions}"

BRAND KNOWLEDGE BASE (Style/Constraints):
"${knowledge}"

CONTEXT:
${contextNote || "N/A"}

CONVERSATION HISTORY (keep consistent):
${threadNote}

REFERENCE IMAGES:
${parsedReferences.length > 0 ? "Provided below as inline image data. Analyze and align the prompts to match the product look & feel. Call out materials, colors, and structure inferred from the references." : "None provided."}

TASK:
Generate ${promptCount} unique, highly descriptive, and detailed image prompts.

REQUIREMENTS:
1. BASE: Start with the core elements of the User Request.
2. EXPAND: Add textures, lighting, atmosphere, and composition. Make it "visual" and "evocative".
3. VARIANCE: Each prompt must have a distinct setting or lighting variation while staying true to the core request.
4. INTEGRATION: Apply the tone and style from the Knowledge Base implicitly.
5. FORMAT: Return strictly a JSON array of strings.`;

          const parts: any[] = [{ text: textPrompt }];
          parsedReferences.forEach((img) =>
            parts.push({
              inlineData: {
                data: img.base64,
                mimeType: img.mime,
              },
            })
          );

          const result = await model.generateContent({
            contents: [
              {
                role: "user",
                parts,
              },
            ],
          });
          const text = result.response.text();
          const cleanedText = text.replace(/```json/g, "").replace(/```/g, "").trim();
          const json = JSON.parse(cleanedText);
          
          if (Array.isArray(json)) {
            const reply = await makeAssistantReply({
              provider: "gemini",
              prompts: json.slice(0, promptCount),
              instructions,
              knowledge,
              references: parsedReferences,
            });
            return NextResponse.json({ 
              prompts: json.slice(0, promptCount), 
              source: `Gemini (${modelName})`,
              assistantReply: reply,
            });
          }
        } catch (e: any) {
          console.error(`Gemini (${modelName}) Error:`, e);
          // Continue to next model in the list
        }
      }
    }

    // 2. OpenAI
    if (process.env.OPENAI_API_KEY) {
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const textPrompt = `You are a professional Prompt Engineer. Generate ${promptCount} distinct, detailed, and descriptive image prompts based on the user's description.

STYLE GUIDE / KNOWLEDGE (apply implicitly):
"${knowledge}"

CONTEXT:
${contextNote || "N/A"}

CONVERSATION HISTORY (keep consistent):
${threadNote}

REFERENCE IMAGES:
${parsedReferences.length > 0 ? "Provided in the same message. Infer materials, color, shape, and brand cues from them and reflect those in the prompts." : "None provided."}

Return ONLY a JSON array of strings.`;

        const userParts: any[] = [{ type: "text", text: instructions || "Describe the desired scene" }];
        parsedReferences.forEach((img) => {
          userParts.push({
            type: "image_url",
            image_url: { url: img.asDataUrl },
          });
        });

        const completion = await openai.chat.completions.create({
          messages: [
            {
              role: "system",
              content: textPrompt,
            },
            { role: "user", content: userParts },
          ],
          model: "gpt-4o",
        });
        const content = completion.choices[0].message.content || "[]";
        const parsed = JSON.parse(content);
        if(Array.isArray(parsed)) {
          const reply = await makeAssistantReply({
            provider: "openai",
            prompts: parsed,
            instructions,
            knowledge,
            references: parsedReferences,
          });
          return NextResponse.json({ prompts: parsed, source: "GPT-4 Turbo", assistantReply: reply });
        }
      } catch (e) {
        console.error("OpenAI Error:", e);
      }
    }

    // 3. Fallback
    const referenceHint = parsedReferences.length > 0 ? `There are ${parsedReferences.length} reference images. Align prompts to the depicted product.` : "";
    const historyHint = threadNote ? `Thread: ${threadNote}` : "";
    const prompts = generateFallbackPrompts(`${instructions} ${referenceHint} ${historyHint}`.trim(), knowledge || "", promptCount);
    const assistantReply = await makeAssistantReply({
      provider: "local",
      prompts,
      instructions,
      knowledge,
      references: parsedReferences,
    });
    // Artificial delay to simulate "work" if it's too fast (helps UX perception sometimes)
    await new Promise(r => setTimeout(r, 600)); 
    
    return NextResponse.json({ 
        prompts, 
        source: "Offline Logic (Fallback)", 
        assistantReply,
        warning: "AI keys invalid or unreachable. Using local generation." 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
type ParsedRef = { mime: string; base64: string; asDataUrl: string };

async function makeAssistantReply({
  provider,
  prompts,
  instructions,
  knowledge,
  references,
}: {
  provider: "gemini" | "openai" | "local";
  prompts: string[];
  instructions: string;
  knowledge: string;
  references: ParsedRef[];
}) {
  const shortSystem = `You are a concise creative prompt assistant. Respond in 1–2 sentences max. Confirm that prompts were produced and offer a helpful next step (e.g., tweak lighting, angle, or styling). Do not list the prompts. Do not mention model names.`;

  if (provider === "gemini" && process.env.GEMINI_API_KEY) {
    try {
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({ model: "gemini-3-pro-preview" });
      const parts: any[] = [
        {
          text: `${shortSystem}\nInstructions: ${instructions}\nKnowledge: ${knowledge}\nCount: ${prompts.length}\nReference images: ${references.length}`,
        },
      ];
      references.forEach((img) =>
        parts.push({
          inlineData: {
            data: img.base64,
            mimeType: img.mime,
          },
        })
      );

      const result = await model.generateContent({
        contents: [
          {
            role: "user",
            parts,
          },
        ],
      });
      const text = result.response.text().trim();
      if (text) return text;
    } catch (e) {
      console.error("Gemini assistant reply failed", e);
    }
  }

  if (provider === "openai" && process.env.OPENAI_API_KEY) {
    try {
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const userParts: any[] = [
        { type: "text", text: `Instructions: ${instructions}\nKnowledge: ${knowledge}\nCount: ${prompts.length}` },
      ];
      references.forEach((img) =>
        userParts.push({
          type: "image_url",
          image_url: { url: img.asDataUrl },
        })
      );

      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        messages: [
          { role: "system", content: shortSystem },
          { role: "user", content: userParts },
        ],
      });
      const text = completion.choices[0].message.content?.trim();
      if (text) return text;
    } catch (e) {
      console.error("OpenAI assistant reply failed", e);
    }
  }

  const refNote = references.length ? ` I used ${references.length} reference image(s).` : "";
  if (prompts.length === 0) return `I couldn’t produce prompts this round${refNote}. Want to try a different request or add another reference?`;
  if (prompts.length < 3) return `Drafted ${prompts.length} focused prompts.${refNote} Want me to push a new angle or adjust lighting?`;
  return `Generated a small batch of prompts covering varied scenes.${refNote} Want them tighter on style, camera, or lighting?`;
}
