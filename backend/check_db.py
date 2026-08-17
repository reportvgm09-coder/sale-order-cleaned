"""Checks whether the backend can actually reach MongoDB, and explains the result
in plain English. Run it with check-db.bat in the project root."""
import os
import re
import socket
import ssl
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

try:
    from dotenv import load_dotenv
    from pymongo import MongoClient
    from pymongo.errors import OperationFailure, ServerSelectionTimeoutError
except ImportError:
    print("  [X] Backend packages are missing. Run start-app.bat once to install them.")
    sys.exit(1)

load_dotenv(ROOT / ".env")
url = os.environ.get("MONGO_URL")

print()
print("  ==========================================")
print("    DATABASE CONNECTION CHECK")
print("  ==========================================")
print()

if not url:
    print("  [X] No MONGO_URL found in backend\\.env")
    print()
    print("      Open backend\\.env and make sure there is a line starting")
    print("      with MONGO_URL=  and that it does NOT start with a #")
    sys.exit(1)

# Hide the password when echoing the connection string back.
masked = re.sub(r"://([^:/@]+):([^@]+)@", r"://\1:*****@", url)
print(f"  Connection string : {masked}")
print(f"  Database name     : {os.environ.get('DB_NAME', '(not set)')}")
print(f"  Python TLS        : {ssl.OPENSSL_VERSION}")
print()

# --- step 1: can we even resolve the host? ---------------------------------
is_srv = url.startswith("mongodb+srv://")
host = re.sub(r"^mongodb(\+srv)?://", "", url).split("@")[-1].split("/")[0].split("?")[0].split(",")[0]
host = host.split(":")[0]
print(f"  [1/2] Looking up {host} ...")
try:
    if is_srv:
        # An Atlas +srv address has no A record of its own - the real hostnames
        # live in a DNS SRV record, so that is what has to be looked up.
        import dns.resolver

        answers = dns.resolver.resolve(f"_mongodb._tcp.{host}", "SRV")
        names = [str(r.target).rstrip(".") for r in answers]
        print(f"        OK - found {len(names)} cluster node(s):")
        for n in names:
            print(f"          {n}")
    else:
        socket.getaddrinfo(host, None)
        print("        OK - the address resolves.")
except Exception as e:
    print(f"        FAILED - {type(e).__name__}: {e}")
    print()
    print("  DIAGNOSIS: the cluster address could not be looked up.")
    print("    - Check you are connected to the internet.")
    print("    - Check the cluster address in MONGO_URL is spelled correctly.")
    print("    - If the cluster was deleted in Atlas, you will need a new one.")
    sys.exit(1)

# --- step 2: can we actually talk to it? -----------------------------------
print("  [2/2] Connecting and sending a ping ...")
try:
    MongoClient(url, serverSelectionTimeoutMS=10000).admin.command("ping")
except ServerSelectionTimeoutError as e:
    detail = str(e)
    print("        FAILED")
    print()
    if "SSL handshake failed" in detail or "TLSV1_ALERT" in detail or "SSLHandshakeFailed" in detail:
        print("  DIAGNOSIS: Atlas accepted the connection then refused the secure handshake.")
        print("  Your machine and the internet are fine - Atlas is turning you away.")
        print()
        print("  Fix these two, in this order:")
        print()
        print("   1. IP ACCESS LIST  - this is the usual cause.")
        print("      Atlas -> Network Access -> IP Access List")
        print("      If the entry says 'temporary' or shows an expiry, it has run out.")
        print("      Delete it and add 0.0.0.0/0 with NO expiry, then wait for the")
        print("      status to go from Pending to Active.")
        print()
        print("   2. CLUSTER PAUSED  - Atlas -> Clusters (Database).")
        print("      A free cluster pauses itself when idle. If there is a Resume")
        print("      button, click it and wait a few minutes.")
    elif "Connection refused" in detail or "timed out" in detail:
        print("  DIAGNOSIS: nothing answered at the cluster address.")
        print("    - If MONGO_URL points at localhost, start MongoDB first")
        print("      (docker compose up -d in the project root).")
        print("    - If it points at Atlas, check the cluster is not paused.")
    else:
        print("  DIAGNOSIS: could not reach the database. Raw error below.")
        print()
        print("  " + detail[:600])
    sys.exit(1)
except OperationFailure as e:
    print("        FAILED")
    print()
    if "auth" in str(e).lower():
        print("  DIAGNOSIS: reached the cluster, but the username or password is wrong.")
        print()
        print("    Atlas -> Database Access -> edit the user -> set a new password,")
        print("    then put that password into MONGO_URL in backend\\.env.")
        print()
        print("    Watch out for special characters - if the password contains")
        print("    @ : / ? # or %, it has to be percent-encoded in the URL.")
        print("    The simplest fix is to generate a password with letters and")
        print("    numbers only.")
    else:
        print(f"  DIAGNOSIS: the database rejected the request: {e}")
    sys.exit(1)
except Exception as e:
    print("        FAILED")
    print()
    print(f"  DIAGNOSIS: unexpected error: {type(e).__name__}: {e}")
    sys.exit(1)

print("        OK")
print()
print("  ==========================================")
print("    ALL GOOD - the database is reachable.")
print()
print("    If the app still shows an error, close")
print("    the backend window and run start-app.bat")
print("    again so it picks up the new settings.")
print("  ==========================================")
