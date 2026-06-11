'use strict';

/* ============ storage ============ */

// Profile support: ?u=jr on the URL gives a teammate a fully separate data
// store under the same site (and labels their backups).
const PROFILE = (new URLSearchParams(location.search).get('u') || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 12);
const LS_KEY = 'fi-scoreboard-v1' + (PROFILE ? '-' + PROFILE : '');

const DEFAULT_DATA = {
  settings: {
    products: [
      { name: 'VSC / ESP',          amt: 1000, active: true, count: 1 },
      { name: 'GAP',                amt: 600,  active: true, count: 1 },
      { name: 'Complete Protection', amt: 1200, active: true, count: 5 },
      { name: 'Express 5',          amt: 1000, active: true, count: 5 },
      { name: 'Express 4',          amt: 800,  active: true, count: 5 },
      { name: 'Tire & Wheel',       amt: 450,  active: true, count: 1 },
      { name: 'Maintenance',        amt: 350,  active: true, count: 1 },
      { name: 'Appearance',         amt: 300,  active: true, count: 1 },
      { name: 'Key Replacement',    amt: 250,  active: true, count: 1 }
    ],
    lenders: ['Ford Credit', 'Chase', 'Capital One', 'Ally', 'Wells Fargo', 'Credit Union', 'Other'],
    payPlan: {
      mode: 'matrix',
      reserveRate: 10,
      holdbackPct: 14,                      // 14% off the top of product + reserve; paid on the rest
      matrix: {
        pvrBasis: 'total',                    // PVR = (products + reserve) / units; or 'products'
        cols: [0, 1151, 1251, 1351, 1451],    // PVR column breakpoints ($)
        rows: [0, 0.76, 1.26, 1.76],          // products-per-deal row breakpoints
        rates: [
          [9, 10, 11, 12, 13],
          [11, 12, 13, 14, 15],
          [12, 13, 14, 15, 16],
          [13, 14, 15, 16, 17]
        ]
      },
      matrixBonus: { extra: 2, vscPen: 55 },   // requires the top-right (max-rate) cell + VSC pen
      retro: true,
      tiers: [{ min: 0, rate: 12 }],
      bonuses: []
    },
    lastBackup: null,
    lastInvSync: null,
    autoBackup: true,        // silently download a backup as you log deals
    lastAutoBackup: null,
    opsSinceBackup: 0
  },
  deals: [],       // {id, date, num, type, cond, lender, reserve, products:[{name, amt}], vin, vehicle, note}
  chargebacks: [], // {id, date, num, product, amt, note}
  inventory: []    // {vin, stock, name, year, cond} — synced from the dealer site via bookmarklet
};

function mergeData(d) {
  const base = structuredClone(DEFAULT_DATA);
  const sp = (d.settings || {}).payPlan || {};
  return {
    settings: {
      ...base.settings, ...(d.settings || {}),
      payPlan: {
        ...base.settings.payPlan, ...sp,
        matrix: { ...base.settings.payPlan.matrix, ...(sp.matrix || {}) },
        matrixBonus: { ...base.settings.payPlan.matrixBonus, ...(sp.matrixBonus || {}) }
      }
    },
    deals: Array.isArray(d.deals) ? d.deals : [],
    chargebacks: Array.isArray(d.chargebacks) ? d.chargebacks : [],
    inventory: Array.isArray(d.inventory) ? d.inventory : []
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_DATA);
    return mergeData(JSON.parse(raw));
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

let data = loadData();
// While viewing a teammate's file, nothing writes to this device's storage.
let teamView = null;   // label of the file being viewed, or null
let myData = null;     // own data, parked during team view
const save = () => { if (!teamView) localStorage.setItem(LS_KEY, JSON.stringify(data)); };

function enterTeamView(d, label) {
  myData = data;
  data = mergeData(d);
  teamView = label;
  document.body.classList.add('teamview');
  const b = $('#team-banner');
  b.hidden = false;
  b.innerHTML = `👀 Viewing <b>${esc(label)}</b> — read-only <button class="btn sm" id="exit-team">Back to my data</button>`;
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.view === 'dashboard'));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-dashboard'));
  renderAll();
}

function exitTeamView() {
  data = myData;
  myData = null;
  teamView = null;
  document.body.classList.remove('teamview');
  $('#team-banner').hidden = true;
  renderAll();
}

/* ============ helpers ============ */

const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fmt$ = n => (n < 0 ? '-$' : '$') + Math.abs(Math.round(n)).toLocaleString('en-US');
const fmtPct = n => (Math.round(n * 10) / 10) + '%';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const monthLabel = m => new Date(m + '-15T12:00:00').toLocaleString('en-US', { month: 'short', year: 'numeric' });
const dateLabel = d => new Date(d + 'T12:00:00').toLocaleString('en-US', { month: 'short', day: 'numeric' });

const state = { month: todayStr().slice(0, 7) };

/* ============ inventory + VIN ============ */

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
const titleCase = s => String(s).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());

function invLookup(q) {
  q = String(q || '').trim().toUpperCase();
  if (!q) return null;
  return data.inventory.find(v => (v.stock || '').toUpperCase() === q)
    || (q.length >= 6 ? data.inventory.find(v => v.vin.endsWith(q)) : null)
    || null;
}

function normInvItem(r) {
  const vin = String(r.vin || '').toUpperCase();
  if (!VIN_RE.test(vin)) return null;
  return {
    vin,
    stock: String(r.stock || '').trim(),
    name: String(r.name || '').trim(),
    year: String(r.year || '').slice(0, 4),
    cond: r.cond === 'used' ? 'used' : (r.cond === 'new' ? 'new' : '')
  };
}

const toCond = s => {
  s = String(s || '').toLowerCase();
  if (!s) return '';
  if (/used|pre|cpo|certified|^u$/.test(s)) return 'used';
  if (/new|^n$/.test(s)) return 'new';
  return '';
};

// Accepts bookmarklet JSON, a backup file's inventory, or CSV/TSV pasted
// straight out of an Excel inventory report.
function parsePastedInventory(text) {
  text = String(text || '').trim();
  if (!text) return null;
  if (text[0] === '{' || text[0] === '[') {
    try {
      const d = JSON.parse(text);
      return Array.isArray(d) ? d : (d.fiInv || d.inv || d.inventory || d.vehicles || null);
    } catch { return null; }
  }
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return null;
  const delim = (lines[0].match(/\t/g) || []).length >= (lines[0].match(/,/g) || []).length ? '\t' : ',';
  const splitLine = line => {
    const out = []; let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
        else cur += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === delim) { out.push(cur); cur = ''; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  };
  const CMAP = {
    vin: 'vin', stock: 'stock', stocknumber: 'stock', stockno: 'stock', stocknum: 'stock', stk: 'stock',
    year: 'year', modelyear: 'year', yr: 'year', make: 'make', model: 'model',
    trim: 'trim', series: 'trim', type: 'cond', newused: 'cond', condition: 'cond',
    nu: 'cond', vehicletype: 'cond', inventorytype: 'cond', status: 'cond'
  };
  const normH = h => String(h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let cols = null, start = 0;
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = splitLine(lines[i]);
    if (cells.some(c => normH(c) === 'vin')) {
      cols = {};
      cells.forEach((c, j) => { const k = CMAP[normH(c)]; if (k && !(k in cols)) cols[k] = j; });
      start = i + 1;
      break;
    }
  }
  if (!cols) return null;
  const out = [];
  for (let i = start; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const get = k => (k in cols && cols[k] < cells.length) ? String(cells[cols[k]]).trim() : '';
    const year = get('year').replace(/\D/g, '').slice(0, 4);
    let make = get('make');
    if (make === make.toUpperCase()) make = titleCase(make);
    out.push({
      vin: get('vin').toUpperCase().replace(/\s/g, ''),
      stock: get('stock').replace(/\.0$/, ''),
      name: [year, make, get('model'), get('trim')].filter(Boolean).join(' '),
      year,
      cond: toCond(get('cond'))
    });
  }
  return out;
}

