/**
 * Minimal token-authenticated API client for the Rotom backend.
 *
 * Phase 0 scaffold: establishes the auth handshake (Bearer token stored in
 * `browser.storage.local`) and a typed fetch wrapper. Feature methods (profile
 * editor, generation, tracking) are added in later phases alongside the UI.
 */

const DEFAULT_BASE_URL = "http://localhost:8787";
const TOKEN_STORAGE_KEY = "rotom.apiToken";
const BASE_URL_STORAGE_KEY = "rotom.baseUrl";

export interface ApiErrorBody {
  error: { code: string; message: string; requestId: string; details?: unknown };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function getStored(key: string): Promise<string | undefined> {
  const result = await browser.storage.local.get(key);
  const value = result[key];
  return typeof value === "string" ? value : undefined;
}

export async function setApiToken(token: string): Promise<void> {
  await browser.storage.local.set({ [TOKEN_STORAGE_KEY]: token });
}

export async function setBaseUrl(url: string): Promise<void> {
  await browser.storage.local.set({ [BASE_URL_STORAGE_KEY]: url });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const [token, baseUrl] = await Promise.all([
    getStored(TOKEN_STORAGE_KEY),
    getStored(BASE_URL_STORAGE_KEY),
  ]);
  if (!token) {
    throw new ApiError(0, "NO_TOKEN", "No API token configured. Set it in extension settings.");
  }

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(`${baseUrl ?? DEFAULT_BASE_URL}${path}`, { ...init, headers });
  const text = await response.text();
  const payload: unknown = text ? JSON.parse(text) : undefined;

  if (!response.ok) {
    const body = payload as ApiErrorBody | undefined;
    throw new ApiError(
      response.status,
      body?.error?.code ?? "HTTP_ERROR",
      body?.error?.message ?? response.statusText,
      body?.error?.requestId,
    );
  }
  return payload as T;
}

export const api = {
  /** Connectivity check used by the Phase 0 background stub. */
  getProfile: () => request<{ profile: unknown }>("/api/profile"),
};
