import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, MessageItem, Toolbar } from "./components";
import { cursorOf, getFeed, getSyncedBlock, PAGE_SIZE } from "@/lib/queries";
import { ensureSetup } from "@/lib/setup";
import { blockNumber } from "@/lib/format";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ view?: string; before?: string }> };

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  if (params.view === "hacks") redirect("/hacks");

  let messages;
  let synced: string | null = null;
  try {
    await ensureSetup();
    [messages, synced] = await Promise.all([getFeed("all", params.before), getSyncedBlock()]);
  } catch (err) {
    console.error(err);
    return (
      <Empty>
        <p>The feed can't load right now.</p>
        <p>Check that the database is connected to the project (see the README).</p>
      </Empty>
    );
  }

  const now = new Date();
  const last = messages[messages.length - 1];

  return (
    <main>
      <Toolbar current="all" right={synced && <p className="sync">Up to block {blockNumber(synced)}</p>} />

      {messages.length === 0 ? (
        <Empty>
          <p>{params.before ? "No older messages." : "No messages yet. They appear here after the first ingest run."}</p>
        </Empty>
      ) : (
        <>
          {messages.map((m) => (
            <MessageItem key={m.tx_hash} m={m} now={now} />
          ))}
          {messages.length === PAGE_SIZE && last && (
            <p className="more">
              <Link href={`/?before=${cursorOf(last)}`}>Older messages</Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