function importInventory(text) {
  const arr = parsePastedInventory(text);
  if (!arr || !arr.length) {
    alert('Could not read that — paste what the bookmark copied, or rows copied from an Excel/CSV inventory report (with a VIN column).');
    return false;
  }
  const byVin = new Map(data.inventory.map(v => [v.vin, v]));
  let added = 0, updated = 0;
  for (const r of arr) {
    const item = normInvItem(r);
    if (!item) continue;
    if (byVin.has(item.vin)) { Object.assign(byVin.get(item.vin), item); updated++; }
    else { data.inventory.push(item); byVin.set(item.vin, item); added++; }
  }
  if (!added && !updated) { alert('No valid 17-character VINs found in that paste.'); return false; }
  data.settings.lastInvSync = Date.now();
  save();
  renderSettings();
  alert(`Inventory updated: ${added} added, ${updated} refreshed. ${data.inventory.length} vehicles on file.`);
  return true;
}

// Pull the latest feed committed by the daily email sync (inventory.json).
// The feed is a full snapshot, so it replaces the local list when it changes.
async function refreshInventoryFromRepo() {
  try {
    const r = await fetch('inventory.json', { cache: 'no-cache' });
    if (!r.ok) return;
    const j = await r.json();
    const vehicles = (j.vehicles || []).map(normInvItem).filter(Boolean);
    if (!vehicles.length) return;
    const ts = Date.parse(j.updated) || Date.now();
    if (ts === data.settings.lastInvSync && vehicles.length === data.inventory.length) return;
    data.inventory = vehicles;
    data.settings.lastInvSync = ts;
    save();
    renderSettings();
  } catch { /* offline or feed not set up yet — that's fine */ }
}

// Runs on the dealer site in the user's browser (their IP gets in; datacenter IPs are
// blocked by Akamai, so this is the sync path). Harvests JSON-LD vehicle data and
// data-vin attributes from the inventory page and copies them to the clipboard.
const BOOKMARKLET = "javascript:" + encodeURIComponent("(function(){var out=[],seen={};function add(v){if(v&&v.vin&&/^[A-HJ-NPR-Z0-9]{17}$/.test(v.vin)&&!seen[v.vin]){seen[v.vin]=1;out.push(v);}}document.querySelectorAll('script[type=\"application/ld+json\"]').forEach(function(s){try{var d=JSON.parse(s.textContent);(Array.isArray(d)?d:(d['@graph']||[d])).forEach(function(v){if(!v)return;if(v.offers&&v.offers.itemOffered){v=Object.assign({},v.offers.itemOffered,v);}var vin=String(v.vehicleIdentificationNumber||v.vin||'').toUpperCase();if(!vin)return;var cond=String(v.itemCondition||'')+' '+String(v.name||'')+' '+location.pathname;add({vin:vin,stock:String(v.sku||v.mpn||''),name:String(v.name||''),year:String(v.vehicleModelDate||v.productionDate||''),cond:/used|pre-?owned/i.test(cond)?'used':'new'});});}catch(e){}});document.querySelectorAll('[data-vin]').forEach(function(el){var d=el.dataset;add({vin:String(d.vin||'').toUpperCase(),stock:String(d.stocknumber||d.stockNumber||d.stock||''),name:[d.year,d.make,d.model,d.trim].filter(Boolean).join(' '),year:String(d.year||''),cond:/used|pre-?owned/i.test(String(d.type||d.condition||'')+location.pathname)?'used':'new'});});if(!out.length){alert('No vehicles found on this page. Open a new or used inventory listing page, then click the bookmark again.');return;}var txt=JSON.stringify({fiInv:out});function done(){alert('Copied '+out.length+' vehicles. Paste into F&I Scoreboard > Settings > Inventory.');}if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(txt).then(done,function(){prompt('Copy this:',txt);});}else{prompt('Copy this:',txt);}})();");

