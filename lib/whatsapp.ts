import crypto from "node:crypto";
import { env, optionalEnv } from "./env";

const graph = () => `https://graph.facebook.com/${env("GRAPH_API_VERSION", "v21.0")}`;

/** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
export function verifyMetaSignature(rawBody: string, header: string | null): boolean {
  if (!header?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", env("WHATSAPP_APP_SECRET")).update(rawBody).digest("hex");
  const given = header.slice(7);
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

async function post(phoneNumberId: string, payload: unknown) {
  const res = await fetch(`${graph()}/${phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env("WHATSAPP_TOKEN")}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`WhatsApp API ${res.status}: ${await res.text()}`);
  return res.json();
}

/** Free-form text. Only works within 24 hours of the guest's last message. */
export function sendText(phoneNumberId: string, to: string, body: string) {
  return post(phoneNumberId, {
    messaging_product: "whatsapp", recipient_type: "individual", to,
    type: "text", text: { body: body.slice(0, 4096), preview_url: true },
  });
}

export function markRead(phoneNumberId: string, messageId: string) {
  return post(phoneNumberId, { messaging_product: "whatsapp", status: "read", message_id: messageId }).catch(() => {});
}

/** Approved template message: the only way to message someone outside the 24-hour window. */
export function sendTemplate(phoneNumberId: string, to: string, name: string, lang: string, params: string[]) {
  return post(phoneNumberId, {
    messaging_product: "whatsapp", to, type: "template",
    template: {
      name, language: { code: lang },
      components: [{ type: "body", parameters: params.map((text) => ({ type: "text", text: text.replace(/\s+/g, " ").slice(0, 1000) })) }],
    },
  });
}

/** Sends the owner a one-line alert if a template is configured. Never throws. */
export async function notifyOwner(phoneNumberId: string, line: string) {
  const to = optionalEnv("OWNER_WHATSAPP");
  const template = optionalEnv("OWNER_ALERT_TEMPLATE");
  if (!to || !template) { console.log("[owner alert]", line); return; }
  try {
    await sendTemplate(phoneNumberId, to, template, optionalEnv("OWNER_ALERT_TEMPLATE_LANG") ?? "en", [line]);
  } catch (e) {
    console.error("Owner alert failed:", e);
  }
}
