// Per-message spam rules. These only look at one message at a time.
// Rules that need the whole table (mass senders, copy-paste blasts) live in
// lib/spam-sweep.ts and run after every insert.

export type Status = "visible" | "spam" | "hidden";
export type Verdict = { status: Status; reason: string | null };

const LINK =
  /(https?:\/\/|www\.|t\.me\/|\b[a-z0-9-]+\.(com|io|xyz|org|net|app|finance|fi|gg|me|co|site|online|top|vip|cc|link|claims?|bond|pro|live|space|cloud)\b)/i;

const BAIT =
  /\b(claim|claiming|airdrop|reward|rewards|bonus|eligible|giveaway|congratulations|congrats|whitelist|allocation|voucher|redeem|unclaimed|free\s+(eth|usdt|usdc|tokens?|nft|mint))\b/i;

// Ethscriptions and similar inscription protocols write data URIs and JSON
// into calldata. Huge volume, zero conversation.
const INSCRIPTION = /^data:|^\s*\{\s*"p"\s*:/i;

// Exchanges and bots tag their own transfers with labels like
// "BFX_REFILL_SWEEP". Uppercase words joined by _ : . or - with no spaces.
const SYSTEM_TAG = /^[A-Z0-9]+(?:[_:.-][A-Z0-9]+)+$/;

// A message that is nothing but a link is almost always an ad.
const LINK_ONLY = /^(https?:\/\/|www\.|t\.me\/)\S+$/i;

// Long unbroken base64 or base58 strings are payloads, not messages.
const ENCODED_BLOB = /^[A-Za-z0-9+/=_-]{48,}$/;

export function classify(body: string): Verdict {
  const text = body.trim();

  if (INSCRIPTION.test(text)) return { status: "spam", reason: "inscription" };
  if (ENCODED_BLOB.test(text)) return { status: "spam", reason: "encoded data" };
  if (SYSTEM_TAG.test(text)) return { status: "spam", reason: "system tag" };
  if (LINK_ONLY.test(text)) return { status: "spam", reason: "link only" };
  if (LINK.test(text) && BAIT.test(text)) return { status: "spam", reason: "phishing link" };

  return { status: "visible", reason: null };
}
