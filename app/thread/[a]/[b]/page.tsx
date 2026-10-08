import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, EtherscanLink, Party, Translation } from "../../../components";
import { ensureSetup } from "@/lib/setup";
import { getThread } from "@/lib/queries";
import { ethValue, isAddress } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ a: string; b: string }> };

export default async function Thread({ params }: Props) {
  const { a, b } = await params;
  if (!isAddress(a) || !isAddress(b)) notFound();

  await ensureSetup();
  const messages = await getThread(a, b);
  if (messages.length === 0) {
    return (
      <Empty>
        <p>These two addresses haven't exchanged any visible messages.</p>
        <p>
          <Link href="/">Back to the feed</Link>
        </p>
      </Empty>
    );
  }

  // Whoever spoke first sits on the left.
  const first = messages[0];
  const left = first.from_addr;
  const leftParty = { address: first.from_addr, name: first.from_name, kind: first.from_kind };
  const rightParty = { address: first.to_addr, name: first.to_name, kind: first.to_kind };
  const days =
    (new Date(messages[messages.length - 1].block_time).getTime() - new Date(first.block_time).getTime()) /
    86_400_000;

  return (
    <main>
      <header className="view-head">
        <h1>
          <Party {...leftParty} /> and <Party {...rightParty} />
        </h1>
        <p>
          {messages.length} {messages.length === 1 ? "message" : "messages"}
          {days >= 1 ? ` over ${Math.round(days)} ${Math.round(days) === 1 ? "day" : "days"}` : ""}
        </p>
      </header>

      <ol className="thread" style={{ listStyle: "none", margin: 0 }}>
        {messages.map((m) => {
          const side = m.from_addr === left ? "turn-left" : "turn-right";
          const value = ethValue(m.value_wei);
          const when = new Date(m.block_time);
          return (
            <li key={m.tx_hash} className={`turn ${side}`}>
              <p className="turn-meta">
                <Party address={m.from_addr} name={m.from_name} kind={m.from_kind} />{" "}
                <time dateTime={when.toISOString()}>
                  {when.toISOString().slice(0, 16).replace("T", " ")} UTC
                </time>
              </p>
              <div className="turn-bubble">
                <p className="msg-body">{m.body}</p>
                <Translation m={m} />
                <p className="msg-foot">
                  {value && <span className="value">Sent {value}</span>}
                  <EtherscanLink hash={m.tx_hash} />
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
