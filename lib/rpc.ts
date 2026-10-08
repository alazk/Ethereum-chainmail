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

type RpcResponse<T> = { id: number; result?: T; error?: { code?: number; message: string } };

export async function rpcBlockNumber(url: string): Promise<bigint> {
  const res = await call<RpcResponse<string>>(url, { jsonrpc: "2.0", id: nextId++, method: "eth_blockNumber", params: [] });
  if (!res.result) throw new Error(res.error?.message ?? "eth_blockNumber failed");
  return BigInt(res.result);
}

// Providers report rate limits inside a batch as per-item errors, with HTTP 200.
function isRateLimit(err: { code?: number; message: string } | undefined): boolean {
  return !!err && (err.code === 429 || /rate|capacity|too many|compute units per second/i.test(err.message));
}

// Fetches blocks with full transactions in one batch request. Items the
// provider rate-limited are retried with a growing pause.
export async function rpcBlocks(url: string, numbers: bigint[]): Promise<RpcBlock[]> {
  const out = new Map<bigint, RpcBlock>();
  let pending = numbers;
  for (let attempt = 0; pending.length > 0; attempt++) {
    const reqs = pending.map((n) => ({
      jsonrpc: "2.0",
      id: nextId++,
      method: "eth_getBlockByNumber",
      params: ["0x" + n.toString(16), true],
      n,
    }));
    const res = await call<RpcResponse<RpcBlock>[]>(url, reqs.map(({ n: _n, ...r }) => r));
    const byId = new Map(res.map((r) => [r.id, r]));
    const retry: bigint[] = [];
    for (const req of reqs) {
      const r = byId.get(req.id);
      if (r?.result) out.set(req.n, r.result);
      else if ((isRateLimit(r?.error) || !r) && attempt < 6) retry.push(req.n);
      else throw new Error(`Block ${req.n}: ${r?.error?.message ?? "missing"}`);
    }
    pending = retry;
    if (pending.length) await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
  }
  return numbers.map((n) => out.get(n)!);
}
