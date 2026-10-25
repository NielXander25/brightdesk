import { after } from "next/server";
import { sql, hotelByPhoneNumberId } from "@/lib/db";
import { markRead, sendText, verifyMetaSignature } from "@/lib/whatsapp";
import { runAgent } from "@/lib/agent";

export const runtime = "nodejs";
export const maxDuration = 60;

/** Meta calls this once to verify the webhook URL. */
export async function GET(req: Request) {
  const p = new URL(req.url).searchParams;
  if (p.get("hub.mode") === "subscribe" && p.get("hub.verify_token") === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new Response(p.get("hub.challenge") ?? "", { status: 200 });
  }
  return new Response("Forbidden", { status: 403 });
}

/** Incoming messages. Reply 200 fast, then do the work after the response so Meta doesn't retry. */
export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"))) {
    return new Response("Bad signature", { status: 401 });
  }
  const body = JSON.parse(raw);
  after(() => handle(body).catch((e) => console.error("WhatsApp handler error:", e)));
  return new Response("OK", { status: 200 });
}

type WaMessage = {
  id: string; from: string; type: string;
  text?: { body: string };
  interactive?: { button_reply?: { title: string }; list_reply?: { title: string } };
  button?: { text: string };
};

function textOf(m: WaMessage): string | null {
  if (m.type === "text") return m.text?.body ?? null;
  if (m.type === "interactive") return m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? null;
  if (m.type === "button") return m.button?.text ?? null;
  return null;
}

async function handle(body: any) {
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      const value = change?.value;
      if (!value?.messages?.length) continue; // status updates (sent, delivered, read) land here too
      const phoneNumberId: string = value.metadata?.phone_number_id;
      const hotel = await hotelByPhoneNumberId(phoneNumberId);
      if (!hotel) { console.warn("No hotel for phone_number_id", phoneNumberId); continue; }
      const profileName: string | undefined = value.contacts?.[0]?.profile?.name;

      for (const m of value.messages as WaMessage[]) {
        const text = textOf(m);
        await markRead(phoneNumberId, m.id);

        if (!text) {
          await sendText(phoneNumberId, m.from, "Thanks! I can only read text messages for now. Please type your question and I'll help right away.");
          continue;
        }

        // Save first. The unique wa_message_id makes Meta's retries a no-op.
        const saved = await sql()`insert into messages (hotel_id, wa_id, role, content, wa_message_id)
          values (${hotel.id}, ${m.from}, 'user', ${text}, ${m.id})
          on conflict (wa_message_id) do nothing returning id`;
        if (!saved.length) continue; // already handled

        let reply: string, followUps: string[] = [];
        try {
          ({ reply, followUps } = await runAgent(hotel, m.from, profileName));
        } catch (e) {
          console.error("Agent error:", e);
          reply = "Sorry, I'm having a little trouble right now. A staff member will reply to you shortly.";
        }

        for (const out of [reply, ...followUps]) {
          await sendText(phoneNumberId, m.from, out);
          await sql()`insert into messages (hotel_id, wa_id, role, content) values (${hotel.id}, ${m.from}, 'assistant', ${out})`;
        }
      }
    }
  }
}
