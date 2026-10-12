import { useEffect, useRef, useState } from "react";
import { api, apiErr } from "@/lib/api";
import { shrinkPhoto } from "@/lib/photos";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Camera, ImagePlus, X, Loader2, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";

// Photos of the paper order form - the same five allowed by the server.
export const MAX_PHOTOS = 5;

/**
 * Photos for one order, in two modes:
 *  - orderId set: the order exists, so each photo is saved or removed at once
 *  - orderId null: a new order - photos wait in `pending` until it is saved,
 *    then the form calls uploadPending()
 * canChange decides whether there are add / remove buttons at all.
 */
export function OrderPhotos({ orderId, pending, setPending, canChange, testid = "order-photos" }) {
  const [saved, setSaved] = useState([]); // [{ id, url }]
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(null); // index into shown
  const camRef = useRef(null);
  const pickRef = useRef(null);

  // Saved photos are fetched as blobs and shown from memory; the object URLs
  // are let go when the order changes or the form closes.
  useEffect(() => {
    if (!orderId) {
      setSaved([]);
      return undefined;
    }
    let live = true;
    const urls = [];
    (async () => {
      try {
        const list = await api.listOrderPhotos(orderId);
        const withUrls = await Promise.all(
          list.map(async (p) => {
            const url = URL.createObjectURL(await api.photoBlob(p.id));
            urls.push(url);
            return { id: p.id, url };
          })
        );
        if (live) setSaved(withUrls);
      } catch (e) {
        if (live) toast.error(apiErr(e));
      }
    })();
    return () => {
      live = false;
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [orderId]);

  const shown = orderId ? saved : pending || [];
  const room = MAX_PHOTOS - shown.length;

  const add = async (files) => {
    const list = Array.from(files || []).slice(0, Math.max(0, room));
    if (files?.length > list.length) toast.warning(`An order can have up to ${MAX_PHOTOS} photos`);
    if (!list.length) return;
    setBusy(true);
    try {
      for (const file of list) {
        let photo;
        try {
          photo = await shrinkPhoto(file);
        } catch (e) {
          toast.error(e.message);
          continue;
        }
        if (orderId) {
          try {
            const meta = await api.addOrderPhoto(orderId, photo.data);
            setSaved((s) => [...s, { id: meta.id, url: photo.url }]);
          } catch (e) {
            URL.revokeObjectURL(photo.url);
            toast.error(apiErr(e));
          }
        } else {
          setPending((p) => [...p, { key: `p-${Math.random().toString(36).slice(2, 8)}`, ...photo }]);
        }
      }
    } finally {
      setBusy(false);
    }
  };

  const remove = async (i) => {
    const p = shown[i];
    if (orderId) {
      if (!window.confirm("Remove this photo from the order?")) return;
      try {
        await api.deletePhoto(p.id);
        URL.revokeObjectURL(p.url);
        setSaved((s) => s.filter((x) => x.id !== p.id));
      } catch (e) {
        toast.error(apiErr(e));
      }
    } else {
      URL.revokeObjectURL(p.url);
      setPending((list) => list.filter((x) => x.key !== p.key));
    }
  };

  const pick = (e) => {
    add(e.target.files);
    e.target.value = ""; // so the same photo can be picked again
  };

  return (
    <div data-testid={testid}>
      <div className="flex flex-wrap items-center gap-2">
        {shown.map((p, i) => (
          <div key={p.id || p.key} className="relative h-20 w-20 overflow-hidden rounded-sm border-2 border-border bg-secondary">
            <button type="button" onClick={() => setView(i)} className="h-full w-full" aria-label={`Open photo ${i + 1}`} data-testid={`${testid}-thumb-${i}`}>
              <img src={p.url} alt={`Order form, photo ${i + 1}`} className="h-full w-full object-cover" />
            </button>
            {canChange && (
              <button
                type="button"
                onClick={() => remove(i)}
                aria-label={`Remove photo ${i + 1}`}
                data-testid={`${testid}-remove-${i}`}
                className="absolute right-0.5 top-0.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-destructive shadow-sm"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex h-20 w-20 items-center justify-center rounded-sm border-2 border-dashed border-border">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}
        {canChange && room > 0 && !busy && (
          <>
            {/* The camera button opens the camera straight away on a phone;
                "Choose" goes to the gallery, or files on a computer. */}
            <Button type="button" variant="outline" size="sm" onClick={() => camRef.current?.click()} className="h-9 gap-1.5 rounded-sm" data-testid={`${testid}-camera`}>
              <Camera className="h-4 w-4" /> Take photo
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => pickRef.current?.click()} className="h-9 gap-1.5 rounded-sm" data-testid={`${testid}-choose`}>
              <ImagePlus className="h-4 w-4" /> Choose
            </Button>
            <input ref={camRef} type="file" accept="image/*" capture="environment" onChange={pick} className="hidden" data-testid={`${testid}-camera-input`} />
            <input ref={pickRef} type="file" accept="image/*" multiple onChange={pick} className="hidden" data-testid={`${testid}-input`} />
          </>
        )}
      </div>
      {!shown.length && !canChange && <p className="text-sm text-muted-foreground">No photos on this order.</p>}
      <PhotoViewer photos={shown} index={view} setIndex={setView} />
    </div>
  );
}

/** Saves the photos a new order collected, once the order exists. Returns how many failed. */
export async function uploadPending(orderId, pending) {
  let failed = 0;
  for (const p of pending) {
    try {
      await api.addOrderPhoto(orderId, p.data);
    } catch {
      failed++;
    }
    URL.revokeObjectURL(p.url);
  }
  return failed;
}

function PhotoViewer({ photos, index, setIndex }) {
  const open = index !== null && photos[index];
  return (
    <Dialog open={!!open} onOpenChange={(v) => !v && setIndex(null)}>
      <DialogContent className="max-w-3xl rounded-sm p-3 sm:p-4" data-testid="photo-viewer">
        <DialogHeader>
          <DialogTitle className="text-base">
            Order form · photo {index + 1} of {photos.length}
          </DialogTitle>
          <DialogDescription className="sr-only">A photo of the paper order form</DialogDescription>
        </DialogHeader>
        {open && <img src={photos[index].url} alt={`Order form, photo ${index + 1}`} className="mx-auto max-h-[70dvh] w-auto max-w-full rounded-sm" />}
        {photos.length > 1 && (
          <div className="flex justify-between">
            <Button variant="outline" size="sm" className="gap-1 rounded-sm" disabled={index === 0} onClick={() => setIndex(index - 1)} data-testid="photo-prev">
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button variant="outline" size="sm" className="gap-1 rounded-sm" disabled={index === photos.length - 1} onClick={() => setIndex(index + 1)} data-testid="photo-next">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** The paperclip on an order in a list: shows the count, opens the photos. */
export function PhotosButton({ order, canChange = false }) {
  const [open, setOpen] = useState(false);
  if (!order.photo_count) return null;
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        className="h-7 gap-1 rounded-sm px-1.5 text-xs text-muted-foreground"
        title="Photos of the order form"
        data-testid={`photos-btn-${order.id}`}
      >
        <Paperclip className="h-3.5 w-3.5" /> {order.photo_count}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md rounded-sm" data-testid={`photos-dialog-${order.id}`}>
          <DialogHeader>
            <DialogTitle className="text-base">Order form photos · {order.id}</DialogTitle>
            <DialogDescription>Tap a photo to see it full size.</DialogDescription>
          </DialogHeader>
          {open && <OrderPhotos orderId={order.id} canChange={canChange} testid={`photos-${order.id}`} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
