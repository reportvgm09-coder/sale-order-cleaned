import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { api, apiErr } from "@/lib/api";
import { useAuth } from "@/context/Auth";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { RefreshCw, CloudOff, Cloud, AlertTriangle } from "lucide-react";

// How often the bar re-reads the status. The sync itself runs on the server.
const POLL_MS = 60 * 1000;

const ago = (iso) => {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  return `${Math.round(hrs / 24)} days ago`;
};

const when = (iso) => new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

/**
 * Says how fresh this copy is. On the office PC: when it last synced with the
 * online site, a Sync now button, and any clashes to look at. On the online
 * site: when the office PC last sent its changes, since anything entered there
 * after that is not here yet. Shows nothing until the first sync has happened,
 * so a site that does not use offline mode looks exactly as before.
 */
export const SyncBar = () => {
  const { seesMoney } = useAuth();
  const [s, setS] = useState(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [conflicts, setConflicts] = useState([]);

  const load = useCallback(() => api.syncStatus().then(setS).catch(() => {}), []);

  useEffect(() => {
    load();
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  if (!s || (!s.office && !s.last_sync)) return null;

  const syncNow = async () => {
    setBusy(true);
    try {
      const r = await api.syncRun();
      toast.success(`Synced - ${r.pushed} sent online, ${r.pulled} brought to this PC`);
      if (r.conflicts) toast.warning(`${r.conflicts} clash${r.conflicts === 1 ? "" : "es"} to look at`);
    } catch (e) {
      toast.error(apiErr(e));
    } finally {
      setBusy(false);
      load();
    }
  };

  const showConflicts = async () => {
    try {
      setConflicts(await api.syncConflicts());
      setOpen(true);
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const clearConflicts = async () => {
    try {
      await api.clearSyncConflicts();
      setOpen(false);
      load();
    } catch (e) {
      toast.error(apiErr(e));
    }
  };

  const failing = s.office && s.last_error;
  const Icon = failing ? CloudOff : Cloud;

  return (
    <div
      data-testid="sync-bar"
      className={`border-b border-border no-print ${failing ? "bg-amber-50 text-amber-900" : "bg-secondary text-muted-foreground"}`}
    >
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 px-4 py-1.5 text-xs sm:px-6">
        <span className="flex min-w-0 items-center gap-1.5" data-testid="sync-status">
          <Icon className="h-3.5 w-3.5 shrink-0" />
          {s.office ? (
            failing ? (
              <span>Working offline. Last synced {ago(s.last_sync)} - {s.last_error}</span>
            ) : (
              <span>Synced with the online site {ago(s.last_sync)}</span>
            )
          ) : (
            <span>
              Office PC last synced {ago(s.last_sync)}. Anything entered there since then is not here yet.
            </span>
          )}
        </span>
        {s.office && seesMoney && (
          <span className="ml-auto flex items-center gap-2">
            {s.conflicts > 0 && (
              <button
                type="button"
                data-testid="sync-conflicts-btn"
                onClick={showConflicts}
                className="flex items-center gap-1 font-semibold text-amber-800 underline-offset-2 hover:underline"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> {s.conflicts} clash{s.conflicts === 1 ? "" : "es"}
              </button>
            )}
            <Button
              data-testid="sync-now-btn"
              variant="outline"
              size="sm"
              disabled={busy || s.running}
              onClick={syncNow}
              className="h-7 gap-1 rounded-sm bg-white px-2 text-xs"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${busy || s.running ? "animate-spin" : ""}`} />
              {busy || s.running ? "Syncing…" : "Sync now"}
            </Button>
          </span>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="rounded-sm sm:max-w-lg" data-testid="sync-conflicts-dialog">
          <DialogHeader>
            <DialogTitle>Changed in both places</DialogTitle>
            <DialogDescription>
              These were changed on the office PC and online between two syncs. The later change was kept. The other
              copy is shown here so you can put anything back by hand.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {conflicts.map((c) => (
              <div key={c.id} className="rounded-sm border border-border p-3 text-sm" data-testid="sync-conflict">
                <div className="text-xs text-muted-foreground">{when(c.at)}</div>
                <div className="mt-1">{c.note}</div>
                {c.lost && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-muted-foreground">Show the copy that was not kept</summary>
                    <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-secondary p-2 text-[11px]">
                      {JSON.stringify(c.lost, null, 2)}
                    </pre>
                  </details>
                )}
              </div>
            ))}
          </div>
          <DialogFooter>
            <Button data-testid="sync-conflicts-clear" variant="outline" onClick={clearConflicts} className="rounded-sm">
              I have checked these - clear the list
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
