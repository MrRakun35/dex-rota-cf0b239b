import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decodeOrderlySeed, sealTradingKey } from "./credentials";

afterEach(() => vi.unstubAllGlobals());
describe("Orderly credential sealing", () => {
  it("decodes a 32-byte seed with and without the ed25519 prefix", () => {
    const vector = "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi";
    expect([...decodeOrderlySeed(vector)]).toEqual(new Array(32).fill(1));
    expect([...decodeOrderlySeed(`ed25519:${vector}`)]).toEqual(
      new Array(32).fill(1),
    );
    expect([...decodeOrderlySeed("1".repeat(32))]).toEqual(
      new Array(32).fill(0),
    );
  });
  it.each(["", "0".repeat(32), "1", "1".repeat(33)])(
    "rejects malformed seeds: %s",
    (value) => {
      expect(() => decodeOrderlySeed(value)).toThrow();
    },
  );
  it("produces RSA-OAEP SHA-256 ciphertext that decrypts to the seed", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const keys = await webcrypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["encrypt", "decrypt"],
    );
    const exported = await webcrypto.subtle.exportKey("spki", keys.publicKey);
    const pem = `-----BEGIN PUBLIC KEY-----\n${Buffer.from(exported).toString("base64")}\n-----END PUBLIC KEY-----`;
    const ciphertext = await sealTradingKey(
      pem,
      "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
    );
    const plain = await webcrypto.subtle.decrypt(
      { name: "RSA-OAEP" },
      keys.privateKey,
      Buffer.from(ciphertext, "base64"),
    );
    expect([...new Uint8Array(plain)]).toEqual(new Array(32).fill(1));
  });
});
