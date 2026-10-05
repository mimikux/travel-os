# Travel OS Roadmap

Last updated: 2026-10-05 · online release line v1.1.0

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
- [x] Map route panel proportional distance ruler: stop positions follow cumulative road distance and each segment shows its own km label; playback fills the same ruler.
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

## Release versioning

The public online app reached **v1.0**. Prototype numbers such as v0.17/v0.18 are historical and must not be used for new online releases.

Current naming:
- **v1.0** — first online Travel OS baseline.
- **v1.1A** — Supabase becomes the authoritative trip data source.
- **v1.1B** — Multi-Trip shell, trip routing, My Trips, trip-scoped authorization.
- **v1.1C** — Owner/Editor itinerary and booking editor.
- **v1.1.0** — cumulative online release containing 1.1A + 1.1B + 1.1C after smoke-test signoff.
- **v1.2** — Excel/CSV import.
- **v1.3** — Travel Inbox / forwarded-email ingestion.

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

## Current online implementation block: v1.1.0

### v1.1A — Supabase authoritative data source

- [x] Reconciled Iceland UI D0-D7 into Supabase.
- [x] Supabase now contains 8 trip days, 35 itinerary items, and 8 reservations for Iceland 2026.
- [x] Current day names, distances, drive times, events, notes, coordinates, hero images, sunrise/sunset values copied into Supabase.
- [x] travel-data now returns trip + role + days + itinerary + reservations.
- [x] Frontend cloud hydration replaces the in-memory trip with normalized Supabase data.
- [x] IndexedDB cache can store the full normalized cloud trip, not only bookings.
- [x] data.js is now Iceland-only fallback/demo seed instead of the intended production authority.
- [ ] Production smoke test: open Iceland online, verify D0-D7/Map/Booking after cloud hydration.
- [ ] Offline smoke test: load once online, disconnect network, reopen and verify cached itinerary + bookings.

### v1.1B — Multi-Trip

- [x] 2026-10-05 PWA install hotfix: Edge-installed app no longer treats `/travel-os/index.html` as a trip slug; manifest launches at the Travel OS root, and legacy installed copies that still start at `index.html` are normalized to the root shell. This fixes the misleading `Index.html` device-authorization failure while preserving the existing authenticated session.

- [x] 2026-10-05 UX polish: DEMO uses 3天前 / 前天 / 昨天 / 今天 / 明天 / 後天 / 3天後; live mode shows a numeric trip countdown in the hero (e.g. 46天) and directional wording in the timeline heading.
- [x] 2026-10-05 UX polish: Map and Booking use a permanently compact sticky header matching the collapsed Today hero height, instead of a second large header animation.

- [x] 2026-10-05 hotfix: desktop auth callback deadlock fixed by deferring Supabase API calls outside onAuthStateChange.
- [x] 2026-10-05 hotfix: IndexedDB open/upgrade now has a fail-safe and no longer blocks login indefinitely.
- [x] 2026-10-05 UI hotfix: timeline dots restored to ring + center-dot style and aligned exactly to the vertical rail.


- [x] 2026-10-05 hotfix: fixed GitHub Pages deep-link redirect syntax that caused a blank white page on /travel-os/:tripSlug.
- [x] 2026-10-05 hotfix: trip navigation now uses stable /travel-os/?trip=:slug internally; pretty URLs remain supported through 404 redirect.
- [x] 2026-10-05 hotfix: auth startup now has an 8-second fail-safe so the loading gate cannot hang forever.


- [x] Dynamic trip slug routing added.
- [x] Pretty routes supported: /travel-os/:tripSlug (GitHub Pages 404 fallback included).
- [x] /travel-os/ My Trips shell added.
- [x] travel-trips endpoint lists only trips authorized for the current signed-in email/user.
- [x] Roles remain trip-scoped: same user may be Editor in one trip, Viewer in another, or have no access.
- [x] Direct trip data requests still require active trip membership + Trusted Device.
- [x] Hero trip title acts as a trip switcher.
- [x] Owner can create a new trip from My Trips.
- [x] New trip gets its own Trusted Device registration and optional D0 when a start date is supplied.
- [x] Root Travel OS login works without requiring a specific trip first.
- [x] Login form no longer exposes the owner's email as a prefilled value.
- [ ] Production smoke test with a second test trip and at least one user who has access to only one of the two trips.
- [ ] Verify guessed unauthorized URL returns no trip data and cannot edit.

### v1.1C — Owner / Editor

- [x] travel-editor authenticated Edge Function added.
- [x] Every write checks trip membership role and Trusted Device server-side.
- [x] Viewer writes are rejected.
- [x] Add itinerary item.
- [x] Edit itinerary item.
- [x] Soft-delete itinerary item.
- [x] Reorder itinerary items.
- [x] Edit current trip day metadata.
- [x] Add reservation.
- [x] Edit reservation.
- [x] Soft-delete reservation.
- [x] Optimistic version checks return version_conflict instead of silently overwriting newer data.
- [x] Writes append entity_change_log records.
- [x] Owner/Editor Edit Mode UI added; Viewer does not get edit controls.
- [ ] Production smoke test: add/edit/delete/reorder on a temporary itinerary item.
- [ ] Production smoke test: add/edit/delete a temporary reservation.
- [ ] UX polish after real use: replace temporary prompt-based day editing with the same form-sheet UX as itinerary/booking editing.

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
- [x] Weather sheet links to the exact Open-Meteo raw forecast request and Google weather search for the day's primary location.
- [x] DEMO weather explicitly warns that displayed values are illustrative, not live source data.
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

