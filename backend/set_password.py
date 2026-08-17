"""Sets the username and password used to sign in to the app.

The password itself is never stored - only a bcrypt hash of it, which cannot be
turned back into the password. Run it with set-password.bat, or:

    python set_password.py           # asks for everything
    python set_password.py --show    # show what is already saved, change nothing

Use --show when setting up hosting - it prints the values to paste into your
host's settings. show-hosting-values.bat in the project root does exactly that.
"""
import argparse
import getpass
import re
import secrets
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ENV = ROOT / ".env"

try:
    import bcrypt
except ImportError:
    print("  [X] Backend packages are missing. Run start-app.bat once to install them.")
    sys.exit(1)

parser = argparse.ArgumentParser(description="Set the app's login credentials.")
parser.add_argument("--print-only", action="store_true", help="show the values without writing to .env")
parser.add_argument("--show", action="store_true", help="show the values already saved, without changing anything")
args = parser.parse_args()


def existing(key):
    if not ENV.exists():
        return None
    for line in ENV.read_text(encoding="utf-8").splitlines():
        if line.strip().startswith(f"{key}="):
            return line.split("=", 1)[1].strip()
    return None


if args.show:
    # Read back what is already set, so the values can be copied into a host
    # without anyone needing to open a Command Prompt or retype a password.
    saved = {k: existing(k) for k in ("APP_USERNAME", "APP_PASSWORD_HASH", "JWT_SECRET")}
    print()
    print("  ==========================================")
    print("    YOUR HOSTING VALUES")
    print("  ==========================================")
    print()
    if not saved["APP_PASSWORD_HASH"]:
        print("  [X] No login is set yet.")
        print("      Double-click set-password.bat first, then run this again.")
        print()
        sys.exit(1)
    print("  Copy each of these into Render, one at a time.")
    print("  Copy the WHOLE line under each name - they are long.")
    print()
    for k, v in saved.items():
        print(f"  ---- {k} ----")
        print(f"  {v}")
        print()
    print("  Keep this window open while you paste them.")
    print("  Nothing here is your actual password - it cannot be reversed.")
    sys.exit(0)

print()
print("  ==========================================")
print("    SET YOUR LOGIN")
print("  ==========================================")
print()

username = input("  Username [admin]: ").strip() or "admin"

while True:
    pw = getpass.getpass("  Password (typing is hidden): ")
    if len(pw) < 8:
        print("  Too short - use at least 8 characters.\n")
        continue
    if pw != getpass.getpass("  Type it again to confirm: "):
        print("  Those did not match. Try again.\n")
        continue
    break

pw_hash = bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


# Reuse the existing secret if there is one - regenerating it signs you out
# everywhere, which is a surprise nobody needs.
jwt_secret = existing("JWT_SECRET") or secrets.token_urlsafe(48)

values = {
    "APP_USERNAME": username,
    "APP_PASSWORD_HASH": pw_hash,
    "JWT_SECRET": jwt_secret,
}

if args.print_only:
    print()
    print("  Paste these into your host's environment settings:")
    print()
    for k, v in values.items():
        print(f"    {k}")
        print(f"    {v}")
        print()
    print("  Nothing was written to .env.")
    sys.exit(0)

lines = ENV.read_text(encoding="utf-8").splitlines() if ENV.exists() else []
for key, val in values.items():
    pattern = re.compile(rf"^\s*#?\s*{key}\s*=")
    replaced = False
    for i, line in enumerate(lines):
        if pattern.match(line):
            lines[i] = f"{key}={val}"
            replaced = True
            break
    if not replaced:
        lines.append(f"{key}={val}")

ENV.write_text("\n".join(lines) + "\n", encoding="utf-8")

print()
print("  ==========================================")
print("    DONE")
print()
print(f"    Username : {username}")
print("    Password : saved as a hash in backend\\.env")
print()
print("    Restart the backend for it to take effect.")
print()
print("    Putting this online? Double-click")
print("    show-hosting-values.bat to get the values")
print("    to paste into Render.")
print("  ==========================================")
