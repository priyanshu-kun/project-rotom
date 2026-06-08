import { api, ApiError } from "../lib/api.js";

/**
 * Phase 0 background service worker stub. It exists to prove the extension ↔
 * backend auth handshake works end to end. Popup, dashboard, content scripts,
 * and the apply flow are added in later phases.
 *
 * Responds to a single runtime message, `rotom:ping-backend`, by calling the
 * authenticated profile endpoint and reporting connectivity.
 */

interface PingResult {
  connected: boolean;
  error?: string;
}

browser.runtime.onMessage.addListener((message: unknown): Promise<PingResult> | undefined => {
  if (
    typeof message === "object" &&
    message !== null &&
    (message as { type?: unknown }).type === "rotom:ping-backend"
  ) {
    return pingBackend();
  }
  return undefined;
});

async function pingBackend(): Promise<PingResult> {
  try {
    await api.getProfile();
    return { connected: true };
  } catch (error) {
    if (error instanceof ApiError) {
      return { connected: false, error: `${error.code}: ${error.message}` };
    }
    return { connected: false, error: String(error) };
  }
}

console.info("[Rotom] background scaffold loaded");
