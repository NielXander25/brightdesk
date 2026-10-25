import { sql, hotelById, type Booking } from "@/lib/db";
import { verifyPaystackSignature } from "@/lib/paystack";
import { notifyOwner, sendText } from "@/lib/whatsapp";
import { naira, niceDate } from "@/lib/dates";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"))) {
    return new Response("Bad signature", { status: 401 });
  }
  const event = JSON.parse(raw);
  if (event.event !== "charge.success" || event.data?.status !== "success") return new Response("ignored");

  const ref = String(event.data.reference);
  const [booking] = (await sql()`
    select b.id::text, b.hotel_id::text, b.ref, b.wa_id, b.guest_name, b.check_in::text, b.check_out::text,
           b.total, b.status, r.name as room_name
    from bookings b join room_types r on r.id = b.room_type_id
    where b.ref = ${ref} limit 1`) as Booking[];
  if (!booking) return new Response("unknown ref");
  if (booking.status === "paid") return new Response("already paid");
  if (Number(event.data.amount) !== booking.total * 100) {
    console.error(`Amount mismatch on ${ref}: paid ${event.data.amount} kobo, expected ${booking.total * 100}`);
    return new Response("amount mismatch");
  }

  // Flip to paid exactly once, even if Paystack sends the event twice.
  const updated = await sql()`update bookings set status = 'paid', paid_at = now()
    where id = ${booking.id} and status <> 'paid' returning id`;
  if (!updated.length) return new Response("already paid");

  const hotel = await hotelById(booking.hotel_id);
  if (hotel?.wa_phone_number_id) {
    const first = booking.guest_name.split(" ")[0];
    const msg = `Payment received. Thank you, ${first}! ✅\n*${booking.room_name}* is confirmed for ${niceDate(booking.check_in)} to ${niceDate(booking.check_out)}.\nRef: *${booking.ref}*\nCheck-in is from ${hotel.check_in_time}. Please bring a valid ID. We look forward to hosting you.`;
    try {
      await sendText(hotel.wa_phone_number_id, booking.wa_id, msg);
      await sql()`insert into messages (hotel_id, wa_id, role, content) values (${hotel.id}, ${booking.wa_id}, 'assistant', ${msg})`;
    } catch (e) {
      console.error("Confirmation message failed:", e);
    }
    await notifyOwner(hotel.wa_phone_number_id, `${hotel.name}: new paid booking ${booking.ref}, ${booking.guest_name}, ${booking.room_name}, ${niceDate(booking.check_in)}, ${naira(booking.total)}`);
  }
  return new Response("ok");
}
