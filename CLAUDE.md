# Order Ledger — project notes

Context for whoever picks this up next, human or Claude. Read before changing
anything: several decisions here look odd until you know why.

---

## What this is

A sale order and dispatch tracker for a garment distribution business in India.
Orders are taken at **exhibitions** or by **door-to-door salesmen**, in pieces,
against **brands**, grouped by **season**. Goods are dispatched in parts over
time, so "ordered" and "dispatched" are always separate numbers.

Single owner-operator. One login. Money is in INR.

---

## Layout

```
backend/          FastAPI + MongoDB (Motor). Everything is in server.py.
frontend/         Create React App + craco, Tailwind, shadcn/ui, Radix.
*.bat             Double-clickable helpers for a non-technical Windows user.
DEPLOY.md         Step-by-step hosting guide, written for a beginner.
MAKING-CHANGES.md Day-to-day "I want to change something" guide.
render.yaml       Render blueprint: API (web service) + site (static).
```

**Data lives in MongoDB Atlas** (free M0). Local and hosted share the same
cluster, so a test order on localhost is a real order in production.

### Running locally

`start-app.bat` — installs anything missing, sets a password on first run,
opens two windows. Frontend on 3000, API on 8000.

Other helpers: `set-password.bat`, `show-hosting-values.bat`, `check-db.bat`,
`restore-backup.bat`.

---

## Decisions that will confuse you otherwise

### Order rates are indicative. Dispatch amounts are real.

The rate on a sale order line is the brand's general rate. The **actual** money
is only known at dispatch. So a dispatch line carries an optional `amount`:

- **blank/null** → value it at the order's rate (what happened before this existed)
- **a number** → that is the truth, use it
- **`0`** → it genuinely went out free. Not the same as blank.

`brand_dispatched_value()` mixes both: a brand part-shipped with an amount and
part without gets actual money for the priced portion and order rates for the
rest. Rates are **blended per brand**, not per order, because one brand can sit
on several order lines at different rates.

**Four places compute dispatched value** — the ledger, `get_sale_order`,
`/reports` and the expense summary. They must always agree. There is a test
asserting exactly that. Do not add a fifth without one.

### Quantities and money are independent

Order status (pending / partial / done) is driven purely by **quantity**.
Entering a dispatch amount must never change what is outstanding.

### Expenses are vouchers, charged to an exhibition or a salesman

One expense = one date + one target + several head lines (Hotel, Vehicle…).
Never both an exhibition and a salesman; `expense_doc()` nulls the other one.

`/expenses/summary` takes `basis=order|dispatch` — compare cost against
everything ordered, or only what shipped. **Both values are always returned**
so the UI can show one against the other without refetching.

Every filter (dates, season, exhibition, salesman) goes through one shared
`keep()` gate applied to **both** expenses and orders. If the two sides were
filtered differently, a row would compare one season's costs against every
season's revenue and read as far more profitable than it was.

### Expense heads are an ordinary master type

`expense_heads` is in `MASTER_TYPES`, so it gets CRUD, bulk import and
near-duplicate detection free. Seeded on startup **only when the collection is
empty**, so a head deliberately deleted does not come back.

### Reads must never truncate silently

`to_list(5000)` used to be everywhere, quietly dropping everything past the
5000th document — wrong totals, no error. All reads now go through
`fetch_all()`, which warns at 20k and logs `TRUNCATED` at the 250k ceiling.
**Never reintroduce a bare `to_list(n)`.**

### Dates are calendar days, and three formats have to agree

Stored as plain `YYYY-MM-DD` - a day, with no time and no timezone. Three rules
keep that honest, all in `lib/format.js` and `lib/excel.js`:

- `today()` is built from the **local** clock. `toISOString()` is UTC, which
  before 05:30 in India answers with yesterday - an order typed at 1am was
  filed a day early, and at a month end in the wrong month entirely.
- `fmtDate()` splits `YYYY-MM-DD` by hand rather than letting `new Date()`
  read it as UTC midnight, which prints as the day before west of UTC.
- `xlDate()` builds the Date for Excel at **UTC** midnight, because that is how
  ExcelJS converts one to a cell - a local midnight lands a day early. Exports
  carry real dates with a `dd-mmm-yyyy` format, not text, so Excel can sort,
  filter and group by month.

Coming back the other way, `sheetDate()` normalises whatever a spreadsheet cell
holds - a real Date, a bare serial number, or text - to `YYYY-MM-DD`. The
importer used to read only the text case, so a cell Excel had turned into a real
date arrived as `"46252.7708"` and was stored as the order date; nothing
validated it, and `fin_year()` duly reported FY 4624-25.

### Near-duplicate masters return 409, not 400

Adding "Raj Textile" when "Raj Textiles" exists returns **409** with the
matches. The UI shows them and offers `force: true`. 400 would read as
"invalid"; this is "needs confirming". Deliberately errs slightly noisy —
a false warning costs one click, a missed duplicate splits a customer's history.