const vinCache = {};
let vinReqId = 0;
async function decodeVIN(vin) {
  vin = vin.toUpperCase();
  if (vinCache[vin] !== undefined) return vinCache[vin];
  const r = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`);
  const j = await r.json();
  const x = (j && j.Results && j.Results[0]) || {};
  const s = [x.ModelYear, x.Make && titleCase(x.Make), x.Model, x.Trim || x.Series]
    .filter(Boolean).join(' ').trim();
  vinCache[vin] = s;
  return s;
}

function showVehicle(text, val) {
  const el = $('#f-vehicle');
  el.textContent = text || '';
  el.dataset.v = val !== undefined ? val : (text || '');
}

/* ============ metrics ============ */

// How many "products" a line counts as toward PPD. Bundles (Complete Protection,
// Express 4/5) count as 5. A weight stored on the deal line wins; otherwise the
// current product setting decides, so re-weighting applies retroactively.
function prodWeight(p) {
  if (p.count != null && +p.count > 0) return +p.count;
  const s = data.settings.products.find(x => x.name === p.name);
  return s && +s.count > 0 ? +s.count : 1;
}

function calcMonth(m) {
  const deals = data.deals.filter(d => d.date.startsWith(m));
  const cbs = data.chargebacks.filter(c => c.date.startsWith(m));
  const units = deals.length;
  let productGross = 0, reserve = 0, prodCount = 0;
  const prodStats = {}, lenderMix = {}, lenderStats = {}, typeCount = { finance: 0, lease: 0, cash: 0 }, condCount = { new: 0, used: 0 };
  const condStats = { new: { units: 0, gross: 0, prodCount: 0 }, used: { units: 0, gross: 0, prodCount: 0 } };

  for (const d of deals) {
    reserve += +d.reserve || 0;
    typeCount[d.type] = (typeCount[d.type] || 0) + 1;
    condCount[d.cond] = (condCount[d.cond] || 0) + 1;
    const cs = condStats[d.cond] || (condStats[d.cond] = { units: 0, gross: 0, prodCount: 0 });
    cs.units++;
    cs.gross += +d.reserve || 0;
    let dealProd = 0;
    for (const p of (d.products || [])) {
      productGross += +p.amt || 0;
      dealProd += +p.amt || 0;
      const w = prodWeight(p);
      prodCount += w;
      cs.prodCount += w;
      cs.gross += +p.amt || 0;
      const s = prodStats[p.name] || (prodStats[p.name] = { count: 0, gross: 0 });
      s.count++;                 // deals containing it — drives penetration %
      s.gross += +p.amt || 0;
    }
    if (d.lender && d.type !== 'cash') {
      lenderMix[d.lender] = (lenderMix[d.lender] || 0) + 1;
      const L = lenderStats[d.lender] || (lenderStats[d.lender] = { count: 0, reserve: 0, product: 0 });
      L.count++;
      L.reserve += +d.reserve || 0;
      L.product += dealProd;
    }
  }

  const gross = productGross + reserve;
  const cbAmt = cbs.reduce((a, c) => a + (+c.amt || 0), 0);
  return {
    deals, cbs, units, productGross, reserve, gross,
    cbAmt, cbCount: cbs.length, net: gross - cbAmt,
    pvr: units ? gross / units : 0,
    ppd: units ? prodCount / units : 0,
    prodCount, prodStats, lenderMix, lenderStats, typeCount, condCount, condStats
  };
}

function dealTotal(d) {
  return (+d.reserve || 0) + (d.products || []).reduce((a, p) => a + (+p.amt || 0), 0);
}

/* ============ pay engine ============ */

function sortedTiers() {
  const t = (data.settings.payPlan.tiers || []).map(x => ({ min: +x.min || 0, rate: +x.rate || 0 }));
  if (!t.length) t.push({ min: 0, rate: 0 });
  return t.sort((a, b) => a.min - b.min);
}

function basePay(net) {
  const plan = data.settings.payPlan;
  const tiers = sortedTiers();
  let tier = tiers[0];
  for (const t of tiers) if (net >= t.min) tier = t;

  let pay;
  if (plan.retro !== false) {
    pay = Math.max(net, 0) * tier.rate / 100;
  } else {
    pay = 0;
    for (let i = 0; i < tiers.length; i++) {
      const lo = tiers[i].min, hi = i + 1 < tiers.length ? tiers[i + 1].min : Infinity;
      if (net > lo) pay += (Math.min(net, hi) - lo) * tiers[i].rate / 100;
    }
  }
  return { pay, tier, tiers };
}

const BONUS_METRICS = {
  units: { label: 'Units delivered', fmt: v => Math.round(v) + ' units' },
  gross: { label: 'Net back gross', fmt: v => fmt$(v) },
  pvr:   { label: 'PVR',            fmt: v => fmt$(v) },
  ppd:   { label: 'Products per deal', fmt: v => (Math.round(v * 100) / 100).toFixed(2) },
  pen:   { label: 'Product penetration', fmt: v => fmtPct(v) }
};

function bonusStatus(b, M) {
  let cur = 0;
  switch (b.metric) {
    case 'units': cur = M.units; break;
    case 'gross': cur = M.net; break;
    case 'pvr':   cur = M.pvr; break;
    case 'ppd':   cur = M.ppd; break;
    case 'pen': {
      const s = M.prodStats[b.product];
      cur = M.units ? ((s ? s.count : 0) / M.units) * 100 : 0;
      break;
    }
  }
  const threshold = +b.threshold || 0;
  const earned = M.units > 0 && cur >= threshold;
  let gapText = '';
  if (!earned) {
    if (b.metric === 'units') {
      gapText = `${Math.ceil(threshold - cur)} more unit${threshold - cur > 1 ? 's' : ''} to go`;
    } else if (b.metric === 'gross') {
      gapText = `${fmt$(threshold - cur)} more gross to go`;
    } else if (b.metric === 'pvr') {
      gapText = `PVR is ${fmt$(cur)}, needs ${fmt$(threshold)}`;
    } else if (b.metric === 'ppd') {
      gapText = `PPD is ${BONUS_METRICS.ppd.fmt(cur)}, needs ${BONUS_METRICS.ppd.fmt(threshold)}`;
    } else if (b.metric === 'pen') {
      const s = M.prodStats[b.product];
      const c = s ? s.count : 0, t = threshold / 100;
      if (t >= 1) {
        gapText = `needs it on every deal`;
      } else if (M.units) {
        const n = Math.max(1, Math.ceil((t * M.units - c) / (1 - t)));
        gapText = `at ${fmtPct(cur)} — sell it on the next ${n} straight to hit ${fmtPct(threshold)}`;
      } else {
        gapText = `no deals logged yet`;
      }
    }
  }
  return { cur, threshold, earned, gapText };
}

function vscStats(M) {
  let count = 0;
  for (const [name, s] of Object.entries(M.prodStats)) {
    if (/vsc|esp|service/i.test(name)) count += s.count;
  }
  return { count, pen: M.units ? count / M.units * 100 : 0 };
}

const idxFor = (breaks, v) => {
  let i = 0;
  breaks.forEach((b, j) => { if (v >= b) i = j; });
  return i;
};

function calcPayMatrix(M, plan) {
  const mx = plan.matrix;
  const pvr = M.units ? (mx.pvrBasis === 'products' ? M.productGross : M.gross) / M.units : 0;
  const ri = idxFor(mx.rows, M.ppd);
  const ci = idxFor(mx.cols, pvr);
  const rate = (mx.rates[ri] || [])[ci] ?? 0;
  const vsc = vscStats(M);
  const mb = plan.matrixBonus || {};
  const inCorner = ri === mx.rows.length - 1 && ci === mx.cols.length - 1;
  const bonusEarned = M.units > 0 && inCorner && vsc.pen >= (mb.vscPen ?? 55);
  // 14% chargeback hold off the top of product + reserve; commissioned on the rest.
  const hold = (plan.holdbackPct ?? 0) / 100;
  const prodNet = M.productGross * (1 - hold);
  const reserveNet = M.reserve * (1 - hold);
  const prodRate = rate + (bonusEarned ? (mb.extra ?? 2) : 0);
  const productPay = prodNet * prodRate / 100;
  const reserveRate = plan.reserveRate ?? 10;
  const reservePay = reserveNet * reserveRate / 100;
  return {
    M, mode: 'matrix', rate, prodRate, reserveRate, pvr, ri, ci, inCorner,
    vsc, bonusEarned, holdPct: plan.holdbackPct ?? 0, prodNet, reserveNet, productPay, reservePay,
    total: productPay + reservePay,
    rateLabel: `${prodRate}% products + ${reserveRate}% reserve`
  };
}

function calcPay(m) {
  const M = calcMonth(m);
  const plan = data.settings.payPlan;
  if (plan.mode !== 'tiers') return calcPayMatrix(M, plan);

  const base = basePay(M.net);
  const bonuses = (plan.bonuses || []).map(b => ({ b, ...bonusStatus(b, M) }));
  const earnedSum = bonuses.filter(x => x.earned).reduce((a, x) => a + (+x.b.amount || 0), 0);

  let next = null;
  const idx = base.tiers.indexOf(base.tier);
  if (idx > -1 && idx + 1 < base.tiers.length) {
    const nt = base.tiers[idx + 1];
    next = {
      min: nt.min, rate: nt.rate,
      gap: nt.min - M.net,
      jump: plan.retro !== false ? nt.min * (nt.rate - base.tier.rate) / 100 : 0
    };
  }
  return {
    M, mode: 'tiers', base, bonuses, earnedSum, total: base.pay + earnedSum, next,
    rateLabel: base.tier.rate + '% tier' + (earnedSum ? ' + bonuses' : '')
  };
}

/* ============ rendering ============ */

function renderAll() {
  $('#month-picker').value = state.month;
  renderDashboard();
  renderDeals();
  renderPay();
  renderSettings();
  renderBackupNudge();
}

function statCard(label, value, sub, cls) {
  return `<div class="stat ${cls || ''}"><div class="l">${label}</div><div class="v">${value}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
}

