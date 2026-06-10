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
- **Stock # autocomplete** — load your store's live inventory once and the stock # field
  suggests real units, auto-filling VIN, new/used, and vehicle:
  1. On a computer, open the app → **Settings → Inventory Autocomplete**
  2. Drag the **➕ Grab Astro Ford Inventory** link to your bookmarks bar
  3. Open astroford.com's new (and used) inventory pages and click the bookmark on each —
     it copies every vehicle on the page
  4. Back in the app, paste into the Inventory box and hit **Import / Merge**

  Re-run whenever you want fresher stock (takes ~30 seconds). It has to work this way because
  the dealer site sits behind Akamai bot protection that blocks all server/datacenter traffic —
  your own browser is the only thing allowed in, so the bookmark does the harvesting there.

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