Every inline "add new" — including the pickers on the Fast Entry pad, which can
create a customer, brand, exhibition, salesman or season without leaving the
row — goes through `addMasterConfirmed()`, so the warning still fires. A quick
add that posted straight to the API would quietly undo the whole point of it.

### The Orders grid is driven by one column list

`pages/Orders.jsx` is the spreadsheet-style view: every column heading carries
a funnel that opens its own filter, the way Excel does it - so filtering costs
no vertical space. The heading, each filter, each body cell, the column picker
and the grand total are all generated from a single `COLUMNS` array.

Columns can be hidden, so the total row's `colSpan` values are measured off the
**visible** columns at render time, never typed in - see the table rule under
Conventions. Note `colSpan={0}` means "span the rest" in HTML, not "span
nothing", so the label cell is dropped rather than given a zero span.

Which columns are hidden is remembered as the list you turned **off**, for the
same reason the export dialog does it that way.

The sideways scrollbar is duplicated above the grid, because the real one sits
below a table that can be hundreds of rows tall. It reaches the scrolling
element through `table.parentElement` - the `Table` component owns that wrapper
and does not expose it.

`pctOf()` is the only place the dispatched percentage is worked out, so the bar
and the number printed beside it cannot drift apart.

It reads `/sale-orders` plus the master lists once and does everything else in
the browser, so filtering never goes back to the server. It deliberately shows
order value and pending value only - **not** dispatched value, which would have
made a fifth place computing it.

### Export column memory stores what you turned OFF

`ExportDialog` saves the **excluded** columns, not the included ones. If it
saved your selection, a column added later would be missing from your exports
forever and you would never know. New columns default to on.

### Auth refuses to start rather than run open

No `APP_PASSWORD_HASH` or `JWT_SECRET` → `RuntimeError` at import. A
"no password configured" fallback is how an app ends up publicly readable.
The guard is on the **router** (`dependencies=[Depends(require_auth)]`), so a
new endpoint is protected by default. Only `/api/auth/login`, `/api/` and `/`
are public — there is a whitelist test asserting nothing else is.

---

## Gotchas

| Thing | Why |
|---|---|
| `REACT_APP_BACKEND_URL` is baked in at **build** time | Changing it needs a redeploy, not just a save. Catches everyone. |
| `CI=false` on the static site | Render sets `CI=true`; CRA then fails the build on any lint warning. |
| SPA rewrite in `render.yaml` | Without it, refreshing on `/customers/CUST-123` 404s. |
| Everything is under `/api` | The bare `/` is a status page only. |
| Radix `Select` cannot use `""` as an item value | Hence the `NONE = "__none__"` sentinel and `toSel`/`fromSel`. |
| `.bat` files need CRLF | Enforced in `.gitattributes`. LF can make Windows stop mid-script. |
| Atlas free tier has no Mumbai region | And Render's free plan has no fixed IP, so the access list must be `0.0.0.0/0`. |
| `.env` is gitignored | Never commit it. Check the file list before publishing. |

---

## Conventions

- **Backend is one file.** `server.py`. Keep helpers near their use.
- **Comments explain *why*, never *what*.** If a line needs "what", rewrite it.
- **User-facing text is plain English**, no jargon. Errors say what to do next,
  and name only the thing actually wrong.
- **Money via `inr()`, counts via `num()`** — never raw numbers in the UI.
- **`data-testid` on anything interactive.**
- Tables: header, body and the `colSpan` total row must agree on width. A
  miscount silently shifts every figure one column.

---

## Testing

There is no test runner in this repo. Verification so far has been done by
**extracting the real logic out of the shipped files and running it** — e.g.
pulling the payload builder out of `FastOrderEntry.jsx`, or importing
`server.py` with stubbed FastAPI/Motor and an in-memory database. That
approach caught real bugs (an order-ID generator that wrapped and collided; a
`customer_history` refactor that had to be proved byte-for-byte identical).

If you add tests properly, the highest-value ones:

1. All four dispatched-value computations agree for the same order.
2. Old dispatches with no `amount` still fall back to order rates.
3. Only login and the two status routes are public.
4. Expense summary totals equal the sum of their rows, on both bases.

---

## Known gaps

- **Dashboard fires ~6 database queries sequentially.** Running them together
  would cut its wait to roughly one round trip. Biggest easy win.
- **No pagination anywhere.** Fine now, warns at 20k documents.
- **Single user.** No roles, no audit trail of who changed what.
- **Order edits overwrite** with no history.
- **Dispatches can be deleted but not edited.**
- When Mongo is unreachable at boot, the index loop logs the same error 17
  times, once per index.

---

## Hosting

Render, free tier. `sale-order-api` (Python web service) and `sale-order-web`
(static site). Pushing to `main` redeploys both automatically.

The free API sleeps after ~15 minutes idle; first request then takes ~50s.
$7/month on Starter removes that. Full walkthrough in `DEPLOY.md`.