function renderDashboard() {
  const m = state.month;
  const M = calcMonth(m);
  const P = calcPay(m);
  const el = $('#dash');

  if (!M.units && !M.cbCount) {
    el.innerHTML = `<div class="empty">No deals logged for ${monthLabel(m)} yet.<br><br>Tap the <b>+</b> button to log your first one — it takes about 15 seconds.</div>`;
    return;
  }

  // pace: only for the current real month
  let paceSub = '';
  if (m === todayStr().slice(0, 7)) {
    const now = new Date();
    const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const pace = M.net / now.getDate() * daysIn;
    paceSub = `pace: ${fmt$(pace)} net by month end`;
  }

  const typeSub = `${M.typeCount.finance || 0} fin · ${M.typeCount.lease || 0} lease · ${M.typeCount.cash || 0} cash`;
  const condSub = `${M.condCount.new || 0} new · ${M.condCount.used || 0} used`;

  // penetration of a product family by deal-count
  const penOf = re => {
    let c = 0;
    for (const [name, s] of Object.entries(M.prodStats)) if (re.test(name)) c += s.count;
    return { count: c, pen: M.units ? c / M.units * 100 : 0 };
  };
  const vscP = penOf(/vsc|esp|service\s*contract/i);
  const gapP = penOf(/gap/i);

  let html = `<div class="stats">
    ${statCard('Back Gross', fmt$(M.gross), paceSub, 'hero good')}
    ${statCard('Est. Pay MTD', fmt$(P.total), P.rateLabel, 'hero')}
    ${statCard('Units', M.units, typeSub)}
    ${statCard('PVR', fmt$(M.pvr), condSub)}
    ${statCard('Products/Deal', (Math.round(M.ppd * 100) / 100).toFixed(2), M.prodCount + ' products')}
    ${statCard('Reserve', fmt$(M.reserve))}
    ${statCard('VSC %', fmtPct(vscP.pen), `${vscP.count} of ${M.units}`, vscP.pen >= 55 ? 'good' : '')}
    ${statCard('GAP %', fmtPct(gapP.pen), `${gapP.count} of ${M.units}`)}
    ${statCard('Finance %', fmtPct(M.units ? (M.typeCount.finance || 0) / M.units * 100 : 0),
      `${fmtPct(M.units ? (M.typeCount.cash || 0) / M.units * 100 : 0)} cash` + (M.typeCount.lease ? ` · ${fmtPct((M.typeCount.lease || 0) / M.units * 100)} lease` : ''))}
    ${statCard('Net Gross', fmt$(M.net), `${fmt$(M.productGross)} prod + ${fmt$(M.reserve)} res`)}
  </div>`;

  // weight (products-counted-as) for a product name, from settings or deal lines
  const weightOf = name => {
    const sp = data.settings.products.find(p => p.name === name);
    if (sp && +sp.count > 0) return +sp.count;
    for (const d of data.deals) for (const p of (d.products || [])) if (p.name === name && +p.count > 0) return +p.count;
    return 1;
  };

  // product table — ×5 bundles collapse into one "Bundle Product" row
  const names = [...new Set([...data.settings.products.filter(p => p.active).map(p => p.name), ...Object.keys(M.prodStats)])];
  if (names.length && M.units) {
    const disp = {};
    for (const n of names) {
      const w = weightOf(n);
      const s = M.prodStats[n] || { count: 0, gross: 0 };
      const key = w > 1 ? 'Bundle Product' : n;
      const r = disp[key] || (disp[key] = { count: 0, gross: 0, weight: 1, bundle: w > 1 });
      r.count += s.count;
      r.gross += s.gross;
      if (w > 1) r.weight = w;
    }
    html += `<h2>Product Breakdown</h2><div class="scrollx"><table class="tbl"><tr>
      <th>Product</th><th class="num">Sold</th><th class="num">Pen %</th><th class="num">Avg $</th><th class="num">Gross</th></tr>`;
    for (const [name, r] of Object.entries(disp).sort((a, b) => b[1].gross - a[1].gross)) {
      const pen = r.count / M.units * 100;
      const avg = r.count ? r.gross / r.count : 0;
      const badge = r.bundle ? `<span class="cntbadge">×${r.weight}</span>` : '';
      html += `<tr><td>${esc(name)}${badge}<div class="bar"><i style="width:${Math.min(pen, 100)}%"></i></div></td>
        <td class="num">${r.count}</td><td class="num">${fmtPct(pen)}</td>
        <td class="num">${r.count ? fmt$(avg) : '—'}</td><td class="num">${fmt$(r.gross)}</td></tr>`;
    }
    html += `</table></div>`;
  }

  // new vs used split
  if (M.units) {
    html += `<h2>New vs Used</h2><table class="tbl"><tr>
      <th></th><th class="num">Units</th><th class="num">PVR</th><th class="num">Products/Deal</th></tr>`;
    for (const cond of ['new', 'used']) {
      const cs = M.condStats[cond];
      if (!cs || !cs.units) continue;
      html += `<tr><td>${cond[0].toUpperCase() + cond.slice(1)}</td><td class="num">${cs.units}</td>
        <td class="num">${fmt$(cs.gross / cs.units)}</td><td class="num">${(cs.prodCount / cs.units).toFixed(2)}</td></tr>`;
    }
    html += `</table>`;
  }

  // lender performance — deals, share, avg reserve, avg back gross per lender
  const lenders = Object.entries(M.lenderStats).sort((a, b) => (b[1].reserve + b[1].product) - (a[1].reserve + a[1].product));
  if (lenders.length) {
    const fin = lenders.reduce((a, [, s]) => a + s.count, 0);
    html += `<h2>Lender Performance</h2><div class="scrollx"><table class="tbl"><tr>
      <th>Lender</th><th class="num">Deals</th><th class="num">Share</th>
      <th class="num">Avg Reserve</th><th class="num">Avg Back</th></tr>`;
    for (const [name, s] of lenders) {
      const avgRes = s.count ? s.reserve / s.count : 0;
      const avgBack = s.count ? (s.reserve + s.product) / s.count : 0;
      html += `<tr><td>${esc(name)}</td><td class="num">${s.count}</td><td class="num">${fmtPct(s.count / fin * 100)}</td>
        <td class="num">${fmt$(avgRes)}</td><td class="num">${fmt$(avgBack)}</td></tr>`;
    }
    // weighted totals row
    const tRes = lenders.reduce((a, [, s]) => a + s.reserve, 0);
    const tProd = lenders.reduce((a, [, s]) => a + s.product, 0);
    html += `<tr class="totrow"><td><b>All financed</b></td><td class="num"><b>${fin}</b></td><td class="num">—</td>
      <td class="num"><b>${fmt$(fin ? tRes / fin : 0)}</b></td><td class="num"><b>${fmt$(fin ? (tRes + tProd) / fin : 0)}</b></td></tr>`;
    html += `</table></div>`;
  }

  // 6-month history
  const months = [];
  let [y, mo] = state.month.split('-').map(Number);
  for (let i = 0; i < 6; i++) {
    months.push(`${y}-${pad(mo)}`);
    mo--; if (mo === 0) { mo = 12; y--; }
  }
  const hist = months.map(mm => ({ mm, M: calcMonth(mm), P: calcPay(mm) })).filter(h => h.M.units || h.M.cbCount);
  if (hist.length > 1) {
    html += `<h2>History</h2><table class="tbl"><tr><th>Month</th><th class="num">Units</th><th class="num">PVR</th><th class="num">Net Gross</th><th class="num">Est. Pay</th></tr>`;
    for (const h of hist) {
      html += `<tr><td>${monthLabel(h.mm)}</td><td class="num">${h.M.units}</td><td class="num">${fmt$(h.M.pvr)}</td><td class="num">${fmt$(h.M.net)}</td><td class="num">${fmt$(h.P.total)}</td></tr>`;
    }
    html += `</table>`;
  }

  el.innerHTML = html;
}

function renderDeals() {
  const M = calcMonth(state.month);
  const list = $('#deals-list');

  if (!M.deals.length) {
    list.innerHTML = `<div class="empty">Nothing logged for ${monthLabel(state.month)}.</div>`;
  } else {
    list.innerHTML = M.deals
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .map(d => {
        const prods = (d.products || []).map(p => `<span class="badge prod">${esc(p.name)} ${fmt$(p.amt)}</span>`).join('');
        const res = +d.reserve ? `<span class="badge prod">Reserve ${fmt$(d.reserve)}</span>` : '';
        return `<div class="deal-card" data-id="${d.id}">
          <div class="deal-top">
            <span><span class="deal-num">#${esc(d.num) || '—'}</span> <span class="deal-date">${dateLabel(d.date)}</span></span>
            <span class="deal-total">${fmt$(dealTotal(d))}</span>
          </div>
          <div class="badges">
            <span class="badge">${d.type}</span><span class="badge">${d.cond}</span>
            ${d.vehicle ? `<span class="badge">${esc(d.vehicle)}</span>` : ''}
            ${d.lender && d.type !== 'cash' ? `<span class="badge">${esc(d.lender)}</span>` : ''}
            ${res}${prods}
          </div>
          ${d.note ? `<div class="deal-note">${esc(d.note)}</div>` : ''}
          <div class="deal-actions">
            <button class="btn sm" data-act="edit">Edit</button>
            <button class="btn sm danger" data-act="del">Delete</button>
          </div>
        </div>`;
      }).join('');
  }

  const cbl = $('#cbs-list');
  if (!M.cbs.length) {
    cbl.innerHTML = `<div class="empty">No chargebacks this month. Keep it that way.</div>`;
  } else {
    cbl.innerHTML = M.cbs
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(c => `<div class="deal-card cb-card" data-cbid="${c.id}">
        <div class="deal-top">
          <span><span class="deal-num">#${esc(c.num) || '—'}</span> <span class="deal-date">${dateLabel(c.date)}</span> · ${esc(c.product)}</span>
          <span class="cb-amt">-${fmt$(c.amt)}</span>
        </div>
        ${c.note ? `<div class="deal-note">${esc(c.note)}</div>` : ''}
        <div class="deal-actions">
          <button class="btn sm danger" data-act="delcb">Delete</button>
        </div>
      </div>`).join('');
  }
}

function modeSelectRow(mode) {
  return `<div class="edit-row"><span class="hint-inline">Plan type</span>
    <select data-mx="mode">
      <option value="matrix" ${mode !== 'tiers' ? 'selected' : ''}>PVR × PPD matrix</option>
      <option value="tiers" ${mode === 'tiers' ? 'selected' : ''}>Simple gross tiers</option>
    </select></div>`;
}

