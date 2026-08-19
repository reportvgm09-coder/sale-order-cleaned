# Changing the app now that it is online

Short version: **ask me, then Commit and Push. Render does the rest.**

---

## First — does it even need a change?

Plenty of things are not code changes at all. Just use the app:

| You want to… | Do this |
|---|---|
| Add a customer, brand, season, exhibition, salesman | **Masters** page |
| Add or rename an expense head | **Masters** page → Expense Heads |
| Fix a wrong order or dispatch | Edit it in the app |
| Change your password | `set-password.bat`, then update `APP_PASSWORD_HASH` in Render |

None of those need a rebuild. They take effect immediately.

---

## The normal way to change the app itself

New column, new page, different wording, a bug — anything in the app itself.

### 1. Tell me what you want

Describe it in plain words. I edit the files in your `sale-order-cleaned`
folder directly, same as I have been doing all along, and tell you what changed.

### 2. Send it to GitHub

Open **GitHub Desktop**. You will see the changed files listed on the left.

1. Bottom left, type a short note in the Summary box — "added dispatch column"
2. Click **Commit to main**
3. Click **Push origin** at the top

### 3. Wait

Render notices within a minute and rebuilds by itself. Nothing to click.

- Backend change → **sale-order-api** rebuilds, about 3 minutes
- Frontend change → **sale-order-web** rebuilds, about 5 minutes
- Both changed → both rebuild

✅ **Check it worked:** in Render, the **Updated** column shows "a few seconds
ago" and the status is green. Then refresh your app in the browser.

> **If your browser still shows the old version**, press **Ctrl+Shift+R**.
> That forces it to fetch the new files instead of the ones it saved.

---

## Try it on your PC first (optional)

For anything big, run it locally before pushing:

1. Double-click `start-app.bat`
2. Check the change looks right at `http://localhost:3000`
3. Happy? Commit and push.

Your PC and the hosted app share the same database, so orders you add in one
appear in the other. Be aware of that when testing — a test order is a real
order.

---

## Settings are different from code

Some things live in Render, not in your files. Changing these does **not**
involve GitHub:

| Setting | Where | Anything else? |
|---|---|---|
| `MONGO_URL`, `DB_NAME` | sale-order-api → Environment | Restarts itself |
| `APP_USERNAME`, `APP_PASSWORD_HASH` | sale-order-api → Environment | Restarts itself |
| `JWT_SECRET` | sale-order-api → Environment | Signs everyone out |
| `CORS_ORIGINS` | sale-order-api → Environment | Restarts itself |
| `REACT_APP_BACKEND_URL` | sale-order-web → Environment | ⚠️ **Also click Manual Deploy → Deploy latest commit** |

That last one catches everyone. The website only reads that address while it is
being built, so saving alone does nothing.

---

## If a change breaks something

Nothing is lost. Two ways back.

### Quickest: roll back in Render

1. Open the service that broke
2. Click the **Deploys** tab
3. Find the last deploy that worked
4. Use its **Rollback** option

You are back on the old version in a couple of minutes. Your data is untouched
— rolling back changes the app, never the database.

### Or undo the change itself

In GitHub Desktop, click **History**, right-click the commit that caused it,
and choose **Revert changes in commit**. Then **Push origin**.

### Either way, tell me

Send me what went wrong and I will fix the cause rather than leave you on an
old version.

---

## Before anything big

Take a backup: **Masters** → **Download Backup**, and keep the file off this PC.

Code changes cannot touch your orders — they live in MongoDB, not in the code.
But a backup costs ten seconds and removes the worry.

---

## Quick reference

```
Something in the app       →  tell me  →  Commit  →  Push origin  →  wait
A setting or a password    →  change it in Render  →  it restarts
Customers, brands, orders  →  just use the app
Something broke            →  Render → Deploys → Rollback  →  tell me
Browser showing old version →  Ctrl+Shift+R
```
