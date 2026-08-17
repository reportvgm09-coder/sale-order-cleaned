import { useEffect, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { inr, num, today } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Truck, Pencil, Plus, X } from "lucide-react";

// Radix Select cannot use "" as an item value, so a sentinel stands in for "not set".
const NONE = "__none__";
const toSel = (v) => v || NONE;
const fromSel = (v) => (v === NONE ? null : v || null);
const blankItem = () => ({ id: `tmp-${Math.random().toString(36).slice(2, 8)}`, brand_id: "", rate: "", qty: "" });

export function DispatchDialog({ order, open, onOpenChange, onDone }) {
  const [date, setDate] = useState(today());
  const [qty, setQty] = useState({});
  const [amount, setAmount] = useState({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setDate(today());
      setQty({});
      setAmount({});
    }
  }, [open]);

  if (!order) return null;
  const rows = (order.brand_rows || []).filter((r) => r.pending > 0);

  const submit = async () => {
    const items = rows
      .map((r) => {
        const typed = String(amount[r.brand_id] ?? "").trim();
        return {
          brand_id: r.brand_id,
          qty: Number(qty[r.brand_id]) || 0,
          // blank means "value it at the order rate", which is what happened
          // before this field existed
          amount: typed === "" ? null : Number(typed) || 0,
        };
      })
      .filter((it) => it.qty > 0);
    if (items.length === 0) return toast.error("Enter a dispatch quantity");
    const over = items.find((it) => it.qty > rows.find((r) => r.brand_id === it.brand_id).pending);
    if (over) return toast.error("Quantity exceeds pending for a brand");
    const negative = items.find((it) => it.amount !== null && it.amount < 0);
    if (negative) return toast.error("Amount cannot be negative");
    setSaving(true);
    try {
      await api.createDispatch({ sale_order_id: order.id, dispatch_date: date, items });
      toast.success("Dispatch saved");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg rounded-sm border-2 border-border" data-testid="ledger-dispatch-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Dispatch · {order.id}</DialogTitle>
          <DialogDescription>Enter quantities to dispatch. Leave the amount blank to value it at the order rate, or type what it actually came to.</DialogDescription>
        </DialogHeader>
        <div>
          <Label className="text-xs uppercase tracking-widest">Dispatch Date</Label>
          <Input data-testid="ledger-dispatch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 rounded-sm border-2" />
        </div>
        <div className="mt-2 rounded-sm border border-border">
          <div className="grid grid-cols-[1fr_70px_80px_90px_120px] gap-2 border-b border-border bg-secondary/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <div>Brand</div><div className="text-right">Ordered</div><div className="text-right">Pending</div><div className="text-right">Dispatch</div><div className="text-right">Actual ₹</div>
          </div>
          {rows.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Nothing pending on this order.</div>
          ) : (
            rows.map((r) => {
              const q = Number(qty[r.brand_id]) || 0;
              const suggested = q * (r.rate || 0);
              return (
                <div key={r.brand_id} className="grid grid-cols-[1fr_70px_80px_90px_120px] items-center gap-2 px-3 py-2" data-testid={`ledger-dispatch-item-${r.brand_id}`}>
                  <div className="text-sm font-medium">{r.brand}</div>
                  <div className="text-right tabular-nums text-sm">{num(r.ordered)}</div>
                  <div className="text-right tabular-nums text-sm font-semibold text-amber-700">{num(r.pending)}</div>
                  <div className="flex justify-end">
                    <Input
                      data-testid={`ledger-dispatch-qty-${r.brand_id}`}
                      type="number"
                      min="0"
                      max={r.pending}
                      value={qty[r.brand_id] || ""}
                      onChange={(e) => setQty({ ...qty, [r.brand_id]: e.target.value })}
                      className="h-8 w-20 rounded-sm border-2 text-right"
                      placeholder="0"
                    />
                  </div>
                  <div className="flex flex-col items-end">
                    <Input
                      data-testid={`ledger-dispatch-amount-${r.brand_id}`}
                      type="number"
                      min="0"
                      value={amount[r.brand_id] ?? ""}
                      onChange={(e) => setAmount({ ...amount, [r.brand_id]: e.target.value })}
                      className="h-8 w-28 rounded-sm border-2 text-right"
                      placeholder={q > 0 ? String(Math.round(suggested)) : "optional"}
                    />
                    {q > 0 && (
                      <span className="mt-0.5 text-[10px] text-muted-foreground">
                        {String(amount[r.brand_id] ?? "").trim() === "" ? `${inr(suggested)} at order rate` : `${inr((Number(amount[r.brand_id]) || 0) / q)} each`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-sm">Cancel</Button>
          <Button data-testid="ledger-dispatch-save" onClick={submit} disabled={saving || rows.length === 0} className="gap-2 rounded-sm">
            <Truck className="h-4 w-4" /> Save Dispatch
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EditOrderDialog({ order, customer, masters, open, onOpenChange, onDone }) {
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && order) {
      setDraft({
        order_date: order.order_date || today(),
        dispatch_date: order.dispatch_date || "",
        event_type: order.event_type || "exhibition",
        exhibition_id: toSel(order.exhibition_id),
        salesman_id: toSel(order.salesman_id),
        season_id: toSel(order.season_id),
        items: (order.items || []).length
          ? order.items.map((it) => ({
              id: it.id || `tmp-${Math.random().toString(36).slice(2, 8)}`,
              brand_id: it.brand_id || "",
              rate: it.rate ?? "",
              qty: it.qty ?? "",
            }))
          : [blankItem()],
      });
    }
  }, [open, order]);

  if (!order || !draft) return null;

  // How much has already gone out per brand — an edit must never drop below this.
  const dispatchedByBrand = {};
  (order.brand_rows || []).forEach((r) => {
    dispatchedByBrand[r.brand_id] = r.dispatched || 0;
  });
  const brandName = (bid) =>
    masters.brands.find((b) => b.id === bid)?.name ||
    (order.brand_rows || []).find((r) => r.brand_id === bid)?.brand ||
    bid;

  const setField = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setItem = (idx, key, val) =>
    setDraft((d) => ({ ...d, items: d.items.map((it, i) => (i === idx ? { ...it, [key]: val } : it)) }));
  const selectBrand = (idx, brandId) => {
    const b = masters.brands.find((x) => x.id === brandId);
    setDraft((d) => ({
      ...d,
      items: d.items.map((it, i) => {
        if (i !== idx) return it;
        const empty = it.rate === "" || it.rate == null || Number(it.rate) === 0;
        return { ...it, brand_id: brandId, rate: empty && b?.rate ? b.rate : it.rate };
      }),
    }));
  };
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
  const removeItem = (idx) => setDraft((d) => ({ ...d, items: d.items.filter((_, i) => i !== idx) }));

  const total = draft.items.reduce((s, it) => s + (Number(it.rate) || 0) * (Number(it.qty) || 0), 0);

  const submit = async () => {
    const items = draft.items
      .filter((it) => it.brand_id && Number(it.qty) > 0)
      .map((it) => ({ brand_id: it.brand_id, rate: Number(it.rate) || 0, qty: Number(it.qty) || 0 }));
    if (items.length === 0) return toast.error("Add at least one item with a brand and quantity");

    const newByBrand = {};
    items.forEach((it) => {
      newByBrand[it.brand_id] = (newByBrand[it.brand_id] || 0) + it.qty;
    });
    const shortfall = Object.entries(dispatchedByBrand).find(([bid, disp]) => disp > 0 && (newByBrand[bid] || 0) < disp);
    if (shortfall) {
      return toast.error(
        `${num(shortfall[1])} pcs of ${brandName(shortfall[0])} have already been dispatched — the order quantity cannot go below that.`
      );
    }

    setSaving(true);
    try {
      await api.updateSaleOrder(order.id, {
        id: order.id,
        order_date: draft.order_date || null,
        customer_id: customer?.id || order.customer_id || null,
        dispatch_date: draft.dispatch_date || null,
        event_type: draft.event_type,
        exhibition_id: draft.event_type === "exhibition" ? fromSel(draft.exhibition_id) : null,
        salesman_id: draft.event_type === "door_to_door" ? fromSel(draft.salesman_id) : null,
        season_id: fromSel(draft.season_id),
        items,
      });
      toast.success("Sale order updated");
      onOpenChange(false);
      onDone();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto rounded-sm border-2 border-border" data-testid="ledger-edit-dialog">
        <DialogHeader>
          <DialogTitle className="font-display">Edit Order · {order.id}</DialogTitle>
          <DialogDescription>
            Quick edit for {customer?.name || "this order"}. The order ID and customer stay fixed — use the Sale Orders page to change those.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label className="text-xs uppercase tracking-widest">Order Date</Label>
            <Input data-testid="ledger-edit-order-date" type="date" value={draft.order_date} onChange={(e) => setField({ order_date: e.target.value })} className="mt-1 rounded-sm border-2" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Dispatch Date</Label>
            <Input data-testid="ledger-edit-dispatch-date" type="date" value={draft.dispatch_date} onChange={(e) => setField({ dispatch_date: e.target.value })} className="mt-1 rounded-sm border-2" />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Event Type</Label>
            <Select value={draft.event_type} onValueChange={(v) => setField({ event_type: v })}>
              <SelectTrigger data-testid="ledger-edit-event-type" className="mt-1 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exhibition">Exhibition</SelectItem>
                <SelectItem value="door_to_door">Door to Door</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.event_type === "exhibition" ? (
            <div>
              <Label className="text-xs uppercase tracking-widest">Exhibition</Label>
              <Select value={draft.exhibition_id} onValueChange={(v) => setField({ exhibition_id: v })}>
                <SelectTrigger data-testid="ledger-edit-exhibition" className="mt-1 rounded-sm border-2"><SelectValue placeholder="Select exhibition" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {masters.exhibitions.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <div>
              <Label className="text-xs uppercase tracking-widest">Sales Man</Label>
              <Select value={draft.salesman_id} onValueChange={(v) => setField({ salesman_id: v })}>
                <SelectTrigger data-testid="ledger-edit-salesman" className="mt-1 rounded-sm border-2"><SelectValue placeholder="Select salesman" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>— None —</SelectItem>
                  {masters.salesmen.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}
          <div>
            <Label className="text-xs uppercase tracking-widest">Season</Label>
            <Select value={draft.season_id} onValueChange={(v) => setField({ season_id: v })}>
              <SelectTrigger data-testid="ledger-edit-season" className="mt-1 rounded-sm border-2"><SelectValue placeholder="Select season" /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {masters.seasons.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Line items */}
        <div className="mt-2 rounded-sm border border-border">
          <div className="grid grid-cols-[1fr_100px_90px_110px_36px] gap-2 border-b border-border bg-secondary/60 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <div>Brand</div><div>Rate (₹)</div><div>Qty</div><div className="text-right">Amount</div><div />
          </div>
          {draft.items.map((it, idx) => {
            const disp = dispatchedByBrand[it.brand_id] || 0;
            return (
              <div key={it.id} className="grid grid-cols-[1fr_100px_90px_110px_36px] items-center gap-2 px-3 py-2" data-testid={`ledger-edit-item-${idx}`}>
                <div>
                  <Select value={it.brand_id} onValueChange={(v) => selectBrand(idx, v)}>
                    <SelectTrigger data-testid={`ledger-edit-brand-${idx}`} className="rounded-sm"><SelectValue placeholder="Brand" /></SelectTrigger>
                    <SelectContent>
                      {masters.brands.map((b) => <SelectItem key={b.id} value={b.id}>{b.name}{b.rate ? ` · ₹${b.rate}` : ""}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  {disp > 0 && <p className="mt-0.5 text-[10px] text-muted-foreground">{num(disp)} already dispatched</p>}
                </div>
                <Input data-testid={`ledger-edit-rate-${idx}`} type="number" value={it.rate} onChange={(e) => setItem(idx, "rate", e.target.value)} className="h-9 rounded-sm" />
                <Input data-testid={`ledger-edit-qty-${idx}`} type="number" value={it.qty} onChange={(e) => setItem(idx, "qty", e.target.value)} className="h-9 rounded-sm" />
                <div className="text-right tabular-nums text-sm font-medium">{inr((Number(it.rate) || 0) * (Number(it.qty) || 0))}</div>
                <Button data-testid={`ledger-edit-remove-${idx}`} variant="ghost" size="icon" onClick={() => removeItem(idx)} className="h-8 w-8 text-destructive">
                  <X className="h-4 w-4" />
                </Button>
              </div>
            );
          })}
          <div className="flex items-center justify-between border-t border-border px-3 py-2">
            <Button data-testid="ledger-edit-add-item" variant="outline" size="sm" onClick={addItem} className="gap-1 rounded-sm">
              <Plus className="h-4 w-4" /> Add Item Row
            </Button>
            <div className="text-sm">Total: <span className="font-display text-lg font-bold tabular-nums" data-testid="ledger-edit-total">{inr(total)}</span></div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="rounded-sm">Cancel</Button>
          <Button data-testid="ledger-edit-save" onClick={submit} disabled={saving} className="gap-2 rounded-sm">
            <Pencil className="h-4 w-4" /> Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
