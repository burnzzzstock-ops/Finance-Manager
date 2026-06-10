#!/usr/bin/env python3
"""Pull the newest inventory email attachment (xlsx/csv) and write inventory.json.

Reads the configured IMAP inbox, finds the most recent message (last 4 days)
with a spreadsheet attachment — optionally filtered by sender/subject — parses
it with flexible column matching, and writes inventory.json for the app.

Env vars:
  IMAP_USER, IMAP_PASSWORD  (required; Gmail needs an App Password)
  IMAP_HOST                 (default imap.gmail.com)
  INV_FROM, INV_SUBJECT     (optional filters to find the right email)
"""
import csv
import email
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


def parse_rows(rows):
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
                             'year': year, 'cond': to_cond(get('cond'))}
    else:
        # No recognizable header: harvest anything that looks like a VIN
        for row in rows:
            for c in row:
                s = str(c or '').strip().upper()
                if VIN_RE.match(s):
                    vehicles[s] = {'vin': s, 'stock': '', 'name': '', 'year': '', 'cond': ''}
    return list(vehicles.values())


def newest_attachment():
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

    since = (datetime.now(timezone.utc) - timedelta(days=4)).strftime('%d-%b-%Y')
    crit = ['SINCE', since]
    if os.environ.get('INV_FROM'):
        crit += ['FROM', os.environ['INV_FROM']]
    if os.environ.get('INV_SUBJECT'):
        crit += ['SUBJECT', os.environ['INV_SUBJECT']]

    _, ids = box.search(None, *crit)
    msg_ids = ids[0].split()
    print(f'{len(msg_ids)} candidate message(s) in the last 4 days')
    for msgid in reversed(msg_ids):  # newest first
        _, msgdata = box.fetch(msgid, '(RFC822)')
        msg = email.message_from_bytes(msgdata[0][1])
        for part in msg.walk():
            fn = (part.get_filename() or '').strip()
            if fn.lower().endswith(('.xlsx', '.xls', '.csv', '.txt')):
                data = part.get_payload(decode=True)
                if data:
                    print(f'Using attachment "{fn}" ({len(data)} bytes) '
                          f'from message dated {msg.get("Date", "?")}')
                    return fn, data
    return None, None


def main():
    fn, data = newest_attachment()
    if not data:
        print('No inventory email with a spreadsheet attachment found in the last 4 days. '
              'Check the INV_FROM / INV_SUBJECT filters and that the report is arriving.',
              file=sys.stderr)
        sys.exit(1)

    if fn.lower().endswith('.xlsx'):
        parsers = (rows_from_xlsx, rows_from_csv)
    else:
        parsers = (rows_from_csv, rows_from_xlsx)
    rows, last_err = None, None
    for p in parsers:
        try:
            rows = p(data)
            break
        except Exception as e:  # try the other format
            last_err = e
    if rows is None:
        print(f'Could not parse "{fn}": {last_err}', file=sys.stderr)
        sys.exit(1)

    vehicles = parse_rows(rows)
    if not vehicles:
        print(f'Parsed "{fn}" ({len(rows)} rows) but found no valid VINs.', file=sys.stderr)
        sys.exit(1)
    vehicles.sort(key=lambda v: (v['cond'], v['stock'] or v['vin']))

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
