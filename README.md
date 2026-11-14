# daniel-booking
Mobile lead page for Daniel Quintanilla (Fred Haas Nissan, Tomball) linked from Facebook Marketplace listings.
Three buttons: Confirm Availability, Schedule a Test Drive (9 AM or later, Mon-Sat), Get Your Trade-In Value.
Every submission is texted to Daniel's cell (+18326202855) by `server.js` (`POST /api/lead`).

Prefill a car: `https://<host>/?car=2026+Pathfinder+SL&stock=TC230453P`

## SMS provider (env vars on Render; first configured wins; never put keys in this repo)
- Quo/OpenPhone: `QUO_API_KEY`, `QUO_FROM` (E.164 Quo number)
- Twilio: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`
- Textbelt: `TEXTBELT_KEY` (paid key; free key is blocked for US numbers)
Optional: `BACKUP_EMAIL` (FormSubmit email copy), `SITE_URL`, `NOTIFY_TO`, `PER_IP_PER_HOUR` (5), `GLOBAL_PER_HOUR` (40).
Spam: honeypot field, 2.5s minimum fill time, per-IP and global hourly rate limits. Leads are also logged in Render logs.

## Current status
Alerts: ntfy.sh push (env `NTFY_TOPIC`, private, set only on Render; optional `NTFY_TOKEN` access token so Render's shared IP doesn't hit ntfy's anonymous daily limit) + email to dannyinhouston@yahoo.com
(server-side FormSubmit via `BACKUP_EMAIL`; if the server email fails, the browser sends the same email once as a fallback).
SMS is off unless a provider key is set. `/healthz` shows the last delivery result (no secrets).
