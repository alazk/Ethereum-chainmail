// Minimal JSON-RPC client for bulk block reads. Skips viem's formatting, which
// matters when the backfill reads hundreds of thousands of blocks on a
// CPU-metered host.

export type RpcTx = {
  hash: string;
  transactionIndex: string;
  from: string;
  to: string | null;
  value: string;
  input: string;
};
export type RpcBlock = { number: string; timestamp: string; transactions: RpcTx[] };

let nextId = 1;

async function call<T>(url: string, body: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    // Rate limited: back off and retry a few times.
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    return (await res.json()) as T;
  }
}

type RpcResponse<T> = { id: number; result?: T; error?: { message: string } };

export async function rpcBlockNumber(url: string): Promise<bigint> {
  const res = await call<RpcResponse<string>>(url, { jsonrpc: "2.0", id: nextId++, method: "eth_blockNumber", params: [] });
  if (!res.result) throw new Error(res.error?.message ?? "eth_blockNumber failed");
  return BigInt(res.result);
}

// Fetches blocks with full transactions in one batch request.
export async function rpcBlocks(url: string, numbers: bigint[]): Promise<RpcBlock[]> {
  if (numbers.length === 0) return [];
  const reqs = numbers.map((n) => ({
    jsonrpc: "2.0",
    id: nextId++,
    method: "eth_getBlockByNumber",
    params: ["0x" + n.toString(16), true],
  }));
  const res = await call<RpcResponse<RpcBlock>[]>(url, reqs);
  const byId = new Map(res.map((r) => [r.id, r]));
  return reqs.map((req) => {
    const r = byId.get(req.id);
    if (!r?.result) throw new Error(`Block ${BigInt(req.params[0] as string)}: ${r?.error?.message ?? "missing"}`);
    return r.result;
  });
}
