import { useState, useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, DollarSign, Calculator } from "lucide-react";

const OUR_RATE = 0.23;
const THEIR_RATE = 0.30;

export function ROICalculator() {
  const [callsPerDay, setCallsPerDay] = useState([40]);
  const [avgCallMins, setAvgCallMins] = useState([3]);

  const calculations = useMemo(() => {
    const monthlyMinutes = callsPerDay[0] * avgCallMins[0] * 30;
    const ourMonthlyCost = monthlyMinutes * OUR_RATE;
    const theirMonthlyCost = monthlyMinutes * THEIR_RATE;
    const monthlySavings = theirMonthlyCost - ourMonthlyCost;
    const annualSavings = monthlySavings * 12;
    const percentSavings = ((monthlySavings / theirMonthlyCost) * 100).toFixed(1);

    return {
      monthlyMinutes,
      ourMonthlyCost,
      theirMonthlyCost,
      monthlySavings,
      annualSavings,
      percentSavings,
    };
  }, [callsPerDay, avgCallMins]);

  return (
    <Card className="bg-gradient-to-br from-card to-blue-500/5 border-blue-500/30 overflow-hidden">
      <CardContent className="p-8 lg:p-10">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-lg bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
            <Calculator className="w-5 h-5 text-blue-400" />
          </div>
          <div>
            <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-bold">ROI Calculator</div>
            <div className="text-xl font-bold tracking-tight">See your savings</div>
          </div>
        </div>

        {/* Inputs */}
        <div className="space-y-6 mb-8">
          <div>
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-semibold">Calls per day</label>
              <span className="text-2xl font-black tracking-tight text-blue-400">{callsPerDay[0]}</span>
            </div>
            <Slider
              value={callsPerDay}
              onValueChange={setCallsPerDay}
              min={5}
              max={150}
              step={5}
              className="w-full"
            />
            <div className="flex justify-between mt-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <span>5</span>
              <span>150</span>
            </div>
          </div>

          <div>
            <div className="flex items-baseline justify-between mb-3">
              <label className="text-sm font-semibold">Average call length</label>
              <span className="text-2xl font-black tracking-tight text-blue-400">{avgCallMins[0]} min</span>
            </div>
            <Slider
              value={avgCallMins}
              onValueChange={setAvgCallMins}
              min={1}
              max={10}
              step={1}
              className="w-full"
            />
            <div className="flex justify-between mt-2 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              <span>1 min</span>
              <span>10 min</span>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">Total Minutes / Mo</div>
            <div className="text-2xl font-black tabular-nums">{calculations.monthlyMinutes.toLocaleString()}</div>
          </div>
          <div className="bg-card/50 border border-border rounded-lg p-4">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-1">TowPilot Cost</div>
            <div className="text-2xl font-black tabular-nums text-muted-foreground line-through">
              ${calculations.theirMonthlyCost.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-br from-blue-500/15 to-cyan-500/10 border border-blue-500/40 rounded-xl p-5">
          <div className="flex items-baseline justify-between mb-2">
            <div className="text-[10px] uppercase tracking-wider text-blue-400 font-bold">You Save Monthly</div>
            <Badge className="bg-blue-500/20 text-blue-400 border-blue-500/40 text-[10px]">
              <TrendingUp className="w-3 h-3 mr-1" />
              {calculations.percentSavings}% LESS
            </Badge>
          </div>
          <div className="flex items-baseline gap-2">
            <DollarSign className="w-7 h-7 text-blue-400" />
            <span className="text-5xl font-black tabular-nums tracking-tight">
              {Math.round(calculations.monthlySavings).toLocaleString()}
            </span>
            <span className="text-base text-muted-foreground">/mo</span>
          </div>
          <div className="mt-2 text-sm text-muted-foreground">
            That's <span className="text-foreground font-bold">${Math.round(calculations.annualSavings).toLocaleString()}</span> saved per year vs TowPilot AI.
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
