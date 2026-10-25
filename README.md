# Bright Desk — AI WhatsApp booking desk (KMLABS)

Guests chat with the hotel on WhatsApp. An AI answers questions, checks real availability,
creates bookings and sends a Paystack payment link. When Paystack confirms payment, the guest
gets a WhatsApp confirmation and the booking shows as Paid on the owner dashboard.

## How it fits together
- `app/api/whatsapp` receives messages from Meta, runs the AI (`lib/agent.ts`), replies.
- `lib/db.ts` Neon Postgres client (serverless HTTP driver, works well on Vercel).
- `lib/bookings.ts` availability and booking logic (unpaid bookings hold a room for 30 min).
- `app/api/paystack/webhook` marks bookings paid and sends the confirmation.
- `app/dashboard` owner view, protected by DASHBOARD_USER / DASHBOARD_PASSWORD.
- One `hotels` row per client, matched by WhatsApp phone number ID, so one deployment can serve many hotels.

## Setup (about an hour)

### 1. Neon
1. Create a project at console.neon.tech (pick the AWS Europe region closest to Nigeria, e.g. Frankfurt).
2. In the SQL Editor run `db/schema.sql`, then `db/seed.sql`.
3. Connect → copy the **pooled** connection string into `DATABASE_URL` in `.env.local`.
   Tip: create a `dev` branch in Neon for testing so you never touch real bookings.

### 2. Meta WhatsApp Cloud API (test number, no business verification needed yet)
1. developers.facebook.com → Create app → type **Business** → add the **WhatsApp** product.
2. In WhatsApp → API Setup you get a free **test number**. Add up to 5 phone numbers as recipients.
3. Copy the **Phone number ID** into the hotel row:
   `update hotels set wa_phone_number_id = 'YOUR_ID' where name = 'Bright Hotels';`
4. Copy the temporary access token into `WHATSAPP_TOKEN` (expires in 24h; create a System User
   permanent token in Business Settings before going live).
5. App settings → Basic → **App secret** → `WHATSAPP_APP_SECRET`.

### 3. Paystack
1. Use test keys first: `PAYSTACK_SECRET_KEY=sk_test_...`.
2. Settings → API Keys & Webhooks → Webhook URL: `https://YOUR-APP.vercel.app/api/paystack/webhook`.

### 4. Claude API
Create a key at console.anthropic.com → `ANTHROPIC_API_KEY`.

### 5. Deploy on Vercel
1. Push to GitHub, import into Vercel, add every variable from `.env.example`.
2. Set `PUBLIC_BASE_URL` to the Vercel URL.
3. Back in Meta → WhatsApp → Configuration → Webhook:
   Callback URL `https://YOUR-APP.vercel.app/api/whatsapp`, Verify token = `WHATSAPP_VERIFY_TOKEN`.
   Subscribe to the **messages** field.
4. Message the test number from a recipient phone. Done.

Local testing: `npm install && npm run dev`, then expose with `ngrok http 3000` and use that URL in Meta.

## Going live for a paying hotel
- Verify the hotel's Meta Business account and add their real number (it can't be on the normal
  WhatsApp app at the same time).
- Replace placeholder rooms, prices, extras and policies in Neon.
- Switch Paystack to live keys (the hotel's own Paystack account, so money goes straight to them).
- **24-hour rule:** you can reply freely within 24h of a guest's last message. Messaging anyone outside
  that window (including owner alerts) needs a Meta-approved template. Create a Utility template
  named `owner_alert` with body `New update: {{1}}` and set OWNER_WHATSAPP to get alerts on the owner's phone.
- Data: guest chats and phone numbers are personal data under Nigeria's Data Protection Act. Keep
  DATABASE_URL server-side, tell guests they're chatting with an automated assistant, and agree
  data handling with the hotel in your contract.

## Known limits of v1
- Text messages only (voice notes and images get a polite "please type" reply).
- Availability counts overlapping bookings, which is slightly conservative for long stays.
- Two very fast messages from one guest can produce two replies.
