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

Have a daily inventory report (Excel or CSV attachment) emailed to a Gmail inbox, and a
scheduled job in this repo ingests it every morning — the app updates itself, zero touch.

One-time setup:

1. **Inbox**: use a dedicated free Gmail for this (recommended — e.g. `yourname.invfeed@gmail.com`)
   or your own. Schedule the dealership's daily inventory report to be emailed there as an
   `.xlsx` or `.csv` attachment.
2. **App password**: in that Google account, turn on 2-Step Verification, then create an
   **App Password** (Google Account → Security → App passwords). Never share this in chat or
   email — it goes only into GitHub Secrets:
3. **Secrets**: in this repo → **Settings → Secrets and variables → Actions**, add:
   - `IMAP_USER` — the Gmail address
   - `IMAP_PASSWORD` — the app password
   - `IMAP_HOST` — only if not Gmail
4. Optional but smart, under the **Variables** tab: `INV_FROM` (sender of the report email)
   and/or `INV_SUBJECT` (a word from its subject) so the job grabs the right email.
5. Test it: **Actions → Inventory sync → Run workflow**. Green run = `inventory.json` updates
   and the app picks it up on next open.

The job runs daily at ~6:30am Central, finds the newest report in the inbox (last 4 days),
parses it with flexible column matching (Stock #, VIN, Year, Make, Model, Trim, New/Used —
any reasonable header names), and commits the result only when inventory actually changed.

### Manual fallbacks

- **Paste**: copy rows straight out of an Excel/CSV inventory report and paste them into
  **Settings → Inventory Autocomplete → Import / Merge** (a VIN column is the only requirement).
- **Bookmarklet**: drag **➕ Grab Astro Ford Inventory** (in Settings) to your bookmarks bar,
  click it while on astroford.com's inventory pages, paste the result into the app. This exists
  because the dealer site's bot protection blocks all server-side fetching — only a real
  browser gets in.

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
