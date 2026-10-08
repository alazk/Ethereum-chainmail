import { timingSafeEqual } from "node:crypto";

// Constant-time check of an "Authorization: Bearer <secret>" header.
export function hasBearer(request: Request, secret: string | undefined): boolean {
  if (!secret) return false;
  const header = request.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}
