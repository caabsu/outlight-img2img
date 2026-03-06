# UGC Video Studio Architecture

## Goal

`/ugc` is a dedicated workflow page for creator-style video ads. It is built around two coordinated agent tracks instead of a single generic generation form:

1. The on-camera dialogue agent
2. The separate B-roll coverage agent

The page is designed to turn a product plus script intent into:

- selectable script options
- avatar and base-scene prompts
- ordered 5-second dialogue clip prompts
- B-roll seed image prompts
- B-roll clip prompts

## Current implementation

Implemented:

- new `UGC Studio` page at `/ugc`
- planning endpoint at `/api/ugc/plan`
- configurable agent prompt pack in-page
- safe vs fast execution mode
- catalog product selection or custom product upload
- generated or uploaded script source
- base-scene image generation using existing `/api/generate`
- dialogue clip generation using existing `/api/video/generate` with Kling 3.0
- B-roll seed image generation
- B-roll clip generation
- JSON and prompt-pack export

Intentionally constrained:

- execution path is currently optimized around `Nano Banana 2`-style image generation and `Kling 3.0`
- the planning route is AI-first with heuristic fallback, but execution is deterministic and uses existing generation APIs
- safe mode stores and applies stage-specific override notes, but it is not yet a resumable multi-run workflow engine with server persistence

## Agent model

### Agent 1: Script Strategist

Responsibilities:

- create or preserve the script
- estimate runtime
- map dialogue beats
- produce the approved script contract for downstream steps

Primary outputs:

- `scriptOptions`
- `selectedScriptId`

### Agent 2: Scene Architect

Responsibilities:

- infer believable environment from script/product context
- propose avatar candidates
- produce base-scene prompts for vertical creator framing

Primary outputs:

- `avatarOptions`
- `sceneVariations`

### Agent 3: Dialogue Director

Responsibilities:

- segment approved dialogue into ordered 5-second batches
- preserve exact spoken text
- add gesture, continuity, and camera instructions per clip

Primary outputs:

- `dialogueClips`

### Agent 4: B-roll Director

Responsibilities:

- derive supporting coverage from the approved scene and script
- generate empty-scene, hero, detail, and alternate-angle prompts
- convert seed images into B-roll clip prompts

Primary outputs:

- `bRollImagePlans`
- `bRollClipPlans`

### Agent 5: Safe Mode Coordinator

Responsibilities:

- insert approval gates
- capture disapproval rationale
- prioritize the latest user override for the next action

Primary outputs:

- `approvalGates`
- stage override notes

## Planning contract

Shared types live in [`src/lib/ugc-types.ts`](/Users/heesuchung/outlight-img2img/outlight-img2img/src/lib/ugc-types.ts).

The planning route returns:

- `productAnalysis`
- `scriptOptions`
- `avatarOptions`
- `sceneVariations`
- `dialogueClips`
- `bRollImagePlans`
- `bRollClipPlans`
- `approvalGates`
- `architecture`
- `summary`

This contract is stable enough that the page can render planning results before any expensive generation starts.

## Execution flow

1. Build workflow plan with `/api/ugc/plan`
2. Approve or revise the plan
3. Generate base scene images from `sceneVariations`
4. Select a base scene
5. Generate talking-head clips from `dialogueClips`
6. Generate B-roll seed images from `bRollImagePlans`
7. Generate B-roll clips from `bRollClipPlans`
8. Download selected dialogue and B-roll outputs

## Safe mode behavior

Safe mode inserts approval gates after:

- planning
- base scene selection
- dialogue clip render batch
- B-roll clip render batch

Each gate accepts:

- approve
- disapprove
- freeform override notes

Those override notes are appended to the next generation prompt for that stage. This is the current implementation of “latest user instruction overrides default workflow.”

## UI layout

The page is split into:

- left sticky control rail
- right execution workspace

Right workspace sections:

- workflow board
- workflow plan
- base scene generation
- dialogue clip batch
- separate B-roll agent
- prompt architecture
- runtime activity log

## Files

- Page: [`src/app/ugc/page.tsx`](/Users/heesuchung/outlight-img2img/outlight-img2img/src/app/ugc/page.tsx)
- Planning route: [`src/app/api/ugc/plan/route.ts`](/Users/heesuchung/outlight-img2img/outlight-img2img/src/app/api/ugc/plan/route.ts)
- Shared types: [`src/lib/ugc-types.ts`](/Users/heesuchung/outlight-img2img/outlight-img2img/src/lib/ugc-types.ts)
- Navigation: [`src/components/layout/SiteHeader.tsx`](/Users/heesuchung/outlight-img2img/outlight-img2img/src/components/layout/SiteHeader.tsx)

## Next upgrades

- persist workflows and approvals server-side
- add multi-model execution parity for Veo and Sora
- support re-planning from any approved intermediate asset
- zip bulk download server-side
- add resumable runs and cancellation semantics
