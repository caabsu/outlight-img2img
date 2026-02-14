# Ad Studio - Complete Architecture & Implementation

## Overview

Ad Studio (`/ads`) is an AI agentic workflow that autonomously creates ad creatives from minimal inputs: a product, theme, model, and quantity. The agent handles everything — analyzing the product, ideating creative concepts, crafting prompts, generating images in multiple aspect ratios — with a real-time live log of its thinking and actions.

---

## 1. Agentic Workflow Architecture

### Agent Pipeline (5 Phases)

```
Phase 1: ANALYZE    → Understand product + theme + creative constraints
Phase 2: IDEATE     → Generate N creative concepts (variations)
Phase 3: CRAFT      → Convert each concept into detailed image prompts (per aspect ratio)
Phase 4: GENERATE   → Call /api/generate for each prompt (concurrent workers)
Phase 5: FINALIZE   → Compile results, report summary
```

#### Phase 1: ANALYZE (AI-powered)
- **Input**: Product data (name, image_url, shopify_vendor, shopify_product_type, shopify_price), theme string, knowledge base content (if selected)
- **Action**: Call Gemini/GPT to analyze the product and theme, producing a structured `CreativeBrief`
- **Output**:
  ```json
  {
    "productAnalysis": "Premium skincare serum in sleek glass bottle...",
    "themeInterpretation": "Summer vibes = bright, warm, tropical, energetic youth...",
    "targetMood": ["vibrant", "warm", "energetic"],
    "visualStyle": "Bright editorial photography with tropical elements",
    "colorPalette": ["coral", "turquoise", "golden yellow", "warm sand"],
    "keyElements": ["tropical leaves", "water droplets", "golden hour light"]
  }
  ```
- **Log events**: "Analyzing product...", "Product identified as [type]", "Interpreting theme: [theme]", "Creative brief established"

#### Phase 2: IDEATE (AI-powered)
- **Input**: CreativeBrief + quantity
- **Action**: Generate N creative concept variations, each a distinct creative direction
- **Output**:
  ```json
  [
    {
      "name": "Tropical Oasis",
      "description": "Product nestled among tropical leaves with dewy water droplets, golden hour backlighting",
      "prompts": { "1:1": "...", "9:16": "..." }
    }
  ]
  ```
- **Creative variance**: The AI varies based on the theme. A "summer" theme gets playful variance; a "luxury" theme gets refined, subtle variance.
- **Log events**: "Generating [N] creative concepts...", "Concept 1: [name] — [description]", etc.

#### Phase 3: CRAFT (AI-powered)
- **Input**: CreativeBrief + Concepts + aspect ratios (1:1 and 9:16 by default) + product reference image URL
- **Action**: For each concept x each aspect ratio, craft a detailed image generation prompt
  - 1:1 prompts: centered, balanced compositions for square social feed
  - 9:16 prompts: vertical framing with negative space for text overlays
- **Output**: Array of `{ conceptName, aspectRatio, prompt }` objects
- **Log events**: "Crafting prompts for [concept]...", "All prompts ready"

