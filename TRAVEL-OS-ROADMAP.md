# Travel OS Roadmap

Last updated: 2026-10-05

This file is the persistent source of truth for product scope and implementation order. Update it whenever a feature is completed, changed, or newly agreed.

## Product goal

Build a PWA Travel OS that is good enough to use as the primary travel interface instead of the original spreadsheet. Core priorities are fast mobile use, reliable offline access, private booking data, multi-trip collaboration, and safe import/update workflows.

## Current implementation status

### Completed

- [x] GitHub Pages web app with mobile-first layout.
- [x] PWA manifest + service worker cache.
- [x] Today page with hero, date/day switching, timeline, weather summary, stay card.
- [x] Hero collapse behavior and v0.17 visual parity fixes.
- [x] Map page with per-day route, route animation/playback, markers, route range selection, mileage/drive summary.
- [x] Google Maps-style navigation links from itinerary items.
- [x] Booking Center with private reservation data, reveal controls, detail panels.
- [x] Supabase project and core schema.
- [x] Supabase Auth Magic Link flow.
- [x] Trusted Device model.
- [x] 30-minute idle window and automatic session resume when returning to the tab.
- [x] Duplicate Magic Link submission bug fixed; rate-limit message improved.
- [x] Owner / Editor / Viewer role model at trip membership level.
- [x] Trip member + device administration UI/backend.
- [x] Private reservation access through authenticated Edge Functions.
- [x] IndexedDB local/offline store.
- [x] Synced private bookings persisted offline.
- [x] Weather integration and forecast-range handling.
- [x] Third trusted device enrollment verified in production.

### Partial / needs consolidation

- [~] Database is not yet the single source of truth.
  - Current UI itinerary/day data still primarily comes from data.js.
  - Supabase currently has Iceland D0-D5 / 30 itinerary items, while the current UI seed has D0-D7 and newer distance/time values.
  - Reservations are already loaded from Supabase.
- [~] Offline mode exists for app shell/local data, but the full agreed offline package still needs completion: documents/vouchers/QR, essential private trip data, and explicit offline UX.
- [~] Multi-trip backend model exists (trips + trip_members), but frontend still behaves as Iceland-only.
- [~] Role model exists, but itinerary/reservation write APIs and edit UI do not yet exist.
- [~] Expense table exists, but Money UI, splits, receipts, FX, and settlement are not implemented.
- [~] Change-log/sync tables exist, but full user-facing history/version workflow is not implemented.

## Agreed new architecture

### Multi-trip

Use one Travel OS app, not separate apps.

Routes:

- /travel-os/
- /travel-os/iceland-2026
- /travel-os/kumamoto-2027

Supabase Auth answers: who is this user?

trip_members answers: which trips may this user access, and what may they do in each trip?

Roles are trip-scoped, not global.

Example:

| User | Iceland 2026 | Kumamoto 2027 |
| --- | --- | --- |
| Owner | Owner | Owner |
| A | Editor | Editor |
| B | Editor | No access |
| C | No access | Editor |
| D | No access | Viewer |

A user must not even receive private data for a trip where no active trip_members row exists. Direct URL access must be checked server-side, not only hidden in the UI.

### Trip switcher/login UX

- /travel-os/ after login shows only trips the current user is authorized to access.
- /travel-os/:tripSlug logs into that specific trip.
- Hero trip title becomes a trip switcher.
- Trip switcher lists only authorized trips.
- Owner can create a new trip.
- Trusted Devices remain trip-scoped.

### Database source of truth

Supabase becomes authoritative for:

- trips
- trip_members
- trip_days
- itinerary_items
- reservations
- future expenses / documents / imports / changes

data.js becomes demo/emergency fallback only.

## Next implementation block: v0.18

Do this before Excel/email import.

### 1. Consolidate Iceland data into Supabase

- [ ] Reconcile current UI D0-D7 against Supabase D0-D5.
- [ ] Copy current correct day names, distances, drive times, events, notes, coordinates into Supabase.
- [ ] Verify all 8 reservations and sensitive fields.
- [ ] Make travel-data return trip + days + itinerary + reservations.
- [ ] Change frontend rendering to use cloud/local normalized data instead of data.js.
- [ ] Keep data.js only as demo/emergency fallback.
- [ ] Verify offline reopen still works after cloud hydration.

### 2. Multi-trip shell

- [ ] Add /travel-os/ "My Trips" screen.
- [ ] Add trip slug routing.
- [ ] Add server-side authorized-trip listing endpoint.
- [ ] Add Hero trip switcher.
- [ ] Prevent unauthorized trip discovery/data access.
- [ ] Add New Trip flow for Owner.

### 3. Manual itinerary editor

Editor and Owner can edit; Viewer cannot.

