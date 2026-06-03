import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Phone, MapPin, Clock, Truck } from "lucide-react";

interface Job {
  id: string;
  customer: string;
  vehicle: string;
  location: string;
  status: "Waiting" | "Dispatched" | "Enroute" | "On Scene" | "Completed";
  driver: string;
  eta: string;
  isNew?: boolean;
}

const INITIAL_JOBS: Job[] = [
  { id: "121737", customer: "Jazmine Genovese", vehicle: "2019 Honda Civic", location: "I-71 S, MM 42", status: "Enroute", driver: "Dustin DeLauder", eta: "12 min" },
  { id: "121730", customer: "Andre Martin", vehicle: "2021 Toyota Camry", location: "5th & High St", status: "On Scene", driver: "Jesse Shortridge", eta: "Arrived" },
  { id: "121745", customer: "Brooke Logue", vehicle: "2017 Hyundai Elantra", location: "Target, Morse Rd", status: "Dispatched", driver: "Lonnie Carr", eta: "20 min" },
];

const STATUS_COLORS: Record<string, string> = {
  Waiting: "bg-amber-500/15 text-amber-400 border-amber-500/40",
  Dispatched: "bg-blue-500/15 text-blue-400 border-blue-500/40",
  Enroute: "bg-cyan-500/15 text-cyan-400 border-cyan-500/40",
  "On Scene": "bg-violet-500/15 text-violet-400 border-violet-500/40",
  Completed: "bg-muted text-muted-foreground border-border",
};

export function LiveDispatchPreview() {
  const [jobs, setJobs] = useState<Job[]>(INITIAL_JOBS);
  const [pulseId, setPulseId] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      // Simulate a new job arriving every 8 seconds
      const newJob: Job = {
        id: String(121750 + Math.floor(Math.random() * 100)),
        customer: ["Sarah Chen", "James Patterson", "Maria Lopez", "Tony Marcetti"][Math.floor(Math.random() * 4)],
        vehicle: ["2020 Ford F-150", "2018 Chevy Malibu", "2022 Tesla Model 3", "2019 Jeep Wrangler"][Math.floor(Math.random() * 4)],
        location: ["I-270 W", "Polaris Pkwy", "Easton Town", "Downtown"][Math.floor(Math.random() * 4)],
        status: "Waiting",
        driver: "Unassigned",
        eta: "—",
        isNew: true,
      };
      setJobs((prev) => [newJob, ...prev.slice(0, 3)]);
      setPulseId(newJob.id);
      setTimeout(() => setPulseId(null), 2000);
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  return (
    <Card className="bg-gradient-to-br from-card via-card to-blue-500/5 border-blue-500/30 overflow-hidden">
      {/* Header */}
      <div className="bg-gradient-to-r from-blue-500/10 via-cyan-500/5 to-transparent border-b border-blue-500/20 p-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
            <Truck className="w-4 h-4 text-blue-400" />
          </div>
          <div>
            <div className="text-sm font-bold">Live Dispatch Board</div>
            <div className="text-xs text-muted-foreground">Auto-syncing every 60s</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse-glow"></span>
          <span className="text-[10px] uppercase tracking-wider text-blue-400 font-bold">Live</span>
        </div>
      </div>

      {/* Job rows */}
      <div className="divide-y divide-border/40">
        {jobs.map((job, i) => (
          <div
            key={job.id + "-" + i}
            className={`p-4 transition-all duration-500 ${
              pulseId === job.id ? "bg-blue-500/10 animate-float-up" : "hover:bg-card/40"
            }`}
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-muted-foreground">#{job.id}</span>
                <Badge className={`${STATUS_COLORS[job.status]} text-[10px] border`}>{job.status}</Badge>
                {job.isNew && (
                  <Badge className="bg-cyan-500/20 text-cyan-400 border-cyan-500/40 text-[10px] animate-pulse">
                    NEW
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="w-3 h-3" />
                {job.eta}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{job.customer}</div>
                <div className="text-xs text-muted-foreground truncate flex items-center gap-1 mt-0.5">
                  <span>{job.vehicle}</span>
                  <span className="opacity-50">·</span>
                  <MapPin className="w-3 h-3" />
                  <span>{job.location}</span>
                </div>
              </div>
              <div className="text-right ml-3">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Driver</div>
                <div className="text-xs font-semibold">{job.driver}</div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t border-border/40 p-4 bg-card/40 flex items-center justify-between text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <Phone className="w-3 h-3 text-blue-400" />
            <span className="text-muted-foreground">AI handling</span>
            <span className="font-bold text-blue-400">{jobs.length} active</span>
          </div>
        </div>
        <span className="text-muted-foreground">Towbook · AAA · Synced</span>
      </div>
    </Card>
  );
}
