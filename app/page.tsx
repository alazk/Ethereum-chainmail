import Link from "next/link";
import { Empty, MessageItem } from "./components";
import { cursorOf, getFeed, getSyncedBlock, PAGE_SIZE, type Filter } from "@/lib/queries";
import { blockNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ view?: string; before?: string }> };

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const filter: Filter = params.view === "hacks" ? "hacks" : "all";
  const base = filter === "hacks" ? "/?view=hacks" : "/";

  let messages;
  let synced: string | null = null;
  try {
    [messages, synced] = await Promise.all([getFeed(filter, params.before), getSyncedBlock()]);
  } catch (err) {
    console.error(err);
    return (
      <Empty>
        <p>The feed can't load right now.</p>
        <p>
          On a new deployment, the first ingest run creates the database tables. If that already ran, check
          that the database is connected to the project (see the README).
        </p>
      </Empty>
    );
  }

  const now = new Date();
  const last = messages[messages.length - 1];
  const olderHref = last
    ? `${base}${base.includes("?") ? "&" : "?"}before=${cursorOf(last)}`
    : null;

  return (
    <main>
      <nav className="toolbar" aria-label="Feed filters">
        <ul className="filters">
          <li>
            <Link href="/" aria-current={filter === "all" ? "page" : undefined}>
              Everything
            </Link>
          </li>
          <li>
            <Link href="/?view=hacks" aria-current={filter === "hacks" ? "page" : undefined}>
              Hacks and negotiations
            </Link>
          </li>
        </ul>
        {synced && <p className="sync">Up to block {blockNumber(synced)}</p>}
      </nav>

      {messages.length === 0 ? (
        <Empty>
          {params.before ? (
            <p>No older messages.</p>
          ) : filter === "hacks" ? (
            <p>
              No messages involving known exploiters yet. Add exploiter addresses to the labels table and they
              show up here.
            </p>
          ) : (
            <p>No messages yet. They appear here after the first ingest run.</p>
          )}
        </Empty>
      ) : (
        <>
          {messages.map((m) => (
            <MessageItem key={m.tx_hash} m={m} now={now} />
          ))}
          {messages.length === PAGE_SIZE && olderHref && (
            <p className="more">
              <Link href={olderHref}>Older messages</Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
