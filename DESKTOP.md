# The desktop app

Order Ledger as an ordinary Windows program: double-click it and it opens in
its own window. It has its own database inside, so it works with no internet,
and it keeps in step with the online site whenever it can - salesmen on their
phones carry on using the website exactly as before.

You do not need Python, Node, MongoDB or `start-app.bat` on a PC that only
runs the desktop app.

## Installing

1. Run **`Order Ledger Setup 1.0.0.exe`** (from `desktop\dist`).
2. Windows shows a blue *"Windows protected your PC"* box, because the program
   is not signed. Click **More info**, then **Run anyway**.
3. Pick where to install, or keep the suggestion. A desktop shortcut is made.

## The first time it opens

A setup screen asks for four things. On this PC, the easy way is the
**Copy settings from my old app folder** button: pick the folder that has
`start-app.bat` in it, and it fills everything in. Your password stays the same
as on the online site.

On another PC, type them in:

- **Online database** - your MongoDB Atlas connection string (from
  `show-hosting-values.bat`). Leave blank to keep everything on that PC only.
- **Database name** - the same `DB_NAME` the online site uses.
- **Username** and **password** - use the same as the online site.

Click **Save and start**. The first sync copies everything down, which can take
a minute.

## Day to day

- The bar under the menu says when it last synced. It syncs every 5 minutes on
  its own; **Sync now** does it straight away.
- **Close the window** to stop it - that also shuts its database down properly.
- **Help > Change settings** brings the setup screen back.
- **Help > Open data folder** shows where your data is kept
  (`%APPDATA%\Order Ledger`). Uninstalling the program leaves it in place.

## If you used setup-offline.bat before

The desktop app keeps its own database, separate from the one
`setup-offline.bat` made. Click **Sync now** (or run `sync-now.bat`) in the old
app first, so nothing is left only in the old copy, then start using the
desktop app. It gets everything from the online database on its first sync.

## Making a new installer after a change

Double-click **`build-desktop.bat`**. The first time it downloads its tools and
takes a while; after that it takes a few minutes. The new installer appears in
`desktop\dist` - run it over the top of the old one; your data is kept.
