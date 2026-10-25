import crypto from "node:crypto";
import { sql, type Booking, type Extra, type Hotel, type RoomType } from "./db";
import { addDays, isISODate, lagosToday } from "./dates";
import { createPaymentLink } from "./paystack";
import { env } from "./env";

const holdMinutes = () => Number(process.env.BOOKING_HOLD_MINUTES || 30);

export async function hotelCatalog(hotelId: string) {
  const [rooms, extras] = await Promise.all([
    sql()`select id::text, hotel_id::text, name, description, price_naira, total_rooms, active
      from room_types where hotel_id = ${hotelId} and active order by price_naira`,
    sql()`select id::text, hotel_id::text, name, price_naira, unit, active
      from extras where hotel_id = ${hotelId} and active order by price_naira`,
  ]);
  return { rooms: rooms as RoomType[], extras: extras as Extra[] };
}

function validateStay(checkIn: unknown, nights: unknown) {
  if (!isISODate(checkIn)) throw new Error("check_in must be a date in YYYY-MM-DD format");
  if (checkIn < lagosToday()) throw new Error("That check-in date has already passed");
  const n = Math.floor(Number(nights));
  if (!Number.isFinite(n) || n < 1 || n > 60) throw new Error("nights must be between 1 and 60");
  return { checkIn, nights: n, checkOut: addDays(checkIn, n) };
}

/** Rooms left per room type for a stay. Paid bookings and fresh unpaid holds both count. */
export async function availability(hotelId: string, checkIn: string, checkOut: string) {
  const rows = await sql()`
    select r.id::text, r.hotel_id::text, r.name, r.description, r.price_naira, r.total_rooms, r.active,
      greatest(0, r.total_rooms - count(b.id) filter (
        where b.status = 'paid'
           or (b.status = 'pending' and b.created_at > now() - make_interval(mins => ${holdMinutes()}))
      ))::int as rooms_left
    from room_types r
    left join bookings b
      on b.room_type_id = r.id and b.check_in < ${checkOut}::date and b.check_out > ${checkIn}::date
    where r.hotel_id = ${hotelId} and r.active
    group by r.id
    order by r.price_naira`;
  return (rows as (RoomType & { rooms_left: number })[]).map(({ rooms_left, ...room }) => ({ room, left: rooms_left }));
}

export async function checkAvailability(hotel: Hotel, input: { check_in?: unknown; nights?: unknown }) {
  const { checkIn, checkOut, nights } = validateStay(input.check_in, input.nights);
  const rows = await availability(hotel.id, checkIn, checkOut);
  return {
    check_in: checkIn, check_out: checkOut, nights,
    rooms: rows.map(({ room, left }) => ({
      type: room.name, price_per_night: room.price_naira, rooms_left: left, total_for_stay: room.price_naira * nights,
    })),
  };
}

function newRef(prefix: string) {
  return `${prefix}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function createBooking(hotel: Hotel, waId: string, input: {
  guest_name?: unknown; guest_email?: unknown; room_type?: unknown; check_in?: unknown;
  nights?: unknown; guests?: unknown; extras?: unknown;
}): Promise<Booking> {
  const { checkIn, checkOut, nights } = validateStay(input.check_in, input.nights);
  const guestName = String(input.guest_name ?? "").trim();
  if (guestName.length < 2) throw new Error("guest_name is required");
  const guests = Math.max(1, Math.min(10, Math.floor(Number(input.guests) || 1)));

  const { rooms, extras } = await hotelCatalog(hotel.id);
  const room = rooms.find((r) => r.name.toLowerCase() === String(input.room_type ?? "").toLowerCase());
  if (!room) throw new Error(`Unknown room type. Options: ${rooms.map((r) => r.name).join(", ")}`);

  const left = (await availability(hotel.id, checkIn, checkOut)).find((a) => a.room.id === room.id)?.left ?? 0;
  if (left < 1) throw new Error(`No ${room.name} is free for those dates`);

  const wanted = Array.isArray(input.extras) ? input.extras.map((e) => String(e).toLowerCase()) : [];
  const chosen = extras
    .filter((e) => wanted.includes(e.name.toLowerCase()))
    .map((e) => ({ name: e.name, cost: e.unit === "person_night" ? e.price_naira * guests * nights : e.price_naira }));
  const roomTotal = room.price_naira * nights;
  const extrasTotal = chosen.reduce((s, e) => s + e.cost, 0);
  const total = roomTotal + extrasTotal;

  const emailInput = String(input.guest_email ?? "").trim();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailInput);
  const email = validEmail ? emailInput : `${waId}@${env("GUEST_EMAIL_DOMAIN")}`;
  const ref = newRef(hotel.ref_prefix);

  const [row] = await sql()`
    insert into bookings (hotel_id, ref, wa_id, guest_name, guest_email, room_type_id, check_in, check_out,
                          guests, extras, room_total, extras_total, total)
    values (${hotel.id}, ${ref}, ${waId}, ${guestName}, ${validEmail ? emailInput : null}, ${room.id},
            ${checkIn}::date, ${checkOut}::date, ${guests}, ${JSON.stringify(chosen)}::jsonb, ${roomTotal}, ${extrasTotal}, ${total})
    returning id::text, hotel_id::text, ref, wa_id, guest_name, guest_email, room_type_id::text,
              check_in::text, check_out::text, guests, extras, room_total, extras_total, total, status,
              payment_url, paid_at::text, created_at::text`;
  const booking = { ...(row as Booking), room_name: room.name };

  try {
    const url = await createPaymentLink({
      reference: booking.ref, amountNaira: booking.total, email,
      metadata: { hotel_id: hotel.id, booking_id: booking.id, guest_name: guestName, room: room.name },
    });
    await sql()`update bookings set payment_url = ${url} where id = ${booking.id}`;
    return { ...booking, payment_url: url };
  } catch {
    // Free the room if we can't take payment, then let the assistant hand off to staff.
    await sql()`update bookings set status = 'cancelled' where id = ${booking.id}`;
    throw new Error("Payment link could not be created. Hand this booking to staff.");
  }
}
