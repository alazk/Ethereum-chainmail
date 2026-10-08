import { db } from "./db";

// Table-wide spam rules. Both are about copy-paste: real negotiations are
// written for one reader, spam is the same text sprayed at many.

// One sender, same text, many recipients.
export const SAME_SENDER_RECIPIENTS = 10;
// Many senders, same text (bot farms). Only for texts long enough that
// people wouldn't write them identically by chance ("gm" is fine).
export const SAME_TEXT_SENDERS = 25;
export const SAME_TEXT_MIN_LENGTH = 20;

export async function sweepSpam(senders?: string[]): Promise<number> {
  const sql = db();
  const scope = senders && senders.length > 0;

  const blasts = await sql`
    update messages m set status = 'spam', spam_reason = 'same text sent to many addresses'
    from (
      select from_addr, body_hash from messages
      ${scope ? sql`where from_addr = any(${senders!})` : sql``}
      group by from_addr, body_hash
      having count(distinct to_addr) >= ${SAME_SENDER_RECIPIENTS}
    ) s
    where m.status = 'visible' and m.from_addr = s.from_addr and m.body_hash = s.body_hash`;

  const farms = await sql`
    update messages m set status = 'spam', spam_reason = 'same text from many senders'
    from (
      select body_hash from messages
      where length(body) >= ${SAME_TEXT_MIN_LENGTH}
      ${scope ? sql`and body_hash in (select body_hash from messages where from_addr = any(${senders!}))` : sql``}
      group by body_hash
      having count(distinct from_addr) >= ${SAME_TEXT_SENDERS}
    ) s
    where m.status = 'visible' and m.body_hash = s.body_hash`;

  return blasts.count + farms.count;
}
