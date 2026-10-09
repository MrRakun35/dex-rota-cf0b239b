// RSA-OAEP credential sealing adapted from starchild-orderly-plugin (MIT).
// The decoded seed is cleared after sealing and never returned to the caller.
export function decodeOrderlySeed(encoded: string): Uint8Array<ArrayBuffer> {
  const value = encoded.replace(/^ed25519:/, "");
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (!value.length || value.length > 44)
    throw new Error("Invalid trading key.");
  let number = 0n;
  for (const character of value) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("Invalid trading key.");
    number = number * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (number > 0n) {
    bytes.unshift(Number(number & 255n));
    number >>= 8n;
  }
  const leadingZeros = value.match(/^1*/)?.[0].length || 0;
  if (leadingZeros + bytes.length !== 32)
    throw new Error("Invalid trading key length.");
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

export async function sealTradingKey(pubKey: string, encoded: string) {
  const seed = decodeOrderlySeed(encoded);
  try {
    const binary = atob(
      pubKey.replace(
        /-----BEGIN PUBLIC KEY-----|-----END PUBLIC KEY-----|\s/g,
        "",
      ),
    );
    const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey(
      "spki",
      der,
      { name: "RSA-OAEP", hash: "SHA-256" },
      false,
      ["encrypt"],
    );
    const encrypted = await crypto.subtle.encrypt(
      { name: "RSA-OAEP" },
      key,
      seed,
    );
    return btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  } finally {
    seed.fill(0);
  }
}
