import { useEffect, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { fmtDate } from "@/lib/format";
import { useAuth } from "@/context/Auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, ShieldCheck, Loader2 } from "lucide-react";

// What each role is allowed to do. The server enforces this; the text here is
// only so whoever picks a role knows what they are handing out.
const ROLES = [
  { value: "admin", label: "Admin", help: "Everything, including adding and removing users" },
  { value: "editor", label: "Editor", help: "Add, change and delete orders, dispatches, expenses and masters" },
  { value: "viewer", label: "Viewer", help: "Can look at everything, cannot change anything" },
  { value: "salesman", label: "Salesman", help: "Their own screen: enter orders and expenses, and see only their own" },
];
const roleLabel = (r) => ROLES.find((x) => x.value === r)?.label || r;

const BLANK = { username: "", password: "", role: "editor", salesman_id: "" };

function UserDialog({ open, editing, onClose, onSaved, isSelf, salesmen }) {
  const [form, setForm] = useState(BLANK);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setForm(editing ? { username: editing.username, password: "", role: editing.role, salesman_id: editing.salesman_id || "" } : BLANK);
  }, [open, editing]);

  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {
    if (!form.username.trim()) return toast.error("Enter a username");
    if (!editing && !form.password) return toast.error("Enter a password for the new user");
    if (form.role === "salesman" && !form.salesman_id) return toast.error("Choose which salesman this login is for");
    setBusy(true);
    try {
      if (editing) {
        const body = { username: form.username.trim(), role: form.role, salesman_id: form.salesman_id || null };
        // blank means "leave the password alone"
        if (form.password) body.password = form.password;
        await api.updateUser(editing.id, body);
        toast.success(form.password ? "Saved - they will need to sign in again with the new password" : "Saved");
      } else {
        await api.createUser({ ...form, username: form.username.trim(), salesman_id: form.salesman_id || null });
        toast.success(`${form.username.trim()} can now sign in`);
      }
      onSaved();
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="rounded-sm sm:max-w-md" data-testid="user-dialog">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${editing.username}` : "Add a user"}</DialogTitle>
          <DialogDescription>
            {editing ? "Leave the password blank to keep the current one." : "They sign in with this username and password."}
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <div>
            <Label className="text-xs uppercase tracking-widest">Username</Label>
            <Input
              data-testid="user-username"
              autoFocus
              autoComplete="off"
              value={form.username}
              onChange={(e) => set("username")(e.target.value)}
              className="mt-1 rounded-sm border-2"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">{editing ? "New password" : "Password"}</Label>
            <Input
              data-testid="user-password"
              type="password"
              autoComplete="new-password"
              placeholder={editing ? "Unchanged" : "At least 8 characters"}
              value={form.password}
              onChange={(e) => set("password")(e.target.value)}
              className="mt-1 rounded-sm border-2"
            />
          </div>
          <div>
            <Label className="text-xs uppercase tracking-widest">Role</Label>
            <Select value={form.role} onValueChange={set("role")} disabled={isSelf}>
              <SelectTrigger data-testid="user-role" className="mt-1 rounded-sm border-2">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r.value} value={r.value} data-testid={`user-role-${r.value}`}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-xs text-muted-foreground">
              {isSelf ? "You cannot change your own role." : ROLES.find((r) => r.value === form.role)?.help}
            </p>
          </div>
          {form.role === "salesman" && (
            <div>
              <Label className="text-xs uppercase tracking-widest">Which salesman</Label>
              <Select value={form.salesman_id} onValueChange={set("salesman_id")}>
                <SelectTrigger data-testid="user-salesman" className="mt-1 rounded-sm border-2">
                  <SelectValue placeholder={salesmen.length ? "Pick from your salesmen" : "Add salesmen on the Masters page first"} />
                </SelectTrigger>
                <SelectContent>
                  {salesmen.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="mt-1 text-xs text-muted-foreground">Their door-to-door orders and expenses are filed under this name.</p>
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} className="rounded-sm" data-testid="user-cancel">
              Cancel
            </Button>
            <Button type="submit" disabled={busy} className="gap-2 rounded-sm" data-testid="user-save">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Add user"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Users() {
  const { user, isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState({ open: false, editing: null });
  const [salesmen, setSalesmen] = useState([]);

  const load = async () => {
    try {
      const [u, sm] = await Promise.all([api.listUsers(), api.listMasters("salesmen")]);
      setUsers(u);
      setSalesmen(sm);
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin]); // eslint-disable-line

  const remove = async (u) => {
    if (!window.confirm(`Delete ${u.username}? They will be signed out straight away and will not be able to sign in again.`)) return;
    try {
      await api.deleteUser(u.id);
      toast.success(`${u.username} deleted`);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  if (!isAdmin) {
    return (
      <Card className="rounded-sm border-2 p-6 text-sm text-muted-foreground" data-testid="users-not-allowed">
        Only an admin can manage users.
      </Card>
    );
  }

  const isSelf = (u) => u.username.toLowerCase() === (user || "").toLowerCase();

  return (
    <div className="space-y-6" data-testid="users-view">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">Users</h1>
          <p className="text-sm text-muted-foreground">
            Who can sign in, and what each of them is allowed to do. Changes take effect on their very next click.
          </p>
        </div>
        <Button data-testid="add-user-btn" onClick={() => setDialog({ open: true, editing: null })} className="gap-2 rounded-sm">
          <Plus className="h-4 w-4" /> Add user
        </Button>
      </div>

      <Card className="rounded-sm border-2 p-0 shadow-none">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Username</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Added</TableHead>
              <TableHead className="w-28 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && (
              <TableRow>
                <TableCell colSpan={4} className="py-6 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </TableCell>
              </TableRow>
            )}
            {users.map((u) => (
              <TableRow key={u.id} data-testid={`user-row-${u.id}`}>
                <TableCell className="font-medium">
                  {u.username}
                  {isSelf(u) && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center gap-1 rounded-sm border border-border px-2 py-0.5 text-xs font-semibold">
                    {u.owner && <ShieldCheck className="h-3 w-3" />}
                    {u.owner ? "Owner" : roleLabel(u.role)}
                  </span>
                  {u.role === "salesman" && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      {salesmen.find((s) => s.id === u.salesman_id)?.name || "salesman removed - edit to relink"}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">{u.created_at ? fmtDate(u.created_at.slice(0, 10)) : "-"}</TableCell>
                <TableCell className="text-right">
                  {u.owner ? (
                    // Set on the server, so a mistake here can never lock everyone out.
                    <span className="text-xs text-muted-foreground">Set on the server</span>
                  ) : (
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Edit"
                        data-testid={`edit-user-${u.id}`}
                        onClick={() => setDialog({ open: true, editing: u })}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title={isSelf(u) ? "You cannot delete yourself" : "Delete"}
                        disabled={isSelf(u)}
                        data-testid={`delete-user-${u.id}`}
                        onClick={() => remove(u)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {ROLES.map((r) => (
          <div key={r.value} className="rounded-sm border-2 border-border p-3">
            <div className="font-semibold">{r.label}</div>
            <div className="text-muted-foreground">{r.help}</div>
          </div>
        ))}
      </div>

      <UserDialog
        open={dialog.open}
        editing={dialog.editing}
        isSelf={!!dialog.editing && isSelf(dialog.editing)}
        salesmen={salesmen}
        onClose={() => setDialog({ open: false, editing: null })}
        onSaved={() => {
          setDialog({ open: false, editing: null });
          load();
        }}
      />
    </div>
  );
}
