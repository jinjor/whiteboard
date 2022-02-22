const IV_LENGTH = 16;

function bufToBase64(buffer: ArrayBuffer): string {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
function base64ToBuf(base64: string): ArrayBuffer {
  const binary_string = atob(base64);
  const len = binary_string.length;
  let bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary_string.charCodeAt(i);
  }
  return bytes.buffer;
}

async function aesEncrypt(key: CryptoKey, text: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const result = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    new TextEncoder().encode(text)
  );
  const buffer = new Uint8Array(IV_LENGTH + result.byteLength);
  buffer.set(iv, 0);
  buffer.set(new Uint8Array(result), IV_LENGTH);
  return bufToBase64(buffer);
}

async function aesDecrypt(key: CryptoKey, text: string) {
  const buffer = base64ToBuf(text);
  const iv = buffer.slice(0, IV_LENGTH);
  const buf = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
    },
    key,
    buffer.slice(IV_LENGTH)
  );
  return new TextDecoder().decode(buf);
}

async function makeKey(secret: string) {
  const digest = await crypto.subtle.digest(
    { name: "SHA-256" },
    new TextEncoder().encode(secret)
  );
  return await crypto.subtle.importKey("raw", digest, "AES-GCM", true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encrypt(secret: string, text: string): Promise<string> {
  const key = await makeKey(secret);
  return aesEncrypt(key, text);
}

export async function decrypt(secret: string, text: string): Promise<string> {
  const key = await makeKey(secret);
  return aesDecrypt(key, text);
}

export async function digest(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-1",
    new TextEncoder().encode(text)
  );
  const hashArray = Array.from(new Uint8Array(buf));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}
