"""Restore a backup file produced by the app's Download Backup button.

Deliberately a command-line tool and not a button in the app: restoring
overwrites live data, and that is not something anyone should be able to
do by mis-clicking.

    python restore_backup.py my-backup.json
    python restore_backup.py my-backup.json --into other_db_name

By default it refuses to touch a database that already has records. Pass
--replace to wipe those collections first (it will ask you to confirm).
"""
import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
except ImportError:
    print("  [X] Backend packages are missing. Run start-app.bat once to install them.")
    sys.exit(1)

COLLECTIONS = [
    "customers", "brands", "exhibitions", "salesmen", "seasons", "expense_heads",
    "sale_orders", "dispatch_orders", "expenses",
]

parser = argparse.ArgumentParser(description="Restore an Order Ledger backup into MongoDB.")
parser.add_argument("backup_file", help="the .json file downloaded from the app")
parser.add_argument("--into", help="database name to restore into (defaults to DB_NAME in .env)")
parser.add_argument("--replace", action="store_true", help="wipe existing records first")
args = parser.parse_args()

load_dotenv(ROOT / ".env")
url = os.environ.get("MONGO_URL")
if not url:
    print("  [X] No MONGO_URL in backend\\.env - nothing to restore into.")
    sys.exit(1)

path = Path(args.backup_file)
if not path.exists():
    path = ROOT / args.backup_file
if not path.exists():
    print(f"  [X] Could not find {args.backup_file}")
    sys.exit(1)

try:
    payload = json.loads(path.read_text(encoding="utf-8"))
except Exception as e:
    print(f"  [X] {path.name} is not readable JSON: {e}")
    sys.exit(1)

if payload.get("app") != "order-ledger":
    print("  [X] That file was not produced by this app - refusing to restore it.")
    sys.exit(1)

data = payload.get("collections", {})
db_name = args.into or payload.get("database") or os.environ.get("DB_NAME")

print()
print("  ==========================================")
print("    RESTORE BACKUP")
print("  ==========================================")
print()
print(f"  File        : {path.name}")
print(f"  Taken at    : {payload.get('taken_at', 'unknown')}")
print(f"  Restoring to: {db_name}")
print()
print("  Contents of the backup:")
for coll in COLLECTIONS:
    print(f"    {coll:<18} {len(data.get(coll, []))}")
print()

client = MongoClient(url, serverSelectionTimeoutMS=15000)
try:
    client.admin.command("ping")
except Exception as e:
    print(f"  [X] Cannot reach the database: {e}")
    print("      Run check-db.bat to work out why.")
    sys.exit(1)

db = client[db_name]
existing = {coll: db[coll].count_documents({}) for coll in COLLECTIONS}
occupied = {k: v for k, v in existing.items() if v}

if occupied and not args.replace:
    print("  [X] That database already holds records:")
    for k, v in occupied.items():
        print(f"        {k:<18} {v}")
    print()
    print("      Restoring on top of them would create duplicates.")
    print("      Either restore into an empty database:")
    print(f"          python restore_backup.py {path.name} --into sale_order_restored")
    print("      or wipe these collections first:")
    print(f"          python restore_backup.py {path.name} --replace")
    sys.exit(1)

if occupied and args.replace:
    print("  WARNING: --replace will permanently delete these records first:")
    for k, v in occupied.items():
        print(f"        {k:<18} {v}")
    print()
    if input(f'  Type the database name "{db_name}" to confirm: ').strip() != db_name:
        print("  Cancelled. Nothing was changed.")
        sys.exit(1)
    for coll in COLLECTIONS:
        db[coll].delete_many({})
    print("  Existing records cleared.")

print()
restored = {}
for coll in COLLECTIONS:
    docs = data.get(coll) or []
    if docs:
        db[coll].insert_many([dict(d) for d in docs])
    restored[coll] = len(docs)
    print(f"  restored {coll:<18} {len(docs)}")

print()
print("  ==========================================")
print(f"    DONE - {sum(restored.values())} records restored into {db_name}")
print()
if args.into and args.into != os.environ.get("DB_NAME"):
    print(f"    You restored into '{args.into}', which is not")
    print("    the database the app is using. Update DB_NAME")
    print("    in backend\\.env to point at it.")
    print()
print("    Restart the backend to pick it up.")
print("  ==========================================")
