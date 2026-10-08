- [x] 2026-10-06 Global Mail Router / Multi Trip: Gmail ingestion no longer trusts the Apps Script tripSlug. Incoming mail is parsed first, then routed by reservation travel date against the owner's active trip date ranges. Exactly one in-range trip => classified (~98%); overlapping/nearby trips => ambiguous; no matching trip or no usable travel date => unclassified. mail_imports now supports nullable trip_id plus routing_status, route_confidence, route_candidates and inbox owner. More now includes a Global Mail Inbox with manual trip assignment, ignore and reroute controls plus its own bottom-nav badge. Creating a new trip automatically reruns unclassified/ambiguous mail so previously forwarded reservations can attach to the newly created trip. Existing Iceland mail history was preserved unchanged.

- [x] 2026-10-06 Navigation split: right-side ellipsis is now the current-trip action menu, while bottom More is a global Travel OS hub. More V1 includes My Trips / trip switching, create trip, cloud sync status + manual resync, account identity, sign out, and app info. Hero trip title shortcut now opens More instead of duplicating a trip switcher inside the ellipsis menu. Mail import now shows pending-count badges on trip action menu buttons for Owner/Editor, and reviewed mail cards animate out with fade/collapse before the next card shifts up.

- [x] 2026-10-06 Mail parser hardening: Booking.com enrichment now reliably extracts stay dates/times, room summary, guest count, address, confirmation/PIN, amount/payment and cancellation deadline; Trip.com enrichment now extracts flight date from the itinerary section (not forwarded-message date) plus PNR, flight number, route and times. The enrichment runs on future mail_import rows too. Long-term parser direction is layered: deterministic provider parsers for known formats, generic/AI fallback for unknown or changed formats, schema validation/confidence scoring, then human Review Mode before any reservation write.

- [x] 2026-10-06 Gmail reservation import V1: dedicated mTripPlan Gmail inbox can push messages through Apps Script into Supabase mail_imports without touching live reservations. Parser recognizes Trip.com flights, Booking.com stays, Blue Car Rental cars and GetYourGuide tours; Google account/security notices are auto-ignored. Parsed mails are matched to existing reservations when possible. Travel OS now exposes a MAIL IMPORT review sheet for Owner/Editor with field comparison plus Ignore / Apply actions; Apply updates only parsed fields and preserves unmatched existing reservation data. Initial Iceland test: 9 inbox messages accepted, 4 travel reservations matched, 5 Google system mails ignored. Parser follow-up still needed for some Booking.com structured fields and Trip.com date/PNR edge formatting.

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
- [x] Production smoke test with a second test trip and a restricted Editor account: `mimikux@hotmail.com` can access Kumamoto 2027 and cannot see Iceland 2026.
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

- [x] 2026-10-05 Stay linkage display r110aq: linked stay itinerary rows inherit the reservation title as well as shared map/address/GPS fields. Tonight booking details first match explicit reservation_id, with fuzzy title matching only as legacy fallback. D5/D6 Hvalfjörður stays were linked to the same Kalastaðakot reservation and the shared Google Maps coordinates were migrated from D5.

- [x] 2026-10-05 Day Note r110ar: added a premium collapsed DAY NOTE card between the day strip and Timeline. It uses existing trip_days.notes (`day.short`) as the per-day long-form note, shows a one-line preview when collapsed, preserves line breaks when expanded, and exposes a dedicated textarea editor in edit mode. Empty notes stay hidden outside edit mode.

- [x] 2026-10-05 Day editor r110as: DAY NOTE is now always visible between the day strip and Timeline, including when empty. Replaced the old chained browser prompts for `編輯本日` with a single polished Day Editor sheet that edits title, departure time and long-form day note together in one save; date is shown read-only because itinerary dates now drive D0–Dn automatically. The Day Note edit action opens this same full editor.

- [x] 2026-10-05 Google Maps type default r110at: new itinerary items remain `景點` by default. Google Maps parsing no longer overwrites the selected type (e.g. incorrectly changing beaches/landmarks to 住宿); parser suggestions are shown only as a non-binding hint. Existing date-picker flow continues to allow creating dates beyond the current trip range (e.g. 11/28 becomes D8 and reindexes automatically).

- [x] 2026-10-05 Google Maps day-route export r110au: added `Google 路線 ↗` on the map page. In single-day mode it exports the exact active route stops (including carried-over overnight origin, excluding uncertain items) as a Google Maps Directions URL with origin, destination and ordered waypoints. Round trips are preserved when start/end are the same stay. Multi-day mode disables export and asks the user to select one day.

