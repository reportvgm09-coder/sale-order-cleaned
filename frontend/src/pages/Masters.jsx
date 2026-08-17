import { useEffect, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { addMasterConfirmed } from "@/lib/masters";
import { readWorkbookRows, downloadSheet } from "@/lib/excel";
import { inr } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Plus, X, Upload, Download, Users, Tag, Store, UserCog, CalendarRange, Pencil, Check, DatabaseBackup, ShieldAlert, Wallet } from "lucide-react";

const LISTS = [
  { type: "customers", label: "Customers", icon: Users, hasCity: true },
  { type: "brands", label: "Brands", icon: Tag, hasRate: true },
  { type: "seasons", label: "Seasons", icon: CalendarRange },
  { type: "exhibitions", label: "Exhibitions", icon: Store },
  { type: "salesmen", label: "Salesmen", icon: UserCog },
  { type: "expense_heads", label: "Expense Heads", icon: Wallet },
];

function MasterPanel({ type, label, icon: Icon, hasCity, hasRate }) {
  const [items, setItems] = useState([]);
  const [name, setName] = useState("");
  const [extra, setExtra] = useState("");
  const [editId, setEditId] = useState(null);
  const [editName, setEditName] = useState("");
  const [editExtra, setEditExtra] = useState("");
  const [selected, setSelected] = useState([]);

  const toggleSel = (id) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));

  const load = async () => {
    try {
      setItems(await api.listMasters(type));
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  useEffect(() => {
    load();
  }, []); // eslint-disable-line

  const add = async () => {
    const n = name.trim();
    if (!n) return toast.error("Name is required");
    if (hasCity && !extra.trim()) return toast.error("City is required for customers");
    try {
      const payload = { name: n };
      if (hasCity) payload.city = extra.trim();
      if (hasRate) payload.rate = Number(extra) || 0;
      const created = await addMasterConfirmed(type, payload);
      if (!created) return; // the user looked at the near-duplicates and backed out
      setName("");
      setExtra("");
      toast.success(`${label.slice(0, -1)} added`);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const startEdit = (it) => {
    setEditId(it.id);
    setEditName(it.name);
    setEditExtra(hasCity ? it.city || "" : hasRate ? (it.rate ?? "") : "");
  };

  const saveEdit = async () => {
    if (!editName.trim()) return toast.error("Name is required");
    if (hasCity && !editExtra.trim()) return toast.error("City is required for customers");
    try {
      const body = { name: editName.trim() };
      if (hasCity) body.city = editExtra.trim();
      if (hasRate) body.rate = Number(editExtra) || 0;
      await api.updateMaster(type, editId, body);
      setEditId(null);
      toast.success("Saved");
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const remove = async (id) => {
    try {
      await api.deleteMaster(type, id);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const bulkDelete = async () => {
    if (!window.confirm(`Delete ${selected.length} selected ${label.toLowerCase()}?`)) return;
    try {
      await api.bulkDeleteMasters(type, selected);
      toast.success(`Deleted ${selected.length}`);
      setSelected([]);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const importList = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const rows = await readWorkbookRows(file);
      let body;
      if (hasCity) {
        const parsed = rows
          .map((r) => ({ name: String(r["Name"] ?? Object.values(r)[0] ?? "").trim(), city: String(r["City"] ?? Object.values(r)[1] ?? "").trim() }))
          .filter((r) => r.name && r.city);
        if (parsed.length === 0) return toast.error("Need 'Name' and 'City' columns for customers");
        body = { rows: parsed };
      } else if (hasRate) {
        const parsed = rows
          .map((r) => ({ name: String(r["Name"] ?? Object.values(r)[0] ?? "").trim(), rate: Number(r["Rate"] ?? Object.values(r)[1] ?? 0) || 0 }))
          .filter((r) => r.name);
        if (parsed.length === 0) return toast.error("No names found in file");
        body = { rows: parsed };
      } else {
        const names = rows.map((r) => String(Object.values(r)[0] || "").trim()).filter(Boolean);
        if (names.length === 0) return toast.error("No names found in file");
        body = { names };
      }
      const res = await api.bulkMaster(type, body);
      toast.success(`Added ${res.added} ${label.toLowerCase()}`);
      load();
    } catch (err) {
      toast.error(apiErr(err));
    } finally {
      e.target.value = "";
    }
  };

  const template = () =>
    downloadSheet(
      hasCity ? [{ Name: "Acme Traders", City: "Mumbai" }] : hasRate ? [{ Name: "Nova Wear", Rate: 500 }] : [{ Name: `Sample ${label.slice(0, -1)}` }],
      label,
      `${type}-template.xlsx`
    );

  const twoCol = hasCity || hasRate;
  const extraPlaceholder = hasCity ? "City" : "Rate ₹";

  return (
    <Card className="rounded-sm border-2 border-border shadow-none" data-testid={`master-${type}`}>
      <div className="flex items-center gap-2 border-b border-border p-4">
        <div className="flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-accent text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <h3 className="font-display text-base font-bold tracking-tight">{label}</h3>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Checkbox data-testid={`master-select-all-${type}`} checked={items.length > 0 && selected.length === items.length} onCheckedChange={(v) => setSelected(v ? items.map((i) => i.id) : [])} /> All
          </label>
          <span className="rounded-sm border border-border px-2 py-0.5 text-xs text-muted-foreground">{items.length}</span>
        </div>
      </div>
      {selected.length > 0 && (
        <div className="flex items-center justify-between border-b border-border bg-accent/40 px-4 py-2" data-testid={`master-bulk-bar-${type}`}>
          <span className="text-xs font-medium">{selected.length} selected</span>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setSelected([])} className="h-7 rounded-sm text-xs">Clear</Button>
            <Button data-testid={`master-bulk-delete-${type}`} variant="destructive" size="sm" onClick={bulkDelete} className="h-7 gap-1 rounded-sm text-xs">
              <X className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      )}
      <div className="p-4">
        <div className={`grid gap-2 ${twoCol ? "grid-cols-[1fr_1fr_auto]" : "grid-cols-[1fr_auto]"}`}>
          <Input data-testid={`master-input-${type}`} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={`Add ${label.slice(0, -1).toLowerCase()}…`} className="rounded-sm border-2" />
          {twoCol && (
            <Input data-testid={`master-extra-${type}`} type={hasRate ? "number" : "text"} value={extra} onChange={(e) => setExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={extraPlaceholder} className="rounded-sm border-2" />
          )}
          <Button data-testid={`master-add-${type}`} onClick={add} className="gap-1 rounded-sm">
            <Plus className="h-4 w-4" /> Add
          </Button>
        </div>

        <div className="mt-3 flex items-center gap-3 text-xs">
          <label className="inline-flex cursor-pointer items-center gap-1 rounded-sm border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
            <Upload className="h-3.5 w-3.5" /> Import list
            <input data-testid={`master-import-${type}`} type="file" accept=".xlsx,.xls,.csv" onChange={importList} className="hidden" />
          </label>
          <button onClick={template} className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-1 text-muted-foreground hover:text-foreground">
            <Download className="h-3.5 w-3.5" /> Template
          </button>
        </div>

        <div className="mt-3 max-h-64 space-y-1 overflow-auto">
          {items.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border py-6 text-center text-sm text-muted-foreground">Nothing here yet.</div>
          ) : (
            items.map((it) =>
              editId === it.id ? (
                <div key={it.id} className={`grid gap-2 rounded-sm border border-primary/40 bg-accent/40 p-2 ${twoCol ? "grid-cols-[1fr_1fr_auto_auto]" : "grid-cols-[1fr_auto_auto]"}`} data-testid={`master-edit-${it.id}`}>
                  <Input data-testid={`master-edit-name-${it.id}`} value={editName} onChange={(e) => setEditName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} className="h-8 rounded-sm border-2" />
                  {twoCol && <Input data-testid={`master-edit-extra-${it.id}`} type={hasRate ? "number" : "text"} value={editExtra} onChange={(e) => setEditExtra(e.target.value)} onKeyDown={(e) => e.key === "Enter" && saveEdit()} placeholder={extraPlaceholder} className="h-8 rounded-sm border-2" />}
                  <Button data-testid={`master-save-${it.id}`} size="icon" onClick={saveEdit} className="h-8 w-8 rounded-sm"><Check className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={() => setEditId(null)} className="h-8 w-8"><X className="h-4 w-4" /></Button>
                </div>
              ) : (
                <div key={it.id} className="flex items-center justify-between rounded-sm border border-border px-3 py-1.5 text-sm" data-testid={`master-item-${it.id}`}>
                  <span className="flex items-center gap-2">
                    <Checkbox data-testid={`master-select-${it.id}`} checked={selected.includes(it.id)} onCheckedChange={() => toggleSel(it.id)} />
                    <span>
                      {it.name}
                      {hasCity && it.city ? <span className="ml-2 text-xs text-muted-foreground">· {it.city}</span> : null}
                      {hasCity && !it.city ? <span className="ml-2 text-xs font-medium text-amber-600">· city missing</span> : null}
                      {hasRate ? <span className="ml-2 text-xs font-medium text-primary">· {it.rate ? inr(it.rate) : "no rate"}</span> : null}
                      {hasCity ? <span className="ml-2 font-mono text-[10px] text-muted-foreground">{it.id}</span> : null}
                    </span>
                  </span>
                  <div className="flex items-center gap-1">
                    <button data-testid={`master-edit-btn-${it.id}`} onClick={() => startEdit(it)} className="text-muted-foreground hover:text-primary"><Pencil className="h-3.5 w-3.5" /></button>
                    <button data-testid={`master-remove-${it.id}`} onClick={() => remove(it.id)} className="text-muted-foreground hover:text-destructive"><X className="h-4 w-4" /></button>
                  </div>
                </div>
              )
            )
          )}
        </div>
      </div>
    </Card>
  );
}

function BackupPanel() {
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);

  const download = async () => {
    setBusy(true);
    try {
      const data = await api.backup();
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `order-ledger-backup-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setLast(data.counts);
      const total = Object.values(data.counts).reduce((s, n) => s + n, 0);
      toast.success(`Backup downloaded — ${total} records`);
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="rounded-sm border-2 border-border shadow-none" data-testid="backup-panel">
      <div className="flex items-center gap-2 border-b border-border p-4">
        <DatabaseBackup className="h-4 w-4 text-primary" />
        <div>
          <h2 className="font-display text-lg font-bold tracking-tight">Backup</h2>
          <p className="text-xs text-muted-foreground">Everything you have — orders, dispatches and all master lists — in one file.</p>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-start gap-2 rounded-sm border-2 border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <p>
            Your data lives only in MongoDB Atlas. If that cluster is ever paused, deleted or lost, there is no other copy.
            Download a backup now and then, and keep it somewhere other than this PC.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Button data-testid="backup-download-btn" onClick={download} disabled={busy} className="gap-2 rounded-sm">
            <Download className="h-4 w-4" /> {busy ? "Preparing…" : "Download Backup"}
          </Button>
          {last && (
            <span className="text-xs text-muted-foreground" data-testid="backup-counts">
              {Object.entries(last).map(([k, v]) => `${v} ${k.replace(/_/g, " ")}`).join(" · ")}
            </span>
          )}
        </div>

        <p className="text-xs text-muted-foreground">
          To restore one, double-click <span className="font-mono text-foreground">restore-backup.bat</span> in the project folder
          and point it at the file. It refuses to write over a database that already has records unless you explicitly confirm,
          so it can't wipe your live data by accident.
        </p>
      </div>
    </Card>
  );
}

export default function Masters() {
  // Reaching any page at all now means signed in, so there is no second gate here.
  return (
    <div className="space-y-6" data-testid="masters-view">
      <div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight">Masters</h1>
        <p className="text-sm text-muted-foreground">Manage customers (with city), brands (with default rate), seasons, exhibitions and salesmen. Click the pencil to edit any entry.</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {LISTS.map((l) => (
          <MasterPanel key={l.type} {...l} />
        ))}
      </div>
      <BackupPanel />
    </div>
  );
}
