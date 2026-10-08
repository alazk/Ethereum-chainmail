import Link from "next/link";
import { addLabel, deleteLabel, login, logout, moderate } from "./actions";
import { hackFlags, incidentOptions, isAdmin, recentAdminLabels, teamSuggestions, FLAG_MIN_SENDERS, FLAG_WINDOW_HOURS } from "@/lib/admin";
import { ensureSetup, KINDS } from "@/lib/setup";
import { shortAddr } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin · Chainmail", robots: { index: false } };

type Props = { searchParams: Promise<{ notice?: string; address?: string; name?: string; kind?: string; incident?: string }> };

export default async function Admin({ searchParams }: Props) {
  const params = await searchParams;
  const notice = params.notice;

  if (!(await isAdmin())) {
    return (
      <main className="admin">
        <h1>Admin</h1>
        {!process.env.ADMIN_SECRET && <p className="notice">Set ADMIN_SECRET in the environment to use this page.</p>}
        {notice && <p className="notice">{notice}</p>}
        <form action={login} className="row">
          <label>
            Password (your ADMIN_SECRET)
            <input name="secret" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Sign in</button>
        </form>
      </main>
    );
  }

  await ensureSetup();
  const [incidents, suggestions, flags, recent] = await Promise.all([
    incidentOptions(),
    teamSuggestions(),
    hackFlags(),
    recentAdminLabels(),
  ]);

  return (
    <main className="admin">
      <h1>Admin</h1>
      {notice && <p className="notice">{notice}</p>}

      <section>
        <h2>Add or change a label</h2>
        <p className="hint">
          Exploiter and team labels put an address on a hack page. Saving an exploiter or team address also pulls its
          past messages.
        </p>
        <form action={addLabel} className="row">
          <label>
            Address
            <input name="address" className="wide" defaultValue={params.address} placeholder="0x…" required />
          </label>
          <label>
            Name
            <input name="name" defaultValue={params.name} placeholder="Euler Finance team" required />
          </label>
          <label>
            Kind
            <select name="kind" defaultValue={params.kind ?? "exploiter"}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label>
            Hack
            <select name="incident" defaultValue={params.incident ?? ""}>
              <option value="">None</option>
              {incidents.map((i) => (
                <option key={i.slug} value={i.slug}>
                  {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Or a new hack
            <input name="new_incident" placeholder="Name of a new hack" />
          </label>
          <button type="submit">Save label</button>
        </form>
      </section>

      <section>
        <h2>Possible new hacks</h2>
        <p className="hint">
          Unlabeled addresses that got messages from at least {FLAG_MIN_SENDERS} different senders in the last {FLAG_WINDOW_HOURS / 24} days
          and almost none before. A fresh exploit usually looks like this, but so does a famous wallet, so check before
          labeling.
        </p>
        {flags.length === 0 ? (
          <p className="hint">Nothing right now.</p>
        ) : (
          flags.map((f) => (
            <div key={f.address} className="card">
              <p>
                <Link href={`/address/${f.address}`} className="addr">
                  {f.address}
                </Link>
                : {f.senders} senders, {f.messages} messages
              </p>
              {f.samples.map((s, i) => (
                <p key={i} className="sample">
                  {s}
                </p>
              ))}
              <p>
                <Link href={`/admin?address=${f.address}&kind=exploiter`}>Label as exploiter</Link>
              </p>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>Suggested team addresses</h2>
        <p className="hint">
          Unlabeled addresses that wrote to a labeled exploiter and got a message back. Usually the protocol team or a
          negotiator; sometimes someone the exploiter answered. Read the sample before approving.
        </p>
        {suggestions.length === 0 ? (
          <p className="hint">No suggestions.</p>
        ) : (
          suggestions.map((s) => (
            <div key={`${s.address}-${s.incident}`} className="card">
              <p>
                <Link href={`/address/${s.address}`} className="addr">
                  {shortAddr(s.address)}
                </Link>{" "}
                wrote to the {s.incident_name} exploiter {s.wrote} {s.wrote === 1 ? "time" : "times"} and got{" "}
                {s.got} {s.got === 1 ? "reply" : "replies"}
              </p>
              {s.sample && <p className="sample">{s.sample}</p>}
              <form action={addLabel} className="row">
                <input type="hidden" name="address" value={s.address} />
                <input type="hidden" name="incident" value={s.incident} />
                <input type="hidden" name="kind" value="protocol" />
                <label>
                  Name
                  <input name="name" defaultValue={`${s.incident_name} team`} required />
                </label>
                <button type="submit">Approve as team</button>
              </form>
            </div>
          ))
        )}
      </section>

      <section>
        <h2>Hide or restore a message</h2>
        <form action={moderate} className="row">
          <label>
            Transaction hash
            <input name="tx_hash" className="wide" placeholder="0x…" required />
          </label>
          <label>
            Set to
            <select name="status" defaultValue="hidden">
              <option value="hidden">hidden</option>
              <option value="visible">visible</option>
              <option value="spam">spam</option>
            </select>
          </label>
          <button type="submit">Apply</button>
        </form>
      </section>

      <section>
        <h2>Labels you added</h2>
        {recent.length === 0 ? (
          <p className="hint">None yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Hack</th>
                <th>Address</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {recent.map((l) => (
                <tr key={l.address}>
                  <td>{l.name}</td>
                  <td>{l.kind}</td>
                  <td>{l.incident ? <Link href={`/hacks/${l.incident}`}>{l.incident}</Link> : ""}</td>
                  <td className="addr">{shortAddr(l.address)}</td>
                  <td>
                    <form action={deleteLabel}>
                      <input type="hidden" name="address" value={l.address} />
                      <button type="submit" className="quiet">
                        Remove
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <form action={logout}>
        <button type="submit" className="quiet">
          Sign out
        </button>
      </form>
    </main>
  );
}
