import ring from "@/assets/brand/logo-ring.webp";
import centre from "@/assets/brand/logo-centre.webp";

/* The company logo, taken apart: the cloud ring and the tree with its
   lettering are separate images (made from the logo by the steps in
   CLAUDE.md), so a highlight can sweep round the ring like a spinner while the
   tree breathes in the middle. The ring is not spun because the logo is a
   touch oval - turning it would wobble. All the motion is opacity and
   transform, plus one animated mask angle, so it stays smooth while the page
   behind it is busy. The styles live in index.css under .brand-loader. */
export const Loader = ({ label = "Loading…" }) => (
  <div
    className="flex min-h-[45vh] flex-col items-center justify-center gap-5"
    data-testid="app-loader"
    role="status"
    aria-live="polite"
  >
    <div className="brand-loader" aria-hidden="true">
      <img src={ring} alt="" className="brand-loader-ring" draggable="false" />
      <img src={ring} alt="" className="brand-loader-sweep" draggable="false" />
      <img src={centre} alt="" className="brand-loader-centre" draggable="false" />
    </div>
    <div className="brand-loader-label font-display text-sm font-bold uppercase tracking-[0.25em] text-foreground">
      {label}
    </div>
  </div>
);
