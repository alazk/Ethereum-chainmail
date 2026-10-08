import Link from "next/link";
import { notFound } from "next/navigation";
import { Empty, MessageItem } from "../../components";
import { cursorOf, getAddressMessages, getLabel, PAGE_SIZE } from "@/lib/queries";
import { isAddress } from "@/lib/format";
import { ensureSetup } from "@/lib/setup";

export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ addr: string }>;
  searchParams: Promise<{ before?: string }>;
};

export default async function AddressPage({ params, searchParams }: Props) {
  const { addr } = await params;
  const { before } = await searchParams;
  if (!isAddress(addr)) notFound();

  const address = addr.toLowerCase();
  await ensureSetup();
  const [label, messages] = await Promise.all([getLabel(address), getAddressMessages(address, before)]);
  const now = new Date();
  const last = messages[messages.length - 1];

  return (
    <main>
      <header className="view-head">
        <h1>{label ? label.name : "Messages from and to this address"}</h1>
        <p className="full-addr">{address}</p>
        <p>
          <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noreferrer">
            Open on Etherscan
          </a>
        </p>
      </header>

      {messages.length === 0 ? (
        <Empty>
          <p>{before ? "No older messages." : "This address hasn't sent or received any visible messages."}</p>
          <p>
            <Link href="/">Back to the feed</Link>
          </p>
        </Empty>
      ) : (
        <>
          {messages.map((m) => (
            <MessageItem key={m.tx_hash} m={m} now={now} />
          ))}
          {messages.length === PAGE_SIZE && last && (
            <p className="more">
              <Link href={`/address/${address}?before=${cursorOf(last)}`}>Older messages</Link>
            </p>
          )}
        </>
      )}
    </main>
  );
}
