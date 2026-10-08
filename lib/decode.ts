// Turns transaction input data into a human message, or null if it isn't one.
//
// Contract calls almost never survive these checks: ABI arguments are padded
// with 0x00 bytes, and a NUL inside the text fails the readability test.

const MAX_INPUT_BYTES = 20_000;
const MIN_LETTERS = 2;
const MIN_READABLE_RATIO = 0.95;

const utf8 = new TextDecoder("utf-8", { fatal: true });

// Letters, marks, numbers, punctuation, symbols (incl. emoji), spaces,
// common whitespace, and the zero-width joiner used inside emoji sequences.
const READABLE = /[\p{L}\p{M}\p{N}\p{P}\p{S}\p{Zs}\n\r\t‍]/u;
const LETTER = /\p{L}/gu;
const HEX_BLOB = /^(0x)?[0-9a-f\s]{16,}$/i;

export function hexToBytes(input: string): Uint8Array | null {
  const hex = input.startsWith("0x") || input.startsWith("0X") ? input.slice(2) : input;
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  if (!/^[0-9a-fA-F]+$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

export function isReadable(text: string): boolean {
  const chars = Array.from(text);
  if (chars.length < 2) return false;
  let readable = 0;
  for (const c of chars) if (READABLE.test(c)) readable++;
  if (readable / chars.length < MIN_READABLE_RATIO) return false;
  const letters = text.match(LETTER)?.length ?? 0;
  if (letters < MIN_LETTERS) return false;
  // Someone pasting a hash or raw hex isn't writing a message.
  if (HEX_BLOB.test(text.trim())) return false;
  return true;
}

export function decodeMessage(input: string | null | undefined): string | null {
  if (!input || input === "0x") return null;
  // Cheap length guard before allocating anything.
  if (input.length > MAX_INPUT_BYTES * 2 + 2) return null;

  const bytes = hexToBytes(input);
  if (!bytes || bytes.length < 2) return null;

  // Some senders pad their message with NUL bytes on either side.
  let start = 0;
  let end = bytes.length;
  while (start < end && bytes[start] === 0) start++;
  while (end > start && bytes[end - 1] === 0) end--;
  if (end - start < 2) return null;

  let text: string;
  try {
    text = utf8.decode(bytes.subarray(start, end));
  } catch {
    return null; // not valid UTF-8, so a contract call or binary data
  }

  if (!isReadable(text)) return null;
  const trimmed = text.trim();
  return trimmed.length >= 2 ? trimmed : null;
}