- [ ] Enter/exit Edit Mode.
- [ ] Add itinerary item.
- [ ] Edit itinerary item.
- [ ] Delete/soft-delete itinerary item.
- [ ] Reorder items.
- [ ] Edit trip day title/date/notes.
- [ ] Add/edit reservations.
- [ ] Backend role check for every write.
- [ ] Change log for edits.
- [ ] Conflict/version handling for concurrent edits.

## Import roadmap

### Excel / CSV

- [ ] Provide official Travel OS .xlsx template.
- [ ] Suggested sheets: Trip, Itinerary, Bookings.
- [ ] Template import with deterministic validation.
- [ ] Non-template Excel/CSV mapping.
- [ ] AI-assisted column normalization into Travel OS schema.
- [ ] Import staging/preview before DB write.
- [ ] Duplicate detection.
- [ ] Show warnings for missing/ambiguous date/time/type/location.
- [ ] Allow download of normalized Excel/CSV for audit/archive.
- [ ] Never let AI write arbitrary imported rows directly to production without user confirmation.

### Text / PDF / screenshot booking import

- [ ] Paste text.
- [ ] Upload PDF.
- [ ] Upload screenshot.
- [ ] Extract booking fields.
- [ ] Show confirmation preview.
- [ ] Save only after user approval.

## Travel Inbox / email ingestion

Preferred model: a dedicated Travel OS mailbox, not broad access to every traveler's private inbox.

MVP:

- [ ] Create/connect a dedicated mailbox.
- [ ] Travelers forward booking/airline/rental/tour confirmations to it.
- [ ] Support per-trip aliases, e.g. travelos.booking+iceland2026@...
- [ ] Ingest new mail into an import inbox/staging table.
- [ ] Parse known providers with rules first.
- [ ] AI fallback for unknown email formats.
- [ ] Match to trip and existing reservation.
- [ ] Detect duplicate booking references.
- [ ] Detect changes to existing bookings.
- [ ] Present "suggested change" for confirmation before updating.
- [ ] Preserve old values in reservation_changes/change log.
- [ ] Never silently overwrite booking data.

Later:

- [ ] Optional direct Gmail connection.
- [ ] Optional Outlook connection.
- [ ] Automatic change detection for flight time / hotel / rental updates.

## Original roadmap still outstanding

### Offline / PWA completion

- [ ] Offline itinerary, booking, addresses, codes, contacts.
- [ ] Offline vouchers / QR / documents.
- [ ] Clear offline/last-sync status.
- [ ] Install/add-to-home-screen polish.

### Weather / alerts / push

- [x] Weather forecast display.
- [ ] Weather risk rules linked to itinerary activities.
- [ ] Plan B recommendation when weather conflicts with outdoor activities.
- [ ] Web Push reminders/alerts.
- [ ] Check-in / cancellation deadline reminders.

### Plan A / Plan B

- [ ] Alternate itinerary branches.
- [ ] One-tap switch Plan A -> Plan B.
- [ ] Recalculate route/day summary after switching.
- [ ] Preserve original plan/history.

### Money

- [ ] Expense entry.
- [ ] Multi-currency.
- [ ] Paid-by / participants / split rules.
- [ ] Receipt photo import/OCR.
- [ ] Reference FX vs actual card FX.
- [ ] Settlement summary.
- [ ] CSV export.

### More

- [ ] Packing list.
- [ ] Travel documents.
- [ ] Emergency/insurance contacts.
- [ ] Members/devices moved/linked into More.
- [ ] App/trip settings.

### Booking UX additions

- [ ] One-tap copy for address, booking code, PIN, phone, Wi-Fi, parking.
- [ ] Original source/voucher/document attachment.
- [ ] Cancellation deadline reminders.
- [ ] Booking change history.

## Order of work

1. v0.18A — Supabase becomes the single source of truth for Iceland.
2. v0.18B — Multi-trip routing + My Trips + trip-scoped authorization/switcher.
3. v0.18C — Owner/Editor manual add/edit/delete + change log.
4. v0.19 — Official Excel template + deterministic import preview.
5. v0.19.1 — AI-assisted non-template Excel/CSV normalization.
6. v0.20 — Dedicated Travel Inbox + forwarded email parsing.
7. v0.20.1 — Reservation change detection/history.
8. Complete Offline/Push/Plan B.
9. Money/expense split/receipt OCR.
10. Packing/documents/remaining More features.

## Non-negotiable design rules

- Database is the final source of truth; spreadsheets become import/export only.
- Same account may have different roles in different trips.
- No membership row = no trip data access.
- Viewer cannot write.
- Editor can edit trip content but cannot administer unrelated trips/users.
- Owner controls members/devices and trip creation.
- Sensitive reservation data is private and must not be shipped to unauthorized clients.
- Imports and AI extraction use staging + preview + confirmation.
- Booking/email changes must have a visible change log.
- Offline access must not bypass trip authorization.
- Do not introduce biometric prompts; approved-device flow is the chosen access model.
