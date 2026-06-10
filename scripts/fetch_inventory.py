#!/usr/bin/env python3
"""Pull the daily new + used inventory emails (xlsx/csv) and write inventory.json.

Reads the configured IMAP inbox, finds the newest "new inventory" report and the
newest "used inventory" report (last 2 days), tags each report's vehicles new/used
accordingly, parses with flexible column matching, merges, and writes inventory.json.

Env vars:
  IMAP_USER, IMAP_PASSWORD            (required; Gmail needs an App Password)
  IMAP_HOST                           (default imap.gmail.com)
  INV_FROM                            (optional: sender to filter on)
  INV_SUBJECT_NEW, INV_SUBJECT_USED   (optional: subject text identifying each report;
                                       otherwise new/used is guessed from subject+filename)
"""
import csv
import email
import email.header
import hashlib
import imaplib
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime

VIN_RE = re.compile(r'^[A-HJ-NPR-Z0-9]{17}$')
VIN_FIND = re.compile(r'\b([A-HJ-NPR-Z0-9]{17})\b')
MONEY_T = re.compile(r'^[$\-()0-9,.%]+$')
YEAR_T = re.compile(r'^(19|20)\d{2}$')
OUT_PATH = os.path.join(os.path.dirname(__file__), '..', 'inventory.json')

COLMAP = {
    'vin': 'vin',
    'stock': 'stock', 'stocknumber': 'stock', 'stockno': 'stock', 'stocknum': 'stock',
    'stk': 'stock', 'stknumber': 'stock', 'stkno': 'stock',
    'year': 'year', 'modelyear': 'year', 'yr': 'year',
    'make': 'make', 'division': 'make',
    'model': 'model',
    'trim': 'trim', 'series': 'trim', 'trimlevel': 'trim', 'bodystyle': 'trim',
    'type': 'cond', 'newused': 'cond', 'condition': 'cond', 'nu': 'cond',
    'vehicletype': 'cond', 'inventorytype': 'cond', 'newusedcert': 'cond', 'status': 'cond',
}


def norm_header(h):
    return re.sub(r'[^a-z0-9]', '', str(h or '').lower())


def rows_from_xlsx(data):
    import openpyxl
    wb = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    ws = wb.worksheets[0]
    return [['' if c is None else str(c) for c in row] for row in ws.iter_rows(values_only=True)]


def rows_from_csv(data):
    text = data.decode('utf-8-sig', errors='replace')
    try:
        dialect = csv.Sniffer().sniff(text[:4096], delimiters=',;\t|')
    except csv.Error:
        dialect = csv.excel
    return [list(r) for r in csv.reader(io.StringIO(text), dialect)]


def to_cond(raw):
    s = str(raw).strip().lower()
    if not s:
        return ''
    if 'used' in s or 'pre' in s or 'cpo' in s or 'certified' in s or s == 'u':
        return 'used'
    if 'new' in s or s == 'n':
        return 'new'
    return ''


def parse_rows(rows, default_cond=''):
    header_i, cols = None, {}
    for i, row in enumerate(rows[:15]):
        if any(norm_header(c) == 'vin' for c in row):
            header_i = i
            for j, c in enumerate(row):
                key = COLMAP.get(norm_header(c))
                if key and key not in cols:
                    cols[key] = j
            break

    vehicles = {}
    if header_i is not None:
        for row in rows[header_i + 1:]:
            def get(k, row=row):
                j = cols.get(k)
                if j is None or j >= len(row) or row[j] is None:
                    return ''
                return str(row[j]).strip()
            vin = get('vin').upper().replace(' ', '')
            if not VIN_RE.match(vin):
                continue
            year = re.sub(r'\D', '', get('year'))[:4]
            make = get('make')
            if make.isupper():
                make = make.title()
            # Excel often renders numbers as floats ("12345.0")
            stock = re.sub(r'\.0$', '', get('stock'))
            name = ' '.join(x for x in (year, make, get('model'), get('trim')) if x)
            vehicles[vin] = {'vin': vin, 'stock': stock, 'name': name,
                             'year': year, 'cond': to_cond(get('cond')) or default_cond}
    else:
        # No recognizable header: harvest anything that looks like a VIN
        for row in rows:
            for c in row:
                s = str(c or '').strip().upper()
                if VIN_RE.match(s):
                    vehicles[s] = {'vin': s, 'stock': '', 'name': '',
                                   'year': '', 'cond': default_cond}
    return list(vehicles.values())