function renderPay() {
  const P = calcPay(state.month);
  const plan = data.settings.payPlan;
  if (P.mode === 'matrix') renderPayMatrix(P, plan);
  else renderPayTiers(P, plan);
}

function renderPayMatrix(P, plan) {
  const mx = plan.matrix;
  const mb = plan.matrixBonus || {};

  const holdNote = P.holdPct ? ` (after ${P.holdPct}% hold)` : '';
  $('#pay-breakdown').innerHTML = `
    <div class="pay-line"><span>Product gross ${fmt$(P.M.productGross)} → commissionable${holdNote}</span><b>${fmt$(P.prodNet)}</b></div>
    <div class="pay-line"><span>Products @ ${P.prodRate}%${P.bonusEarned ? ` (incl. +${mb.extra ?? 2}% bonus)` : ''}</span><b>${fmt$(P.productPay)}</b></div>
    <div class="pay-line"><span>Reserve ${fmt$(P.M.reserve)}${holdNote} @ ${P.reserveRate}% flat</span><b>${fmt$(P.reservePay)}</b></div>
    <div class="pay-line total"><span>Estimated pay MTD</span><b>${fmt$(P.total)}</b></div>`;

  // targets
  let t = '';
  if (P.M.units) {
    t += `<div class="target done">Current cell: <b>${P.rate}%</b> — PVR <b>${fmt$(P.pvr)}</b>, PPD <b>${P.M.ppd.toFixed(2)}</b>, VSC <b>${fmtPct(P.vsc.pen)}</b>.</div>`;
    if (P.ci < mx.cols.length - 1) {
      const gap = mx.cols[P.ci + 1] - P.pvr;
      t += `<div class="target">Next PVR column (<b>+1%</b> on all product gross): lift PVR by <b>${fmt$(gap)}</b> — ≈ <b>${fmt$(gap * P.M.units)}</b> more back gross at ${P.M.units} units. Worth ≈ <b>+${fmt$(P.prodNet * 0.01)}</b> right now.</div>`;
    }
    if (P.ri < mx.rows.length - 1) {
      const need = Math.max(1, Math.ceil(mx.rows[P.ri + 1] * P.M.units - P.M.prodCount));
      t += `<div class="target">Next PPD row (<b>+1%</b>): <b>${need}</b> more product${need > 1 ? 's' : ''} across your existing units. Worth ≈ <b>+${fmt$(P.prodNet * 0.01)}</b>.</div>`;
    }
    if (P.bonusEarned) {
      t += `<div class="target done">✓ +${mb.extra ?? 2}% product bonus earned (top cell + VSC ≥ ${mb.vscPen ?? 55}%)</div>`;
    } else {
      const bits = [];
      const topPpd = mx.rows[mx.rows.length - 1], topPvr = mx.cols[mx.cols.length - 1];
      if (P.ri < mx.rows.length - 1) bits.push(`PPD ${P.M.ppd.toFixed(2)} → ${topPpd}`);
      if (P.ci < mx.cols.length - 1) bits.push(`PVR ${fmt$(P.pvr)} → ${fmt$(topPvr)}`);
      const tp = (mb.vscPen ?? 55) / 100;
      if (P.vsc.pen < (mb.vscPen ?? 55) && tp < 1) {
        const k = Math.max(1, Math.ceil((tp * P.M.units - P.vsc.count) / (1 - tp)));
        bits.push(`VSC ${fmtPct(P.vsc.pen)} → ${mb.vscPen ?? 55}% (sell it on the next ${k} straight)`);
      }
      t += `<div class="target"><b>+${mb.extra ?? 2}% bonus (needs the ${(mx.rates[mx.rates.length - 1] || []).slice(-1)[0] ?? ''}% corner cell)</b>: ${bits.join(' · ') || 'almost there'} — worth ≈ <b>+${fmt$(P.prodNet * (mb.extra ?? 2) / 100)}</b> on the month.</div>`;
    }
  } else {
    t = `<div class="empty">Log deals and this becomes your target board: which cell you're in, and exactly what moves you up a percent.</div>`;
  }
  $('#pay-targets').innerHTML = t;

  // editor: thresholds + rate grid (current cell highlighted)
  let grid = `<div class="scrollx"><table class="tbl mx"><tr><th>PPD \\ PVR</th>`;
  mx.cols.forEach((c, j) => {
    grid += `<th class="num">$<input class="mxin" data-mx="col" data-j="${j}" type="number" value="${c}" ${j === 0 ? 'disabled' : ''}></th>`;
  });
  grid += `</tr>`;
  mx.rows.forEach((r, i) => {
    grid += `<tr><td><input class="mxin" data-mx="row" data-i="${i}" type="number" step="0.01" value="${r}" ${i === 0 ? 'disabled' : ''}></td>`;
    mx.cols.forEach((c, j) => {
      const cur = i === P.ri && j === P.ci && P.M.units;
      grid += `<td class="num ${cur ? 'cur' : ''}"><input class="mxin" data-mx="rate" data-i="${i}" data-j="${j}" type="number" step="0.5" value="${(mx.rates[i] || [])[j] ?? 0}">%</td>`;
    });
    grid += `</tr>`;
  });
  grid += `</table></div>`;

  $('#plan-editor').innerHTML = `
    ${modeSelectRow(plan.mode)}
    <div class="edit-row"><span class="hint-inline">Chargeback hold</span>
      <input class="amt" type="number" data-mx="holdbackPct" value="${plan.holdbackPct ?? 0}" step="0.5">
      <span class="hint-inline">% off the top of product + reserve</span></div>
    <div class="edit-row"><span class="hint-inline">Reserve pays</span>
      <input class="amt" type="number" data-mx="reserveRate" value="${plan.reserveRate ?? 10}" step="0.5">
      <span class="hint-inline">% flat &nbsp;·&nbsp; PVR basis</span>
      <select data-mx="pvrBasis">
        <option value="total" ${mx.pvrBasis !== 'products' ? 'selected' : ''}>Products + reserve</option>
        <option value="products" ${mx.pvrBasis === 'products' ? 'selected' : ''}>Products only</option>
      </select></div>
    ${grid}
    <p class="hint">Column headers = PVR breakpoints, row headers = products-per-deal breakpoints. Your current cell is highlighted.</p>
    <div class="edit-row"><span class="hint-inline">Bonus: +</span>
      <input class="amt" type="number" data-mx="bex" value="${mb.extra ?? 2}" step="0.5">
      <span class="hint-inline">% on products when in the top-right cell and VSC ≥</span>
      <input class="amt" type="number" data-mx="bvsc" value="${mb.vscPen ?? 55}">
      <span class="hint-inline">%</span></div>`;
}

