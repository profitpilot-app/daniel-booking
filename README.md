# daniel-booking
Mobile lead page for Daniel Quintanilla (Fred Haas Nissan, Tomball) linked from Facebook Marketplace listings.
Three buttons: Confirm Availability, Schedule a Test Drive (9 AM or later, Mon-Sat), Get Your Trade-In Value.
Every submission is texted to Daniel's cell (+18326202855) by `server.js` (`POST /api/lead`).

Prefill a car: `https://<host>/?car=2026+Pathfinder+SL&stock=TC230453P`

## SMS provider (env vars on Render; first configured wins; never put keys in this repo)
- Quo/OpenPhone: `QUO_API_KEY`, `QUO_FROM` (E.164 Quo number)
- Twilio: `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM`
- Textbelt: `TEXTBELT_KEY` (defaults to `textbelt` = 1 free text/day)
Optional: `BACKUP_EMAIL` (FormSubmit email copy), `SITE_URL`, `NOTIFY_TO`, `PER_IP_PER_HOUR` (5), `GLOBAL_PER_HOUR` (40).
Spam: honeypot field, 2.5s minimum fill time, per-IP and global hourly rate limits. Leads are also logged in Render logs.

## Current status
Textbelt's free key is disabled for US numbers, so no SMS goes out until a provider key is set.
Until then, if the server can't text, the browser falls back to emailing the lead to dannyinhouston@yahoo.com via FormSubmit
(same path as drive-with-daniel). `/healthz` shows the provider and the last delivery result (no secrets).