def pdf_pages_text(data):
    import pdfplumber
    pages = []
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            pages.append(page.extract_text() or '')
    return pages


MAKE_FIX = {
    'CHEV': 'Chevrolet', 'CHEVY': 'Chevrolet', 'CADI': 'Cadillac', 'CHRY': 'Chrysler',
    'MERC': 'Mercedes', 'MERZ': 'Mercedes', 'VOLK': 'Volkswagen', 'VW': 'Volkswagen',
    'LINC': 'Lincoln', 'TOYT': 'Toyota', 'NISS': 'Nissan', 'HYUN': 'Hyundai',
    'MITS': 'Mitsubishi', 'INFI': 'Infiniti', 'PONT': 'Pontiac', 'OLDS': 'Oldsmobile',
    'BUIC': 'Buick', 'SUBA': 'Subaru', 'MAZD': 'Mazda', 'LEXS': 'Lexus', 'LEXU': 'Lexus',
}
MAKE_ACRONYM = {'BMW', 'GMC', 'KIA', 'RAM', 'MINI', 'FIAT', 'AUDI', 'JEEP'}


def fix_make(m):
    u = m.upper()
    if u in MAKE_FIX:
        return MAKE_FIX[u]
    if u in MAKE_ACRONYM:
        return u
    return m.title()


def _expand_year(yy):
    """DealerTrack prints 2-digit model years: 00-29 -> 2000s, 30-99 -> 1900s."""
    if not (len(yy) == 2 and yy.isdigit()):
        return ''
    n = int(yy)
    return str(2000 + n) if n < 30 else str(1900 + n)


def vehicles_from_pdf_text(pages, default_cond=''):
    """Parse a DealerTrack IN3130R "Inventory Analysis Detail" report.

    Row layout:  [*]Stock#  VIN  YY  MAKE  <description...>  Cost  List  Age  Miles
    The report also carries an "All New" / "All Used" banner that identifies it.
    """
    blob = '\n'.join(pages)
    if not default_cond:
        if re.search(r'\ball\s+used\b', blob, re.I):
            default_cond = 'used'
        elif re.search(r'\ball\s+new\b', blob, re.I):
            default_cond = 'new'

    vehicles = {}
    for text in pages:
        for line in text.splitlines():
            m = VIN_FIND.search(line.upper())
            if not m:
                continue
            vin = m.group(1)
            if not VIN_RE.match(vin):
                continue
            toks = line.split()
            vi = next((i for i, t in enumerate(toks) if vin in t.upper()), None)
            if vi is None:
                continue
            stock = toks[vi - 1].lstrip('*').upper().strip('#:') if vi >= 1 else ''
            after = toks[vi + 1:]
            year = _expand_year(after[0]) if after else ''
            make = fix_make(after[1]) if len(after) > 1 else ''
            desc = []
            for t in after[2:]:
                if re.fullmatch(r'\d{3,}', t):   # first cost-sized integer = numeric columns begin
                    break
                if t.lower() in ('total', 'per'):
                    break
                desc.append(t)
            while desc and not re.search(r'[A-Za-z0-9]', desc[-1]):
                desc.pop()
            name = ' '.join(x for x in ([year, make] + desc) if x).strip()
            vehicles[vin] = {'vin': vin, 'stock': stock, 'name': name,
                             'year': year, 'cond': default_cond}
    return list(vehicles.values())


