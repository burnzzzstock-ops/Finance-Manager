'use strict';

/* ============ storage ============ */

const LS_KEY = 'fi-scoreboard-v1';

const DEFAULT_DATA = {
  settings: {
    products: [
      { name: 'VSC / ESP',       amt: 1000, active: true },
      { name: 'GAP',             amt: 600,  active: true },
      { name: 'Tire & Wheel',    amt: 450,  active: true },
      { name: 'Maintenance',     amt: 350,  active: true },
      { name: 'Appearance',      amt: 300,  active: true },
      { name: 'Key Replacement', amt: 250,  active: true }
    ],
    lenders: ['Ford Credit', 'Chase', 'Capital One', 'Ally', 'Wells Fargo', 'Credit Union', 'Other'],
    payPlan: {
      retro: true,
      tiers: [{ min: 0, rate: 12 }],
      bonuses: []
    },
    lastBackup: null,
    lastInvSync: null
  },
  deals: [],       // {id, date, num, type, cond, lender, reserve, products:[{name, amt}], vin, vehicle, note}
  chargebacks: [], // {id, date, num, product, amt, note}
  inventory: []    // {vin, stock, name, year, cond} — synced from the dealer site via bookmarklet
};

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return structuredClone(DEFAULT_DATA);
    const d = JSON.parse(raw);
    const base = structuredClone(DEFAULT_DATA);
    return {
      settings: { ...base.settings, ...(d.settings || {}), payPlan: { ...base.settings.payPlan, ...((d.settings || {}).payPlan || {}) } },
      deals: Array.isArray(d.deals) ? d.deals : [],
      chargebacks: Array.isArray(d.chargebacks) ? d.chargebacks : [],
      inventory: Array.isArray(d.inventory) ? d.inventory : []
    };
  } catch {
    return structuredClone(DEFAULT_DATA);
  }
}

let data = loadData();
const save = () => localStorage.setItem(LS_KEY, JSON.stringify(data));

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

