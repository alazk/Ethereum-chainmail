import { createHmac, randomBytes } from "node:crypto";

// Posting to X with OAuth 1.0a user context (the four keys from an X
// developer app with read and write access).

export type XKeys = { apiKey: string; apiSecret: string; accessToken: string; accessSecret: string };

export function xKeysFromEnv(): XKeys | null {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) return null;
  return { apiKey: X_API_KEY, apiSecret: X_API_SECRET, accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_SECRET };
}

// RFC 3986 percent-encoding, as OAuth 1.0a requires.
export function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

export function oauthSignature(
  method: string,
  url: string,
  params: Record<string, string>,
  consumerSecret: string,
  tokenSecret: string,
): string {
  const normalized = Object.keys(params)
    .map((k) => [pct(k), pct(params[k])] as const)
    .sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const base = [method.toUpperCase(), pct(url), pct(normalized)].join("&");
  const key = `${pct(consumerSecret)}&${pct(tokenSecret)}`;
  return createHmac("sha1", key).update(base).digest("base64");
}

export function authHeader(method: string, url: string, keys: XKeys, extra: Record<string, string> = {}): string {
  const oauth: Record<string, string> = {
    oauth_consumer_key: keys.apiKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: String(Math.floor(Date.now() / 1000)),
    oauth_token: keys.accessToken,
    oauth_version: "1.0",
  };
  // A JSON body isn't part of the signature; only query and oauth params are.
  const signature = oauthSignature(method, url, { ...extra, ...oauth }, keys.apiSecret, keys.accessSecret);
  const all = { ...oauth, oauth_signature: signature };
  return "OAuth " + Object.keys(all).sort().map((k) => `${pct(k)}="${pct(all[k as keyof typeof all])}"`).join(", ");
}

const X_POST_URL = process.env.X_API_URL ?? "https://api.x.com/2/tweets";

export async function postToX(text: string, keys: XKeys): Promise<string> {
  const res = await fetch(X_POST_URL, {
    method: "POST",
    headers: { authorization: authHeader("POST", X_POST_URL, keys), "content-type": "application/json" },
    body: JSON.stringify({ text }),
  });
  const body = (await res.json().catch(() => ({}))) as { data?: { id: string }; detail?: string; title?: string };
  if (!res.ok || !body.data?.id) throw new Error(`X API ${res.status}: ${body.detail ?? body.title ?? "no id"}`);
  return body.data.id;
}

// X counts every link as 23 characters, whatever its length.
const LINK_LENGTH = 23;
const MAX_POST = 280;

export function composePost(header: string, quote: string, link: string): string {
  const fixed = header.length + 2 + 2 + 2 + LINK_LENGTH; // header, blank line, quotes, blank line, link
  const room = MAX_POST - fixed - 2;
  const flat = quote.replace(/\s+/g, " ").trim();
  const excerpt = flat.length <= room ? flat : flat.slice(0, Math.max(room - 1, 0)).trimEnd() + "…";
  return `${header}\n\n“${excerpt}”\n\n${link}`;
}
