# Putting your app on the internet

Read this once from top to bottom. Then start at Step 1 and do one step at a time.

You cannot break anything by following this. Your orders stay in the same
database they are in right now. Nothing gets moved or deleted.

Set aside about an hour. Most of that is waiting.

---

## What you will end up with

Two web addresses, made for you automatically:

- **A website address** — this is the one you use. Looks like
  `https://sale-order-web.onrender.com`
- **An API address** — the app talks to this. You never open it yourself.
  Looks like `https://sale-order-api.onrender.com`

Why two? One holds the screens you look at. The other does the thinking and
talks to your database. They need separate homes.

---

## First, two accounts

Both free. Sign up now, before you start.

1. **GitHub** — github.com. This is where your code is kept.
2. **Render** — render.com. This is what runs it.

When Render asks how you want to sign up, **choose "Sign up with GitHub"**.
That saves connecting them later.

---

## Also first: take a backup

Open your app → **Masters** page → **Download Backup**.

Save that file somewhere other than this PC. Email it to yourself if that is
easiest. You almost certainly will not need it. Do it anyway.

---

# Part 1 — On your computer

## Step 1: Choose your password

In your `sale-order-cleaned` folder, **double-click `set-password.bat`**.

It asks two things:

- **Username** — press Enter to accept `admin`, or type your own.
- **Password** — type it, then type it again. Nothing appears while you type.
  That is normal, not a fault.

Use a real password. This one is going on the internet.

✅ **You should see:** a box saying DONE, showing your username.

---

## Step 2: Get your three values

**Double-click `show-hosting-values.bat`.**

A window opens showing three things:

```
---- APP_USERNAME ----
admin

---- APP_PASSWORD_HASH ----
$2b$12$LongMessOfLettersAndNumbers...

---- JWT_SECRET ----
AnotherLongMessOfLettersAndNumbers...
```

**Leave this window open.** You will copy from it in Step 6.

Don't worry that the password looks like nonsense — that is the point. It is
scrambled and cannot be turned back into your password.

---

## Step 3: Put your code on GitHub

Install **GitHub Desktop** from desktop.github.com. Sign in with your GitHub
account.

Then:

1. Click **File** → **Add local repository**.
2. Click **Choose…** and pick your `sale-order-cleaned` folder.
3. It says the folder is not a repository yet and offers to create one.
   Click **create a repository**, then click **Create repository**.

Now look at the list of files on the left.

> ⚠️ **Check this before going on.** You should see things like
> `backend/server.py` and `frontend/src/...`
>
> You should **not** see a file called `.env` anywhere.
>
> If you do see `.env`, stop and tell me. It holds your database password.

4. Bottom left, in the Summary box, type `first version`.
5. Click **Commit to main**.
6. Click **Publish repository** at the top.
7. ⚠️ **Tick the box that says "Keep this code private."**
8. Click **Publish repository**.

✅ **You should see:** the button at the top changes to "Fetch origin".

---

# Part 2 — On Render

## Step 4: Create the two services

1. Go to your Render dashboard.
2. Click **New +** (top right) → **Blueprint**.
3. Find your `sale-order-cleaned` repository in the list and click **Connect**.
4. Render reads a file in your project and offers to create two things:
   **sale-order-api** and **sale-order-web**.
5. Click **Apply**.

Now wait. This takes about five minutes.

> **The API will fail. That is expected.** It does not know your database
> details yet. Step 5 fixes it. Carry on.

---

## Step 5: Get your database address

Open your `sale-order-cleaned` folder → `backend` folder → open the file
called `.env` with Notepad.

Find the line starting with `MONGO_URL=`.

Copy everything **after** the `=` sign. It looks like:

```
mongodb+srv://myuser:mypassword@something.mongodb.net/
```

That is your database address. Keep Notepad open too.

---

## Step 6: Fill in the API settings

In Render, click **sale-order-api**, then click **Environment** in the left menu.

You will add four things. For each one, click **Add Environment Variable**,
type the name in the first box, paste the value in the second box.

| Name to type | What to paste |
|---|---|
| `MONGO_URL` | The address from Step 5 |
| `DB_NAME` | `sale_order_db` |
| `APP_USERNAME` | From the Step 2 window |
| `APP_PASSWORD_HASH` | From the Step 2 window |

