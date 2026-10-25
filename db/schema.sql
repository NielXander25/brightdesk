-- Bright Desk schema. Run in the Neon SQL Editor (or: psql $DATABASE_URL -f db/schema.sql).
-- One row in `hotels` per client hotel, so the same app can serve many hotels.

create table if not exists hotels (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  address text not null,
  check_in_time text not null default '2:00 PM',
  check_out_time text not null default '12:00 noon',
  policies text not null default '',
  ref_prefix text not null default 'BH',
  wa_phone_number_id text unique,          -- WhatsApp phone number ID that receives this hotel's chats
  created_at timestamptz not null default now()
);

create table if not exists room_types (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id) on delete cascade,
  name text not null,
  description text not null default '',
  price_naira integer not null check (price_naira > 0),
  total_rooms integer not null check (total_rooms >= 0),
  active boolean not null default true
);

create table if not exists extras (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id) on delete cascade,
  name text not null,
  price_naira integer not null check (price_naira >= 0),
  unit text not null check (unit in ('trip', 'person_night', 'stay')),
  active boolean not null default true
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id) on delete cascade,
  ref text not null unique,
  wa_id text not null,
  guest_name text not null,
  guest_email text,
  room_type_id uuid not null references room_types(id),
  check_in date not null,
  check_out date not null,
  guests integer not null default 1,
  extras jsonb not null default '[]',
  room_total integer not null,
  extras_total integer not null default 0,
  total integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'cancelled')),
  payment_url text,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  check (check_out > check_in)
);
create index if not exists bookings_hotel_dates on bookings (hotel_id, check_in, check_out);

create table if not exists messages (
  id bigserial primary key,
  hotel_id uuid not null references hotels(id) on delete cascade,
  wa_id text not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  wa_message_id text unique,               -- stops duplicate processing when Meta retries
  created_at timestamptz not null default now()
);
create index if not exists messages_thread on messages (hotel_id, wa_id, created_at desc);

create table if not exists staff_alerts (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references hotels(id) on delete cascade,
  wa_id text not null,
  guest_name text,
  reason text not null,
  summary text not null,
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
