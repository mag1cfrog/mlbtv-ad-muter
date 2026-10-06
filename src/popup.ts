import type { DiagnosticPopupState } from "./shared/types.ts";
import { getSettings } from "./shared/settings.ts";
import { sessionKey } from "./shared/tab-session.ts";
import { getActiveTab, readTabState } from "./popup/state.ts";
import {
  copyDiagnosticsButton,
  enabledInput,
  overlayPositionInput,
  render,
  renderSettings,
  renderUnavailable,
  setCopyStatus,
  showOverlayInput
} from "./popup/view.ts";

let activeTabId: number | null = null;
let lastPopupState: DiagnosticPopupState | null = null;
let refreshSequence = 0;

async function refresh(): Promise<void> {
  const sequence = ++refreshSequence;
  try {
    const [settings, activeTab] = await Promise.all([
      getSettings(),
      getActiveTab()
    ]);
    if (sequence !== refreshSequence) {
      return;
    }
    renderSettings(settings);

    if (typeof activeTab?.id !== "number") {
      activeTabId = null;
      lastPopupState = null;
      render({ ...settings, record: {} });
      return;
    }

    activeTabId = activeTab.id;
    const record = await readTabState(activeTab.id, activeTab.mutedInfo?.muted);
    // A slower request must not overwrite a newer detector or settings update.
    if (sequence !== refreshSequence) {
      return;
    }

    lastPopupState = {
      ...settings,
      record,
      extensionVersion: chrome.runtime.getManifest().version,
      generatedAt: new Date().toISOString(),
      tabId: activeTab.id
    };
    render(lastPopupState);
  } catch (error) {
    if (sequence === refreshSequence) {
      lastPopupState = null;
      renderUnavailable(error);
    }
  }
}

enabledInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    enabled: enabledInput.checked
  });
  await refresh();
});

showOverlayInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    showOverlay: showOverlayInput.checked
  });
  await refresh();
});

overlayPositionInput.addEventListener("change", async () => {
  await chrome.storage.local.set({
    overlayPosition: overlayPositionInput.value
  });
  await refresh();
});

copyDiagnosticsButton.addEventListener("click", async () => {
  if (!lastPopupState) {
    setCopyStatus("Nothing to copy yet.");
    return;
  }

  try {
    await navigator.clipboard.writeText(
      JSON.stringify(lastPopupState, null, 2)
    );
    setCopyStatus("Copied.");
  } catch {
    setCopyStatus("Copy failed.");
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" || (
    areaName === "session" &&
    activeTabId !== null &&
    changes[sessionKey(activeTabId)]
  )) {
    refresh();
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "detector-state" && sender.tab?.id === activeTabId) {
    refresh();
  }
  return false;
});

refresh();
