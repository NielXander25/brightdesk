import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";

let client: NeonQueryFunction<false, false> | null = null;

/** Neon HTTP client. Server only. Use as a tagged template: await sql()`select ...` */
export function sql() {
  if (!client) client = neon(env("DATABASE_URL"));
  return client;
}

export type Hotel = {
  id: string; name: string; city: string; address: string;
  check_in_time: string; check_out_time: string; policies: string;
  ref_prefix: string; wa_phone_number_id: string | null;
};
export type RoomType = {
  id: string; hotel_id: string; name: string; description: string;
  price_naira: number; total_rooms: number; active: boolean;
};
export type Extra = {
  id: string; hotel_id: string; name: string; price_naira: number;
  unit: "trip" | "person_night" | "stay"; active: boolean;
};
/** Dates and timestamps are cast to text in queries so they arrive as plain strings. */
export type Booking = {
  id: string; hotel_id: string; ref: string; wa_id: string; guest_name: string;
  guest_email: string | null; room_type_id: string; room_name?: string; check_in: string; check_out: string;
  guests: number; extras: { name: string; cost: number }[]; room_total: number;
  extras_total: number; total: number; status: "pending" | "paid" | "cancelled";
  payment_url: string | null; paid_at: string | null; created_at: string;
};

export async function hotelByPhoneNumberId(phoneNumberId: string): Promise<Hotel | null> {
  const rows = await sql()`select id::text, name, city, address, check_in_time, check_out_time, policies, ref_prefix, wa_phone_number_id
    from hotels where wa_phone_number_id = ${phoneNumberId} limit 1`;
  return (rows[0] as Hotel) ?? null;
}

export async function hotelById(id: string): Promise<Hotel | null> {
  const rows = await sql()`select id::text, name, city, address, check_in_time, check_out_time, policies, ref_prefix, wa_phone_number_id
    from hotels where id = ${id} limit 1`;
  return (rows[0] as Hotel) ?? null;
}
