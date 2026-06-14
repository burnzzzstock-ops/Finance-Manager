# F&I Scoreboard

A personal scoreboard for an F&I manager: log each deal in ~15 seconds, see your monthly
PVR / product penetration / products-per-deal at a glance, track chargebacks, and watch your
month-to-date pay build against your actual pay plan.

No logins, no server, no database. It's a static web page — your data is stored **only in your
own browser** (localStorage) and is never uploaded anywhere.

## Turn it on (one-time, ~1 minute)

1. In this GitHub repo, go to **Settings → Pages**
2. Under **Source**, choose **Deploy from a branch**
3. Pick the branch this code lives on, folder **/ (root)**, and hit **Save**
4. After a minute, your app is live at `https://<your-username>.github.io/Finance-Manager/`
5. Open it on your phone and use **Share → Add to Home Screen** so it sits next to your other apps

> GitHub Pages on a free plan requires the repo to be **public**. That's fine here — the code
> contains zero personal data, and your deals never leave your browser.

## Using it

- **+ button** → log a deal: date, stock #, finance/lease/cash, new/used, lender, reserve,
  then tap the products you sold (each prefills your default profit — adjust if needed). Save.
- **Dashboard** → units, back gross, PVR, products-per-deal, reserve, chargebacks, net gross,
  estimated pay, product penetration table, lender mix, and a 6-month history.
- **Pay tab** → enter your pay plan once: commission tiers on monthly net back gross
  (retroactive or marginal) plus bonuses (unit count, gross, PVR, PPD, or product penetration).
  The "What You Need" board then tells you exactly what's between you and the next tier or bonus.
- **Chargebacks** → log them as they hit; they net against your gross and your estimated pay
  in the month they land.
- **Settings** → edit your product list and default profits, your lender list, and backups.

## Less typing: VIN decode + inventory autocomplete

- **VIN decode** — type a VIN in the deal form (or tap 📷 Scan on Android/Chrome and point at
  the door-jamb barcode) and the vehicle auto-fills via the free federal NHTSA decoder.
- **Stock # autocomplete** — the app knows your live inventory, so the stock # field suggests
  real units and auto-fills VIN, new/used, and vehicle.

### Automatic daily inventory feed (recommended)

Two reports — **new** and **used** — get emailed to a Gmail inbox at midnight daily, and a
scheduled job in this repo ingests both every morning, merges them, and the app updates itself.
Zero touch after setup.

One-time setup:

1. **Inbox**: use a dedicated free Gmail for this (recommended — e.g. `yourname.invfeed@gmail.com`).
   Schedule the dealership's **new** and **used** inventory reports to be emailed there daily as
   `.xlsx` or `.csv` attachments.
2. **App password**: in that Google account, turn on 2-Step Verification, then create an
   **App Password** (Google Account → Security → App passwords). Never share this in chat or
   email — it goes only into GitHub Secrets.
3. **Secrets**: in this repo → **Settings → Secrets and variables → Actions → Secrets**, add:
   - `IMAP_USER` — the Gmail address
   - `IMAP_PASSWORD` — the app password
   - `IMAP_HOST` — only if not Gmail
4. **Variables** (same page, **Variables** tab):
   - `INV_FROM` — recommended: the sender address of the reports (e.g. the DMSREPORTS
     address), so unrelated mail is ignored.
   - `INV_SUBJECT_NEW` / `INV_SUBJECT_USED` — only needed if the reports can't self-identify.

   New vs. used is detected automatically: DealerTrack "Inventory Analysis Detail" PDFs carry
   an **"All New" / "All Used"** banner, which the parser reads directly. Subject/filename
   keywords and an average-model-year tiebreaker are fallbacks if that banner is ever absent.

Supported attachment formats: **PDF** (DealerTrack IN3130R inventory reports), plus Excel
(`.xlsx`) and CSV.
5. Test it: **Actions → Inventory sync → Run workflow**. A green run means `inventory.json`
   updated and the app will pick it up on next open.

The job runs daily at ~6:30am Central — well after the midnight emails land. It finds the
newest new report and newest used report (last 2 days), tags each report's vehicles
accordingly, parses with flexible column matching (Stock #, VIN, Year, Make, Model, Trim,
New/Used — any reasonable header names), merges them, and commits only when inventory
actually changed.

### Manual fallbacks

- **Paste**: copy rows straight out of an Excel/CSV inventory report and paste them into
  **Settings → Inventory Autocomplete → Import / Merge** (a VIN column is the only requirement).
- **Bookmarklet**: drag **➕ Grab Astro Ford Inventory** (in Settings) to your bookmarks bar,
  click it while on astroford.com's inventory pages, paste the result into the app. This exists
  because the dealer site's bot protection blocks all server-side fetching — only a real
  browser gets in.

## Cloud sync across devices (optional, end-to-end encrypted)

Your data is **encrypted on your device** with your passphrase before it's sent anywhere, so the
cloud only ever stores unreadable ciphertext. The free store is Firebase Realtime Database.

**One-time setup (~2 minutes), on your main device:**

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project**
   (name it anything, you can skip Google Analytics).
2. In the left menu: **Build → Realtime Database → Create Database**. Pick a location, then choose
   **Start in test mode** → Enable.
3. (Recommended, so it never locks) Open the **Rules** tab and set:
   ```json
   { "rules": { "fiscoreboard": { ".read": true, ".write": true } } }
   ```
   Publish. Your data under there is encrypted, so open rules only expose ciphertext.
4. Copy the database URL shown at the top of the Data tab — it looks like
   `https://yourproject-default-rtdb.firebaseio.com`.
5. In the app: **Settings → Cloud Sync**, paste that URL, pick a passphrase, tap **Start syncing**.
   You'll get a **Sync Code**.

**On any other device:** open the app → **Settings → Cloud Sync → Connect**, paste the Sync Code
and the same passphrase. Done — it pulls your data and stays in sync from then on.

Notes: the passphrase can't be recovered (lose it and the cloud copy is unreadable — your local
data and backup files are unaffected). The Sync Code contains the database location but not the
passphrase, so both are needed to connect. Backup files never contain the passphrase.

## Keep your data safe

- Data lives in the browser you logged it in. **Settings → Export Backup (JSON)** regularly.
- Moving to a new phone/computer: Export on the old one, **Import Backup** on the new one.
- **Export Deals (CSV)** any time you want the raw deals in a spreadsheet.

## House rules

- **No customer PII.** Key deals by stock or deal number only — never names, SSNs, DOBs,
  or anything else covered by the Safeguards Rule. The note field is for deal notes, not people.

## Changing the app

It's three files: `index.html` (layout), `style.css` (looks), `app.js` (logic).
Easiest path: open a Claude Code session on this repo and describe what you want changed.
