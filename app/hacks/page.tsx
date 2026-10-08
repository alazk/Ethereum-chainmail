import Link from "next/link";
import { Empty, Toolbar } from "../components";
import { listIncidents } from "@/lib/incidents";
import { ensureSetup } from "@/lib/setup";

export const dynamic = "force-dynamic";

export const metadata = { title: "Hacks · Chainmail" };

function when(d: Date | null): string {
  return d ? new Date(d).toISOString().slice(0, 10) : "";
}

export default async function Hacks() {
  await ensureSetup();
  const incidents = await listIncidents();
  const withMessages = incidents.filter((i) => i.core + i.crowd > 0);
  const quiet = incidents.filter((i) => i.core + i.crowd === 0);

  return (
    <main>
      <Toolbar current="hacks" />
      <header className="view-head">
        <h1>Hacks</h1>
        <p>What exploiters and the teams they robbed wrote to each other onchain, and what everyone else told them.</p>
      </header>

      {withMessages.length === 0 ? (
        <Empty>
          <p>No messages tied to a known hack yet.</p>
        </Empty>
      ) : (
        <ol className="incidents">
          {withMessages.map((i) => (
            <li key={i.slug} className="incident-row">
              <Link href={`/hacks/${i.slug}`} className="incident-name">
                {i.name}
              </Link>
              <p className="incident-meta">
                {i.core > 0 ? (
                  <span>
                    {i.core} {i.core === 1 ? "message" : "messages"} from the {i.team > 0 ? "exploiter and team" : "exploiter"}
                  </span>
                ) : (
                  <span>The exploiter never wrote back</span>
                )}
                <span>
                  {i.crowd} from others
                </span>
                <span>
                  {when(i.first_at)}
                  {i.last_at && when(i.last_at) !== when(i.first_at) ? ` to ${when(i.last_at)}` : ""}
                </span>
              </p>
            </li>
          ))}
        </ol>
      )}

      {quiet.length > 0 && (
        <p className="quiet-incidents">
          No messages yet for {quiet.map((i) => i.name).join(", ")}.
        </p>
      )}
    </main>
  );
}