> `JWT_SECRET` is already there. Render made one for you. **Leave it alone.**

Click **Save changes**. Render starts again on its own. Wait a few minutes.

✅ **You should see:** a green **Live** label at the top.

Now click the address at the top of the page. A page opens showing:

```json
{"message":"Order Ledger API","status":"ok"}
```

That means the API is working. **Copy that address from your browser bar.**
Remove the `/` at the end if there is one.

---

## Step 7: Tell the website where the API is

In Render, click **sale-order-web** → **Environment**.

Add one thing:

| Name to type | What to paste |
|---|---|
| `REACT_APP_BACKEND_URL` | The API address you just copied |

Click **Save changes**.

Then click **Manual Deploy** (top right) → **Deploy latest commit**.

> This last click matters. The website only picks up that address when it is
> rebuilt. Saving alone does nothing.

Wait a few minutes.

✅ **You should see:** a green **Live** label, and an address at the top.
**That address is your app.** Write it down.

---

# Part 3 — Let Render reach your database

Right now your database only accepts connections from your own PC.

1. Go to cloud.mongodb.com and sign in.
2. Left menu → **Network Access**.
3. Click **Add IP Address**.
4. Click **Allow access from anywhere**.
5. Make sure there is **no expiry time** set.
6. Click **Confirm**.

Wait until the status says **Active** — about a minute.

> **Is that safe?** It allows someone to *try* to connect from anywhere, but
> they still need your database username and password. It is a second lock,
> not the only one.

---

# Part 4 — Try it

Open the website address from Step 7.

✅ You should see the **sign-in screen**. Sign in with the username and
password from Step 1.

Check three things:

1. The Dashboard loads.
2. You can open Sale Orders and see your orders.
3. Masters → **Download Backup** gives you a file.

**Done.** You can now open that address from any phone or computer.

---

# Two things to do afterwards

Not urgent. Do them this week.

### Change your database password

That password appeared in a screenshot weeks ago, and it is now reachable from
the internet.

1. cloud.mongodb.com → **Database Access** → click **Edit** on your user.
2. Click **Autogenerate Secure Password**, then **Copy**, then **Update User**.
3. Use only letters and numbers if it offers a choice. Symbols cause problems.
4. Put the new address in **both** places:
   - `backend/.env` on your PC (the `MONGO_URL=` line)
   - Render → sale-order-api → Environment → `MONGO_URL`

### Lock the API to your website

Right now any website could talk to your API. To fix that:

Render → **sale-order-api** → **Environment** → Add:

| Name | Value |
|---|---|
| `CORS_ORIGINS` | Your website address from Step 7 |

Save. It restarts on its own.

---

# Things you will want to know

**It is slow the first time each day.** The free plan puts the app to sleep
when unused. The first page load takes about 50 seconds while it wakes up.
Everything after that is normal speed.

To stop that: Render → sale-order-api → **Settings** → **Instance Type** →
choose **Starter ($7/month)**. Takes effect immediately. No other changes.

**Staying signed in.** 30 days per device. **Sign Out** is top right.

**Someone got your password?** Render → sale-order-api → Environment →
change `JWT_SECRET` to any long random text and save. Everyone is signed out
at once, everywhere.

**Making changes later.** Open GitHub Desktop, type a summary, click
**Commit to main**, then **Push origin**. Render updates itself within minutes.

**Your PC still works.** `start-app.bat` runs your local copy exactly as
before. Both use the same database, so both show the same orders.

---

# If something goes wrong

| What you see | What to do |
|---|---|
| Website shows sign-in but nothing loads after | Wait a minute — the API is waking up. Still nothing? Recheck Step 7, then Deploy latest commit again. |
| "Could not reach the backend" | The API is asleep, or Step 7's address has a typo or a `/` on the end. |
| Sign-in says wrong password | `APP_PASSWORD_HASH` was pasted incomplete. It is very long — copy the whole thing again from Step 2. |
| API page won't open at all | Open sale-order-api → **Logs**. If it mentions `APP_PASSWORD_HASH`, Step 6 was missed. If it mentions SSL or a timeout, redo Part 3. |
| Website build failed | Open the log. Anything else — send me the last 20 lines and I will tell you what it means. |

Stuck anywhere? Tell me the step number and what you see on screen.
