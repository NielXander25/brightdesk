import crypto from "node:crypto";
import { env } from "./env";

/** Creates a Paystack checkout and returns the link the guest taps to pay. */
export async function createPaymentLink(opts: {
  reference: string; amountNaira: number; email: string; metadata: Record<string, unknown>;
}): Promise<string> {
  const res = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: { Authorization: `Bearer ${env("PAYSTACK_SECRET_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: opts.email,
      amount: Math.round(opts.amountNaira * 100), // kobo
      currency: "NGN",
      reference: opts.reference,
      callback_url: `${env("PUBLIC_BASE_URL")}/paid`,
      metadata: opts.metadata,
    }),
  });
  const json = await res.json();
  if (!res.ok || !json.status) throw new Error(`Paystack: ${json.message ?? res.status}`);
  return json.data.authorization_url as string;
}

/** Checks the x-paystack-signature header (HMAC SHA512 of the raw body with your secret key). */
export function verifyPaystackSignature(rawBody: string, header: string | null): boolean {
  if (!header) return false;
  const expected = crypto.createHmac("sha512", env("PAYSTACK_SECRET_KEY")).update(rawBody).digest("hex");
  return header.length === expected.length && crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
}
