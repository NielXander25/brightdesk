-- Placeholder data for Bright Hotels. Run after schema.sql. Replace with real details before going live.
-- Set wa_phone_number_id to the Phone number ID shown in Meta > WhatsApp > API Setup.
with h as (
  insert into hotels (name, city, address, policies, ref_prefix, wa_phone_number_id)
  values (
    'Bright Hotels', 'Kaduna', 'Sample address, Kaduna (replace me)',
    '24-hour power and security, free parking, pool open 7 AM to 7 PM, restaurant and bar on site. Valid ID required at check-in. Bookings are confirmed once paid.',
    'BH', 'REPLACE_WITH_PHONE_NUMBER_ID'
  ) returning id
), r as (
  insert into room_types (hotel_id, name, description, price_naira, total_rooms)
  select id, x.name, x.descr, x.price, x.cnt from h, (values
    ('Standard Room', 'Queen bed, AC, Wi-Fi, smart TV', 45000, 6),
    ('Deluxe Room', 'King bed, work desk, city view', 65000, 3),
    ('Executive Suite', 'Separate lounge, bathtub, complimentary breakfast', 110000, 1)
  ) as x(name, descr, price, cnt)
)
insert into extras (hotel_id, name, price_naira, unit)
select id, x.name, x.price, x.unit from h, (values
  ('Airport pickup', 25000, 'trip'),
  ('Breakfast', 8000, 'person_night'),
  ('Late checkout (4 PM)', 10000, 'stay'),
  ('Birthday room decoration', 30000, 'stay')
) as x(name, price, unit);
