import { formatEther } from "viem";

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function isAddress(s: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(s);
}

export function ethValue(wei: string): string | null {
  if (!wei || wei === "0") return null;
  const eth = Number(formatEther(BigInt(wei)));
  if (eth < 0.0001) return "< 0.0001 ETH";
  return `${eth.toLocaleString("en-US", { maximumFractionDigits: 4 })} ETH`;
}

export function timeAgo(date: Date, now = new Date()): string {
  const s = Math.max(0, Math.round((now.getTime() - new Date(date).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 60) return `${d} days ago`;
  return new Date(date).toISOString().slice(0, 10);
}

// The message as it sits onchain, for the faint line under each message.
export function asHex(body: string): string {
  return "0x" + Buffer.from(body, "utf8").toString("hex");
}

export function blockNumber(n: string): string {
  return Number(n).toLocaleString("en-US");
}