- [x] 2026-10-06 Mobile/PWA cloud reconnect r110av: fixed the trusted-cache/auth zombie state introduced by persistent login handling. Cached trusted devices may render local data immediately as `offline_ready`, but cloud sync now requires a real Supabase session; a confirmed missing session becomes `需要重新登入` rather than remaining falsely `Offline cache` forever. Android/PWA sync no longer trusts `navigator.onLine` as a hard gate, and opening the Trip sheet / network reconnect actively retries auth then travel-data. Sync status now distinguishes cache, syncing, synced, auth-required and error states. No production trip/day/item/reservation rows were modified by this fix.

- [x] 2026-10-06 Google route placeholder guard r110aw: route/map calculations now ignore legacy `drive` cards that only contain a rough coordinate and no real navigation source. This fixes D6 `前往 Snæfellsnes` (64.750000,-23.000000), which was a prototype region point in the sea and was being exported to Google Maps as a destination/waypoint. Real route stops, linked accommodations, Google Maps-derived places, and explicit nav-query/address points are unchanged. No Supabase production rows were modified.

- [x] 2026-10-06 Today spacing density r110ax: reduced Today D0–Dn selector height by ~20% while preserving button widths; tightened Hero→day-selector spacing by ~40%, and made day-selector→Day Note use the same compact 11px gap. No itinerary / reservation / Supabase production data changed.

- [x] 2026-10-06 Day Note→Timeline spacing r110ay: reduced the gap after Day Note to 14px, roughly 30% tighter than before while intentionally keeping it slightly larger than the 11px Hero→days and days→Day Note gaps. Layout-only change; no Supabase data changed.

- [x] 2026-10-06 Public Share route privacy fix: public maps now keep route continuity by using server-generated coarse accommodation route coordinates instead of exact lodging GPS. The next day automatically inherits the previous night's masked accommodation as its route origin, matching the private app's route logic. Address-like accommodation titles are sanitized before being returned publicly. Exact accommodation addresses/original GPS remain excluded from the public payload. D5/D6 remain dependent on source data because their current lodging itinerary rows have no GPS to mask.

- [x] 2026-10-06 Public Share V1 r110az: added Owner-only public sharing controls with create/reset/revoke/copy link actions, backed by hashed share tokens. Added privacy-safe public.html UI and travel-public-data Edge Function. Public payload omits real calendar dates, accommodation addresses/GPS, booking codes/PIN, payment/private notes, contact data; it includes D0–Dn, itinerary times/places, public prices, safe room/package fields, amenities, and non-stay map points. Existing private production itinerary/reservation rows are not modified.


- [x] 2026-10-07 Trip notification counts + create reconciliation: Trip action menu now mirrors the aggregate red notification badge with per-section counts: MAIL IMPORT shows pending mail count and PLACE CHECK shows current opening-hours/place-alert count; the outside menu badge remains their sum. New Trip creation now performs a one-time list reconciliation before showing "儲存失敗", so a backend-committed Trip is reopened instead of being falsely presented as failed after a transient response/runtime error. Frontend cache bumped to create-reconcile-v23.

- [ ] 2026-10-07 mTripPlan ingest backlog fix: sender-side Gmail confirms three Tigerair forwards (JF44PR, T9T92D, X17K6B), while Supabase currently contains only T9T92D. This is an ingest-stage gap, not a review UI grouping issue. Current Apps Script sample sends only messages.slice(0,20); update the mTripPlan Apps Script to process an unprocessed queue/batches so older Inbox messages cannot be permanently starved by the same newest 20.


- [x] 2026-10-07 Mail queue + Tigerair recovery: Apps Script importer now batches all recent non-Sent/non-Trash/non-Spam mail in groups of 20, oldest first. Two Tigerair forwards (JF44PR, X17K6B) were confirmed to have landed in Gmail Spam; after restoring them and rerunning the importer, both were ingested and classified to Kumamoto 2027. Tigerair mail count is now 3/3 including T9T92D.

- [x] 2026-10-07 Multi-trip day identity + solar times + app branding: Today hero no longer leaves placeholder names such as "未命名行程" when useful itinerary data exists. Placeholder day titles are derived from real spot/tour items (up to two meaningful stops), with stay/flight fallback and active multi-night stay fallback. Sunrise/sunset are now calculated from date + geographic coordinates and are independent from forecast availability; D0 uses the arrival airport when recognized, later days use the previous night's accommodation as the local base, then fall back to the day's first geocoded item. Kumamoto timezone corrected from UTC to Asia/Tokyo. Login/app identity now displays "Matt's Travel OS V1.3.0"; manifest and More/App version were aligned. Frontend cache bumped to smartday-sun-v25.


- [x] 2026-10-07 Invite reliability v28: Owner member invitations now distinguish authorization from email delivery. New-user invite mail failures (including Supabase 429 email rate limiting) no longer masquerade as success; pending access is retained and the Members sheet shows a dedicated "重新寄送" action. Existing Travel OS users are authorized without a redundant invitation email. request-travel-login now surfaces invite email delivery failures instead of silently returning "link sent". Frontend cache bumped to invitefix-v28.


