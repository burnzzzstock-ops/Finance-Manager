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
import imaplib
import io
import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone

VIN_RE = re.compile(r'^[A-HJ-NPR-Z0-9]{17}$')
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

    # Newest first; keep the first spreadsheet we see for each of new/used,
    # plus an untagged fallback if a report's category can't be determined.
    found = {}      # cond -> (fn, data)
    fallback = []   # [(fn, data)] for reports we couldn't classify
    for msgid in reversed(msg_ids):
        _, msgdata = box.fetch(msgid, '(RFC822)')
        msg = email.message_from_bytes(msgdata[0][1])
        subject = str(email.header.make_header(email.header.decode_header(msg.get('Subject', ''))))
        for part in msg.walk():
            fn = (part.get_filename() or '').strip()
            if not fn.lower().endswith(('.xlsx', '.xls', '.csv', '.txt')):
                continue
            data = part.get_payload(decode=True)
            if not data:
                continue
            cond = classify(subject, fn)
            tag = cond or '?'
            label = {'new': 'NEW', 'used': 'USED'}.get(cond, 'unclassified')
            print(f'  [{label}] "{fn}" ({len(data)} bytes) — subject: {subject!r}')
            if cond and cond not in found:
                found[cond] = (fn, data)
            elif not cond:
                fallback.append((fn, data))
    box.logout()

    # If only one report type was identifiable but there are unclassified ones,
    # treat the newest unclassified as the missing category isn't safe — leave it
    # to the data's own new/used column (default_cond='').
    return found, fallback


def parse_attachment(fn, data, default_cond):
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


def main():
    found, fallback = collect_reports()
    if not found and not fallback:
        print('No inventory email with a spreadsheet attachment found in the last 2 days. '
              'Check that both reports are arriving and the INV_FROM filter (if set) matches.',
              file=sys.stderr)
        sys.exit(1)

    reports = []  # (fn, data, default_cond)
    for cond in ('new', 'used'):
        if cond in found:
            reports.append((*found[cond], cond))
    if not found:
        # Couldn't classify any — fall back to letting each file's data decide.
        for fn, data in fallback:
            reports.append((fn, data, ''))
        print('WARNING: could not tell new vs used reports apart from subject/filename. '
              'Set INV_SUBJECT_NEW / INV_SUBJECT_USED variables to fix this.', file=sys.stderr)

    merged = {}
    sources = []
    for fn, data, cond in reports:
        for v in parse_attachment(fn, data, cond):
            merged[v['vin']] = v  # later (used) reports can't clobber earlier ones by VIN
        sources.append(fn)
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
