import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, EtherscanLink, MessageItem, Party, Toolbar, Translation } from "../../components";
import { getCrowd, getIncident } from "@/lib/incidents";
import { ensureSetup } from "@/lib/setup";
import { ethValue, shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ crowd?: string }>;
};

const CROWD_PAGE = 50;

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  await ensureSetup();
  const data = await getIncident(slug);
  return { title: data ? `${data.incident.name} hack · Chainmail` : "Chainmail" };
}

export default async function Incident({ params, searchParams }: Props) {
  const { slug } = await params;
  const { crowd } = await searchParams;
  await ensureSetup();
  const data = await getIncident(slug);
  if (!data) notFound();

  const { incident, parties, core, crowdCount } = data;
  const exploiters = new Set(parties.filter((p) => p.kind === "exploiter").map((p) => p.address));
  const crowdOffset = Math.max(Number(crowd) || 0, 0);
  const crowdOpen = crowd !== undefined;
  const crowdMessages = crowdOpen ? await getCrowd(slug, crowdOffset, CROWD_PAGE) : [];
  const now = new Date();

  return (
    <main>
      <Toolbar current="hacks" />
      <header className="view-head">
        <h1>{incident.name}</h1>
        <p className="incident-parties">
          {parties.map((p) => (
            <Party key={p.address} address={p.address} name={p.name} kind={p.kind} />
          ))}
        </p>
      </header>

      <section aria-labelledby="story">
        <h2 id="story" className="section-title">
          What the {parties.some((p) => p.kind !== "exploiter") ? "exploiter and team" : "exploiter"} wrote
        </h2>
        {core.length === 0 ? (
          <Empty>
            <p>The exploiter hasn't written anything onchain.</p>
            {!parties.some((p) => p.kind !== "exploiter") && (
              <p>The team's own addresses aren't labeled yet, so their messages aren't pinned here.</p>
            )}
          </Empty>
        ) : (
          <ol className="thread story">
            {core.map((m) => {
              const side = exploiters.has(m.from_addr) ? "turn-left" : "turn-right";
              const when = new Date(m.block_time);
              const value = ethValue(m.value_wei);
              const [a, b] = m.pair_key.split(":");
              return (
                <li key={m.tx_hash} className={`turn ${side}`}>
                  <p className="turn-meta">
                    <Party address={m.from_addr} name={m.from_name} kind={m.from_kind} /> to{" "}
                    {m.to_addr === m.from_addr ? (
                      "itself"
                    ) : (
                      <Party address={m.to_addr} name={m.to_name} kind={m.to_kind} />
                    )}
                    <time dateTime={when.toISOString()}>{when.toISOString().slice(0, 16).replace("T", " ")} UTC</time>
                  </p>
                  <div className="turn-bubble">
                    <p className="msg-body">{m.body}</p>
                    <Translation m={m} />
                    <p className="msg-foot">
                      {value && <span className="value">Sent {value}</span>}
                      <Link href={`/thread/${a}/${b}`}>Conversation</Link>
                      <EtherscanLink hash={m.tx_hash} />
                    </p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      <section aria-labelledby="crowd" className="crowd">
        <h2 id="crowd" className="section-title">
          {crowdCount === 0
            ? "Nobody else wrote to the exploiter"
            : `${crowdCount.toLocaleString("en-US")} ${crowdCount === 1 ? "message" : "messages"} from everyone else`}
        </h2>
        {crowdCount > 0 && !crowdOpen && (
          <p className="more-inline">
            <Link href={`/hacks/${slug}?crowd=0#crowd`}>Read them</Link>
          </p>
        )}
        {crowdOpen && (
          <>
            {crowdMessages.map((m) => (
              <MessageItem key={m.tx_hash} m={m} now={now} />
            ))}
            <p className="more">
              {crowdOffset > 0 && (
                <Link href={`/hacks/${slug}?crowd=${Math.max(crowdOffset - CROWD_PAGE, 0)}#crowd`}>Newer</Link>
              )}
              {crowdOffset + CROWD_PAGE < crowdCount && (
                <Link href={`/hacks/${slug}?crowd=${crowdOffset + CROWD_PAGE}#crowd`}>Older</Link>
              )}
              <Link href={`/hacks/${slug}`}>Hide</Link>
            </p>
          </>
        )}
      </section>

      <p className="incident-addresses">
        Addresses in this incident:{" "}
        {parties.map((p, i) => (
          <span key={p.address}>
            {i > 0 && ", "}
            <a href={`https://etherscan.io/address/${p.address}`} target="_blank" rel="noreferrer" className="addr">
              {shortAddr(p.address)}
            </a>
          </span>
        ))}
      </p>
    </main>
  );
}
