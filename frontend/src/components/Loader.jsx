import { BookMarked } from "lucide-react";

export const Loader = ({ label = "Loading…" }) => (
  <div className="flex min-h-[45vh] flex-col items-center justify-center gap-5" data-testid="app-loader">
    <div className="relative h-16 w-16">
      <div className="absolute inset-0 rounded-sm border-2 border-border" />
      <div className="absolute inset-0 animate-spin rounded-sm border-2 border-transparent border-t-primary border-r-primary" />
      <div className="absolute inset-0 flex items-center justify-center text-primary">
        <BookMarked className="h-6 w-6" />
      </div>
    </div>
    <div className="flex flex-col items-center gap-1">
      <div className="font-display text-sm font-bold uppercase tracking-[0.25em] text-foreground">{label}</div>
      <div className="flex gap-1">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary" />
      </div>
    </div>
  </div>
);
