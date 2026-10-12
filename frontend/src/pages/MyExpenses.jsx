import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { useAuth } from "@/context/Auth";
import { inr, num, today, fmtDate } from "@/lib/format";
import { MasterPicker } from "@/components/FastOrderEntry";
import { Loader } from "@/components/Loader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Plus, X, Wallet, Pencil, Trash2, Receipt } from "lucide-react";

const NONE = "__none__";

let lineKey = 0;
const blankLine = () => ({ key: `l-${++lineKey}`, head_id: "", amount: "", note: "" });

// The salesman's half of Expenses: put in what a day or a trip cost, and see
// his own entries. None of the profit-and-loss side - that is the office's.
export default function MyExpenses() {
  const { salesmanId, userId } = useAuth();
  const [masters, setMasters] = useState({ exhibitions: [], seasons: [], expense_heads: [], lines: [] });
  const [expenses, setExpenses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(() => ({
    expense_date: today(),
    event_type: "door_to_door",
    exhibition_id: "",
    line_id: "",
    season_id: NONE,
    note: "",
    items: [blankLine(), blankLine()],
  }));

  const load = async () => {
    try {
      const [list, ex, se, hd, ln] = await Promise.all([
        api.listExpenses(),
        api.listMasters("exhibitions"),
        api.listMasters("seasons"),
        api.listMasters("expense_heads"),
        api.listMasters("lines"),
      ]);
      setExpenses(list);
      setMasters({ exhibitions: ex, seasons: se, expense_heads: hd, lines: ln });
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line

  const myLines = useMemo(() => masters.lines.filter((l) => l.salesman_id === salesmanId), [masters.lines, salesmanId]);

  const setItem = (key, patch) => setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const addLine = () => setDraft((d) => ({ ...d, items: [...d.items, blankLine()] }));
  const removeLine = (key) =>
    setDraft((d) => ({ ...d, items: d.items.length === 1 ? [blankLine()] : d.items.filter((it) => it.key !== key) }));

  const draftTotal = draft.items.reduce((s, it) => s + (Number(it.amount) || 0), 0);

  // Date and where stay put - the next voucher is usually the same trip.
  const reset = () => {
    setEditing(null);
    setDraft((d) => ({ ...d, note: "", items: [blankLine(), blankLine()] }));
  };

  const save = async () => {
    const items = draft.items
      .filter((it) => it.head_id && Number(it.amount) !== 0)
      .map((it) => ({ head_id: it.head_id, amount: Number(it.amount) || 0, note: it.note?.trim() || null }));
    if (items.length === 0) return toast.error("Add at least one head with an amount");
    if (draft.event_type === "exhibition" && !draft.exhibition_id) return toast.error("Pick the exhibition this was for");
    const door = draft.event_type === "door_to_door";
    const payload = {
      expense_date: draft.expense_date || null,
      event_type: draft.event_type,
      exhibition_id: door ? null : draft.exhibition_id,
      // the server sets this from the login either way
      salesman_id: door ? salesmanId : null,
      line_id: door ? draft.line_id || null : null,
      season_id: draft.season_id === NONE ? null : draft.season_id,
      note: draft.note?.trim() || null,
      items,
    };
    setSaving(true);
    try {
      if (editing) {
        await api.updateExpense(editing, payload);
        toast.success("Expense updated");
      } else {
        await api.createExpense(payload);
        toast.success(`Expense saved - ${inr(draftTotal)}`);
      }
      reset();
      load();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (e) => {
    setEditing(e.id);
    setDraft({
      expense_date: e.expense_date || today(),
      event_type: e.event_type || "door_to_door",
      exhibition_id: e.exhibition_id || "",
      line_id: e.line_id || "",
      season_id: e.season_id || NONE,
      note: e.note || "",
      items: (e.items || []).map((it) => ({ key: `l-${++lineKey}`, head_id: it.head_id || "", amount: it.amount ?? "", note: it.note || "" })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (e) => {
    if (!window.confirm(`Delete this ${inr(e.total)} expense from ${fmtDate(e.expense_date)}?`)) return;
    try {
      await api.deleteExpense(e.id);
      toast.success("Deleted");
      if (editing === e.id) reset();
      load();
    } catch (err) {
      toast.error(apiErr(err));
    }
  };

  if (loading) return <Loader label="Loading…" />;

  const heads = masters.expense_heads;
  const grand = expenses.reduce((s, e) => s + (e.total || 0), 0);

  return (
    <div className="space-y-6" data-testid="my-expenses-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Expenses</h1>
        <p className="text-sm text-muted-foreground">What a day or a trip cost - yours, and any the office entered under your name.</p>
      </div>

      <Card className="rounded-sm border-2 border-border p-4 shadow-none sm:p-5" data-testid="my-expense-form">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Receipt className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-bold tracking-tight">{editing ? "Edit Expense" : "New Expense"}</h2>
          </div>
          {editing && (
            <Button data-testid="my-expense-cancel-edit" variant="ghost" size="sm" onClick={reset} className="gap-1">
              <X className="h-4 w-4" /> Cancel
            </Button>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs uppercase tracking-widest">Date</Label>
            <Input
              data-testid="my-expense-date"
              type="date"
              value={draft.expense_date}
              onChange={(e) => setDraft({ ...draft, expense_date: e.target.value })}
              className="mt-1 h-9 rounded-sm border-2"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Spent on</Label>
            <Select value={draft.event_type} onValueChange={(v) => setDraft({ ...draft, event_type: v })}>
              <SelectTrigger data-testid="my-expense-event-type" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="door_to_door">Door to door</SelectItem>
                <SelectItem value="exhibition">An exhibition</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.event_type === "exhibition" ? (
            <div>
              <Label className="text-xs uppercase tracking-widest">Exhibition</Label>
              <div className="mt-1">
                <MasterPicker
                  testid="my-expense-exhibition"
                  items={masters.exhibitions}
                  value={draft.exhibition_id}
                  onChange={(x) => setDraft({ ...draft, exhibition_id: x.id })}
                  placeholder="Pick exhibition"
                  addLabel="exhibition"
                  triggerClass="border-2"
                />
              </div>
            </div>
          ) : (
            <div>
              <Label className="text-xs uppercase tracking-widest">Line (trip)</Label>
              <div className="mt-1">
                <MasterPicker
                  testid="my-expense-line"
                  items={myLines}
                  value={draft.line_id}
                  onChange={(x) => setDraft({ ...draft, line_id: x.id })}
                  placeholder="Optional"
                  addLabel="line"
                  triggerClass="border-2"
                />
              </div>
            </div>
          )}
          <div>
            <Label className="text-xs uppercase tracking-widest">Season</Label>
            <Select value={draft.season_id} onValueChange={(v) => setDraft({ ...draft, season_id: v })}>
              <SelectTrigger data-testid="my-expense-season" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {masters.seasons.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="mt-5 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">What it was for</div>
          {heads.length === 0 ? (
            <div className="rounded-sm border border-border p-4 text-center text-sm text-muted-foreground">
              No expense heads have been set up yet - ask the office.
            </div>
          ) : (
            draft.items.map((it, idx) => (
              <div key={it.key} className="grid grid-cols-[1fr_110px_auto] gap-2 sm:grid-cols-[minmax(140px,1fr)_130px_minmax(160px,1.4fr)_40px] sm:items-center" data-testid={`my-expense-line-${idx}`}>
                <Select value={it.head_id} onValueChange={(v) => setItem(it.key, { head_id: v })}>
                  <SelectTrigger data-testid={`my-expense-head-${idx}`} className="h-9 rounded-sm"><SelectValue placeholder="Head" /></SelectTrigger>
                  <SelectContent>
                    {heads.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  data-testid={`my-expense-amount-${idx}`}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  placeholder="₹"
                  value={it.amount}
                  onChange={(e) => setItem(it.key, { amount: e.target.value })}
                  className="h-9 rounded-sm text-right"
                />
                <Input
                  data-testid={`my-expense-note-${idx}`}
                  value={it.note}
                  onChange={(e) => setItem(it.key, { note: e.target.value })}
                  placeholder="Note (optional)"
                  className="col-span-3 row-start-2 h-9 rounded-sm sm:col-span-1 sm:row-start-auto"
                />
                <Button variant="ghost" size="icon" onClick={() => removeLine(it.key)} className="col-start-3 row-start-1 h-9 w-9 text-destructive sm:col-start-auto sm:row-start-auto" data-testid={`my-expense-remove-${idx}`} title="Remove">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button data-testid="my-expense-add-line" variant="outline" size="sm" onClick={addLine} className="gap-1 rounded-sm">
              <Plus className="h-4 w-4" /> Add head
            </Button>
            <div className="text-sm">
              Total: <span className="font-display text-lg font-bold tabular-nums" data-testid="my-expense-total">{inr(draftTotal)}</span>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Label className="text-xs uppercase tracking-widest">Note for the whole entry</Label>
          <Input
            data-testid="my-expense-voucher-note"
            value={draft.note}
            onChange={(e) => setDraft({ ...draft, note: e.target.value })}
            placeholder="e.g. Day 3 in Amravati"
            className="mt-1 h-9 rounded-sm border-2"
          />
        </div>

        <Button data-testid="my-expense-save" onClick={save} disabled={saving} className="mt-4 w-full gap-2 rounded-sm sm:w-auto">
          <Wallet className="h-4 w-4" /> {editing ? "Save changes" : "Save expense"}
        </Button>
      </Card>

      <Card className="rounded-sm border-border shadow-none" data-testid="my-expense-list">
        <div className="flex items-end justify-between border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-bold tracking-tight">My expenses</h2>
            <p className="text-xs text-muted-foreground">{num(expenses.length)} entr{expenses.length === 1 ? "y" : "ies"}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">Total</div>
            <div className="font-display text-lg font-bold tabular-nums" data-testid="my-expense-grand-total">{inr(grand)}</div>
          </div>
        </div>
        {expenses.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No expenses entered yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {expenses.map((e) => (
              <li key={e.id} className="flex flex-wrap items-start justify-between gap-3 p-4" data-testid={`my-expense-${e.id}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">
                    {fmtDate(e.expense_date)} · {e.event_type === "exhibition" ? e.exhibition || "Exhibition" : e.line || "Door to door"}
                  </div>
                  {e.note && <div className="text-xs italic text-muted-foreground">{e.note}</div>}
                  <div className="mt-1 text-sm text-muted-foreground">
                    {e.items.map((it) => `${it.head} ${inr(it.amount)}`).join(", ")}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{inr(e.total)}</div>
                  {/* the office's vouchers for him are his to see, not to change */}
                  {e.created_by !== userId ? (
                    <div className="mt-1"><span data-testid="entered-by-office" className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Entered by office</span></div>
                  ) : (
                  <div className="mt-1 flex justify-end gap-1">
                    <Button data-testid={`my-expense-edit-${e.id}`} variant="ghost" size="icon" className="h-8 w-8" title="Edit" onClick={() => startEdit(e)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button data-testid={`my-expense-delete-${e.id}`} variant="ghost" size="icon" className="h-8 w-8 text-destructive" title="Delete" onClick={() => remove(e)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
