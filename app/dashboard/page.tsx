import { sql, type Booking, type Hotel } from "@/lib/db";
import { lagosToday, naira, niceDate } from "@/lib/dates";
import { resolveAlert } from "./actions";

export const dynamic = "force-dynamic";

type Alert = { id: string; wa_id: string; guest_name: string | null; reason: string; summary: string };
type Totals = { messages_today: number; bookings_today: number; paid_month: number; extras_month: number };

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ hotel?: string }> }) {
  const { hotel: hotelParam } = await searchParams;
  const hotels = (await sql()`select id::text, name, check_in_time from hotels order by created_at`) as Hotel[];
  const hotel = hotels.find((h) => h.id === hotelParam) ?? hotels[0];
  if (!hotel) return <main className="center"><p>No hotel yet. Run db/seed.sql first.</p></main>;
  const holdMins = Number(process.env.BOOKING_HOLD_MINUTES || 30);

  const [[totals], bookings, alerts] = await Promise.all([
    sql()`
      with lagos as (
        select date_trunc('day', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos' as day_start,
               date_trunc('month', now() at time zone 'Africa/Lagos') at time zone 'Africa/Lagos' as month_start
      )
      select
        (select count(*) from messages, lagos where hotel_id = ${hotel.id} and role = 'user' and created_at >= day_start)::int as messages_today,
        (select count(*) from bookings, lagos where hotel_id = ${hotel.id} and created_at >= day_start)::int as bookings_today,
        (select coalesce(sum(total), 0) from bookings, lagos where hotel_id = ${hotel.id} and status = 'paid' and paid_at >= month_start)::int as paid_month,
        (select coalesce(sum(extras_total), 0) from bookings, lagos where hotel_id = ${hotel.id} and status = 'paid' and paid_at >= month_start)::int as extras_month`,
    sql()`
      select b.id::text, b.ref, b.wa_id, b.guest_name, b.check_in::text, b.check_out::text, b.total, r.name as room_name,
        case when b.status = 'pending' and b.created_at < now() - make_interval(mins => ${holdMins}) then 'expired' else b.status end as status
      from bookings b join room_types r on r.id = b.room_type_id
      where b.hotel_id = ${hotel.id}
      order by b.created_at desc limit 50`,
    sql()`select id::text, wa_id, guest_name, reason, summary from staff_alerts
      where hotel_id = ${hotel.id} and not resolved order by created_at desc`,
  ]);

  const t = totals as Totals;
  const list = bookings as (Omit<Booking, "status"> & { status: "paid" | "pending" | "cancelled" | "expired" })[];
  const open = alerts as Alert[];
  const label = { paid: "Paid", pending: "Awaiting payment", cancelled: "Cancelled", expired: "Expired (unpaid)" } as const;

  return (
    <>
      <header className="top">
        <h1>{hotel.name}</h1>
        <p>Owner dashboard · {niceDate(lagosToday())}</p>
      </header>
      <main className="wrap">
        <div className="figures">
          <div className="fig"><b>{t.messages_today}</b><span>Guest messages today</span></div>
          <div className="fig"><b>{t.bookings_today}</b><span>Bookings started today</span></div>
          <div className="fig money"><b>{naira(t.paid_month)}</b><span>Paid this month</span></div>
          <div className="fig money"><b>{naira(t.extras_month)}</b><span>From extras this month</span></div>
        </div>

        <h2>Needs a staff member</h2>
        {open.length ? open.map((a) => (
          <div className="alert" key={a.id}>
            <div><strong>{a.reason}</strong> · {a.guest_name ?? "Guest"} (+{a.wa_id})<br />{a.summary}</div>
            <form action={resolveAlert}>
              <input type="hidden" name="id" value={a.id} />
              <button type="submit">Mark handled</button>
            </form>
          </div>
        )) : <p className="empty">Nothing waiting.</p>}

        <h2>Recent bookings</h2>
        <div className="table">
          {list.length ? (
            <table>
              <thead><tr><th>Ref</th><th>Guest</th><th>Phone</th><th>Room</th><th>Stay</th><th>Total</th><th>Status</th></tr></thead>
              <tbody>
                {list.map((b) => (
                  <tr key={b.id}>
                    <td>{b.ref}</td><td>{b.guest_name}</td><td>+{b.wa_id}</td><td>{b.room_name}</td>
                    <td>{niceDate(b.check_in)} → {niceDate(b.check_out)}</td>
                    <td>{naira(b.total)}</td>
                    <td><span className={`pill ${b.status}`}>{label[b.status]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : <p className="empty">No bookings yet.</p>}
        </div>
      </main>
    </>
  );
}
