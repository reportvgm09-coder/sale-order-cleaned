# Using the app without internet

Your office PC can keep its own copy of everything, so the app keeps working
when the internet is down. The online site stays exactly as it is, so salesmen
on their phones carry on as before. Whenever the PC has internet, the two swap
their changes.

## Setting it up (once)

1. **Install MongoDB on the PC.** Go to `mongodb.com/try/download/community`,
   download *MongoDB Community Server* for Windows (the `.msi`), run it, choose
   **Complete**, and leave **Install MongoD as a Service** ticked.
2. **Make sure the online site is up to date** - the new code has to be on
   Render first, or the changes made online cannot be picked up.
3. **Close the app** if it is open, then double-click **`setup-offline.bat`**.
   It needs internet this one time to copy everything down.
4. Start the app with `start-app.bat` as usual.

## Day to day

Nothing changes. A thin bar under the menu tells you where you stand:

- *Synced with the online site 3 min ago* - all good.
- *Working offline. Last synced 2 hours ago* - no internet. Keep working;
  everything goes up the moment the connection is back.

The PC syncs by itself every 5 minutes while the app is open. **Sync now** on
that bar (or `sync-now.bat`) does it straight away.

The online site shows *Office PC last synced …*, so whoever is looking there
knows that anything entered at the office after that time is not there yet.

## If the same thing was changed in both places

If an order was edited at the office *and* online between two syncs, the
**later** edit is kept. The other one is not thrown away: the bar shows
*1 clash*, and clicking it shows what was replaced, so you can put anything back
by hand. When you have looked, click *clear the list*.

If both sides added an order **with the same order number**, both are kept.
The online one gets `-2` on the end of its number.

## Things to know

- **Leave the PC on and the app open** if you want online changes to come down
  regularly. Changes made online simply wait until the PC next syncs.
- **Your PC's copy is now real data.** Keep taking backups (Masters page).
- **Going back** to the old way, using the online database directly: open a
  command prompt in this folder and run `setup-offline.bat --undo`. Sync
  first, or anything entered on the PC since the last sync stays on the PC.