function renderPayTiers(P, plan) {
  // breakdown
  let html = `
    <div class="pay-line"><span>Net back gross (${P.M.units} units)</span><b>${fmt$(P.M.net)}</b></div>
    <div class="pay-line"><span>Commission @ ${P.base.tier.rate}%${plan.retro !== false ? ' (retro)' : ' (marginal)'}</span><b>${fmt$(P.base.pay)}</b></div>`;
  for (const x of P.bonuses.filter(x => x.earned)) {
    html += `<div class="pay-line"><span>✓ ${esc(x.b.name || 'Bonus')}</span><b>${fmt$(x.b.amount)}</b></div>`;
  }
  html += `<div class="pay-line total"><span>Estimated pay MTD</span><b>${fmt$(P.total)}</b></div>`;
  $('#pay-breakdown').innerHTML = html;

  // targets
  let t = '';
  if (P.next) {
    const dealsNeeded = P.M.pvr > 0 ? Math.ceil(P.next.gap / P.M.pvr) : null;
    t += `<div class="target">Next tier: <b>${P.next.rate}%</b> at <b>${fmt$(P.next.min)}</b> net gross — <b>${fmt$(P.next.gap)}</b> to go${dealsNeeded ? ` (≈ ${dealsNeeded} deal${dealsNeeded > 1 ? 's' : ''} at your ${fmt$(P.M.pvr)} PVR)` : ''}.${P.next.jump > 0 ? ` Crossing it is worth <b>+${fmt$(P.next.jump)}</b> instantly.` : ''}</div>`;
  } else if (P.base.tiers.length > 1) {
    t += `<div class="target done">✓ Top tier (${P.base.tier.rate}%) — locked in.</div>`;
  }
  for (const x of P.bonuses) {
    if (x.earned) {
      t += `<div class="target done">✓ ${esc(x.b.name || 'Bonus')} earned (+${fmt$(x.b.amount)})</div>`;
    } else {
      t += `<div class="target"><b>${esc(x.b.name || 'Bonus')}</b> (+${fmt$(x.b.amount)}): ${esc(x.gapText)}</div>`;
    }
  }
  if (!t) t = `<div class="empty">Add tiers and bonuses to your pay plan below and this turns into your target board.</div>`;
  $('#pay-targets').innerHTML = t;

  // plan editor
  const tiers = plan.tiers.map((x, i) => `
    <div class="edit-row">
      <span class="hint-inline">from $</span>
      <input class="amt" type="number" inputmode="numeric" value="${+x.min || 0}" data-plan="tier" data-i="${i}" data-f="min">
      <span class="hint-inline">net gross →</span>
      <input class="amt" type="number" inputmode="decimal" step="0.5" value="${+x.rate || 0}" data-plan="tier" data-i="${i}" data-f="rate">
      <span class="hint-inline">%</span>
      <button class="del" data-plan="deltier" data-i="${i}" title="Remove tier">✕</button>
    </div>`).join('');

  const prodOpts = data.settings.products.map(p => `<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  const bonuses = (plan.bonuses || []).map((b, i) => `
    <div class="edit-row">
      <input type="text" placeholder="Bonus name" value="${esc(b.name || '')}" data-plan="bonus" data-i="${i}" data-f="name">
      <select data-plan="bonus" data-i="${i}" data-f="metric">
        ${Object.entries(BONUS_METRICS).map(([k, v]) => `<option value="${k}" ${b.metric === k ? 'selected' : ''}>${v.label}</option>`).join('')}
      </select>
      ${b.metric === 'pen' ? `<select data-plan="bonus" data-i="${i}" data-f="product">${prodOpts.replace(`value="${esc(b.product)}"`, `value="${esc(b.product)}" selected`)}</select>` : ''}
      <span class="hint-inline">≥</span>
      <input class="amt" type="number" inputmode="decimal" placeholder="target" value="${+b.threshold || 0}" data-plan="bonus" data-i="${i}" data-f="threshold">
      <span class="hint-inline">pays $</span>
      <input class="amt" type="number" inputmode="numeric" placeholder="$" value="${+b.amount || 0}" data-plan="bonus" data-i="${i}" data-f="amount">
      <button class="del" data-plan="delbonus" data-i="${i}" title="Remove bonus">✕</button>
    </div>`).join('');

  $('#plan-editor').innerHTML = `
    ${modeSelectRow(plan.mode)}
    ${tiers}
    <div class="btn-row"><button class="btn sm" data-plan="addtier">+ Add Tier</button></div>
    <label class="check-row"><input type="checkbox" id="plan-retro" ${plan.retro !== false ? 'checked' : ''}> Tiers are retroactive to dollar one (most F&amp;I plans are)</label>
    <h2>Bonuses</h2>
    ${bonuses || '<p class="hint">No bonuses yet — add penetration, unit, PVR, or PPD bonuses from your plan.</p>'}
    <div class="btn-row"><button class="btn sm" data-plan="addbonus">+ Add Bonus</button></div>`;
}

function renderSettings() {
  const prods = data.settings.products.map((p, i) => `
    <div class="edit-row">
      <input type="text" value="${esc(p.name)}" data-set="prod" data-i="${i}" data-f="name">
      <span class="hint-inline">default $</span>
      <input class="amt" type="number" inputmode="numeric" value="${+p.amt || 0}" data-set="prod" data-i="${i}" data-f="amt">
      <span class="hint-inline">counts as</span>
      <input class="amt" style="max-width:60px" type="number" inputmode="numeric" value="${+p.count || 1}" data-set="prod" data-i="${i}" data-f="count" title="products toward PPD">
      <label class="check-row" style="margin:0"><input type="checkbox" ${p.active ? 'checked' : ''} data-set="prod" data-i="${i}" data-f="active"> show</label>
      <button class="del" data-set="delprod" data-i="${i}" title="Remove">✕</button>
    </div>`).join('');
  $('#settings-products').innerHTML = prods + `<div class="btn-row"><button class="btn sm" data-set="addprod">+ Add Product</button></div>`;

  $('#settings-lenders').innerHTML = `
    <div class="chiplist">${data.settings.lenders.map((l, i) => `<span class="chip">${esc(l)}<button data-set="dellender" data-i="${i}">✕</button></span>`).join('')}</div>
    <div class="edit-row"><input type="text" id="new-lender" placeholder="Add a lender"><button class="btn sm" data-set="addlender">Add</button></div>`;

  const lb = data.settings.lastBackup;
  $('#backup-status').textContent = lb
    ? `Last backup: ${new Date(lb).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${data.deals.length} deals, ${data.chargebacks.length} chargebacks on file`
    : `No backup taken yet · ${data.deals.length} deals on file`;
  $('#auto-backup').checked = data.settings.autoBackup !== false;

  $('#product-names').innerHTML = data.settings.products.map(p => `<option value="${esc(p.name)}">`).join('');

  const ls = data.settings.lastInvSync;
  $('#inv-status').textContent = data.inventory.length
    ? `${data.inventory.length} vehicles on file` + (ls ? ` · last synced ${new Date(ls).toLocaleString('en-US', { month: 'short', day: 'numeric' })}` : '')
    : 'No inventory loaded yet — stock # autocomplete turns on after your first import.';
  $('#bookmarklet').setAttribute('href', BOOKMARKLET);
}

function renderBackupNudge() {
  const el = $('#backup-nudge');
  const lb = data.settings.lastBackup;
  const stale = !lb || (Date.now() - lb) > 14 * 24 * 3600 * 1000;
  el.innerHTML = (data.deals.length >= 5 && stale)
    ? `<div class="nudge">⚠️ Your data lives only in this browser. It's been a while since your last backup — hit <b>Settings → Export Backup</b> so a cleared cache can't wipe your month.</div>`
    : '';
}

/* ============ deal modal ============ */

let editingDealId = null;

function segVal(sel) { return $(sel).querySelector('.active')?.dataset.val; }
function setSeg(sel, val) {
  $$(sel + ' button').forEach(b => b.classList.toggle('active', b.dataset.val === val));
}

function openDealModal(deal) {
  editingDealId = deal ? deal.id : null;
  $('#deal-modal-title').textContent = deal ? 'Edit Deal' : 'Log Deal';
  $('#f-date').value = deal ? deal.date : todayStr();
  $('#f-num').value = deal ? deal.num : '';
  $('#f-vin').value = deal ? (deal.vin || '') : '';
  showVehicle(deal?.vehicle || '');
  $('#f-note').value = deal ? (deal.note || '') : '';
  $('#f-reserve').value = deal && +deal.reserve ? +deal.reserve : '';

  $('#stock-list').innerHTML = data.inventory
    .filter(v => v.stock || v.vin)
    .map(v => `<option value="${esc(v.stock || v.vin.slice(-8))}">${esc(v.name || [v.year, v.cond].filter(Boolean).join(' ') || v.vin)}</option>`)
    .join('');
  setSeg('#f-type', deal ? deal.type : 'finance');
  setSeg('#f-cond', deal ? deal.cond : 'new');

  const sel = $('#f-lender');
  sel.innerHTML = data.settings.lenders.map(l => `<option ${deal && deal.lender === l ? 'selected' : ''}>${esc(l)}</option>`).join('');
  if (deal && deal.lender && !data.settings.lenders.includes(deal.lender)) {
    sel.insertAdjacentHTML('beforeend', `<option selected>${esc(deal.lender)}</option>`);
  }

  // product rows: active settings products + anything already on the deal
  const rows = data.settings.products.filter(p => p.active).map(p => ({ name: p.name, def: p.amt, count: +p.count || 1 }));
  for (const p of (deal?.products || [])) {
    if (!rows.some(r => r.name === p.name)) rows.push({ name: p.name, def: p.amt, count: prodWeight(p) });
  }
  $('#f-products').innerHTML = rows.map(r => {
    const on = deal?.products?.find(p => p.name === r.name);
    const cnt = r.count > 1 ? `<span class="cntbadge">×${r.count}</span>` : '';
    return `<div class="prod-row ${on ? 'on' : ''}" data-name="${esc(r.name)}" data-def="${r.def}" data-count="${r.count}">
      <span class="tick">✓</span><span class="name">${esc(r.name)}${cnt}</span>
      <input type="number" inputmode="numeric" value="${on ? +on.amt : ''}" placeholder="${r.def}" onclick="event.stopPropagation()">
    </div>`;
  }).join('');

  updateLenderVis();
  updateDealTotal();
  $('#deal-modal').hidden = false;
  if (!deal) setTimeout(() => $('#f-num').focus(), 50);
}

function updateLenderVis() {
  $('#f-lender-row').style.display = segVal('#f-type') === 'cash' ? 'none' : '';
}

function updateDealTotal() {
  let t = segVal('#f-type') === 'cash' ? 0 : (+$('#f-reserve').value || 0);
  $$('#f-products .prod-row.on').forEach(r => {
    t += +(r.querySelector('input').value || r.dataset.def) || 0;
  });
  $('#f-total').textContent = 'Back gross: ' + fmt$(t);
}

function saveDeal() {
  const type = segVal('#f-type');
  const products = $$('#f-products .prod-row.on').map(r => ({
    name: r.dataset.name,
    amt: +(r.querySelector('input').value || r.dataset.def) || 0,
    count: +r.dataset.count || 1
  }));
  const deal = {
    id: editingDealId || uid(),
    date: $('#f-date').value || todayStr(),
    num: $('#f-num').value.trim(),
    type,
    cond: segVal('#f-cond'),
    lender: type === 'cash' ? '' : $('#f-lender').value,
    reserve: type === 'cash' ? 0 : (+$('#f-reserve').value || 0),
    products,
    vin: $('#f-vin').value.trim().toUpperCase(),
    vehicle: $('#f-vehicle').dataset.v || '',
    note: $('#f-note').value.trim()
  };
  if (editingDealId) {
    const i = data.deals.findIndex(d => d.id === editingDealId);
    if (i > -1) data.deals[i] = deal;
  } else {
    data.deals.push(deal);
  }
  maybeAutoBackup();
  $('#deal-modal').hidden = true;
  state.month = deal.date.slice(0, 7);
  renderAll();
}

/* ============ chargeback modal ============ */

function openCBModal(prefillNum) {
  $('#c-date').value = todayStr();
  $('#c-num').value = prefillNum || '';
  $('#c-prod').value = '';
  $('#c-amt').value = '';
  $('#c-note').value = '';
  $('#cb-modal').hidden = false;
}

function saveCB() {
  const amt = +$('#c-amt').value || 0;
  if (!amt) { alert('Enter the chargeback amount.'); return; }
  data.chargebacks.push({
    id: uid(),
    date: $('#c-date').value || todayStr(),
    num: $('#c-num').value.trim(),
    product: $('#c-prod').value.trim() || 'Product',
    amt,
    note: $('#c-note').value.trim()
  });
  maybeAutoBackup();
  $('#cb-modal').hidden = true;
  state.month = ($('#c-date').value || todayStr()).slice(0, 7);
  renderAll();
}

/* ============ backup / export ============ */

function download(filename, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON() {
  data.settings.lastBackup = Date.now();
  data.settings.lastAutoBackup = Date.now();
  data.settings.opsSinceBackup = 0;
  save();
  download(`fi-scoreboard${PROFILE ? '-' + PROFILE : ''}-backup-${todayStr()}.json`, JSON.stringify(data, null, 2));
  renderAll();
}

// Auto-backup: silently download a snapshot during a save (a user gesture, so the
// browser allows the download) once 3 ops have piled up or it's a new day.
function maybeAutoBackup() {
  const s = data.settings;
  if (!s.autoBackup) { save(); return; }
  s.opsSinceBackup = (s.opsSinceBackup || 0) + 1;
  const last = s.lastAutoBackup ? new Date(s.lastAutoBackup) : null;
  const newDay = !last || last.toDateString() !== new Date().toDateString();
  if (s.opsSinceBackup >= 3 || newDay) {
    s.lastAutoBackup = Date.now();
    s.lastBackup = Date.now();
    s.opsSinceBackup = 0;
    save();
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    download(`fi-scoreboard${PROFILE ? '-' + PROFILE : ''}-auto-${stamp}.json`, JSON.stringify(data, null, 2));
    toast('Backup saved to your Downloads');
  } else {
    save();
  }
}

let toastTimer = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

function importJSON(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.deals) || !d.settings) throw new Error('bad shape');
      if (!confirm(`Import ${d.deals.length} deals and replace everything currently on this device?`)) return;
      data = {
        settings: { ...structuredClone(DEFAULT_DATA.settings), ...d.settings },
        deals: d.deals,
        chargebacks: Array.isArray(d.chargebacks) ? d.chargebacks : [],
        inventory: Array.isArray(d.inventory) ? d.inventory : []
      };
      save();
      renderAll();
      alert('Backup imported.');
    } catch {
      alert("That file doesn't look like an F&I Scoreboard backup.");
    }
  };
  reader.readAsText(file);
}

function exportCSV() {
  const head = ['Date', 'Deal #', 'VIN', 'Vehicle', 'Type', 'New/Used', 'Lender', 'Reserve', 'Products', 'Product Gross', 'Total Back Gross', 'Note'];
  const q = s => `"${String(s ?? '').replace(/"/g, '""')}"`;
  const rows = data.deals
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(d => [
      d.date, d.num, d.vin || '', d.vehicle || '', d.type, d.cond, d.lender, +d.reserve || 0,
      (d.products || []).map(p => `${p.name}: ${+p.amt || 0}`).join('; '),
      (d.products || []).reduce((a, p) => a + (+p.amt || 0), 0),
      dealTotal(d), d.note
    ].map(q).join(','));
  download(`fi-deals-${todayStr()}.csv`, [head.map(q).join(','), ...rows].join('\n'), 'text/csv');
}