def classify(*texts):
    """Decide whether a report is the new or used one, from subject + filename."""
    blob = ' '.join(t for t in texts if t).lower()
    new_sub = (os.environ.get('INV_SUBJECT_NEW') or '').lower()
    used_sub = (os.environ.get('INV_SUBJECT_USED') or '').lower()
    if used_sub and used_sub in blob:
        return 'used'
    if new_sub and new_sub in blob:
        return 'new'
    if re.search(r'\b(used|pre-?owned|preowned|cpo|certified)\b', blob):
        return 'used'
    if re.search(r'\bnew\b', blob):
        return 'new'
    return ''


def collect_reports():
    """Return the newest 'new' report and newest 'used' report as {cond: (fn, data)}."""
    host = os.environ.get('IMAP_HOST') or 'imap.gmail.com'
    user = os.environ.get('IMAP_USER')
    pw = os.environ.get('IMAP_PASSWORD')
    if not user or not pw:
        print('IMAP_USER / IMAP_PASSWORD secrets are not set. Add them in the repo: '
              'Settings -> Secrets and variables -> Actions.', file=sys.stderr)
        sys.exit(1)

    box = imaplib.IMAP4_SSL(host)
    box.login(user, pw)
    box.select('INBOX', readonly=True)

    since = (datetime.now(timezone.utc) - timedelta(days=2)).strftime('%d-%b-%Y')
    crit = ['SINCE', since]
    if os.environ.get('INV_FROM'):
        crit += ['FROM', os.environ['INV_FROM']]

    _, ids = box.search(None, *crit)
    msg_ids = ids[0].split()
    print(f'{len(msg_ids)} candidate message(s) since {since}')

    # Newest first. Keep the first report seen for each of new/used; reports whose
    # category can't be told from subject/filename go to the unclassified pool
    # (DealerTrack sends both as "REPORT.PDF" under one subject).
    found = {}     # cond -> (fn, data)
    pool = []      # [(day, fn, data)] unclassified
    seen = set()   # attachment content hashes, so the same file isn't taken twice
    for msgid in reversed(msg_ids):
        _, msgdata = box.fetch(msgid, '(RFC822)')
        msg = email.message_from_bytes(msgdata[0][1])
        subject = str(email.header.make_header(email.header.decode_header(msg.get('Subject', ''))))
        try:
            day = parsedate_to_datetime(msg.get('Date')).date()
        except Exception:
            day = None
        for part in msg.walk():
            fn = (part.get_filename() or '').strip()
            if not fn.lower().endswith(('.xlsx', '.xls', '.csv', '.txt', '.pdf')):
                continue
            data = part.get_payload(decode=True)
            if not data:
                continue
            h = hashlib.sha1(data).hexdigest()
            if h in seen:
                continue
            seen.add(h)
            cond = classify(subject, fn)
            label = {'new': 'NEW', 'used': 'USED'}.get(cond, 'unclassified')
            print(f'  [{label}] "{fn}" ({len(data)} bytes, {day}) — subject: {subject!r}')
            if cond and cond not in found:
                found[cond] = (fn, data)
            elif not cond:
                pool.append((day, fn, data))
    box.logout()

    # Only the most recent day's unclassified reports matter (yesterday's pair
    # would otherwise sneak in alongside today's).
    days = [d for d, _, _ in pool if d is not None]
    if days:
        newest = max(days)
        pool = [(d, fn, data) for d, fn, data in pool if d == newest]
    return found, [(fn, data) for _, fn, data in pool]


def parse_attachment(fn, data, default_cond):
    if fn.lower().endswith('.pdf') or data[:4] == b'%PDF':
        try:
            v = vehicles_from_pdf_text(pdf_pages_text(data), default_cond)
            print(f'  parsed PDF "{fn}": {len(v)} vehicles '
                  f'(default cond: {default_cond or "from data"})')
            return v
        except Exception as e:
            print(f'  could not parse PDF "{fn}": {e}', file=sys.stderr)
            return []
    parsers = (rows_from_xlsx, rows_from_csv) if fn.lower().endswith(('.xlsx', '.xls')) \
        else (rows_from_csv, rows_from_xlsx)
    last_err = None
    for p in parsers:
        try:
            rows = p(data)
            v = parse_rows(rows, default_cond)
            print(f'  parsed "{fn}": {len(rows)} rows -> {len(v)} vehicles '
                  f'(default cond: {default_cond or "from data"})')
            return v
        except Exception as e:
            last_err = e
    print(f'  could not parse "{fn}": {last_err}', file=sys.stderr)
    return []


