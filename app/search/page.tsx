import Link from "next/link";
import { redirect } from "next/navigation";
import { Empty, MessageItem, Party, Toolbar } from "../components";
import { searchLabels, searchMessages } from "@/lib/queries";
import { ensureSetup } from "@/lib/setup";
import { isAddress } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search · Chainmail" };

type Props = { searchParams: Promise<{ q?: string }> };

export default async function Search({ searchParams }: Props) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 200);
  if (isAddress(q)) redirect(`/address/${q.toLowerCase()}`);
  if (/^0x[0-9a-fA-F]{64}$/.test(q)) redirect(`https://etherscan.io/tx/${q}`);

  await ensureSetup();
  const [labels, messages] = q.length >= 2 ? await Promise.all([searchLabels(q), searchMessages(q)]) : [[], []];
  const now = new Date();

  return (
    <main>
      <Toolbar current="search" />
      <header className="view-head">
        <h1>{q ? `Results for “${q}”` : "Search"}</h1>
        <p>Search the text of messages, the names of known addresses, or paste a full address.</p>
      </header>

      {q.length > 0 && q.length < 2 && (
        <Empty>
          <p>Type at least two characters.</p>
        </Empty>
      )}

      {labels.length > 0 && (
        <section className="search-labels">
          <h2 className="section-title">Known addresses</h2>
          <ul className="label-results">
            {labels.map((l) => (
              <li key={l.address}>
                <Party address={l.address} name={l.name} kind={l.kind} />
                {l.incident && (
                  <>
                    {" "}
                    <Link href={`/hacks/${l.incident}`}>hack page</Link>
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {q.length >= 2 && (
        <section>
          <h2 className="section-title">
            {messages.length === 0
              ? "No messages match"
              : `${messages.length === 40 ? "Latest 40" : messages.length} matching ${messages.length === 1 ? "message" : "messages"}`}
          </h2>
          {messages.map((m) => (
            <MessageItem key={m.tx_hash} m={m} now={now} />
          ))}
        </section>
      )}
    </main>
  );
}
