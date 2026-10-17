"""Switch this PC to its own database, kept in step with the online one.

    python setup_offline.py           set up, then copy everything down
    python setup_offline.py --undo    go back to using the online database directly

Before: MONGO_URL is the online (Atlas) database.
After:  MONGO_URL is the MongoDB on this PC, and SYNC_REMOTE_URL is the online
        one, which sync.py keeps in step. The old .env is kept as
        .env.before-offline, which is what --undo puts back.
"""
import asyncio
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV = ROOT / ".env"
SAVED = ROOT / ".env.before-offline"
LOCAL_URL = "mongodb://localhost:27017"

try:
    from dotenv import dotenv_values
    from motor.motor_asyncio import AsyncIOMotorClient
    from pymongo import MongoClient
except ImportError:
    print("  [X] Backend packages are missing. Run start-app.bat once to install them.")
    sys.exit(1)

from sync import friendly, run_sync


def reachable(url):
    try:
        MongoClient(url, serverSelectionTimeoutMS=5000).admin.command("ping")
        return True
    except Exception:
        return False


def set_key(lines, key, value):
    """Replace KEY=... in place, or add it at the end - keeping every other line,
    comments included, exactly as it was."""
    out, done = [], False
    for line in lines:
        if line.strip().startswith(f"{key}="):
            if not done:
                out.append(f"{key}={value}")
                done = True
            continue
        out.append(line)
    if not done:
        out.append(f"{key}={value}")
    return out


def undo():
    if not SAVED.exists():
        print("  [X] There is nothing to undo - this PC was never switched to offline mode.")
        sys.exit(1)
    shutil.copyfile(SAVED, ENV)
    print("  [ok] Back to using the online database directly.")
    print("       Anything entered on this PC since its last sync is still in the PC's own")
    print("       database, but the app is no longer looking at it. Sync before undoing.")


def main():
    if "--undo" in sys.argv:
        return undo()
    if not ENV.exists():
        print("  [X] backend\\.env is missing. Run start-app.bat once first.")
        sys.exit(1)
    env = dotenv_values(ENV)
    db_name = env.get("DB_NAME")
    if env.get("SYNC_REMOTE_URL"):
        print("  [ok] This PC is already set up for offline use.")
        print("       It syncs by itself while the app is open. To sync now, use sync-now.bat.")
        return
    online_url = (env.get("MONGO_URL") or "").strip()
    if not online_url or not db_name:
        print("  [X] MONGO_URL or DB_NAME is missing from backend\\.env. Run start-app.bat first.")
        sys.exit(1)
    if "localhost" in online_url or "127.0.0.1" in online_url:
        print("  [X] MONGO_URL already points at this PC, so there is no online database to sync with.")
        print("       Put your MongoDB Atlas connection string back in MONGO_URL first.")
        sys.exit(1)

    print("  Checking the database on this PC...")
    if not reachable(LOCAL_URL):
        print()
        print("  [X] MongoDB is not running on this PC.")
        print()
        print("      1. Go to  mongodb.com/try/download/community")
        print("      2. Download MongoDB Community Server for Windows (the .msi).")
        print("      3. Run it, choose Complete, and leave \"Install MongoD as a Service\"")
        print("         ticked. MongoDB Compass is optional.")
        print("      4. Double-click setup-offline.bat again.")
        sys.exit(1)
    print("  [ok] MongoDB is running on this PC")

    print("  Checking the online database...")
    if not reachable(online_url):
        print("  [X] Could not reach the online database. The first copy needs internet -")
        print("      try again once you are connected.")
        sys.exit(1)
    print("  [ok] Online database reachable")

    lines = ENV.read_text(encoding="utf-8").splitlines()
    shutil.copyfile(ENV, SAVED)
    lines = set_key(lines, "MONGO_URL", LOCAL_URL)
    lines = set_key(lines, "SYNC_REMOTE_URL", online_url)
    ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("  [ok] This PC now uses its own database (old settings kept in .env.before-offline)")

    print("  Copying everything down from the online database - this can take a few minutes...")

    async def first_copy():
        local = AsyncIOMotorClient(LOCAL_URL)
        try:
            return await run_sync(local[db_name], online_url, db_name, LOCAL_URL, AsyncIOMotorClient)
        finally:
            local.close()

    try:
        r = asyncio.run(first_copy())
    except Exception as e:
        print(f"  [X] The first copy did not finish: {friendly(e)}")
        print("      Nothing is lost. Double-click sync-now.bat to carry on once that is fixed.")
        sys.exit(1)
    print(f"  [ok] Copied {r['pulled']} records to this PC.")
    print()
    print("  Done. Start the app with start-app.bat as usual. It works without internet,")
    print("  and syncs with the online site every few minutes whenever there is a connection.")


if __name__ == "__main__":
    main()