1. v1.1.0 — Smoke-test and sign off Supabase authority + Multi-Trip + Editor.
2. v1.2 — Official Excel template + deterministic import preview.
3. v1.2.1 — AI-assisted non-template Excel/CSV normalization.
4. v1.3 — Dedicated Travel Inbox + forwarded email parsing.
5. v1.3.1 — Reservation change detection/history.
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

- [x] 2026-10-05 Mobile Today polish: live Hero relative label explicitly uses N天後 / N天前 (今天 on the date itself); timeline heading is at least as large as 看地圖; hero distance keeps value + km on one line and responsively shrinks when needed.

- [x] 2026-10-05 Today Hero meta shows a three-letter English weekday after the date, e.g. D1 · 11/21 SAT.

- [x] 2026-10-05 Editor save UX: inspect Supabase non-2xx responses, reconcile from cloud after ambiguous Edge Function errors, and avoid false failure when the write actually landed.
- [x] 2026-10-05 Editor mobile readability: editor labels, controls, status text and action buttons are at least 15px; form controls are 16px.
- [x] 2026-10-05 Itinerary ordering UX: fixed-time activities are not manually movable; flexible no-time activities use long-press drag ordering instead of up/down arrows.

- [x] 2026-10-05 Editor UX: paste a Google Maps / maps.app.goo.gl link and press 帶入 to resolve place/store name, GPS coordinates, navigation target, and a best-effort activity type.
- [x] 2026-10-05 Today UI: D0-D7 selector locked back to the larger v0.17 button and font proportions; Map date buttons remain unchanged.

- [x] 2026-10-05 Flexible itinerary drag v2: replace HTML5 drag/drop with Pointer Events so long-press sorting works on touch screens and mouse; fixed-time items remain locked to automatic time ordering.
- [x] 2026-10-05 Edit-mode visibility: Owner/Editor gets an explicit header Edit entry plus a persistent high-contrast edit toolbar with 編輯本日 / ＋新增 / 完成 on both mobile and desktop.

- [x] 2026-10-05 Today day selector sizing refined: on mobile, exactly five D-day buttons fit across the same content width as the Hero while remaining horizontally scrollable for D5-D7.

- [x] 2026-10-05 Google Maps import v2: prefer resolved /place/ name over generic Google Maps page titles, narrow type inference to place-specific context, and return confidence.
- [x] 2026-10-05 Google Maps import v2: best-effort weekly opening-hours extraction; append hours to Notes and warn when the scheduled trip date falls on a parsed closed day.

- [x] 2026-10-05 Visual consistency: Hero bottom corners, timeline cards, and Today D0-D7 buttons share one 18px corner radius so the collapsed Hero visually aligns with itinerary cards while scrolling.
- [x] 2026-10-05 Trip place audit: Owner/Editor can run a one-time opening-hours / closed-day check for itinerary items that already have a confirmed Google Maps URL; items without URLs are listed as needing manual completion instead of fuzzy-matched.
- [x] 2026-10-05 Existing itinerary metadata: Google Maps URL, opening hours, closed weekdays, check timestamp, and source are persisted in Supabase and loaded back into Travel OS; closed-day warnings render on Today cards.

- [x] 2026-10-05 Edit entry cleanup: remove direct Edit buttons from Today/Map headers; Owner/Editor enters edit mode only from the trip (...) menu, while the in-edit persistent toolbar remains.

- [x] 2026-10-05 Hero collapse flicker fix: remove the mid-scroll 82% layout switch; Hero height, title font size, spacing, stats and weather now interpolate continuously, with compact class applied only at the final state.

## 2026-10-05 editor/map follow-up

- [x] Route distance ruler: numbered destination nodes above the route line, km labels below; tight labels use two fixed lower lanes.
- [x] Google Maps short-link import: preserve the pasted/original URL, store expanded URL separately, keep an existing user-entered title, and retain address + GPS separately when available.
- [x] Google Maps resolver hardened: prefer coordinates from the expanded URL and avoid arbitrary viewport coordinates from the whole Google HTML.
- [x] Mobile flexible-item drag reorder: pointer-following drag ghost, explicit before/after insertion marker, document-level pointer tracking, backend reorder persistence.
- [ ] User verification on phone for route ruler, short-link sample, and drag reorder after r110x reaches GitHub Pages.

- [x] Route ruler readable scaling: every leg gets a minimum visual width while longer legs still receive proportional extra space; stop nodes no longer overlap; desktop hover/mobile tap shows destination name.

- [x] 2026-10-05 Route ruler r110aa: symmetric start/end node margins; all per-leg labels share one horizontal baseline; KM formatting is <100 => one decimal and >=100 => integer; minimum leg width now reserves label space; added one-button KM/MIN switch using OSRM per-leg distance + duration data, with itinerary day totals as the temporary fallback before routing resolves.

