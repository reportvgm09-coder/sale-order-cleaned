import { useEffect, useMemo, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { addMasterConfirmed } from "@/lib/masters";
import { useAuth } from "@/context/Auth";
import { num, today, fmtDate } from "@/lib/format";
import { MasterPicker, genOrderId } from "@/components/FastOrderEntry";
import { StatusBadge, StateBadge } from "@/components/StatusBadge";
import { Loader } from "@/components/Loader";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, X, Save, Pencil, Trash2, ScrollText } from "lucide-react";

const NONE = "__none__";

let itemKey = 0;
const blankItem = () => ({ key: `it-${++itemKey}`, brand_id: "", qty: "" });

// The salesman's own app: enter an order, see the orders he has entered.
// Everything about which salesman it is gets decided by the server from his
// login, so there is no salesman field here at all.
export default function MyOrders() {
  const { salesmanId } = useAuth();
  const [masters, setMasters] = useState({ customers: [], brands: [], exhibitions: [], seasons: [], lines: [], salesmen: [] });
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  // { type, name, city, apply } - one small dialog for a new shop or a new line
  const [newMaster, setNewMaster] = useState(null);
  const [draft, setDraft] = useState(() => ({
    id: genOrderId(),
    order_date: today(),
    customer_id: "",
    event_type: "door_to_door",
    exhibition_id: "",
    line_id: "",
    season_id: NONE,
    items: [blankItem()],
  }));

  const load = async () => {
    try {
      const [o, c, b, e, se, ln, sm] = await Promise.all([
        api.listSaleOrders(),
        api.listMasters("customers"),
        api.listMasters("brands"),
        api.listMasters("exhibitions"),
        api.listMasters("seasons"),
        api.listMasters("lines"),
        api.listMasters("salesmen"),
      ]);
      setOrders(o);
      setMasters({ customers: c, brands: b, exhibitions: e, seasons: se, lines: ln, salesmen: sm });
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line

  const myName = masters.salesmen.find((s) => s.id === salesmanId)?.name;
  const myLines = useMemo(() => masters.lines.filter((l) => l.salesman_id === salesmanId), [masters.lines, salesmanId]);
  const nameOf = (list, id) => masters[list].find((m) => m.id === id)?.name || "—";

  const setItem = (key, patch) => setDraft((d) => ({ ...d, items: d.items.map((it) => (it.key === key ? { ...it, ...patch } : it)) }));
  const pickBrand = (key, brand) => setItem(key, { brand_id: brand.id });
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, blankItem()] }));
  const removeItem = (key) =>
    setDraft((d) => ({ ...d, items: d.items.length === 1 ? [blankItem()] : d.items.filter((it) => it.key !== key) }));

  const totalPcs = draft.items.reduce((s, it) => s + (Number(it.qty) || 0), 0);

  // Where and when stay as they were, so the next order from the same street
  // or the same stall is only a customer and a few brands away.
  const nextOrder = () => {
    setEditing(null);
    setDraft((d) => ({ ...d, id: genOrderId(), customer_id: "", items: [blankItem()] }));
  };

  const save = async () => {
    if (!draft.customer_id) return toast.error("Pick the customer");
    if (draft.event_type === "exhibition" && !draft.exhibition_id) return toast.error("Pick the exhibition");
    const items = draft.items
      .filter((it) => it.brand_id && Number(it.qty) > 0)
      // No rate: a salesman never sees prices, and the server sets each one
      // from the brand (or keeps what the office already gave it).
      .map((it) => ({ brand_id: it.brand_id, qty: Number(it.qty) || 0 }));
    if (items.length === 0) return toast.error("Add at least one brand with a quantity");
    const door = draft.event_type === "door_to_door";
    const payload = {
      id: draft.id,
      order_date: draft.order_date || null,
      customer_id: draft.customer_id,
      event_type: draft.event_type,
      exhibition_id: door ? null : draft.exhibition_id,
      // filled in by the server from the login; sent only to satisfy the shape
      salesman_id: door ? salesmanId : null,
      line_id: door ? draft.line_id || null : null,
      season_id: draft.season_id === NONE ? null : draft.season_id,
      items,
    };
    setSaving(true);
    try {
      if (editing) {
        await api.updateSaleOrder(editing, payload);
        toast.success(`Order ${draft.id} updated`);
      } else {
        await api.createSaleOrder(payload);
        toast.success(`Order ${draft.id} saved - ${num(totalPcs)} pcs`);
      }
      nextOrder();
      load();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (o) => {
    setEditing(o.id);
    setDraft({
      id: o.id,
      order_date: o.order_date || today(),
      customer_id: o.customer_id || "",
      event_type: o.event_type || "door_to_door",
      exhibition_id: o.exhibition_id || "",
      line_id: o.line_id || "",
      season_id: o.season_id || NONE,
      items: (o.items || []).map((it) => ({ key: `it-${++itemKey}`, brand_id: it.brand_id, qty: it.qty })),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const remove = async (o) => {
    if (!window.confirm(`Delete order ${o.id} for ${nameOf("customers", o.customer_id)}?`)) return;
    try {
      await api.deleteSaleOrder(o.id);
      toast.success("Deleted");
      if (editing === o.id) nextOrder();
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const submitNewMaster = async () => {
    const name = (newMaster.name || "").trim();
    const city = (newMaster.city || "").trim();
    if (!name) return toast.error(newMaster.type === "customers" ? "Enter the shop name" : "Enter the area, e.g. Amravati");
    if (newMaster.type === "customers" && !city) return toast.error("Enter the city");
    try {
      // The server makes any line he adds his own, whatever is sent.
      const payload = newMaster.type === "customers" ? { name, city } : { name, salesman_id: salesmanId };
      const rec = await addMasterConfirmed(newMaster.type, payload);
      if (!rec) return;
      setMasters((m) => ({ ...m, [newMaster.type]: [...m[newMaster.type], rec].sort((a, b) => a.name.localeCompare(b.name)) }));
      newMaster.apply(rec);
      setNewMaster(null);
      toast.success(`${rec.name} added`);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  if (loading) return <Loader label="Loading…" />;

  return (
    <div className="space-y-6" data-testid="my-orders-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Orders</h1>
        <p className="text-sm text-muted-foreground">
          {myName ? `Entering as ${myName}. ` : ""}Only the orders you enter are shown here.
        </p>
      </div>

      <Card className="rounded-sm border-2 border-border p-4 shadow-none sm:p-5" data-testid="my-order-form">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-primary" />
            <h2 className="font-display text-lg font-bold tracking-tight">{editing ? `Edit ${editing}` : "New Order"}</h2>
          </div>
          {editing ? (
            <Button data-testid="my-order-cancel-edit" variant="ghost" size="sm" onClick={nextOrder} className="gap-1">
              <X className="h-4 w-4" /> Cancel
            </Button>
          ) : (
            <span className="font-mono text-xs text-muted-foreground" data-testid="my-order-id">{draft.id}</span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Label className="text-xs uppercase tracking-widest">Date</Label>
            <Input
              data-testid="my-order-date"
              type="date"
              value={draft.order_date}
              onChange={(e) => setDraft({ ...draft, order_date: e.target.value })}
              className="mt-1 h-9 rounded-sm border-2"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Taken</Label>
            <Select value={draft.event_type} onValueChange={(v) => setDraft({ ...draft, event_type: v })}>
              <SelectTrigger data-testid="my-order-event-type" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="door_to_door">Door to door</SelectItem>
                <SelectItem value="exhibition">At an exhibition</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {draft.event_type === "exhibition" ? (
            <div>
              <Label className="text-xs uppercase tracking-widest">Exhibition</Label>
              <div className="mt-1">
                <MasterPicker
                  testid="my-order-exhibition"
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
                  testid="my-order-line"
                  items={myLines}
                  value={draft.line_id}
                  onChange={(x) => setDraft({ ...draft, line_id: x.id })}
                  onCreate={(q) => setNewMaster({ type: "lines", name: q, city: "", apply: (rec) => setDraft((d) => ({ ...d, line_id: rec.id })) })}
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
              <SelectTrigger data-testid="my-order-season" className="mt-1 h-9 rounded-sm border-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>— None —</SelectItem>
                {masters.seasons.map((x) => <SelectItem key={x.id} value={x.id}>{x.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2 lg:col-span-4">
            <Label className="text-xs uppercase tracking-widest">Customer</Label>
            <div className="mt-1">
              <MasterPicker
                testid="my-order-customer"
                items={masters.customers}
                value={draft.customer_id}
                onChange={(x) => setDraft({ ...draft, customer_id: x.id })}
                onCreate={(q) => setNewMaster({ type: "customers", name: q, city: "", apply: (rec) => setDraft((d) => ({ ...d, customer_id: rec.id })) })}
                search={(c) => `${c.name} ${c.city || ""}`}
                suffix={(c) => c.city}
                placeholder="Pick or add the shop"
                addLabel="customer"
                triggerClass="border-2"
              />
            </div>
          </div>
        </div>

        {/* Brands - a card per line so it still reads on a phone */}
        <div className="mt-5 space-y-2">
          <div className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Brands</div>
          {draft.items.map((it, idx) => (
            <div key={it.key} className="grid grid-cols-[1fr_96px_auto] items-center gap-2 rounded-sm border border-border p-2 sm:grid-cols-[minmax(160px,1fr)_140px_40px]" data-testid={`my-order-item-${idx}`}>
              <div className="min-w-0">
                <MasterPicker
                  testid={`my-order-brand-${idx}`}
                  items={masters.brands}
                  value={it.brand_id}
                  onChange={(b) => pickBrand(it.key, b)}
                  placeholder="Brand"
                  addLabel="brand"
                />
              </div>
              <Input
                data-testid={`my-order-qty-${idx}`}
                type="number"
                inputMode="numeric"
                min="0"
                placeholder="Pieces"
                value={it.qty}
                onChange={(e) => setItem(it.key, { qty: e.target.value })}
                className="h-9 rounded-sm text-right"
              />
              <Button variant="ghost" size="icon" onClick={() => removeItem(it.key)} className="h-8 w-8 text-destructive" data-testid={`my-order-remove-${idx}`} title="Remove">
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
            <Button data-testid="my-order-add-item" variant="outline" size="sm" onClick={addItem} className="gap-1 rounded-sm">
              <Plus className="h-4 w-4" /> Add brand
            </Button>
            <div className="text-sm">
              Total: <span className="font-display text-lg font-bold tabular-nums" data-testid="my-order-total">{num(totalPcs)} pcs</span>
            </div>
          </div>
        </div>

        <Button data-testid="my-order-save" onClick={save} disabled={saving} className="mt-4 w-full gap-2 rounded-sm sm:w-auto">
          <Save className="h-4 w-4" /> {editing ? "Save changes" : "Save order"}
        </Button>
      </Card>

      <Card className="rounded-sm border-border shadow-none" data-testid="my-order-list">
        <div className="border-b border-border p-4">
          <h2 className="font-display text-lg font-bold tracking-tight">My orders</h2>
          <p className="text-xs text-muted-foreground">
            {num(orders.length)} order{orders.length === 1 ? "" : "s"}. Once goods go out on an order, only the office can change it.
          </p>
        </div>
        {orders.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">No orders entered yet.</div>
        ) : (
          <ul className="divide-y divide-border">
            {orders.map((o) => {
              const t = o.totals || {};
              const locked = (t.dispatched_qty || 0) > 0;
              return (
                <li key={o.id} className="flex flex-wrap items-start justify-between gap-3 p-4" data-testid={`my-order-${o.id}`}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{nameOf("customers", o.customer_id)}</span>
                      <StatusBadge status={t.status} />
                      <StateBadge state={o.state} />
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {o.id} · {fmtDate(o.order_date)} ·{" "}
                      {o.event_type === "exhibition" ? nameOf("exhibitions", o.exhibition_id) : o.line_id ? nameOf("lines", o.line_id) : "Door to door"}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground">
                      {(o.items || []).map((it) => `${nameOf("brands", it.brand_id)} × ${num(it.qty)}`).join(", ")}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold tabular-nums">{num(t.ordered_qty)} pcs</div>
                    <div className="text-xs text-muted-foreground">
                      {num(t.dispatched_qty)} of {num(t.ordered_qty)} sent
                    </div>
                    <div className="mt-1 flex justify-end gap-1">
                      <Button
                        data-testid={`my-order-edit-${o.id}`}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        disabled={locked}
                        title={locked ? "Goods have gone out - ask the office to change it" : "Edit"}
                        onClick={() => startEdit(o)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        data-testid={`my-order-delete-${o.id}`}
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        disabled={locked}
                        title={locked ? "Goods have gone out - ask the office to change it" : "Delete"}
                        onClick={() => remove(o)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Dialog open={!!newMaster} onOpenChange={(v) => !v && setNewMaster(null)}>
        <DialogContent className="rounded-sm sm:max-w-sm" data-testid="my-new-master-dialog">
          <DialogHeader>
            <DialogTitle>{newMaster?.type === "customers" ? "New customer" : "New line"}</DialogTitle>
            <DialogDescription>
              {newMaster?.type === "customers" ? "A shop that is not on the list yet." : "A new trip of yours - usually named after the area."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              submitNewMaster();
            }}
          >
            <div>
              <Label className="text-xs uppercase tracking-widest">{newMaster?.type === "customers" ? "Shop name" : "Area"}</Label>
              <Input
                data-testid="my-new-master-name"
                autoFocus
                value={newMaster?.name || ""}
                onChange={(e) => setNewMaster((m) => ({ ...m, name: e.target.value }))}
                className="mt-1 rounded-sm border-2"
              />
            </div>
            {newMaster?.type === "customers" && (
              <div>
                <Label className="text-xs uppercase tracking-widest">City</Label>
                <Input
                  data-testid="my-new-master-city"
                  value={newMaster?.city || ""}
                  onChange={(e) => setNewMaster((m) => ({ ...m, city: e.target.value }))}
                  className="mt-1 rounded-sm border-2"
                />
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNewMaster(null)} className="rounded-sm">Cancel</Button>
              <Button type="submit" data-testid="my-new-master-save" className="rounded-sm">Add</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
