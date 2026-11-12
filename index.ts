// DECKTRACK: texts borrowers when equipment they borrowed has reached its due date.
//
// - Finds borrows that are not returned, due today or earlier, and not texted yet.
// - Sends ONE text per borrower (listing all their due items) through Semaphore.
// - Marks those borrows as texted (due_sms_sent_at) so nobody is texted twice.
// - Borrowers with no mobile number are skipped and counted, not marked.
//
// Secrets (Supabase > Edge Functions > Secrets, or `supabase secrets set`):
//   SEMAPHORE_API_KEY   your Semaphore API key
//   SEMAPHORE_SENDER    (optional) your approved sender name, e.g. DECKTRACK
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided automatically.
//
// Deploy:  supabase functions deploy send-due-sms --no-verify-jwt

import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

// Today's date in the Philippines (YYYY-MM-DD), whatever time zone the server uses.
const manilaToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Manila" }).format(new Date());

const prettyDate = (iso: string) =>
  new Date(iso + "T00:00:00").toLocaleDateString("en-PH", {
    month: "short", day: "numeric", year: "numeric",
  });

// 09XXXXXXXXX, 9XXXXXXXXX, 639XXXXXXXXX or +639XXXXXXXXX  ->  09XXXXXXXXX (or null)
function normalizePhone(value: string | null): string | null {
  let d = String(value ?? "").replace(/\D/g, "");
  if (d.startsWith("63") && d.length === 12) d = "0" + d.slice(2);
  if (d.length === 10 && d.startsWith("9")) d = "0" + d;
  return /^09\d{9}$/.test(d) ? d : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const apiKey = Deno.env.get("SEMAPHORE_API_KEY");
  if (!apiKey) return json({ error: "SEMAPHORE_API_KEY is not set" }, 500);
  const sender = Deno.env.get("SEMAPHORE_SENDER");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const today = manilaToday();

  const { data: rows, error } = await supabase
    .from("borrows")
    .select("id, quantity, due_date, student_id, students(name, phone), items(name)")
    .is("returned_at", null)
    .is("due_sms_sent_at", null)
    .lte("due_date", today);

  if (error) return json({ error: error.message }, 500);

  // group the due items by borrower
  const byStudent = new Map<string, any[]>();
  for (const r of rows ?? []) {
    const list = byStudent.get(r.student_id) ?? [];
    list.push(r);
    byStudent.set(r.student_id, list);
  }

  let sent = 0, noPhone = 0, failed = 0;

  for (const [, list] of byStudent) {
    const student = list[0].students;
    const phone = normalizePhone(student?.phone);
    if (!phone) { noPhone++; continue; }

    const first = String(student?.name ?? "Student").split(" ")[0];
    const items = list
      .map((r) => `${r.items?.name ?? "equipment"}${r.quantity > 1 ? " x" + r.quantity : ""}`)
      .join(", ");
    const late = list.some((r) => r.due_date < today);
    const message =
      `DECKTRACK: Hi ${first}, ` +
      (late ? "your borrowed equipment is past its due date: " : "your borrowed equipment is due today: ") +
      `${items} (due ${prettyDate(list[0].due_date)}). ` +
      `Please return it to the Computer Engineering Laboratory. Thank you.`;

    const form = new URLSearchParams({ apikey: apiKey, number: phone, message });
    if (sender) form.set("sendername", sender);

    try {
      const res = await fetch("https://api.semaphore.co/api/v4/messages", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
      });
      const body = await res.json().catch(() => null);
      const accepted = res.ok && Array.isArray(body) && body.length > 0 &&
        !String(body[0]?.status ?? "").toLowerCase().includes("fail");

      if (!accepted) {
        console.error("Semaphore rejected the text", res.status, JSON.stringify(body));
        failed++;
        continue;
      }

      // remember it, so this borrowing is never texted again
      await supabase
        .from("borrows")
        .update({ due_sms_sent_at: new Date().toISOString() })
        .in("id", list.map((r) => r.id));
      sent++;
    } catch (err) {
      console.error("Could not reach Semaphore", err);
      failed++;
    }
  }

  return json({ sent, no_phone: noPhone, failed, checked: rows?.length ?? 0 });
});