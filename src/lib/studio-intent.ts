export const STUDIO_INTENT_KEY = "outlight:studio-intent";

export type StudioIntent =
  | { type: "prompts"; prompts: string[] }
  | { type: "reference"; id: string };

function isBrowser() {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function safeParse(value: string | null): StudioIntent | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    if (parsed?.type === "prompts" && Array.isArray(parsed.prompts)) {
      return { type: "prompts", prompts: parsed.prompts.map((p: string) => String(p)) };
    }
    if (parsed?.type === "reference" && typeof parsed.id === "string") {
      return { type: "reference", id: parsed.id };
    }
    return null;
  } catch {
    return null;
  }
}

export function pushStudioIntent(intent: StudioIntent) {
  if (!isBrowser()) return;
  window.localStorage.setItem(STUDIO_INTENT_KEY, JSON.stringify(intent));
}

export function readStudioIntent(): StudioIntent | null {
  if (!isBrowser()) return null;
  return safeParse(window.localStorage.getItem(STUDIO_INTENT_KEY));
}

export function consumeStudioIntent(): StudioIntent | null {
  if (!isBrowser()) return null;
  const parsed = readStudioIntent();
  window.localStorage.removeItem(STUDIO_INTENT_KEY);
  return parsed;
}
