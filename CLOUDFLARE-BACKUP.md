# Cloudflare production backup (2026-10-24)

This repository is a backup, not the deployment trigger. Cloudflare Pages project **mtravel** remains production; Supabase holds live data.

Production deployment: `6ec16d71-c706-4982-85ba-41a583c6e596` (2026-10-21). The files at `travel-os/` and site root were retrieved from the *running* Cloudflare production endpoint, including currently applied authentication, notification, and hero CSS fixes. Existing files at repository root are historical source and should not replace the Cloudflare production code.

## Restore cautions
- Deploy root files and `travel-os/` directory as one artifact, not only `travel-os/`.
- Travel OS production uses Cloudflare Pages advanced-mode Function and route configuration to patch the served JavaScript and CSS. This snapshot saves *effective served content*; it does **not** capture the executable `_worker.js` deployment source. Restore must preserve or reconstruct the Pages Function/route handling, especially the `/travel-os/index.html` fallback. Do not assume this backup reproduces every production behavior without a restore test.
- The original GitHub `main` before backup was retained at `backup/pre-cloudflare-sync-20261024`.
- Future updates: deploy and verify on Cloudflare first; afterwards update this GitHub backup using exact served production assets and keep a Cloudflare deployment reference. Never deploy old GitHub code over new Cloudflare production.
- Never commit Supabase database rows, authentication secrets, Cloudflare tokens or private backups to this public repository.
