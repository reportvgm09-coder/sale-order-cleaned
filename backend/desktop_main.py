"""The desktop app's server: what PyInstaller bundles into order-ledger-server.exe.

    order-ledger-server.exe                  run the app's server (the desktop shell starts it)
    order-ledger-server.exe hash-password    read a password on stdin, print its hash
    order-ledger-server.exe shutdown-db      stop the bundled MongoDB cleanly

Every setting arrives as an environment variable from the desktop shell, which
keeps them in its own settings file - there is no .env inside the bundle.
"""
import os
import sys


def hash_password():
    import bcrypt
    pw = sys.stdin.readline().rstrip("\r\n")
    print(bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8"))


def shutdown_db():
    """Stop the bundled MongoDB cleanly. Killing it works too - it recovers from
    its journal on the next start - but a clean stop makes that start quicker."""
    from pymongo import MongoClient
    try:
        MongoClient(os.environ["MONGO_URL"], serverSelectionTimeoutMS=3000).admin.command("shutdown")
    except Exception:
        pass  # the connection drops as it stops, which is the success case


def serve():
    import uvicorn
    from server import app
    # Only this PC may reach it: the desktop window is the one thing that should.
    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("PORT", "47800")), log_level="info")


if __name__ == "__main__":
    if sys.argv[1:2] == ["hash-password"]:
        hash_password()
    elif sys.argv[1:2] == ["shutdown-db"]:
        shutdown_db()
    else:
        serve()
