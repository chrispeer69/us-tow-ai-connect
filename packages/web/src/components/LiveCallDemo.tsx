import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Bot, User, Phone, Sparkles } from "lucide-react";

interface Message {
  speaker: "ai" | "customer" | "system";
  text: string;
  delay: number;
}

const SCRIPT: Message[] = [
  { speaker: "system", text: "New tow detected in Towbook · Calling customer...", delay: 800 },
  { speaker: "ai", text: "Hi, this is Sarah from Roadside Towing on behalf of AAA. Am I speaking with Jazmine?", delay: 1500 },
  { speaker: "customer", text: "Yes, this is Jazmine.", delay: 1200 },
  { speaker: "ai", text: "I'm confirming your tow request — 2019 Honda Civic, going to Midas Auto Repair. Is that correct?", delay: 2200 },
  { speaker: "customer", text: "Yes, that's right.", delay: 1100 },
  { speaker: "system", text: "Google Places: Midas Auto Repair · Type: car_repair · Flip eligible: TRUE", delay: 800 },
  { speaker: "ai", text: "Great. We have a certified shop just 3 miles away — Excite Auto Repair. We'd offer you a free diagnostic and 10% off your repair. Want me to redirect?", delay: 2500 },
  { speaker: "customer", text: "Yeah, let's do that.", delay: 1300 },
  { speaker: "system", text: "✓ Towbook destination updated · Management notified · Flip success", delay: 1000 },
];

export function LiveCallDemo() {
  const [visible, setVisible] = useState<Message[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    observerRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !isPlaying) {
            setIsPlaying(true);
          }
        });
      },
      { threshold: 0.3 }
    );
    observerRef.current.observe(containerRef.current);
    return () => observerRef.current?.disconnect();
  }, [isPlaying]);

  useEffect(() => {
    if (!isPlaying) return;
    let cancelled = false;
    let cumulativeDelay = 0;

    SCRIPT.forEach((msg) => {
      cumulativeDelay += msg.delay;
      setTimeout(() => {
        if (!cancelled) {
          setVisible((prev) => [...prev, msg]);
        }
      }, cumulativeDelay);
    });

    // Reset and replay loop
    setTimeout(() => {
      if (!cancelled) {
        setVisible([]);
        setTimeout(() => {
          if (!cancelled) {
            // Trigger replay
            setIsPlaying(false);
            setTimeout(() => setIsPlaying(true), 100);
          }
        }, 4000);
      }
    }, cumulativeDelay + 4000);

    return () => {
      cancelled = true;
    };
  }, [isPlaying]);

  return (
    <Card ref={containerRef} className="bg-gradient-to-br from-card via-card to-blue-500/5 border-blue-500/30 overflow-hidden">
      <CardContent className="p-0">
        {/* Phone-style header */}
        <div className="bg-gradient-to-r from-blue-500/10 to-cyan-500/10 border-b border-blue-500/20 p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-blue-500/20 border border-blue-500/40 flex items-center justify-center animate-pulse-glow">
            <Phone className="w-5 h-5 text-blue-400" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-bold flex items-center gap-2">
              Outbound Call · Live Confirmation
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-blue-400 font-bold">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse"></span>
                Recording
              </span>
            </div>
            <div className="text-xs text-muted-foreground">+1 (614) 290-4897 · Customer: Jazmine Genovese</div>
          </div>
          <Badge className="bg-cyan-500/15 text-cyan-400 border-cyan-500/30 text-[10px]">
            <Sparkles className="w-3 h-3 mr-1" /> AI Powered
          </Badge>
        </div>

        {/* Transcript area */}
        <div className="p-6 space-y-4 min-h-[420px] max-h-[420px] overflow-hidden">
          {visible.map((msg, i) => (
            <div
              key={i}
              className="animate-float-up flex gap-3"
              style={{ animationDelay: "0ms" }}
            >
              {msg.speaker === "system" ? (
                <div className="flex-1 text-center py-1">
                  <span className="inline-block bg-muted/50 border border-border/40 rounded-full px-3 py-1 text-[11px] text-muted-foreground font-mono">
                    {msg.text}
                  </span>
                </div>
              ) : msg.speaker === "ai" ? (
                <>
                  <div className="w-8 h-8 rounded-full bg-blue-500/15 border border-blue-500/40 flex items-center justify-center flex-shrink-0">
                    <Bot className="w-4 h-4 text-blue-400" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-blue-400 font-bold mb-1">AI Agent</div>
                    <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed">
                      {msg.text}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center flex-shrink-0">
                    <User className="w-4 h-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">Customer</div>
                    <div className="bg-muted/30 border border-border/40 rounded-lg rounded-tl-sm px-4 py-2.5 text-sm leading-relaxed">
                      {msg.text}
                    </div>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
