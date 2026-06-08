import { describe, expect, it } from "vitest";
import {
  decryptJson,
  encryptJson,
  generateApiToken,
  safeHexEqual,
  sha256Hex,
  type EncryptedEnvelope,
} from "../src/lib/crypto.js";

describe("crypto.encryptJson / decryptJson", () => {
  it("round-trips an object", () => {
    const value = { fullName: "Ada Lovelace", email: "ada@example.com", nested: [1, 2, 3] };
    const envelope = encryptJson(value);
    expect(envelope.v).toBe(1);
    expect(decryptJson(envelope)).toEqual(value);
  });

  it("produces a different ciphertext each call (random IV)", () => {
    const a = encryptJson({ x: 1 });
    const b = encryptJson({ x: 1 });
    expect(a.iv).not.toEqual(b.iv);
    expect(a.data).not.toEqual(b.data);
  });

  it("does not leak plaintext into the envelope", () => {
    const envelope = encryptJson({ secret: "super-secret-value" });
    expect(JSON.stringify(envelope)).not.toContain("super-secret-value");
  });

  it("rejects a tampered ciphertext (GCM auth)", () => {
    const envelope = encryptJson({ x: 1 });
    const tampered: EncryptedEnvelope = {
      ...envelope,
      data: Buffer.from("not the real ciphertext").toString("base64"),
    };
    expect(() => decryptJson(tampered)).toThrow();
  });

  it("rejects a non-envelope value", () => {
    expect(() => decryptJson({ foo: "bar" })).toThrow(/not a valid encrypted envelope/);
  });

  it("rejects an unsupported version", () => {
    const envelope = { ...encryptJson({ x: 1 }), v: 99 };
    expect(() => decryptJson(envelope)).toThrow(/unsupported encryption version/);
  });
});

describe("crypto hashing helpers", () => {
  it("sha256Hex is stable and 64 hex chars", () => {
    const hash = sha256Hex("hello");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("hello")).toBe(hash);
  });

  it("safeHexEqual compares equal and unequal hashes", () => {
    const a = sha256Hex("token-a");
    const b = sha256Hex("token-b");
    expect(safeHexEqual(a, a)).toBe(true);
    expect(safeHexEqual(a, b)).toBe(false);
  });

  it("safeHexEqual returns false on length mismatch", () => {
    expect(safeHexEqual("aa", "aaaa")).toBe(false);
    expect(safeHexEqual("", "")).toBe(false);
  });

  it("generateApiToken yields unique URL-safe tokens", () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThanOrEqual(40);
  });
});