- [x] 2026-10-05 Route ruler r110ab: stop tooltip changed to dark text on a light card; tapping a stop now jumps the slider/playback/car directly to that stop and makes the tapped node current. Real route progress is kept separate from readability-adjusted ruler positions so the progress fill stays aligned.

- [x] 2026-10-05 Flexible itinerary drag r110ac: floating card now preserves the exact finger/handle grab offset instead of snapping the finger to the card edge; long-press suppresses text selection; live insertion placeholder physically opens a card-sized gap so surrounding flexible cards move aside before drop.

- [x] 2026-10-05 Drag/navigation r110ad: flexible cards may now use fixed-time cards as insertion anchors, so surrounding cards can visibly open a drop gap anywhere in the timeline while fixed-time cards themselves remain non-draggable. Navigation buttons now render for manually added/edited places whenever nav query, address, Google Maps URL/resolved URL, or coordinates exist; navigation uses nav query -> address -> coordinates -> title fallback.

- [x] 2026-10-05 Drag reorder r110ae: fixed-time cards were accepted visually as drop anchors but reorderFlexibleItem still rejected targets that had a time, causing the card to snap back after drop. Removed that stale guard; flexible items can now be inserted before/after fixed-time cards and persist via reorder_items.

- [x] 2026-10-05 Drag reorder r110af: reorder is now optimistic. The card moves to its new position immediately on drop, then saves `sort_order` in the background and reconciles from Supabase; on failure it restores the previous order and shows an error. This removes the ~3 second visual delay that could make users repeat the drag.

- [x] 2026-10-05 Today readability r110ag: raised all undersized Today-page labels/body/action text to a 14px minimum, matching the visual baseline of 看地圖 / 08:15. Only font size changed; existing colors and font weights remain untouched.

- [x] 2026-10-05 Overnight route continuity r110ah: each D1+ map route automatically prepends the previous day's final geocoded stay as its route origin, without duplicating the stay in the next day's timeline/database. The carry-over stay is also rendered as map point 1 and participates in OSRM KM/MIN calculations. D0 first-night Bakkastaðir coordinates were repaired in Supabase.

- [x] 2026-10-05 Tonight card r110ai: removed the redundant white '已確認' status pill from the Today-page accommodation card. Booking status remains available on the dedicated Reservations page where confirmed/planned/cancelled can be meaningful.

- [x] 2026-10-05 Itinerary origin + bottom nav r110aj: D1+ Today timeline now prepends the previous night's accommodation as a virtual '住宿名 出發' route-origin card when the day does not already contain an explicit drive-from-stay item; this matches the map continuity without duplicating database itinerary rows. Bottom nav '今天' renamed to '行程' and its icon changed to an outline map-pin matching the map marker visual language.

- [x] 2026-10-05 Inline stay booking + editor index r110ak: Tonight accommodation now expands its matched stay reservation directly inside the Itinerary page (confirmation/PIN, alerts, details, amenities, tips), and stay timeline actions scroll to the inline details instead of switching tabs. Virtual overnight-origin rows are excluded from editor indexing so Thingvellir edits Thingvellir rather than Efstidalur II.

- [x] 2026-10-05 Auth persistence r110al: removed the 30-minute inactivity sign-out that was clearing the local Supabase session. Trusted installed/browser sessions now remain signed in until explicit sign-out or true token revocation; resume/focus performs silent getSession + refreshSession reconciliation without covering a ready app with the login gate. This also removes the logged-in-page flash followed by a login overlay on mobile PWA resume.

- [x] 2026-10-05 Day departure time r110am: virtual previous-night accommodation origin cards now display the current day's `departure_time` at top-right. In edit mode the virtual card exposes only `編輯出發時間`, opening a one-field time editor that updates `trip_days.departure_time` without creating a fake itinerary row. `編輯本日` also supports the same departure time.

- [x] 2026-10-05 PWA edit availability r110an: installed app now exposes Owner/Editor controls immediately from the trusted local cache instead of waiting for a successful cloud hydrate. Opening the trip sheet re-evaluates edit availability, and returning online automatically rehydrates cloud data so `Offline cache` can become `Cloud synced` without a reload.

- [x] 2026-10-05 Dynamic dates + uncertain itinerary r110ao: item editor uses a calendar date field rather than an existing Dn/day-title dropdown. Saving to an earlier/later date lets the backend create and reindex the continuous trip-day range so earliest date becomes D0. Added `不確定`: dashed itinerary card, still fully editable/visible, but excluded from overnight origin, map markers, OSRM route, total km and drive time.

- [x] 2026-10-05 Timed auto-sort + linked stay reservations r110ap: fixed-time items now calculate placement from chronological timed anchors rather than stale sort_order, so new/edited times self-place automatically. Reservations now store shared accommodation address/GPS/nav/Google Maps data; itinerary stay rows can link to one reservation via reservation_id and inherit those fixed fields while retaining per-day time/title/note. Booking editor supports one-time Google Maps import and stay date range.
