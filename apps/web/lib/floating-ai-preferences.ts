export type FloatingAiPreferences = { desktop: boolean; mobile: boolean };

export const DEFAULT_FLOATING_AI: FloatingAiPreferences = { desktop: true, mobile: false };
export const FLOATING_AI_KEY = "bookmark-ai:floating-ai";

export function parseFloatingAiPreferences(value: string | null): FloatingAiPreferences {
  try {
    const saved = value ? JSON.parse(value) : null;
    return {
      desktop: typeof saved?.desktop === "boolean" ? saved.desktop : DEFAULT_FLOATING_AI.desktop,
      mobile: typeof saved?.mobile === "boolean" ? saved.mobile : DEFAULT_FLOATING_AI.mobile,
    };
  } catch {
    return DEFAULT_FLOATING_AI;
  }
}
