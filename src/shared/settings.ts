import type {
  ExtensionSettings,
  OverlayPosition
} from "./types.ts";
import { DEFAULT_POSITION, normalizePosition } from "./overlay-policy.ts";

export const DEFAULT_SETTINGS: ExtensionSettings = Object.freeze({
  enabled: false,
  showOverlay: false,
  overlayPosition: DEFAULT_POSITION
});

export async function getSettings(): Promise<ExtensionSettings> {
  const stored = await chrome.storage.local.get(
    DEFAULT_SETTINGS
  ) as ExtensionSettings;
  return {
    ...stored,
    overlayPosition: normalizePosition(stored.overlayPosition)
  };
}

export async function initializeSettings(): Promise<void> {
  const existing = await chrome.storage.local.get(
    Object.keys(DEFAULT_SETTINGS)
  );
  const missingDefaults: Record<string, boolean | OverlayPosition> = {};

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (typeof existing[key] !== typeof value) {
      missingDefaults[key] = value;
    }
  }

  const normalizedOverlayPosition = normalizePosition(
    existing.overlayPosition
  );
  if (existing.overlayPosition !== normalizedOverlayPosition) {
    missingDefaults.overlayPosition = normalizedOverlayPosition;
  }

  if (Object.keys(missingDefaults).length) {
    await chrome.storage.local.set(missingDefaults);
  }
}
