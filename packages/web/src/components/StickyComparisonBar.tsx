import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, X } from "lucide-react";

export function StickyComparisonBar() {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 800);
    };
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (dismissed) return null;

  return (
    <div
      className={`fixed bottom-4 left-4 right-4 lg:left-auto lg:right-6 lg:bottom-6 z-50 transition-all duration-300 ${
        visible ? "translate-y-0 opacity-100" : "translate-y-24 opacity-0 pointer-events-none"
      }`}
    >
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl shadow-2xl shadow-blue-500/40 p-4 lg:p-5 lg:max-w-md ml-auto border border-blue-400/30 backdrop-blur-xl">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <div className="flex items-baseline gap-2 mb-1">
              <span className="text-[10px] uppercase tracking-wider text-white/70 font-bold">Shareholders · 33% less than TowPilot</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-3xl font-black text-white tracking-tight">$0.20</span>
              <span className="text-white/80 text-sm">/min</span>
              <span className="text-white/50 text-sm line-through">vs $0.30</span>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="text-white/60 hover:text-white transition-colors"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <Link href="/sign-up" className="block">
          <Button className="w-full mt-3 bg-white hover:bg-white/95 text-blue-700 font-bold h-11">
            Start Free Trial
            <ArrowRight className="w-4 h-4 ml-1" />
          </Button>
        </Link>
      </div>
    </div>
  );
}
