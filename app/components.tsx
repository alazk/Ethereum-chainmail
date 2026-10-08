import Link from "next/link";
import type { FeedMessage, LabelKind } from "@/lib/queries";
import { asHex, blockNumber, ethValue, shortAddr, timeAgo } from "@/lib/format";

const KIND_TEXT: Record<LabelKind, string> = {
  exploiter: "exploiter",
  protocol: "protocol",
  exchange: "exchange",
  sanctioned: "sanctioned",
  other: "labeled",
};

export function Party({ address, name, kind }: { address: string; name: string | null; kind: LabelKind | null }) {
  return (
    <Link
      href={`/address/${address}`}
      className={kind ? `party party-${kind}` : "party"}
      title={kind ? `${address} (${KIND_TEXT[kind]})` : address}
    >
      {name ?? <span className="addr">{shortAddr(address)}</span>}
    </Link>
  );
}

export function EtherscanLink({ hash }: { hash: string }) {
  return (
    <a href={`https://etherscan.io/tx/${hash}`} target="_blank" rel="noreferrer">
      Etherscan
    </a>
  );
}

export function MessageItem({ m, now }: { m: FeedMessage; now: Date }) {
  const value = ethValue(m.value_wei);
  const [a, b] = m.pair_key.split(":");
  return (
    <article className="msg">
      <a className="msg-block" href={`https://etherscan.io/block/${m.block_number}`} target="_blank" rel="noreferrer">
        {blockNumber(m.block_number)}
      </a>
      <div className="msg-main">
        <p className="msg-head">
          <Party address={m.from_addr} name={m.from_name} kind={m.from_kind} /> wrote to{" "}
          <Party address={m.to_addr} name={m.to_name} kind={m.to_kind} />
          <time dateTime={new Date(m.block_time).toISOString()}>{timeAgo(m.block_time, now)}</time>
        </p>
        <p className="msg-body">{m.body}</p>
        <p className="msg-hex" aria-hidden="true" title="Raw transaction input">
          {asHex(m.body)}
        </p>
        <p className="msg-foot">
          {value && <span className="value">Sent {value}</span>}
          {m.thread_count > 1 && (
            <Link href={`/thread/${a}/${b}`}>Read the conversation ({m.thread_count})</Link>
          )}
          <EtherscanLink hash={m.tx_hash} />
        </p>
      </div>
    </article>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
