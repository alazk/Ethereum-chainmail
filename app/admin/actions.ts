"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  ADMIN_COOKIE,
  checkSecret,
  isAdmin,
  removeLabel,
  saveLabel,
  sessionToken,
  setMessageStatus,
  upsertIncident,
} from "@/lib/admin";
import { backfillAddress } from "@/lib/backfill";
import { KINDS } from "@/lib/setup";

function back(notice: string): never {
  revalidatePath("/", "layout");
  redirect(`/admin?notice=${encodeURIComponent(notice)}`);
}

async function requireAdmin() {
  if (!(await isAdmin())) redirect("/admin");
}

function field(form: FormData, name: string): string {
  return String(form.get(name) ?? "").trim();
}

export async function login(form: FormData) {
  if (!checkSecret(field(form, "secret"))) redirect("/admin?notice=" + encodeURIComponent("Wrong password."));
  (await cookies()).set(ADMIN_COOKIE, sessionToken(process.env.ADMIN_SECRET!), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect("/admin");
}

export async function logout() {
  (await cookies()).delete(ADMIN_COOKIE);
  redirect("/admin");
}

// Add or update a label. For exploiters, also pulls the address's full
// history right away so its messages show up without waiting for a backfill.
export async function addLabel(form: FormData) {
  await requireAdmin();
  const address = field(form, "address").toLowerCase();
  const name = field(form, "name");
  const kind = field(form, "kind");
  let incident: string | null = field(form, "incident") || null;
  const newIncident = field(form, "new_incident");

  if (!/^0x[0-9a-f]{40}$/.test(address)) back("That isn't a full 0x address.");
  if (!name) back("Give the address a name.");
  if (!(KINDS as readonly string[]).includes(kind)) back("Pick a kind.");
  if (newIncident) incident = await upsertIncident(newIncident);

  await saveLabel({ address, name, kind, incident });

  let extra = "";
  if (kind === "exploiter" || kind === "protocol") {
    try {
      const r = await backfillAddress(address);
      extra = ` Pulled ${r.transactions} past transactions, ${r.inserted} new messages.`;
    } catch (err) {
      extra = ` Couldn't pull its history yet (${(err as Error).message}); the next label backfill will.`;
    }
  }
  back(`Saved ${name}.${extra}`);
}

export async function deleteLabel(form: FormData) {
  await requireAdmin();
  const address = field(form, "address");
  await removeLabel(address);
  back(`Removed the label for ${address.slice(0, 10)}…`);
}

export async function moderate(form: FormData) {
  await requireAdmin();
  const tx = field(form, "tx_hash").toLowerCase();
  const status = field(form, "status") as "visible" | "hidden" | "spam";
  if (!/^0x[0-9a-f]{64}$/.test(tx)) back("That isn't a transaction hash.");
  if (!["visible", "hidden", "spam"].includes(status)) back("Pick a status.");
  const found = await setMessageStatus(tx, status);
  back(found ? `Message set to ${status}.` : "No message with that transaction hash.");
}