function importInventory(text) {
  let arr = null;
  try {
    const d = JSON.parse(text.trim());
    arr = Array.isArray(d) ? d : (d.fiInv || d.inv || d.inventory || null);
  } catch { /* fall through */ }
  if (!arr || !arr.length) { alert('Could not read that — paste exactly what the bookmark copied.'); return false; }
  const byVin = new Map(data.inventory.map(v => [v.vin, v]));
  let added = 0, updated = 0;
  for (const r of arr) {
    const vin = String(r.vin || '').toUpperCase();
    if (!VIN_RE.test(vin)) continue;
    const item = {
      vin,
      stock: String(r.stock || '').trim(),
      name: String(r.name || '').trim(),
      year: String(r.year || '').slice(0, 4),
      cond: r.cond === 'used' ? 'used' : 'new'
    };
    if (byVin.has(vin)) { Object.assign(byVin.get(vin), item); updated++; }
    else { data.inventory.push(item); byVin.set(vin, item); added++; }
  }
  data.settings.lastInvSync = Date.now();
  save();
  renderSettings();
  alert(`Inventory updated: ${added} added, ${updated} refreshed. ${data.inventory.length} vehicles on file.`);
  return true;
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

/* ---- VIN barcode scanner (Chrome/Android; button hidden where unsupported) ---- */

let scanStream = null, scanTimer = null;

function vinFromCode(raw) {
  let s = String(raw).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (s.length === 18 && s[0] === 'I') s = s.slice(1); // Code 39 import-character prefix
  return VIN_RE.test(s) ? s : null;
}

async function startScan() {
  try {
    const det = new window.BarcodeDetector({ formats: ['code_39', 'code_128', 'qr_code', 'data_matrix'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#scan-video');
    v.srcObject = scanStream;
    await v.play();
    $('#scan-modal').hidden = false;
    scanTimer = setInterval(async () => {
      try {
        for (const c of await det.detect(v)) {
          const vin = vinFromCode(c.rawValue);
          if (vin) {
            stopScan();
            $('#f-vin').value = vin;
            $('#f-vin').dispatchEvent(new Event('input'));
            return;
          }
        }
      } catch { /* keep scanning */ }
    }, 350);
  } catch (e) {
    stopScan();
    alert('Camera not available: ' + (e.message || e));
  }
}

function stopScan() {
  clearInterval(scanTimer);
  scanTimer = null;
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
  $('#scan-modal').hidden = true;
}

/* ============ metrics ============ */

function calcMonth(m) {
  const deals = data.deals.filter(d => d.date.startsWith(m));
  const cbs = data.chargebacks.filter(c => c.date.startsWith(m));
  const units = deals.length;
  let productGross = 0, reserve = 0, prodCount = 0;
  const prodStats = {}, lenderMix = {}, typeCount = { finance: 0, lease: 0, cash: 0 }, condCount = { new: 0, used: 0 };

  for (const d of deals) {
    reserve += +d.reserve || 0;
    typeCount[d.type] = (typeCount[d.type] || 0) + 1;
    condCount[d.cond] = (condCount[d.cond] || 0) + 1;
    if (d.lender && d.type !== 'cash') lenderMix[d.lender] = (lenderMix[d.lender] || 0) + 1;
    for (const p of (d.products || [])) {
      productGross += +p.amt || 0;
      prodCount++;
      const s = prodStats[p.name] || (prodStats[p.name] = { count: 0, gross: 0 });
      s.count++;
      s.gross += +p.amt || 0;
    }
  }

  const gross = productGross + reserve;
  const cbAmt = cbs.reduce((a, c) => a + (+c.amt || 0), 0);
  return {
    deals, cbs, units, productGross, reserve, gross,
    cbAmt, cbCount: cbs.length, net: gross - cbAmt,
    pvr: units ? gross / units : 0,
    ppd: units ? prodCount / units : 0,
    prodCount, prodStats, lenderMix, typeCount, condCount
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

function calcPay(m) {
  const M = calcMonth(m);
  const base = basePay(M.net);
  const bonuses = (data.settings.payPlan.bonuses || []).map(b => ({ b, ...bonusStatus(b, M) }));
  const earnedSum = bonuses.filter(x => x.earned).reduce((a, x) => a + (+x.b.amount || 0), 0);

  let next = null;
  const idx = base.tiers.indexOf(base.tier);
  if (idx > -1 && idx + 1 < base.tiers.length) {
    const nt = base.tiers[idx + 1];
    next = {
      min: nt.min, rate: nt.rate,
      gap: nt.min - M.net,
      jump: data.settings.payPlan.retro !== false ? nt.min * (nt.rate - base.tier.rate) / 100 : 0
    };
  }
  return { M, base, bonuses, earnedSum, total: base.pay + earnedSum, next };
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

  let html = `<div class="stats">
    ${statCard('Back Gross', fmt$(M.gross), paceSub, 'hero good')}
    ${statCard('Est. Pay MTD', fmt$(P.total), P.base.tier.rate + '% tier' + (P.earnedSum ? ' + bonuses' : ''), 'hero')}
    ${statCard('Units', M.units, typeSub)}
    ${statCard('PVR', fmt$(M.pvr), condSub)}
    ${statCard('Products/Deal', (Math.round(M.ppd * 100) / 100).toFixed(2), M.prodCount + ' products')}
    ${statCard('Reserve', fmt$(M.reserve))}
    ${statCard('Chargebacks', M.cbAmt ? '-' + fmt$(M.cbAmt).replace('-', '') : '$0', M.cbCount + ' this month', M.cbAmt ? 'bad' : '')}
    ${statCard('Net Gross', fmt$(M.net), 'after chargebacks')}
  </div>`;

  // product penetration table
  const names = [...new Set([...data.settings.products.filter(p => p.active).map(p => p.name), ...Object.keys(M.prodStats)])];
  if (names.length && M.units) {
    html += `<h2>Product Penetration</h2><table class="tbl"><tr><th>Product</th><th class="num">Sold</th><th class="num">Pen %</th><th class="num">Gross</th></tr>`;
    for (const n of names.sort((a, b) => ((M.prodStats[b]?.gross) || 0) - ((M.prodStats[a]?.gross) || 0))) {
      const s = M.prodStats[n] || { count: 0, gross: 0 };
      const pen = s.count / M.units * 100;
      html += `<tr><td>${esc(n)}<div class="bar"><i style="width:${Math.min(pen, 100)}%"></i></div></td>
        <td class="num">${s.count}</td><td class="num">${fmtPct(pen)}</td><td class="num">${fmt$(s.gross)}</td></tr>`;
    }
    html += `</table>`;
  }

  // lender mix
  const lenders = Object.entries(M.lenderMix).sort((a, b) => b[1] - a[1]);
  if (lenders.length) {
    html += `<h2>Lender Mix</h2><table class="tbl"><tr><th>Lender</th><th class="num">Deals</th><th class="num">Share</th></tr>`;
    const fin = lenders.reduce((a, x) => a + x[1], 0);
    for (const [name, count] of lenders) {
      html += `<tr><td>${esc(name)}</td><td class="num">${count}</td><td class="num">${fmtPct(count / fin * 100)}</td></tr>`;
    }
    html += `</table>`;
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
            <button class="btn sm" data-act="cb">Chargeback</button>
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

function renderPay() {
  const P = calcPay(state.month);
  const plan = data.settings.payPlan;

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
    .map(v => `<option value="${esc(v.stock || v.vin.slice(-8))}">${esc(v.name || (v.year + ' ' + v.cond))}</option>`)
    .join('');
  setSeg('#f-type', deal ? deal.type : 'finance');
  setSeg('#f-cond', deal ? deal.cond : 'new');

  const sel = $('#f-lender');
  sel.innerHTML = data.settings.lenders.map(l => `<option ${deal && deal.lender === l ? 'selected' : ''}>${esc(l)}</option>`).join('');
  if (deal && deal.lender && !data.settings.lenders.includes(deal.lender)) {
    sel.insertAdjacentHTML('beforeend', `<option selected>${esc(deal.lender)}</option>`);
  }

  // product rows: active settings products + anything already on the deal
  const rows = data.settings.products.filter(p => p.active).map(p => ({ name: p.name, def: p.amt }));
  for (const p of (deal?.products || [])) {
    if (!rows.some(r => r.name === p.name)) rows.push({ name: p.name, def: p.amt });
  }
  $('#f-products').innerHTML = rows.map(r => {
    const on = deal?.products?.find(p => p.name === r.name);
    return `<div class="prod-row ${on ? 'on' : ''}" data-name="${esc(r.name)}" data-def="${r.def}">
      <span class="tick">✓</span><span class="name">${esc(r.name)}</span>
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
    amt: +(r.querySelector('input').value || r.dataset.def) || 0
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
  save();
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
  save();
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
  save();
  download(`fi-scoreboard-backup-${todayStr()}.json`, JSON.stringify(data, null, 2));
  renderAll();
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
  if (e.target === w) { if (w.id === 'scan-modal') stopScan(); else w.hidden = true; }
}));

// stock # picked/typed → fill VIN, new/used, vehicle from inventory
$('#f-num').addEventListener('change', () => {
  const hit = invLookup($('#f-num').value);
  if (!hit) return;
  setSeg('#f-cond', hit.cond);
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
    setSeg('#f-cond', hit.cond);
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

// VIN barcode scanning (only where the browser supports it)
if ('BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia) {
  $('#f-scan').hidden = false;
}
$('#f-scan').addEventListener('click', startScan);
$('#scan-cancel').addEventListener('click', stopScan);

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
  if (btn.dataset.act === 'cb') openCBModal(deal.num);
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
  if (el.dataset.set === 'addprod') s.products.push({ name: 'New Product', amt: 0, active: true });
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
  if (el.dataset.f === 'active') p.active = el.checked;
  save(); renderSettings(); renderDashboard(); renderPay();
});

// backup buttons
$('#btn-export-json').addEventListener('click', exportJSON);
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

/* ============ boot ============ */
renderAll();
