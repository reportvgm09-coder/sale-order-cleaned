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

The brand ledger is not a fifth: it reads `dispatched_value` straight off
`build_brand_rows()`, which is the same `brand_dispatched_value()` the other
four run on. Anything new that needs this figure should do the same rather than
sum it again.

### An order's state is set by hand; its status is not

Two different things, deliberately kept apart. `status` (pending / partial /
done) is derived from quantity and nothing else. `state` is a decision somebody
made about the order, one of:

| state | means | effect on the numbers |
|---|---|---|
| `open` | the ordinary case | none |
| `hold` | paused, but still owed | **none** - it stays in every outstanding total |
| `half` | the "50%" mark | **none** - a label and a row colour, nothing else |
| `cancelled` | nothing more will ship | stops counting as outstanding |

An order can be half dispatched *and* on hold, which is why one field cannot
carry both.

Cancelling zeroes pending quantity and pending value, drops the order off the
dashboard entirely, and makes the dispatch dialog offer nothing - but it never
touches what already went out. That stock and that money really moved, so
`ordered_qty`, `amount` and `dispatched_qty` all stay as they were, and a
cancelled order that was half shipped still reads as `partial`. In the expense
summary a cancelled order's ordered value is only what actually shipped;
counting the whole order would park the difference in pending value for good.

The zeroing happens **after** the status is worked out, not before - otherwise
cancelling an order would flip it to "done".

Every form that saves an order must send `state` back. A PUT that leaves it out
gets the model default and quietly reopens something somebody had cancelled.
The colours live in one list in `lib/orderState.js`, so the picker, the badge,
the row tint and the grid's column filter cannot drift apart. Amber, not
yellow, for 50%: the pale yellows read as a highlighter rather than mustard.

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

### A line is one door-to-door trip

Gopal spends twelve days working Amravati, comes home, then goes out to Katni.
Those are two **lines**. Hanging everything off the salesman put both trips'
orders and both trips' costs in one bucket, so neither could be judged on its
own.

A line is an ordinary master (`lines` in `MASTER_TYPES`) with one addition: it
**belongs to a salesman**, and the server refuses to create one without a valid
`salesman_id`. That ownership is why two things behave differently here:

- Near-duplicate detection is scoped to the owner. Two salesmen may each work an
  "Amravati", and warning about the other man's is noise - so `find_similar()`
  takes a `within` filter. A salesman's *own* second Amravati is still warned.
- Bulk import matches the Salesman column by name and **skips** rows that match
  nobody, rather than creating an ownerless line that could never be tracked.

Orders and expense vouchers both carry `line_id`, nulled whenever the event type
is not door-to-door - the same rule `expense_doc()` already applied to
exhibition and salesman.

`/expenses/summary` takes `group=target|line`. `target` is the old behaviour, one
row per exhibition and per salesman; `line` splits door-to-door into one row per
trip and leaves exhibitions alone. Work before lines existed collects under
"No line set" rather than disappearing.

The refactor that made this safe: `doc_context()` says where a voucher or order
*belongs*, and `bucket_for()` says which row it *lands in*. Keeping them apart is
what lets the rows be split by line while a filter still narrows by salesman -
one gate, both sides, as the expenses rule below requires.

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

### The brand ledger is the customer ledger read down the other axis

`/customers/:id` answers "what does this shop still have coming". `/brands/:id`
answers "how is this brand moving, and who is holding it" — same shape, same
dialogs, the other axis of the same order lines.

Every figure on it is **that brand's share of the order, not the order**, which
is why the ordered column also prints the whole order's size beneath it. Two
things are deliberately the whole order's, not the brand's:

- **Status.** An order is what gets dispatched. Calling one brand "done" while
  the rest of its order is still outstanding reads as a shipment that never
  happened.
- **What Edit and Dispatch open.** A brand row is one order *line*, so the page
  fetches the full order through `/sale-orders/{id}` on click and hands it to
  the shared dialogs — the same trick `Reports.jsx` uses for the same reason.

The overview counts an order once per brand it carries, so a brand's "orders" is
how many orders it appears on. Customer counts are per brand and deliberately
have **no** grand total: one shop buying three brands would be counted three
times.

`items.brand_id` is indexed, because the history looks orders up by the brands
sitting on their lines.

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

### The loader plays itself

`components/Loader.jsx` is Space Invaders on a canvas, and it is attract-mode
first: it plays on its own, an arrow key or the on-screen buttons hand you the
ship, and six idle seconds hand it back. Nobody should have to play a game to
see their orders. It knows nothing about the request it is waiting on.

Three things in it look arbitrary and are not:

- The autopilot **aims where the target will be.** The block keeps marching
  while a shot is in the air, so firing at an invader's current position mostly
  misses - it cleared barely half a wave a minute before the lead was added.
- A dodge is **held until that bomb is past.** Deciding afresh each frame reads
  as a dodge but is not one: the instant the ship is clear the threat looks
  gone, it steers back, and it dies anyway. Committing took it from roughly
  eight deaths a minute to under one.
- `dt` is clamped **at both ends.** The ceiling stops a backgrounded tab
  handing back a multi-second step that tunnels bullets through invaders; the
  floor matters because the first frame's timestamp can predate the clock read
  when the effect ran, and a negative step drives the whole game backwards.

Under `prefers-reduced-motion` it draws one still frame and never starts the
loop or the key listeners.

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
The loader was checked the same way: Babel the shipped `.jsx` to CommonJS, stub
the three hooks and a canvas, and drive `requestAnimationFrame` by hand - which
is also how the frames were rasterised to PNG to look at the sprites.

If you add tests properly, the highest-value ones:

1. All four dispatched-value computations agree for the same order.
2. Old dispatches with no `amount` still fall back to order rates.
3. Only login and the two status routes are public.
4. Expense summary totals equal the sum of their rows, on both bases.
5. A cancelled order is outstanding nowhere, and hold / 50% change no number.

The order-state work was checked exactly that way - `server.py` imported with
Motor swapped for an in-memory stub, then the endpoint functions called
directly (the auth guard is on the router, not on them).

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