def avg_year(vehicles):
    years = [int(v['year']) for v in vehicles if v['year'].isdigit()]
    return sum(years) / len(years) if years else 0


def main():
    found, pool = collect_reports()
    if not found and not pool:
        print('No inventory email with a report attachment found in the last 2 days. '
              'Check that both reports are arriving and the INV_FROM filter (if set) matches.',
              file=sys.stderr)
        sys.exit(1)

    reports = []  # {fn, cond, vehicles}
    for cond in ('new', 'used'):
        if cond in found:
            fn, data = found[cond]
            reports.append({'fn': fn, 'cond': cond, 'vehicles': parse_attachment(fn, data, cond)})
    for fn, data in pool:
        reports.append({'fn': fn, 'cond': '', 'vehicles': parse_attachment(fn, data, '')})

    # Unclassified reports: first let the rows speak (a report whose rows are
    # uniformly marked one way takes that condition for its unmarked rows too)…
    for r in reports:
        if r['cond']:
            continue
        conds = {v['cond'] for v in r['vehicles'] if v['cond']}
        if len(conds) == 1:
            r['cond'] = conds.pop()
            print(f'  "{r["fn"]}" classified as {r["cond"]} from its own rows')

    # …then break a two-way tie by average model year (used stock averages older).
    unknown = [r for r in reports if not r['cond'] and r['vehicles']]
    if len(unknown) == 2:
        a, b = sorted(unknown, key=lambda r: avg_year(r['vehicles']))
        if avg_year(a['vehicles']) and avg_year(b['vehicles']) - avg_year(a['vehicles']) >= 0.7:
            a['cond'], b['cond'] = 'used', 'new'
            print(f'  classified by avg model year: "{b["fn"]}" -> new '
                  f'({avg_year(b["vehicles"]):.1f}), "{a["fn"]}" -> used '
                  f'({avg_year(a["vehicles"]):.1f})')
        else:
            print('WARNING: could not tell the two reports apart (similar model years, '
                  'no new/used markings). Vehicles keep whatever their rows say.',
                  file=sys.stderr)

    merged = {}
    sources = []
    for r in reports:
        for v in r['vehicles']:
            if r['cond'] and not v['cond']:
                v = dict(v, cond=r['cond'])
            merged[v['vin']] = v
        sources.append(r['fn'])
    vehicles = list(merged.values())
    if not vehicles:
        print('Reports were found but no valid VINs parsed out of them.', file=sys.stderr)
        sys.exit(1)
    vehicles.sort(key=lambda v: (v['cond'], v['stock'] or v['vin']))
    n_new = sum(1 for v in vehicles if v['cond'] == 'new')
    n_used = sum(1 for v in vehicles if v['cond'] == 'used')
    print(f'Merged {len(vehicles)} vehicles ({n_new} new, {n_used} used) from: {", ".join(sources)}')
    fn = ' + '.join(sources)

    # Skip the write (and the commit) when the vehicle list hasn't changed
    try:
        with open(OUT_PATH, encoding='utf-8') as f:
            if json.load(f).get('vehicles') == vehicles:
                print(f'Inventory unchanged ({len(vehicles)} vehicles) — nothing to commit.')
                return
    except (OSError, ValueError):
        pass

    out = {
        'updated': datetime.now(timezone.utc).isoformat(timespec='seconds'),
        'source': fn,
        'count': len(vehicles),
        'vehicles': vehicles,
    }
    with open(OUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(out, f, indent=1)
    print(f'Wrote inventory.json with {len(vehicles)} vehicles '
          f'({sum(1 for v in vehicles if v["cond"] == "new")} new, '
          f'{sum(1 for v in vehicles if v["cond"] == "used")} used).')


if __name__ == '__main__':
    main()