#### Phase 4: GENERATE (uses existing `/api/generate`)
- **Input**: All crafted prompts + model config + product reference
- **Action**: Concurrent workers (respecting model's maxConcurrency) POST to `/api/generate`
- **Progress**: Each completed image streams an update event
- **Log events**: "Starting image generation (N images)...", "Image [n/total] complete"
- **Error handling**: On failure, retry once. If still fails, log and skip.

#### Phase 5: FINALIZE
- **Action**: Compile all results, pair 1:1 and 9:16 images by concept
- **Log events**: "Campaign complete: N concepts, M images"

### Single AI Call Strategy

Phases 1-3 are combined into a **single Gemini/GPT call** (with fallback chain: Gemini → OpenAI → error) to minimize latency. The AI returns a single structured JSON containing the brief, concepts, and all prompts. The agent then parses this and proceeds to Phase 4. This is more efficient than 3 separate API calls while still streaming distinct phase-level log events as it parses the response.

### AI System Prompt (Core)

```
You are a creative advertising agent. Given a product and a creative theme, produce a complete ad campaign brief with image generation prompts.

INPUTS:
- Product: {name}, {type}, {vendor}, {price}
- Product image: [reference URL]
- Theme: "{theme}"
- Quantity: {N} concepts
- Aspect ratios: {ratios}
- Knowledge base: "{knowledge}"

OUTPUT FORMAT (strict JSON):
{
  "brief": {
    "productAnalysis": "...",
    "themeInterpretation": "...",
    "targetMood": [...],
    "visualStyle": "...",
    "colorPalette": [...],
    "keyElements": [...]
  },
  "concepts": [
    {
      "name": "...",
      "description": "...",
      "prompts": {
        "1:1": "Detailed prompt for square format...",
        "9:16": "Detailed prompt for vertical story format..."
      }
    }
  ]
}

RULES:
1. Each concept must be a DISTINCT creative direction inspired by the theme
2. Prompts must be highly detailed (lighting, composition, materials, atmosphere, camera angle)
3. 9:16 prompts must account for vertical framing — leave upper/lower negative space for text overlays
4. 1:1 prompts must be centered, balanced compositions
5. Reference the product by description, not by name (image AI doesn't know product names)
6. Incorporate the product's visual attributes from the reference image
7. Apply knowledge base style guidelines implicitly
8. Creative variance should scale with theme specificity
```

---

## 2. API Architecture

### SSE Streaming Endpoint: `src/app/api/ads/generate/route.ts`

**Method**: POST (returns SSE stream)

**Request Body**:
```typescript
type AdGenerateRequest = {
  modelId: string;           // from MODEL_LIST
  quantity: number;          // number of concepts (1-10)
  theme: string;             // human-written creative direction
  productId: string;         // product UUID
  aspectRatios: string[];    // e.g., ["1:1", "9:16"]
  knowledgeBaseId?: string;  // optional KB
  profileId: string;         // user profile
  modelOptions?: {           // model-specific options
    quality?: string;
    resolution?: string;
  };
};
```

**SSE Event Types**:
```typescript
type SSEEvent =
  | { type: "phase"; phase: string; message: string }
  | { type: "thought"; message: string }
  | { type: "action"; message: string }
  | { type: "concept"; index: number; concept: AdConcept }
  | { type: "image"; conceptIndex: number; ratio: string; url: string; prompt: string }
  | { type: "error"; message: string; conceptIndex?: number }
  | { type: "progress"; done: number; total: number }
  | { type: "complete"; summary: AdCampaignResult }
  | { type: "cancelled" }
```

**Implementation Flow**:
1. Fetch product from Supabase, stream analyze phase events
2. Fetch knowledge base content if knowledgeBaseId provided
3. Single AI call (Gemini → OpenAI fallback) to get campaign plan (brief + concepts + prompts)
4. Stream concept events as parsed
5. Build task list for all concept x ratio combinations
6. Worker pool pattern with model's maxConcurrency, calling `/api/generate` internally
7. Stream image/progress/error events as each generation completes
8. Send complete event with summary

**Internal API calls**: The route calls `/api/generate` via `fetch()` to the same origin, reusing the existing image generation infrastructure.

---

## 3. Frontend Architecture

### Page: `src/app/ads/page.tsx`

### Two-Panel Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  [Header Bar]  Ad Studio                    [model] [profile]   │
├────────────────────────────┬────────────────────────────────────┤
│                            │                                    │
│   INPUT PANEL (left)       │   OUTPUT PANEL (right)             │
│   380px fixed              │   fluid                            │
│                            │                                    │
│   ┌─ Product ──────────┐   │   ┌─ Agent Log (h-64) ───────────┐│
│   │ [Select product]   │   │   │ ● ANALYZE          12:04:01  ││
│   │ product card       │   │   │   Product: Serum X (skincare) ││
│   └────────────────────┘   │   │ ● IDEATE           12:04:03  ││
│                            │   │   → Concept 1: Tropical Oasis ││
│   ┌─ Theme ────────────┐   │   │ ● GENERATE         12:04:05  ││
│   │ textarea           │   │   │   ■■■□□□ 4/8 complete        ││
│   └────────────────────┘   │   │ ● COMPLETE         12:04:42  ││
│                            │   └──────────────────────────────┘│
│   ┌─ Settings ─────────┐   │                                    │
│   │ Model: [dropdown]  │   │   ┌─ Results Grid ───────────────┐│
│   │ Quality: [high]    │   │   │  Concept: "Tropical Oasis"   ││
│   │ Resolution: [2K]   │   │   │  ┌──────┐  ┌──────┐          ││
│   │ Quantity: [---3--] │   │   │  │ 1:1  │  │ 9:16 │          ││
│   │ Knowledge: [▼]     │   │   │  └──────┘  └──────┘          ││
│   │ Profile: [▼]       │   │   │                               ││
│   └────────────────────┘   │   │  Concept: "Beach Energy"      ││
│                            │   │  ┌──────┐  ┌──────┐          ││
│   ┌─ Formats ──────────┐   │   │  │ 1:1  │  │ 9:16 │          ││
│   │ [1:1] [9:16] ...   │   │   │  └──────┘  └──────┘          ││
│   └────────────────────┘   │   └───────────────────────────────┘│
│                            │                                    │
│   [▶ Launch Campaign]      │                                    │
│   3 concepts x 2 = 6 imgs  │                                    │
└────────────────────────────┴────────────────────────────────────┘
```

### Inline Components

All components live within `page.tsx` (following existing Image/Video Studio pattern):

- **ProductSelectorModal** — Grid-based product picker with search
- **AgentLog** — Auto-scrolling log with color-coded phase indicators and progress bar
- **ResultsGrid** — Concept cards with paired aspect ratio images, click to expand
- **ImageModal** — Fullscreen image view with download and prompt display

### Key State

```typescript
// Inputs
const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
const [theme, setTheme] = useState("");
const [modelId, setModelId] = useState("nanobanana-3-pro");
const [quantity, setQuantity] = useState(3);
const [aspectRatios, setAspectRatios] = useState({ "1:1": true, "9:16": true });
const [knowledgeBaseId, setKnowledgeBaseId] = useState<string | null>(null);
const [modelOptions, setModelOptions] = useState<Record<string, string>>({});

// Agent state
const [status, setStatus] = useState<"idle" | "running" | "done" | "error" | "cancelled">("idle");
const [logEntries, setLogEntries] = useState<LogEntry[]>([]);
const [concepts, setConcepts] = useState<AdConcept[]>([]);
const [images, setImages] = useState<AdImage[]>([]);
const [progress, setProgress] = useState({ done: 0, total: 0 });
const controllerRef = useRef<AbortController | null>(null);

// UI
const [expandedImage, setExpandedImage] = useState<AdImage | null>(null);
const [showProductModal, setShowProductModal] = useState(false);
```

### SSE Consumption

The frontend reads the SSE stream via `fetch()` + `ReadableStream` reader, parsing newline-delimited JSON events and routing them to appropriate state setters via a switch statement on `event.type`.

### Agent Log UI

- Phase headers: colored dots (blue=analyze, purple=ideate, amber=craft, orange=generate, green=complete)
- Thoughts: indented, dimmer text
- Actions: arrow prefix (→)
- Errors: red text
- Progress bar during generation phase
- Animated spinner while running

### Results Grid

- Grouped by concept with name + description header
- Side-by-side images per aspect ratio
- Skeleton/spinner placeholder while generating
- Click image to expand in fullscreen modal with download

---

## 4. Session Persistence

### Storage Key
```typescript
AD_STUDIO: "ol_ad_studio_session"
```

### Session Type
```typescript
type AdStudioSession = {
  version: 1;
  savedAt: number;
  theme: string;
  modelId: string;
  quantity: number;
  aspectRatios: Record<string, boolean>;
  knowledgeBaseId: string | null;
  selectedProductId: string | null;
  modelOptions: Record<string, string>;
  lastCampaign: {
    concepts: AdConcept[];
    images: Array<{ conceptIndex: number; ratio: string; url: string; prompt: string }>;
    logEntries: Array<{ type: string; message: string; timestamp: number; phase?: string }>;
    status: "done" | "error" | "cancelled";
  } | null;
};
```

### Behavior
- Inputs persist across page refreshes (debounced 1s save)
- Last campaign results persist (HTTP URLs only, max 50 images to avoid quota)
- Running campaigns become "cancelled" on page reload (can't resume)

---

## 5. Types

### `src/lib/ad-types.ts`

```typescript
export type AdConcept = {
  name: string;
  description: string;
  prompts: Record<string, string>;  // { "1:1": "...", "9:16": "..." }
};

export type AdImage = {
  conceptIndex: number;
  ratio: string;
  url: string;
  prompt: string;
};

export type AdCampaignResult = {
  brief: {
    productAnalysis: string;
    themeInterpretation: string;
    targetMood: string[];
    visualStyle: string;
    colorPalette: string[];
    keyElements: string[];
  };
  concepts: AdConcept[];
  totalImages: number;
  successCount: number;
  failCount: number;
};

export type LogEntry = {
  type: "phase" | "thought" | "action" | "error";
  phase?: string;
  message: string;
  timestamp: number;
};
```

---

## 6. File Inventory

### Created Files
| File | Purpose | Lines |
|------|---------|-------|
| `src/lib/ad-types.ts` | Shared TypeScript types | ~40 |
| `src/app/api/ads/generate/route.ts` | SSE streaming agent endpoint | ~300 |
| `src/app/ads/page.tsx` | Main Ad Studio page | ~900 |

### Modified Files
| File | Change |
|------|--------|
| `src/components/layout/SiteHeader.tsx` | Added "Ad Studio" nav link + `/ads` activeHref |
| `src/lib/session-storage.ts` | Added AD_STUDIO key + AdStudioSession type + save/load helpers |

### Reused Files (no modifications)
| File | How It's Used |
|------|---------------|
| `src/lib/models.ts` | Import MODEL_LIST, getModelById for model selection |
| `src/app/api/generate/route.ts` | Called internally via fetch for image generation |
| `src/app/api/products/route.ts` | Fetch product data |
| `src/app/api/knowledge/route.ts` | Fetch knowledge base content |
| `src/app/api/profiles/route.ts` | Fetch user profiles |

---

## 7. Video Scalability

The architecture supports future video ad generation:

1. **`aspectRatios` is generic** — not hardcoded to image-only ratios
2. **`AdConcept.prompts`** is `Record<string, string>` — can hold video prompts
3. **Phase 4 (GENERATE)** can dispatch to `/api/video/generate` based on media type
4. **SSE event types** include generic fields — a `"video"` event type fits naturally
5. **Results grid** groups by concept, not by media type

Future additions:
- Add `mediaTypes: ("image" | "video")[]` to the request
- Agent crafts both image and video prompts per concept
- Phase 4 routes to the appropriate generation API
- Results grid shows video thumbnails alongside images

---

## 8. Verification Checklist

1. Navigation: Click "Ad Studio" in header → page loads at `/ads`
2. Product selection: Select a product → card displays with image
3. Theme input: Enter theme text → persists across refresh
4. Model selection: Switch models → options update accordingly
5. Launch campaign: Click Launch → agent log streams in real-time → concepts appear → images generate and display
6. Cancellation: Click cancel during generation → stream stops, partial results displayed
7. Session persistence: Refresh page → last campaign results still visible
8. Aspect ratios: Both 1:1 and 9:16 checked by default → both formats generated
9. Error handling: Disconnect API key → graceful error in log, partial results shown
