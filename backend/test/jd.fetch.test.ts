import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchJobPostingText } from "../src/modules/jd/jd.fetch.js";
import { BadRequestError, UpstreamError } from "../src/lib/errors.js";

const fetchMock = vi.fn();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const LONG_BODY = `
  <html><head><title>x</title><style>.a{color:red}</style></head>
  <body>
    <script>var secret = "do-not-include";</script>
    <nav>Home About</nav>
    <h1>Senior Backend Engineer</h1>
    <p>We are looking for an engineer to build scalable services in Go and TypeScript.</p>
    <p>You will own the applications platform and mentor other engineers.</p>
    <footer>Privacy Terms</footer>
  </body></html>`;

function htmlResponse(body: string, init?: { status?: number; contentType?: string }): Response {
  return new Response(body, {
    status: init?.status ?? 200,
    headers: { "content-type": init?.contentType ?? "text/html; charset=utf-8" },
  });
}

describe("fetchJobPostingText", () => {
  it("rejects an invalid URL without fetching", async () => {
    await expect(fetchJobPostingText("not a url")).rejects.toBeInstanceOf(BadRequestError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a non-http(s) protocol", async () => {
    await expect(fetchJobPostingText("ftp://example.com/jd")).rejects.toBeInstanceOf(
      BadRequestError,
    );
  });

  it("extracts readable text and strips script/style/nav/footer", async () => {
    fetchMock.mockResolvedValue(htmlResponse(LONG_BODY));
    const text = await fetchJobPostingText("https://example.com/jobs/1");
    expect(text).toContain("Senior Backend Engineer");
    expect(text).toContain("Go and TypeScript");
    expect(text).not.toContain("do-not-include");
    expect(text).not.toContain("Privacy Terms");
  });

  it("throws UpstreamError on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(htmlResponse("nope", { status: 404 }));
    await expect(fetchJobPostingText("https://example.com/x")).rejects.toBeInstanceOf(UpstreamError);
  });

  it("throws UpstreamError for a non-HTML content type", async () => {
    fetchMock.mockResolvedValue(htmlResponse("{}", { contentType: "application/json" }));
    await expect(fetchJobPostingText("https://example.com/x")).rejects.toThrow(/not an HTML page/);
  });

  it("maps an aborted fetch to a timeout UpstreamError", async () => {
    fetchMock.mockImplementation(() => {
      const error = new Error("aborted");
      error.name = "AbortError";
      return Promise.reject(error);
    });
    await expect(fetchJobPostingText("https://example.com/x")).rejects.toThrow(/Timed out/);
  });

  it("rejects pages with too little extractable text", async () => {
    fetchMock.mockResolvedValue(htmlResponse("<html><body><div></div></body></html>"));
    await expect(fetchJobPostingText("https://example.com/x")).rejects.toThrow(/meaningful text/);
  });
});