- [x] 2026-10-07 Unified flight timeline + theme completion v30: Flight itinerary cards now use one display model across trips. Collapsed flight cards show departure-arrival time in the title, route in the title, flight number/terminal in the subtitle when available, and replace navigation with a Flight Status action placeholder for future live status/gate integration. Expanding shows the linked reservation records with the same detailed rows used in Booking. Iceland D0/D7 flight itinerary items were linked to their existing Trip.com flight reservations, matching the reservation-link model already used by Kumamoto. Remaining fixed earth-color borders/buttons were converted to trip-theme variables, including Trip action-sheet card borders, More page resync/sign-out buttons, and Map multi-select/range summary controls. Frontend cache bumped to flighttheme-v30.


- [x] 2026-10-07 Final reservation-backed itinerary model v31: Timeline summaries for flight / stay / car / tour now derive from linked reservation data instead of trip-specific hardcoded layouts. Flight collapsed cards show flight number + departure-arrival time, route as subtitle, airline + baggage summary as note; "航班動態" opens a date-specific FlightStats tracker and no longer controls reservation expansion. Stay cards show hotel name, nights / rooms / people, and meal-plan summary; the redundant "住宿細節" action was removed. Car cards show rental company, vehicle / rental days / date range, and transmission / plan / inclusions. Tour cards show full activity name, operator, meeting point / meeting time / provider note. All linked reservations use one "預訂資訊 · N 筆" accordion with full Booking-style detail cards. Mail parsing v11 now normalizes meal plans, flight baggage / airline, rental company/model/days/plan, and tour meeting/provider-note fields. travel-editor v33 now auto-matches or creates car/tour itinerary items just like stay/flight and links their reservation IDs. New-trip creation automatically reparses detached pending email before rerouting, so a delete-and-recreate test uses the current parser. UI polish removes duplicate accordion separators and themes edit-mode buttons. Frontend cache bumped to finalcards-v31.


- [x] 2026-10-07 Offline mode v33: Trusted-device trips now remain usable after reopening the PWA with no network. The root trip chooser falls back to IndexedDB and shows downloaded trips offline; service-worker navigation falls back to cached index.html for ?trip= routes and runtime-caches required CDN assets plus previously viewed OSM tiles. Existing itinerary/day/reservation edits, deletes, and reorders are applied immediately to the local cache and queued in IndexedDB; reconnect automatically replays the queue to travel-editor and then rehydrates from cloud. Repeated offline edits to the same entity/action are coalesced to avoid replaying stale base versions. Invite UX now explicitly states that the email is authorized even if the invitation email is not received, and pending invites show that the invitee can log in directly with the authorized email. Frontend cache bumped to offline-v33.


- [x] 2026-10-07 Offline cold-start fix v34: the app now persists a lightweight authorized-trip directory in localStorage in addition to IndexedDB, and refreshes it every time the cloud trip list is fetched or a trip snapshot is hydrated. Offline cold starts render cached trips immediately before any cloud/auth refresh, then keep the cached list visible if the network call fails. IndexedDB cold-open timeout was increased and failed opens can retry instead of permanently disabling local cache for the session. The service worker now precaches the exact versioned app-shell assets used by index.html so query-string asset URLs remain available offline. Trip-switch fallback also uses the cached directory. Frontend/service-worker cache bumped to offline-v34.


- [x] 2026-10-07 Production verification follow-up: Kumamoto delete/recreate from mail was re-run successfully with the current parser/linking model; restricted Editor access was verified using a second account (Kumamoto visible/editable, Iceland not visible); offline cold-start now reopens cached trips successfully. Remaining highest-value smoke tests are reconnect queue replay to another device, unauthorized direct-URL denial, Viewer write denial, final editor CRUD/reorder regression, Google Maps enriched field mapping, route/uncertain-item behavior, flight-status deep links, and public-share privacy/revocation.


- [x] 2026-10-08 Expense ledger v48: enabled the bottom 花費 tab and added a unified trip expense ledger. Added independent trip_people identities so login accounts can choose a per-trip nickname, automatically join the split-person list, claim a previously manual person, or coexist with unregistered travelers. Added manual expense entry/edit/delete, payer + equal-split selection, reservation-to-expense conversion with duplicate protection, basic per-day/category analysis, and multi-currency totals without unsafe cross-currency summing. Added a private travel-receipts Storage bucket and a guarded receipt parser: receipt photos are sent to a vision model only as a draft, financial fields require explicit evidence + confidence checks, uncertain fields are removed instead of guessed, and nothing is posted to the ledger until the user confirms the preview. travel-data v15, travel-editor v42, travel-receipt-parser v2. Frontend/service-worker cache bumped to expense-v48.
