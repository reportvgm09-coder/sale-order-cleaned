import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { useAuth } from "@/context/Auth";
import { inr, num, fmtDate, today, xlDate } from "@/lib/format";
import { ExportDialog } from "@/components/ExportDialog";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader } from "@/components/Loader";
import { toast } from "sonner";
import { Plus, X, Wallet, Pencil, Trash2, FileSpreadsheet, FilterX, TrendingUp, TrendingDown, Receipt } from "lucide-react";

const NONE = "__none__";
const toSel = (v) => v || NONE;
const fromSel = (v) => (v === NONE ? null : v || null);

const BASIS_LABEL = { order: "Order Value", dispatch: "Dispatched Value" };
const BASIS_SHORT = { order: "ordered", dispatch: "dispatched" };

const blankLine = () => ({ key: `l-${Math.random().toString(36).slice(2, 8)}`, head_id: "", amount: "", note: "" });
const blankDraft = () => ({
  expense_date: today(),
  event_type: "exhibition",
  exhibition_id: "",
  salesman_id: "",
  season_id: NONE,
  note: "",
  items: [blankLine(), blankLine()],
});

const Stat = ({ label, value, sub, testid, tone }) => (
  <Card data-testid={testid} className="rounded-sm border-2 border-border p-4 shadow-none">
    <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{label}</div>
    <div className={`mt-1 font-display text-2xl font-extrabold tabular-nums ${tone || ""}`}>{value}</div>
    {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
  </Card>
);

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [summary, setSummary] = useState(null);
  const [masters, setMasters] = useState({ exhibitions: [], salesmen: [], seasons: [], expense_heads: [] });
  const [draft, setDraft] = useState(blankDraft());
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [f, setF] = useState({
    start: "",
    end: "",
    season: "all",
    exhibition: "all",
    salesman: "all",
    basis: "order", // order = everything ordered, dispatch = only what shipped
  });
  const [view, setView] = useState("all"); // all | exhibition | salesman
  const [exportOpen, setExportOpen] = useState(false);
  const { requireUnlock } = useAuth();

  const loadSummary = async (next = f) => {
    try {
      const params = { basis: next.basis };
      if (next.start) params.start = next.start;
      if (next.end) params.end = next.end;
      if (next.season !== "all") params.season = next.season;
      if (next.exhibition !== "all") params.exhibition = next.exhibition;
      if (next.salesman !== "all") params.salesman = next.salesman;
      setSummary(await api.expenseSummary(params));
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const load = async () => {
    try {
      const [list, ex, sm, se, hd] = await Promise.all([
        api.listExpenses(),
        api.listMasters("exhibitions"),
        api.listMasters("salesmen"),
        api.listMasters("seasons"),
        api.listMasters("expense_heads"),
      ]);
      setExpenses(list);
      setMasters({ exhibitions: ex, salesmen: sm, seasons: se, expense_heads: hd });
      await loadSummary();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line

  const setItem = (key, patch) =>
    setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const addLine = () => setDraft((d) => ({ ...d, items: [...d.items, blankLine()] }));
  const removeLine = (key) =>
    setDraft((d) => ({ ...d, items: d.items.length === 1 ? [blankLine()] : d.items.filter((it) => it.key !== key) }));

  const draftTotal = draft.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  const resetForm = () => {
    setDraft(blankDraft());
    setEditing(null);
  };

  const submit = async () => {
    const items = draft.items
      .filter((it) => it.head_id && Number(it.amount) !== 0)
      .map((it) => ({ head_id: it.head_id, amount: Number(it.amount) || 0, note: it.note?.trim() || null }));
    if (items.length === 0) return toast.error("Add at least one head with an amount");
    if (draft.event_type === "exhibition" && !draft.exhibition_id) return toast.error("Pick the exhibition this is for");
    if (draft.event_type === "door_to_door" && !draft.salesman_id) return toast.error("Pick the salesman this is for");

    const payload = {
      expense_date: draft.expense_date || null,
      event_type: draft.event_type,
      exhibition_id: draft.event_type === "exhibition" ? draft.exhibition_id : null,
      salesman_id: draft.event_type === "door_to_door" ? draft.salesman_id : null,
      season_id: fromSel(draft.season_id),
      note: draft.note?.trim() || null,
      items,
    };
    try {
      if (editing) {
        await api.updateExpense(editing, payload);
        toast.success("Expense updated");
      } else {
        await api.createExpense(payload);
        toast.success(`Expense saved — ${inr(draftTotal)}`);
      }
      resetForm();
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const startEdit = (e) => {
    setEditing(e.id);
    setDraft({
      expense_date: e.expense_date || today(),
      event_type: e.event_type || "exhibition",
      exhibition_id: e.exhibition_id || "",
      salesman_id: e.salesman_id || "",
      season_id: toSel(e.season_id),
      note: e.note || "",
      items: (e.items || []).map((it) => ({
        key: it.id || `l-${Math.random().toString(36).slice(2, 8)}`,
        head_id: it.head_id || "",
        amount: it.amount ?? "",
        note: it.note || "",
      })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete this ${inr(e.total)} expense from ${fmtDate(e.expense_date)}?`)) return;
    try {
      await api.deleteExpense(e.id);
      toast.success("Deleted");
      load();
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  // Exhibition and salesman are mutually exclusive - a voucher is charged to one
  // or the other, so holding both would always give an empty table.
  const applyF = (patch) => {
    const next = { ...f, ...patch };
    if (patch.exhibition && patch.exhibition !== "all") next.salesman = "all";
    if (patch.salesman && patch.salesman !== "all") next.exhibition = "all";
    setF(next);
    loadSummary(next);
  };

  const resetF = () => {
    const next = { start: "", end: "", season: "all", exhibition: "all", salesman: "all", basis: "order" };
    setF(next);
    setView("all");
    loadSummary(next);
  };

  const activeCount =
    (f.start ? 1 : 0) + (f.end ? 1 : 0) +
    ["season", "exhibition", "salesman"].filter((k) => f[k] !== "all").length +
    (view !== "all" ? 1 : 0);

  const rows = useMemo(() => {
    const all = summary?.rows || [];
    return view === "all" ? all : all.filter((r) => r.type === view);
  }, [summary, view]);

  const shown = useMemo(
    () =>
      expenses.filter((x) => {
        const d = x.expense_date || "";
        if (f.start && d < f.start) return false;
        if (f.end && d > f.end) return false;
        if (f.season !== "all" && x.season_id !== f.season) return false;
        const isSalesman = x.event_type === "door_to_door";
        if (f.exhibition !== "all" && !(!isSalesman && x.exhibition_id === f.exhibition)) return false;
        if (f.salesman !== "all" && !(isSalesman && x.salesman_id === f.salesman)) return false;
        if (view === "exhibition" && isSalesman) return false;
        if (view === "salesman" && !isSalesman) return false;
        return true;
      }),
    [expenses, f, view]
  );

  const exportSheets = [
    {
      name: "By Exhibition & Salesman",
      data: summary?.rows || [],
      columns: [
        { key: "Type", get: (r) => (r.type === "exhibition" ? "Exhibition" : "Salesman") },
        { key: "Name", get: (r) => r.name },
        { key: "Vouchers", get: (r) => r.voucher_count },
        { key: "Expense (INR)", get: (r) => r.expense },
        { key: "Orders", get: (r) => r.order_count },
        { key: "Order Value (INR)", get: (r) => r.order_value },
        { key: "Dispatched Value (INR)", get: (r) => r.dispatched_value },
        { key: "Pending Value (INR)", get: (r) => r.pending_value },
        { key: "Compared Against", get: () => BASIS_LABEL[f.basis] },
        { key: "Net (INR)", get: (r) => r.net },
        { key: "Expense %", get: (r) => (r.expense_pct == null ? "" : Number(r.expense_pct.toFixed(2))) },
      ],
    },
    {
      name: "By Head",
      data: summary?.by_head || [],
      columns: [
        { key: "Head", get: (h) => h.name },
        { key: "Amount (INR)", get: (h) => h.amount },
      ],
    },
    {
      name: "All Entries",
      data: shown.flatMap((e) => (e.items || []).map((it) => ({ e, it }))),
      columns: [
        { key: "Date", get: (x) => xlDate(x.e.expense_date) },
        { key: "Against", get: (x) => (x.e.event_type === "door_to_door" ? "Salesman" : "Exhibition") },
        { key: "Name", get: (x) => x.e.exhibition || x.e.salesman || "" },
        { key: "Season", get: (x) => x.e.season || "" },
        { key: "Head", get: (x) => x.it.head },
        { key: "Amount", get: (x) => x.it.amount },
        { key: "Line Note", get: (x) => x.it.note || "" },
        { key: "Voucher Note", get: (x) => x.e.note || "" },
      ],
    },
  ];

  if (loading) return <Loader label="Loading expenses…" />;

  const t = summary?.totals || { expense: 0, order_value: 0, dispatched_value: 0, pending_value: 0, value: 0, net: 0, voucher_count: 0 };
  const heads = masters.expense_heads;

  return (
    <div className="space-y-6" data-testid="expenses-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Expenses</h1>
          <p className="text-sm text-muted-foreground">
            What each exhibition and salesman costs you, next to what they brought in.
          </p>
        </div>
        <Button data-testid="expense-export-btn" variant="outline" onClick={() => setExportOpen(true)} className="gap-2 rounded-sm">
          <FileSpreadsheet className="h-4 w-4" /> Export to Excel
        </Button>
      </div>

      <ExportDialog
        open={exportOpen}
        onOpenChange={setExportOpen}
        storageKey="expenses"
        fileName={`expenses-${today()}.xlsx`}
        sheets={exportSheets}
      />

      {/* Entry form */}
      <Card className="rounded-sm border-2 border-border p-5 shadow-none" data-testid="expense-form">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-bold tracking-tight">
              {editing ? "Edit Expense" : "New Expense"}
            </h2>
          </div>
          {editing && (
            <Button data-testid="expense-cancel-edit" variant="ghost" size="sm" onClick={resetForm} className="gap-1">
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <div>
            <Label className="text-xs uppercase tracking-widest">Date</Label>
            <Input
              data-testid="expense-date"
              type="date"
              value={draft.expense_date}
              onChange={(e) => setDraft({ ...draft, expense_date: e.target.value })}
              className="mt-1 h-9 rounded-sm border-2"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Spent On</Label>
            <Select value={draft.event_type} onValueChange={(v) => setDraft({ ...draft, event_type: v })}>
              <SelectTrigger data-testid="expense-event-type" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exhibition">Exhibition</SelectItem>
                <SelectItem value="door_to_door">Salesman</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.event_type === "exhibition" ? (
            <div>
              <Label className="text-xs uppercase tracking-widest">Exhibition</Label>
              <Select value={draft.exhibition_id} onValueChange={(v) => setDraft({ ...draft, exhibition_id: v })}>
                <SelectTrigger data-testid="expense-exhibition" className="mt-1 h-9 rounded-sm border-2"><SelectValue placeholder="Select exhibition" /></SelectTrigger>
                <SelectContent>
                  {masters.exhibitions.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs uppercase tracking-widest">Salesman</Label>
              <Select value={draft.salesman_id} onValueChange={(v) => setDraft({ ...draft, salesman_id: v })}>
                <SelectTrigger data-testid="expense-salesman" className="mt-1 h-9 rounded-sm border-2"><SelectValue placeholder="Select salesman" /></SelectTrigger>
                <SelectContent>
                  {masters.salesmen.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs uppercase tracking-widest">Season</Label>
            <Select value={draft.season_id} onValueChange={(v) => setDraft({ ...draft, season_id: v })}>
              <SelectTrigger data-testid="expense-season" className="mt-1 h-9 rounded-sm border-2"><SelectValue placeholder="Season" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {masters.seasons.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Head lines */}
        <div className="mt-5 rounded-sm border border-border">
          <div className="grid grid-cols-[minmax(140px,1fr)_130px_minmax(160px,1.4fr)_40px] gap-2 border-b border-border bg-secondary/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <div>Head</div><div className="text-right">Amount</div><div>Note</div><div />
          </div>
          {heads.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              No expense heads yet. Add them on the Masters page.
            </div>
          ) : (
            draft.items.map((it, idx) => (
              <div key={it.key} className="grid grid-cols-[minmax(140px,1fr)_130px_minmax(160px,1.4fr)_40px] items-center gap-2 px-3 py-2" data-testid={`expense-line-${idx}`}>
                <Select value={it.head_id} onValueChange={(v) => setItem(it.key, { head_id: v })}>
                  <SelectTrigger data-testid={`expense-head-${idx}`} className="h-9 rounded-sm"><SelectValue placeholder="Head" /></SelectTrigger>
                  <SelectContent>
                    {heads.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  data-testid={`expense-amount-${idx}`}
                  type="number"
                  min="0"
                  value={it.amount}
                  onChange={(e) => setItem(it.key, { amount: e.target.value })}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addLine(); } }}
                  className="h-9 rounded-sm text-right"
                  placeholder="0"
                />
                <Input
                  data-testid={`expense-note-${idx}`}
                  value={it.note}
                  onChange={(e) => setItem(it.key, { note: e.target.value })}
                  className="h-9 rounded-sm"
                  placeholder="optional"
                />
                <Button variant="ghost" size="icon" onClick={() => removeLine(it.key)} className="h-8 w-8 text-destructive" data-testid={`expense-remove-${idx}`}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
            <Button data-testid="expense-add-line" variant="outline" size="sm" onClick={addLine} className="gap-1 rounded-sm">
              <Plus className="h-4 w-4" /> Add Head
            </Button>
            <div className="text-sm">
              Total: <span className="font-display text-lg font-bold tabular-nums" data-testid="expense-draft-total">{inr(draftTotal)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-1">
            <Label className="text-xs uppercase tracking-widest">Note for the whole entry</Label>
            <Input
              data-testid="expense-voucher-note"
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              placeholder="e.g. Day 2 of the fair"
              className="mt-1 h-9 rounded-sm border-2"
            />
          </div>
          <Button data-testid="expense-save-btn" onClick={submit} className="gap-2 rounded-sm">
            <Wallet className="h-4 w-4" /> {editing ? "Save Changes" : "Save Expense"}
          </Button>
        </div>
      </Card>

      {/* Filters */}
      <Card className="rounded-sm border-border p-4 shadow-none" data-testid="expense-filters">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">From</Label>
            <Input data-testid="expense-range-start" type="date" value={f.start} onChange={(e) => applyF({ start: e.target.value })} className="mt-1 h-9 rounded-sm" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">To</Label>
            <Input data-testid="expense-range-end" type="date" value={f.end} onChange={(e) => applyF({ end: e.target.value })} className="mt-1 h-9 rounded-sm" />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Season</Label>
            <Select value={f.season} onValueChange={(v) => applyF({ season: v })}>
              <SelectTrigger data-testid="expense-filter-season" className="mt-1 h-9 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Seasons</SelectItem>
                {masters.seasons.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Exhibition</Label>
            <Select value={f.exhibition} onValueChange={(v) => applyF({ exhibition: v })}>
              <SelectTrigger data-testid="expense-filter-exhibition" className="mt-1 h-9 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Exhibitions</SelectItem>
                {masters.exhibitions.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Salesman</Label>
            <Select value={f.salesman} onValueChange={(v) => applyF({ salesman: v })}>
              <SelectTrigger data-testid="expense-filter-salesman" className="mt-1 h-9 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Salesmen</SelectItem>
                {masters.salesmen.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Show</Label>
            <Select value={view} onValueChange={setView}>
              <SelectTrigger data-testid="expense-view" className="mt-1 h-9 rounded-sm"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Exhibitions & Salesmen</SelectItem>
                <SelectItem value="exhibition">Exhibitions only</SelectItem>
                <SelectItem value="salesman">Salesmen only</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
          <div>
            <Label className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Compare cost against</Label>
            <Select value={f.basis} onValueChange={(v) => applyF({ basis: v })}>
              <SelectTrigger data-testid="expense-basis" className="mt-1 h-9 w-64 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="order">Order value — everything ordered</SelectItem>
                <SelectItem value="dispatch">Dispatched value — only what shipped</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {activeCount > 0 && (
            <Button data-testid="expense-filter-reset" variant="outline" size="sm" onClick={resetF} className="h-9 gap-1 rounded-sm">
              <FilterX className="h-4 w-4" /> Reset {activeCount} filter{activeCount === 1 ? "" : "s"}
            </Button>
          )}
          <span className="max-w-xl text-xs text-muted-foreground">
            Every filter applies to expenses and orders alike, so each row compares like with like.
            {f.basis === "dispatch"
              ? " Orders stay credited to the event where they were taken, valued at what has actually gone out."
              : " Orders are counted in full, whether or not they have shipped yet."}
            {f.season !== "all" ? " Entries with no season set are excluded." : ""}
          </span>
        </div>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat testid="expense-stat-total" label="Total Spent" value={inr(t.expense)} sub={`${num(t.voucher_count)} entries`} tone="text-amber-700" />
        <Stat
          testid="expense-stat-orders"
          label={BASIS_LABEL[f.basis]}
          value={inr(t.value ?? 0)}
          sub={f.basis === "dispatch" ? `${inr(t.pending_value ?? 0)} still to ship` : `${inr(t.dispatched_value ?? 0)} of it dispatched`}
        />
        <Stat
          testid="expense-stat-net"
          label={`${BASIS_LABEL[f.basis]} Less Expenses`}
          value={inr(t.net ?? 0)}
          tone={(t.net ?? 0) < 0 ? "text-destructive" : "text-emerald-700"}
        />
        <Stat
          testid="expense-stat-ratio"
          label={`Spend per ₹100 ${BASIS_SHORT[f.basis]}`}
          value={t.value > 0 ? inr((t.expense / t.value) * 100) : "—"}
        />
      </div>

      {/* Summary by exhibition / salesman */}
      <Card className="rounded-sm border-2 border-border shadow-none" data-testid="expense-summary">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">Where the money went</h2>
          <p className="text-xs text-muted-foreground">
            Each exhibition and salesman, measured against{" "}
            {f.basis === "dispatch" ? "goods actually dispatched" : "everything ordered"}
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Nothing recorded for this period yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="bg-secondary/60">
                  <TableHead className="text-xs uppercase tracking-widest">Exhibition / Salesman</TableHead>
                  <TableHead className="text-xs uppercase tracking-widest">Breakdown</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">Spent</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">{BASIS_LABEL[f.basis]}</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">Net</TableHead>
                  <TableHead className="text-right text-xs uppercase tracking-widest">Cost %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key} className="align-top hover:bg-secondary/40" data-testid={`expense-row-${r.key}`}>
                    <TableCell>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {r.type === "exhibition" ? "Exhibition" : "Salesman"} · {num(r.voucher_count)} entries
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {r.by_head.length === 0 ? "—" : r.by_head.map((h) => (
                        <div key={h.name}>{h.name} · {inr(h.amount)}</div>
                      ))}
                    </TableCell>
                    <TableCell className="text-right tabular-nums font-semibold text-amber-700">{inr(r.expense)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {inr(r.value)}
                      <div className="text-xs text-muted-foreground">
                        {num(r.order_count)} orders ·{" "}
                        {f.basis === "dispatch"
                          ? `${inr(r.pending_value)} pending`
                          : `${inr(r.dispatched_value)} shipped`}
                      </div>
                    </TableCell>
                    <TableCell className={`text-right tabular-nums font-semibold ${r.net < 0 ? "text-destructive" : "text-emerald-700"}`}>
                      <span className="inline-flex items-center gap-1">
                        {r.net < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : <TrendingUp className="h-3.5 w-3.5" />}
                        {inr(r.net)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {r.expense_pct == null ? <span className="text-muted-foreground">—</span> : `${r.expense_pct.toFixed(1)}%`}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="expense-summary-total">
                  <TableCell colSpan={2}>Grand Total</TableCell>
                  <TableCell className="text-right tabular-nums text-amber-700">{inr(t.expense)}</TableCell>
                  <TableCell className="text-right tabular-nums">{inr(t.value ?? 0)}</TableCell>
                  <TableCell className={`text-right tabular-nums ${(t.net ?? 0) < 0 ? "text-destructive" : "text-emerald-700"}`}>{inr(t.net ?? 0)}</TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </Card>

      {/* Entries */}
      <Card className="rounded-sm border-border shadow-none" data-testid="expense-list">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">All Entries</h2>
          <p className="text-xs text-muted-foreground">{shown.length} entr{shown.length === 1 ? "y" : "ies"}</p>
        </div>
        {shown.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No expenses recorded yet.</div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="bg-secondary/60">
                <TableHead className="text-xs uppercase tracking-widest">Date</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Against</TableHead>
                <TableHead className="text-xs uppercase tracking-widest">Heads</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Total</TableHead>
                <TableHead className="text-right text-xs uppercase tracking-widest">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map((e) => (
                <TableRow key={e.id} className="align-top hover:bg-secondary/40" data-testid={`expense-entry-${e.id}`}>
                  <TableCell className="text-muted-foreground">{fmtDate(e.expense_date)}</TableCell>
                  <TableCell>
                    <div className="font-medium">{e.exhibition || e.salesman || "—"}</div>
                    <div className="text-xs text-muted-foreground">
                      {e.event_type === "door_to_door" ? "Salesman" : "Exhibition"}
                      {e.season ? ` · ${e.season}` : ""}
                    </div>
                    {e.note && <div className="mt-0.5 text-xs italic text-muted-foreground">{e.note}</div>}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {e.items.map((it, i) => (
                      <div key={i}>
                        {it.head} · {inr(it.amount)}
                        {it.note ? <span className="ml-1 text-xs italic">({it.note})</span> : null}
                      </div>
                    ))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">{inr(e.total)}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button data-testid={`expense-edit-${e.id}`} variant="ghost" size="icon" className="h-8 w-8" onClick={() => requireUnlock(() => startEdit(e))}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button data-testid={`expense-delete-${e.id}`} variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => requireUnlock(() => remove(e))}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="border-t-2 border-foreground/20 bg-secondary/40 font-semibold" data-testid="expense-list-total">
                <TableCell colSpan={3}>Grand Total</TableCell>
                <TableCell className="text-right tabular-nums">{inr(shown.reduce((s, e) => s + (e.total || 0), 0))}</TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