/* ============ events ============ */

// tabs
$$('.tab').forEach(b => b.addEventListener('click', () => {
  $$('.tab').forEach(x => x.classList.toggle('active', x === b));
  $$('.view').forEach(v => v.classList.toggle('active', v.id === 'view-' + b.dataset.view));
}));

// month picker
$('#month-picker').addEventListener('change', e => {
  if (e.target.value) { state.month = e.target.value; renderAll(); }
});

// new deal buttons
$('#fab-new-deal').addEventListener('click', () => openDealModal());
$('#btn-new-deal').addEventListener('click', () => openDealModal());
$('#btn-new-cb').addEventListener('click', () => openCBModal());

// deal modal internals
$$('#f-type button, #f-cond button').forEach(b => b.addEventListener('click', () => {
  setSeg('#' + b.parentElement.id, b.dataset.val);
  updateLenderVis();
  updateDealTotal();
}));
$('#f-products').addEventListener('click', e => {
  const row = e.target.closest('.prod-row');
  if (!row || e.target.tagName === 'INPUT') return;
  row.classList.toggle('on');
  if (row.classList.contains('on')) {
    const inp = row.querySelector('input');
    if (!inp.value) inp.value = row.dataset.def;
  }
  updateDealTotal();
});
$('#f-products').addEventListener('input', updateDealTotal);
$('#f-reserve').addEventListener('input', updateDealTotal);
$('#deal-save').addEventListener('click', saveDeal);
$('#deal-cancel').addEventListener('click', () => { $('#deal-modal').hidden = true; });
$('#cb-save').addEventListener('click', saveCB);
$('#cb-cancel').addEventListener('click', () => { $('#cb-modal').hidden = true; });
$$('.modal-wrap').forEach(w => w.addEventListener('click', e => {
  if (e.target === w) w.hidden = true;
}));

