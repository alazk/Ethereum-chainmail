import { classify, type Status } from "./classify";
import { decodeMessage } from "./decode";

export type MessageRow = {
  tx_hash: string;
  block_number: string;
  block_time: Date;
  tx_index: number;
  from_addr: string;
  to_addr: string;
  value_wei: string;
  body: string;
  status: Status;
  spam_reason: string | null;
  pair_key: string;
};

// The minimal shape we need from a transaction. Works for viem blocks and for
// rows coming out of a BigQuery or Dune export.
export type RawTx = {
  hash: string;
  blockNumber: bigint | number | string;
  blockTime: Date;
  index: number;
  from: string;
  to: string | null | undefined;
  value: bigint | number | string;
  input: string;
};

export function pairKey(a: string, b: string): string {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? `${x}:${y}` : `${y}:${x}`;
}

export function extractMessage(tx: RawTx): MessageRow | null {
  if (!tx.to) return null; // contract deployment
  const body = decodeMessage(tx.input);
  if (!body) return null;

  const from = tx.from.toLowerCase();
  const to = tx.to.toLowerCase();
  const verdict = classify(body);

  return {
    tx_hash: tx.hash.toLowerCase(),
    block_number: String(tx.blockNumber),
    block_time: tx.blockTime,
    tx_index: Number(tx.index),
    from_addr: from,
    to_addr: to,
    value_wei: String(tx.value ?? 0),
    body,
    status: verdict.status,
    spam_reason: verdict.reason,
    pair_key: pairKey(from, to),
  };
}
