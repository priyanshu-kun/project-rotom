import { parse } from "node-html-parser";
import { env } from "../../config/env.js";
import { BadRequestError, UpstreamError } from "../../lib/errors.js";

/** Tags whose text content is noise for a job posting. */
const STRIP_TAGS = ["script", "style", "noscript", "nav", "footer", "header", "svg", "iframe"];
const MAX_TEXT_CHARS = 50_000; // Cap what we hand to the CLI (token budget).

/**
 * Fetch a job posting URL and reduce it to readable text for the AI layer to
 * structure. Deliberately simple (fetch + strip + collapse) — the CLI is robust
 * to messy text, so perfect readability extraction is unnecessary.
 *
 * Throws BadRequestError for an invalid URL, UpstreamError for fetch/HTTP/size
 * failures. Callers fall back to requiring pasted `jdText` (JD-4).
 */
export async function fetchJobPostingText(url: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestError("jobUrl is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new BadRequestError("jobUrl must be an http(s) URL");
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.JD_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(parsed, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "User-Agent": env.JD_FETCH_USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    throw new UpstreamError(
      aborted
        ? `Timed out fetching jobUrl after ${env.JD_FETCH_TIMEOUT_MS}ms`
        : `Failed to fetch jobUrl: ${String(error)}`,
    );
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new UpstreamError(`jobUrl returned HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("xml")) {
    throw new UpstreamError(`jobUrl is not an HTML page (content-type: ${contentType || "unknown"})`);
  }

  const html = await readCapped(response, env.JD_FETCH_MAX_BYTES);
  const text = htmlToText(html);
  if (text.length < 50) {
    throw new UpstreamError(
      "Could not extract meaningful text from jobUrl (likely a JS-rendered/auth-walled page); paste the description instead",
    );
  }
  return text.slice(0, MAX_TEXT_CHARS);
}

/** Read the response body up to a byte cap, aborting if exceeded. */
async function readCapped(response: Response, maxBytes: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return response.text();
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for (;;) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    // The web-stream value type is `any` in @types/node; it is a Uint8Array.
    const chunk = Buffer.from(result.value as Uint8Array);
    total += chunk.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new UpstreamError(`jobUrl response exceeded ${maxBytes} bytes`);
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Strip noise tags and collapse whitespace into readable plain text. */
function htmlToText(html: string): string {
  const root = parse(html, { comment: false });
  for (const tag of STRIP_TAGS) {
    for (const node of root.querySelectorAll(tag)) {
      node.remove();
    }
  }
  return root.structuredText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
}