// stock # picked/typed → fill VIN, new/used, vehicle from inventory
$('#f-num').addEventListener('change', () => {
  const hit = invLookup($('#f-num').value);
  if (!hit) return;
  if (hit.cond) setSeg('#f-cond', hit.cond);
  if (hit.name) showVehicle(hit.name);
  if (hit.vin && $('#f-vin').value.trim().toUpperCase() !== hit.vin) {
    $('#f-vin').value = hit.vin;
    $('#f-vin').dispatchEvent(new Event('input'));
  }
});

// VIN typed/scanned → match inventory + decode via NHTSA
$('#f-vin').addEventListener('input', async () => {
  const vin = $('#f-vin').value.trim().toUpperCase();
  if (!VIN_RE.test(vin)) { if (!vin) showVehicle(''); return; }
  const hit = data.inventory.find(v => v.vin === vin);
  if (hit) {
    if (hit.cond) setSeg('#f-cond', hit.cond);
    if (hit.stock && !$('#f-num').value.trim()) $('#f-num').value = hit.stock;
  }
  showVehicle('Decoding VIN…', hit?.name || '');
  const id = ++vinReqId;
  try {
    const s = await decodeVIN(vin);
    if (id === vinReqId) showVehicle(s || hit?.name || '');
  } catch {
    if (id === vinReqId) showVehicle(hit?.name || '');
  }
});

// inventory import
$('#btn-inv-import').addEventListener('click', () => {
  if (importInventory($('#inv-paste').value)) $('#inv-paste').value = '';
});
$('#btn-inv-clear').addEventListener('click', () => {
  if (data.inventory.length && confirm(`Remove all ${data.inventory.length} vehicles from autocomplete? (Your deals are not affected.)`)) {
    data.inventory = [];
    save(); renderSettings();
  }
});

// deal list actions
$('#deals-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.deal-card').dataset.id;
  const deal = data.deals.find(d => d.id === id);
  if (!deal) return;
  if (btn.dataset.act === 'edit') openDealModal(deal);
  if (btn.dataset.act === 'del' && confirm(`Delete deal #${deal.num || '—'}? This can't be undone.`)) {
    data.deals = data.deals.filter(d => d.id !== id);
    save(); renderAll();
  }
});
$('#cbs-list').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act="delcb"]');
  if (!btn) return;
  const id = btn.closest('.deal-card').dataset.cbid;
  if (confirm('Delete this chargeback?')) {
    data.chargebacks = data.chargebacks.filter(c => c.id !== id);
    save(); renderAll();
  }
});

// pay plan editor (delegated)
$('#view-pay').addEventListener('click', e => {
  const el = e.target.closest('[data-plan]');
  if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
  const plan = data.settings.payPlan;
  const i = +el.dataset.i;
  if (el.dataset.plan === 'addtier') plan.tiers.push({ min: 0, rate: 0 });
  if (el.dataset.plan === 'deltier') { if (plan.tiers.length > 1) plan.tiers.splice(i, 1); else alert('Keep at least one tier.'); }
  if (el.dataset.plan === 'addbonus') plan.bonuses.push({ id: uid(), name: '', metric: 'pen', product: data.settings.products[0]?.name || '', threshold: 0, amount: 0 });
  if (el.dataset.plan === 'delbonus') plan.bonuses.splice(i, 1);
  save(); renderPay(); renderDashboard();
});
$('#view-pay').addEventListener('change', e => {
  const el = e.target;
  const plan = data.settings.payPlan;
  const mxk = el.dataset.mx;
  if (mxk) {
    const mx = plan.matrix;
    if (mxk === 'mode') plan.mode = el.value;
    else if (mxk === 'reserveRate') plan.reserveRate = +el.value || 0;
    else if (mxk === 'holdbackPct') plan.holdbackPct = +el.value || 0;
    else if (mxk === 'pvrBasis') mx.pvrBasis = el.value;
    else if (mxk === 'col') mx.cols[+el.dataset.j] = +el.value || 0;
    else if (mxk === 'row') mx.rows[+el.dataset.i] = +el.value || 0;
    else if (mxk === 'rate') mx.rates[+el.dataset.i][+el.dataset.j] = +el.value || 0;
    else if (mxk === 'bex') (plan.matrixBonus ??= {}).extra = +el.value || 0;
    else if (mxk === 'bvsc') (plan.matrixBonus ??= {}).vscPen = +el.value || 0;
    save(); renderPay(); renderDashboard();
    return;
  }
  if (el.id === 'plan-retro') { plan.retro = el.checked; }
  else if (el.dataset.plan === 'tier') { plan.tiers[+el.dataset.i][el.dataset.f] = +el.value || 0; }
  else if (el.dataset.plan === 'bonus') {
    const b = plan.bonuses[+el.dataset.i];
    if (el.dataset.f === 'name' || el.dataset.f === 'metric' || el.dataset.f === 'product') b[el.dataset.f] = el.value;
    else b[el.dataset.f] = +el.value || 0;
    if (el.dataset.f === 'metric' && el.value === 'pen' && !b.product) b.product = data.settings.products[0]?.name || '';
  } else return;
  save(); renderPay(); renderDashboard();
});

// settings (delegated)
$('#view-settings').addEventListener('click', e => {
  const el = e.target.closest('[data-set]');
  if (!el || el.tagName === 'INPUT') return;
  const s = data.settings;
  const i = +el.dataset.i;
  if (el.dataset.set === 'addprod') s.products.push({ name: 'New Product', amt: 0, active: true, count: 1 });
  else if (el.dataset.set === 'delprod' && confirm('Remove this product? Past deals keep it; it just leaves the quick-entry list.')) s.products.splice(i, 1);
  else if (el.dataset.set === 'dellender') s.lenders.splice(i, 1);
  else if (el.dataset.set === 'addlender') {
    const v = $('#new-lender').value.trim();
    if (v && !s.lenders.includes(v)) s.lenders.push(v);
  } else return;
  save(); renderSettings(); renderPay();
});
$('#view-settings').addEventListener('change', e => {
  const el = e.target;
  if (el.dataset.set !== 'prod') return;
  const p = data.settings.products[+el.dataset.i];
  if (el.dataset.f === 'name') p.name = el.value.trim() || p.name;
  if (el.dataset.f === 'amt') p.amt = +el.value || 0;
  if (el.dataset.f === 'count') p.count = Math.max(1, +el.value || 1);
  if (el.dataset.f === 'active') p.active = el.checked;
  save(); renderSettings(); renderDashboard(); renderPay();
});

// backup buttons
$('#btn-export-json').addEventListener('click', exportJSON);
$('#auto-backup').addEventListener('change', e => {
  data.settings.autoBackup = e.target.checked;
  save();
  if (e.target.checked) toast('Auto-backup on — saves as you log deals');
});
$('#btn-export-csv').addEventListener('click', exportCSV);
$('#btn-import-json').addEventListener('click', () => $('#import-file').click());
$('#import-file').addEventListener('change', e => {
  if (e.target.files[0]) importJSON(e.target.files[0]);
  e.target.value = '';
});
$('#btn-clear').addEventListener('click', () => {
  if (confirm('Erase ALL deals, chargebacks, and settings on this device?') && confirm('Last chance — this cannot be undone. Erase everything?')) {
    data = structuredClone(DEFAULT_DATA);
    save(); renderAll();
  }
});

// team view (read-only look at a teammate's backup file)
$('#btn-team-view').addEventListener('click', () => $('#team-file').click());
$('#team-file').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const d = JSON.parse(reader.result);
      if (!Array.isArray(d.deals) || !d.settings) throw new Error('bad shape');
      const label = file.name.replace(/^fi-scoreboard-?/, '').replace(/-(auto|backup).*$/, '') || 'teammate';
      enterTeamView(d, label);
    } catch {
      alert("That file doesn't look like an F&I Scoreboard backup.");
    }
  };
  reader.readAsText(file);
});
document.addEventListener('click', e => {
  if (e.target.id === 'exit-team') exitTeamView();
});

/* ============ boot ============ */
if (PROFILE) {
  const label = PROFILE.toUpperCase();
  document.title = `F&I Scoreboard — ${label}`;
  document.querySelector('.topbar h1').textContent = `F&I Scoreboard · ${label}`;
}
renderAll();
refreshInventoryFromRepo();
