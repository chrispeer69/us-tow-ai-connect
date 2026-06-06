"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { LiveCallDemo } from "@/components/LiveCallDemo";
import { ROICalculator } from "@/components/ROICalculator";
import { AnimatedCounter } from "@/components/AnimatedCounter";
import { StickyComparisonBar } from "@/components/StickyComparisonBar";
import { LiveDispatchPreview } from "@/components/LiveDispatchPreview";
import {
  Phone,
  PhoneOutgoing,
  PhoneIncoming,
  Bot,
  Zap,
  ShieldCheck,
  Network,
  TrendingUp,
  Clock,
  DollarSign,
  Check,
  X,
  ArrowRight,
  Sparkles,
  Database,
  Activity,
  Users,
  Building2,
  Globe,
  Award,
  BookOpen,
  Briefcase,
  Camera,
  Car,
  ClipboardCheck,
  Gauge,
  Gavel,
  Hammer,
  Hash,
  Megaphone,
  Newspaper,
  Package,
  PenTool,
  Star,
  Terminal,
  Truck,
  Wrench,
} from "lucide-react";

const HERO_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663488671835/dJzLf9wtAEeniEd3UAXpws/hero-tow-truck-macBb8UmfLLz7b6LWEeMd3.webp";
const NETWORK_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663488671835/dJzLf9wtAEeniEd3UAXpws/abstract-network-oA2VngdyJYwNm5mFK5keYA.webp";
const DASHBOARD_IMAGE = "https://d2xsxph8kpxj0f.cloudfront.net/310519663488671835/dJzLf9wtAEeniEd3UAXpws/dashboard-mockup-ELDckAk4NofknNGiKepd2n.webp";

export default function Home() {
  return (
    <div className="dark min-h-screen bg-background text-foreground overflow-x-hidden">
      <StickyComparisonBar />

      {/* Navigation */}
      <nav className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="container flex items-center justify-between h-16 lg:h-20">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
              <Phone className="w-5 h-5 text-white" />
            </div>
            <div>
              <div className="font-bold text-base leading-tight tracking-tight">US Tow AI-Connect</div>
              <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-medium">By Blue Collar AI</div>
            </div>
          </div>
          <div className="hidden md:flex items-center gap-7 text-sm font-medium text-muted-foreground">
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#demo" className="hover:text-foreground transition-colors">See It Live</a>
            <a href="#comparison" className="hover:text-foreground transition-colors">vs TowPilot</a>
            <a href="#calculator" className="hover:text-foreground transition-colors">Calculator</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            <Link href="/sign-in" className="hidden sm:block text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Log In</Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-16 lg:pt-24 pb-20 lg:pb-32 overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src={HERO_IMAGE} alt="Heavy-duty tow truck on a highway at night representing the AI-powered towing dispatch service" className="w-full h-full object-cover opacity-35" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/70 via-background/85 to-background"></div>
          <div className="absolute inset-0 bg-grid opacity-30"></div>
        </div>

        <div className="container relative z-10">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-7">
              <div id="trial" className="inline-flex items-center gap-2 mb-6 bg-blue-500/15 border border-blue-500/40 rounded-full px-4 py-2 text-xs font-bold tracking-wider uppercase animate-float-up">
                <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                <span className="text-blue-300">Setup Fee Waived</span>
                <span className="text-muted-foreground/70">·</span>
                <span className="text-cyan-400">When You Switch from TowPilot AI</span>
              </div>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl xl:text-[5.5rem] font-black leading-[1.02] tracking-tight mb-6 animate-float-up">
                Your 24 Hr
                <br />
                AI Dispatcher
                <br />
                Sales Team.
                <br />
                <span className="text-gradient-blue">Always Working.</span>
              </h1>
              <p className="text-lg lg:text-xl text-muted-foreground max-w-2xl mb-10 leading-relaxed animate-float-up">
                AI-Connect not only answers every inbound call — it's built with{" "}
                <span className="text-foreground font-semibold">sales logic for outbound calls</span>{" "}
                and <span className="text-foreground font-semibold">customer retention</span>.
                Our AI agent calls every job, confirms details, and offers discounts at
                preferred auto repair shops of your choosing. It also offers the{" "}
                <a
                  href="https://www.convinicar.online"
                  target="_blank"
                  rel="noreferrer"
                  className="text-foreground font-semibold underline decoration-cyan-400/60 underline-offset-4 hover:decoration-cyan-300"
                >
                  CONVINI app link
                </a> —
                driving more revenue, opportunity, and customer development to your business.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl mb-10">
                <Card className="bg-blue-500/5 border-blue-500/40 backdrop-blur-sm relative overflow-hidden glow-blue">
                  <div className="absolute top-0 right-0 bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
                    Us
                  </div>
                  <CardContent className="p-6">
                    <div className="text-xs uppercase tracking-wider text-blue-400 font-bold mb-3">US Tow AI-Connect</div>
                    <div className="space-y-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-cyan-400 font-bold">Alliance Profile</span>
                        <span className="text-2xl font-black tracking-tight tabular-nums text-cyan-300">
                          $0.30<span className="text-xs text-muted-foreground font-medium">/min</span>
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 pt-2 border-t border-cyan-500/20">
                        <span className="text-[10px] uppercase tracking-wider text-yellow-300 font-bold">Alliance Elite</span>
                        <span className="text-3xl font-black tracking-tight tabular-nums text-yellow-300">
                          $0.25<span className="text-xs text-muted-foreground font-medium">/min</span>
                        </span>
                      </div>
                      <div className="flex items-baseline justify-between gap-2 pt-2 border-t border-amber-500/30">
                        <span className="text-[10px] uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />
                          Shareholders
                        </span>
                        <span className="text-3xl font-black tracking-tight tabular-nums text-amber-400">
                          $0.20<span className="text-xs text-muted-foreground font-medium">/min</span>
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="bg-card/30 border-border/40 backdrop-blur-sm relative overflow-hidden">
                  <div className="absolute top-0 right-0 bg-muted text-muted-foreground text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-bl-lg">
                    Them
                  </div>
                  <CardContent className="p-6">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-3">TowPilot AI</div>
                    <div className="space-y-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">Retail</span>
                        <span className="text-2xl font-black tracking-tight tabular-nums">
                          $0.30<span className="text-xs text-muted-foreground font-medium">/min</span>
                        </span>
                      </div>
                      <div className="flex items-center gap-2 pt-3">
                        <X className="w-4 h-4 text-muted-foreground/60" />
                        <span className="text-xs text-muted-foreground">No Alliance tiers</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <X className="w-4 h-4 text-muted-foreground/60" />
                        <span className="text-xs text-muted-foreground">No volume discount</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

            </div>

            {/* Hero right: Live dispatch preview */}
            <div className="lg:col-span-5">
              <LiveDispatchPreview />
            </div>
          </div>
        </div>
      </section>

      {/* Trust badges strip */}
      <section className="border-y border-border bg-card/40 backdrop-blur-sm">
        <div className="container py-8">
          <div className="text-center mb-6">
            <div className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground font-bold">
              Trusted Technology Partners
            </div>
          </div>
          <div className="flex flex-wrap justify-center items-center gap-6 lg:gap-12 text-sm font-bold tracking-wide">
            <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
              <Bot className="w-4 h-4 text-blue-400" />
              <span>Thinkrr.ai</span>
            </div>
            <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
              <Award className="w-4 h-4 text-blue-400" />
              <span>Blue Collar AI</span>
            </div>
            <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
              <Users className="w-4 h-4 text-blue-400" />
              <span>US Tow Alliance</span>
            </div>
            <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
              <ShieldCheck className="w-4 h-4 text-blue-400" />
              <span>SOC 2 Ready</span>
            </div>
            <div className="flex items-center gap-2 opacity-70 hover:opacity-100 transition-opacity">
              <Globe className="w-4 h-4 text-blue-400" />
              <span>Powered by Twilio</span>
            </div>
          </div>
        </div>
      </section>

      {/* Animated Stats */}
      <section className="border-b border-border bg-background">
        <div className="container py-14">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { label: "Calls Handled / Month", end: 100000, suffix: "+", icon: Phone },
              { label: "Avg Response Time", end: 2.4, suffix: "s", decimals: 1, icon: Clock },
              { label: "Shareholder Savings vs TowPilot", end: 33, suffix: "%", icon: DollarSign },
              { label: "Towing Software Supported", end: 6, suffix: "+", icon: Network },
            ].map((stat, i) => (
              <div key={i} className="text-center lg:text-left">
                <div className="flex items-center justify-center lg:justify-start gap-2 mb-2 text-blue-400">
                  <stat.icon className="w-4 h-4" />
                  <span className="text-[10px] uppercase tracking-[0.2em] font-bold">{stat.label}</span>
                </div>
                <div className="text-4xl lg:text-5xl font-black tracking-tight">
                  <AnimatedCounter end={stat.end} suffix={stat.suffix} decimals={stat.decimals || 0} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Two Engines */}
      <section id="features" className="py-24 lg:py-32 relative">
        <div className="container">
          <div className="max-w-2xl mb-16">
            <Badge className="mb-4 bg-blue-500/10 text-blue-400 border-blue-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              Two Engines · One Platform
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
              Inbound. Outbound.
              <br />
              <span className="text-gradient-blue">Always Working.</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              TowPilot only answers the phone. We answer it <em>and</em> make outbound calls that generate revenue.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card className="bg-gradient-to-br from-card to-blue-500/5 border-blue-500/20 overflow-hidden group hover:border-blue-500/50 transition-all duration-300">
              <CardContent className="p-8 lg:p-10">
                <div className="w-14 h-14 rounded-xl bg-blue-500/15 border border-blue-500/30 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                  <PhoneIncoming className="w-7 h-7 text-blue-400" />
                </div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-bold mb-2">Inbound Engine</div>
                <h3 className="text-2xl lg:text-3xl font-black mb-4 tracking-tight">Answer every call. 24/7/365.</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  AI-Connect picks up every inbound call instantly. Provides ETA updates, handles impound inquiries, quotes prices, and routes urgent calls to your dispatcher.
                </p>
                <ul className="space-y-3">
                  {[
                    "Live ETA lookups from your dispatch software",
                    "Impound inquiries & vehicle status",
                    "Smart routing to dispatchers (day/night shifts)",
                    "Multi-language support (English, Spanish, more)",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <Check className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            <Card className="bg-gradient-to-br from-card to-cyan-500/5 border-cyan-500/30 overflow-hidden relative group hover:border-cyan-500/50 transition-all duration-300">
              <div className="absolute top-4 right-4 bg-cyan-500/20 border border-cyan-500/40 rounded-full px-3 py-1 text-[10px] uppercase tracking-wider font-bold text-cyan-400">
                Exclusive
              </div>
              <CardContent className="p-8 lg:p-10">
                <div className="w-14 h-14 rounded-xl bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-6 group-hover:scale-105 transition-transform">
                  <PhoneOutgoing className="w-7 h-7 text-cyan-400" />
                </div>
                <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-2">Outbound Engine</div>
                <h3 className="text-2xl lg:text-3xl font-black mb-4 tracking-tight">Call every customer. Generate revenue.</h3>
                <p className="text-muted-foreground leading-relaxed mb-6">
                  Every 60 seconds, AI-Connect scans your dispatch board for new jobs and calls customers to confirm details — then refers your preferred auto shops and grows your CONVINI ecosystem.
                </p>
                <ul className="space-y-3">
                  {[
                    "Confirms tow details (name, vehicle, location, issue)",
                    "Updates dispatch notes automatically",
                    "Refers to your preferred auto repair shops",
                    "Promotes CONVINI app on every call",
                  ].map((item, i) => (
                    <li key={i} className="flex items-start gap-3 text-sm">
                      <Check className="w-5 h-5 text-cyan-400 flex-shrink-0 mt-0.5" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-6 pt-6 border-t border-cyan-500/20">
                  <div className="flex items-center gap-2 text-xs text-cyan-400 font-bold uppercase tracking-wider">
                    <X className="w-4 h-4" />
                    TowPilot AI does not have this feature
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Industry First — Outbound Sales AI */}
      <section id="industry-first" className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/10 via-background to-blue-500/10"></div>
          <div className="absolute inset-0 bg-grid opacity-20"></div>
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-cyan-500/15 rounded-full blur-3xl"></div>
        </div>

        <div className="container relative z-10">
          <div className="max-w-4xl mx-auto text-center mb-16">
            <Badge className="mb-6 bg-cyan-500/15 text-cyan-300 border-cyan-500/40 px-4 py-2 text-[10px] font-black tracking-[0.25em] uppercase">
              <Award className="w-3.5 h-3.5 mr-2" />
              Industry First · Category Creator
            </Badge>
            <h2 className="text-4xl lg:text-6xl xl:text-7xl font-black tracking-tight mb-6 leading-[1.05]">
              The towing industry's
              <br />
              <span className="text-gradient-cyan">first &amp; only</span>
              <br />
              <span className="whitespace-nowrap text-yellow-300">OUTBOUND SALES</span>
              <br />
              <span className="whitespace-nowrap">AI attendant.</span>
            </h2>
            <p className="text-lg lg:text-xl text-muted-foreground leading-relaxed max-w-3xl mx-auto">
              AI-Connect doesn't just answer calls — it makes them. Outbound sales calls
              for <span className="text-foreground font-semibold">customer retention</span>{" "}
              and <span className="text-foreground font-semibold">new customer development</span>.
              Plus a one-of-a-kind referral engine that sends every tow to your preferred
              auto repair shops.
            </p>
          </div>

          {/* Flow diagram */}
          <Card className="bg-gradient-to-br from-cyan-500/5 via-card to-blue-500/5 border-cyan-500/30 max-w-5xl mx-auto mb-12 overflow-hidden glow-blue">
            <CardContent className="p-8 lg:p-12">
              <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] gap-6 items-center">
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center mb-3 mx-auto">
                    <Truck className="w-8 h-8 text-cyan-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-1">Step 01</div>
                  <div className="text-sm font-bold">New tow detected</div>
                </div>
                <div className="hidden md:flex justify-center">
                  <ArrowRight className="w-6 h-6 text-cyan-400/60" />
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-cyan-500/15 border border-cyan-500/40 flex items-center justify-center mb-3 mx-auto animate-pulse-glow">
                    <PhoneOutgoing className="w-8 h-8 text-cyan-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-1">Step 02</div>
                  <div className="text-sm font-bold">AI sales call placed</div>
                </div>
                <div className="hidden md:flex justify-center">
                  <ArrowRight className="w-6 h-6 text-cyan-400/60" />
                </div>
                <div className="text-center">
                  <div className="w-16 h-16 rounded-2xl bg-blue-500/15 border border-blue-500/40 flex items-center justify-center mb-3 mx-auto">
                    <Wrench className="w-8 h-8 text-blue-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground font-bold mb-1">Step 03</div>
                  <div className="text-sm font-bold">Referred to your shop</div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pillars */}
          <div className="max-w-7xl mx-auto">
            <div className="flex justify-center mb-6">
              <div className="inline-flex items-center gap-2 bg-cyan-400 text-blue-950 text-xs font-black uppercase tracking-[0.2em] px-5 py-2 rounded-full shadow-xl shadow-cyan-500/40">
                <Sparkles className="w-3.5 h-3.5" />
                Category-Defining
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <Card className="bg-card/60 border-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300 group">
                <CardContent className="p-7">
                  <div className="w-12 h-12 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Users className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-2">Pillar 01</div>
                  <h3 className="text-xl font-black mb-2 tracking-tight">Customer Retention</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    AI calls past customers with status updates, follow-ups, and loyalty
                    offers. They come back to you instead of shopping competitors.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card/60 border-cyan-500/40 hover:border-cyan-500/70 transition-all duration-300 group relative shadow-xl shadow-cyan-500/10">
                <CardContent className="p-7">
                  <div className="w-12 h-12 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Sparkles className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-2">Pillar 02</div>
                  <h3 className="text-xl font-black mb-2 tracking-tight">New Customer Development</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    AI prospects leads in your service area, qualifies them, and books tows.
                    The first true outbound sales engine in towing — nothing else like it
                    exists.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card/60 border-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300 group">
                <CardContent className="p-7">
                  <div className="w-12 h-12 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Wrench className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-2">Pillar 03</div>
                  <h3 className="text-xl font-black mb-2 tracking-tight">Preferred Shop Referrals</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    AI confirms each tow's destination, then offers your preferred auto
                    repair shops with incentives. A one-of-a-kind referral engine — recurring
                    revenue on every call.
                  </p>
                </CardContent>
              </Card>

              <Card className="bg-card/60 border-cyan-500/20 hover:border-cyan-500/50 transition-all duration-300 group">
                <CardContent className="p-7">
                  <div className="w-12 h-12 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                    <Terminal className="w-6 h-6 text-cyan-400" />
                  </div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-2">Pillar 04</div>
                  <h3 className="text-xl font-black mb-2 tracking-tight">Engineered. Not Scripted.</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    We don't paste prompts into website chat boxes. Every conversation,
                    workflow, and integration is written in hard code — production-grade
                    software, not a no-code sandbox.
                  </p>
                </CardContent>
              </Card>
            </div>
          </div>

          <div className="text-center mt-12">
            <div className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Zap className="w-4 h-4 text-cyan-400" />
              <span>No competitor in the towing space offers outbound sales AI. We built it first.</span>
            </div>
          </div>
        </div>
      </section>

      {/* Live Demo */}
      <section id="demo" className="py-24 lg:py-32 relative">
        <div className="absolute inset-0 z-0 opacity-30">
          <img src={NETWORK_IMAGE} alt="Abstract network connectivity graphic illustrating the AI-Connect dispatch automation platform" className="w-full h-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/60 to-background"></div>
        </div>
        <div className="container relative z-10">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <Badge className="mb-4 bg-cyan-500/10 text-cyan-400 border-cyan-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse mr-2"></span>
                Live Demo
              </Badge>
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
                Watch a real
                <br />
                <span className="text-gradient-cyan">flip in action.</span>
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-6">
                This is what every new motor club call looks like. The AI confirms details, identifies the destination, and offers a flip to your preferred shop — automatically.
              </p>
              <ul className="space-y-3 mb-8">
                {[
                  "Detected job in Towbook (60-second polling)",
                  "Outbound call placed via Twilio",
                  "Google Places classifies destination",
                  "AI offers flip · customer accepts",
                  "Towbook destination updated · Management notified",
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm">
                    <div className="w-5 h-5 rounded-full bg-cyan-500/20 border border-cyan-500/40 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Check className="w-3 h-3 text-cyan-400" strokeWidth={3} />
                    </div>
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              <Link href="/sign-up">
                <Button size="lg" className="h-14 px-8 text-base bg-blue-600 hover:bg-blue-500 text-white font-bold shadow-xl shadow-blue-500/30">
                  Start Generating Revenue
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Button>
              </Link>
            </div>
            <div className="lg:col-span-7">
              <LiveCallDemo />
            </div>
          </div>
        </div>
      </section>

      {/* ROI Calculator */}
      <section id="calculator" className="py-24 lg:py-32 bg-card/30">
        <div className="container">
          <div className="grid lg:grid-cols-12 gap-10 items-center">
            <div className="lg:col-span-5">
              <Badge className="mb-4 bg-blue-500/10 text-blue-400 border-blue-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
                ROI Calculator
              </Badge>
              <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
                See exactly how much
                <br />
                <span className="text-gradient-blue">you'll save.</span>
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-8">
                Drag the sliders to match your call volume. We'll show you what TowPilot would charge versus what you'd actually pay with US Tow AI-Connect.
              </p>

              <div className="space-y-3">
                <div className="flex items-center gap-3 p-3 bg-card/60 border border-border rounded-lg">
                  <div className="w-8 h-8 rounded-md bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                    <Check className="w-4 h-4 text-blue-400" strokeWidth={3} />
                  </div>
                  <div className="text-sm">No setup fees · No contracts · No surprises</div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-card/60 border border-border rounded-lg">
                  <div className="w-8 h-8 rounded-md bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                    <Check className="w-4 h-4 text-blue-400" strokeWidth={3} />
                  </div>
                  <div className="text-sm">Up to 33% less per minute (Shareholders vs TowPilot)</div>
                </div>
                <div className="flex items-center gap-3 p-3 bg-card/60 border border-border rounded-lg">
                  <div className="w-8 h-8 rounded-md bg-blue-500/15 border border-blue-500/30 flex items-center justify-center">
                    <Check className="w-4 h-4 text-blue-400" strokeWidth={3} />
                  </div>
                  <div className="text-sm">Plus revenue from outbound flip calls</div>
                </div>
              </div>
            </div>
            <div className="lg:col-span-7">
              <ROICalculator />
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-24 lg:py-32 relative">
        <div className="container">
          <div className="max-w-2xl mb-16">
            <Badge className="mb-4 bg-blue-500/10 text-blue-400 border-blue-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              How It Works
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
              Setup in minutes.
              <br />
              <span className="text-gradient-cyan">Live in hours.</span>
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                num: "01",
                icon: Database,
                title: "Connect Your Dispatch Software",
                desc: "Plug in your Towbook, TOPS, Omadi, Dispatch Anywhere, or InTow credentials. Test connection in 30 seconds.",
              },
              {
                num: "02",
                icon: Activity,
                title: "AI Scans Every 60 Seconds",
                desc: "Our adapter pulls active jobs from your dispatch board and caches them for instant lookups by the AI agent.",
              },
              {
                num: "03",
                icon: Bot,
                title: "Calls Get Handled. Revenue Grows.",
                desc: "Inbound callers get instant ETAs. New tow customers get an outbound confirmation call with shop referrals.",
              },
            ].map((step, i) => (
              <Card key={i} className="bg-card/60 backdrop-blur-md border-border/50 hover:border-blue-500/30 transition-all duration-300 group">
                <CardContent className="p-8">
                  <div className="text-7xl font-black text-blue-500/10 leading-none mb-4 tracking-tighter group-hover:text-blue-500/20 transition-colors">
                    {step.num}
                  </div>
                  <div className="w-12 h-12 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-center mb-4">
                    <step.icon className="w-6 h-6 text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-3 tracking-tight">{step.title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed">{step.desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Comparison */}
      <section id="comparison" className="py-24 lg:py-32 bg-card/30">
        <div className="container">
          <div className="max-w-2xl mb-16">
            <Badge className="mb-4 bg-cyan-500/10 text-cyan-400 border-cyan-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              Feature Comparison
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
              We do everything they do.
              <br />
              <span className="text-gradient-cyan">Plus what they can't.</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Side-by-side comparison vs TowPilot AI.
            </p>
          </div>

          <Card className="bg-card/80 backdrop-blur-md border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-5 px-6 text-xs uppercase tracking-[0.15em] text-muted-foreground font-bold">Feature</th>
                    <th className="py-5 px-6 text-center min-w-[160px]">
                      <div className="flex items-center justify-center gap-2">
                        <div className="w-8 h-8 rounded-md bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center">
                          <Phone className="w-4 h-4 text-white" />
                        </div>
                        <span className="text-sm font-bold">US Tow AI-Connect</span>
                      </div>
                    </th>
                    <th className="py-5 px-6 text-center min-w-[140px]">
                      <span className="text-sm font-bold text-muted-foreground">TowPilot AI</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { f: "Inbound AI Phone Answering", us: true, them: true },
                    { f: "24/7/365 Coverage", us: true, them: true },
                    { f: "Live ETA Lookups", us: true, them: true },
                    { f: "Impound Inquiries", us: true, them: true },
                    { f: "Smart Call Transfers", us: true, them: true },
                    { f: "Multilingual Support", us: true, them: true },
                    { f: "Outbound Confirmation Calls", us: true, them: false, highlight: true },
                    { f: "Auto Shop Referral Engine", us: true, them: false, highlight: true },
                    { f: "CONVINI App Integration", us: true, them: false, highlight: true },
                    { f: "Dynamic Day/Night Routing", us: true, them: false, highlight: true },
                    { f: "AAA Portal Integration", us: true, them: false, highlight: true },
                    { f: "Native Zero-Latency Mode", us: "Coming", them: false, highlight: true },
                    { f: "US Tow Alliance Network", us: true, them: false, highlight: true },
                    { f: "Alliance Profile Rate", us: "$0.30", them: "$0.30", price: true },
                    { f: "Alliance Elite Rate", us: "$0.25", them: false, highlight: true, price: true },
                    { f: "AI-Connect Shareholder Rate", us: "$0.20", them: false, highlight: true, price: true },
                  ].map((row, i) => (
                    <tr key={i} className={`border-b border-border/40 ${row.highlight ? "bg-blue-500/5" : ""}`}>
                      <td className="py-4 px-6 text-sm font-medium">
                        <div className="flex items-center gap-2">
                          {row.f}
                          {row.highlight && <Badge className="bg-blue-500/15 text-blue-400 border-blue-500/30 text-[9px] px-1.5 py-0 h-4 uppercase tracking-wider">Exclusive</Badge>}
                        </div>
                      </td>
                      <td className="py-4 px-6 text-center">
                        {row.us === true ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-blue-500/15 border border-blue-500/40">
                            <Check className="w-4 h-4 text-blue-400" strokeWidth={3} />
                          </div>
                        ) : (
                          <span className={`font-bold ${row.price ? "text-blue-400 text-lg" : "text-blue-400"}`}>{row.us}</span>
                        )}
                      </td>
                      <td className="py-4 px-6 text-center">
                        {row.them === true ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted border border-border">
                            <Check className="w-4 h-4 text-muted-foreground" strokeWidth={3} />
                          </div>
                        ) : row.them === false ? (
                          <div className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-muted/50 border border-border/50">
                            <X className="w-4 h-4 text-muted-foreground/50" strokeWidth={3} />
                          </div>
                        ) : (
                          <span className={`font-bold ${row.price ? "text-muted-foreground text-lg line-through" : "text-muted-foreground"}`}>{row.them}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </section>

      {/* Software compatibility + Native */}
      <section className="py-24 lg:py-32">
        <div className="container">
          <div className="max-w-2xl mb-16 mx-auto text-center">
            <Badge className="mb-4 bg-blue-500/10 text-blue-400 border-blue-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              Works With Your Software
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
              Plug into anything.
              <br />
              <span className="text-gradient-blue">Migrate to perfection.</span>
            </h2>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 max-w-5xl mx-auto mb-16">
            {[
              { name: "Towbook", status: "Live" },
              { name: "AAA Portal", status: "Live" },
              { name: "TOPS", status: "Coming" },
              { name: "Omadi", status: "Coming" },
              { name: "Dispatch Anywhere", status: "Coming" },
              { name: "InTow", status: "Coming" },
            ].map((sw, i) => (
              <Card key={i} className="bg-card/60 border-border hover:border-blue-500/40 transition-all hover:scale-[1.02]">
                <CardContent className="p-5 text-center">
                  <div className="font-bold text-sm mb-2">{sw.name}</div>
                  <Badge variant={sw.status === "Live" ? "default" : "outline"} className={sw.status === "Live" ? "bg-blue-500/20 text-blue-400 border-blue-500/40 text-[9px] px-2" : "text-[9px] px-2 text-muted-foreground"}>
                    {sw.status}
                  </Badge>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card className="bg-gradient-to-br from-cyan-500/10 via-blue-500/5 to-card border-cyan-500/30 overflow-hidden relative">
            <div className="absolute top-0 right-0 w-1/2 h-full opacity-25">
              <img src={DASHBOARD_IMAGE} alt="US Tow Dispatch native dashboard showing zero-latency AI integration with real-time tow job data" className="w-full h-full object-cover" />
            </div>
            <CardContent className="p-10 lg:p-14 relative z-10">
              <div className="max-w-2xl">
                <Badge className="mb-4 bg-cyan-500/20 text-cyan-400 border-cyan-500/40 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
                  <Zap className="w-3 h-3 mr-2" /> Coming Soon · Migration Path
                </Badge>
                <h3 className="text-3xl lg:text-4xl font-black tracking-tight mb-4">
                  Zero-Latency Native Mode
                </h3>
                <p className="text-base lg:text-lg text-muted-foreground leading-relaxed mb-6">
                  When you migrate to US Tow Dispatch, AI-Connect queries your database directly — no scraping, no third-party dependencies, no waiting. The fastest AI dispatch on the market.
                </p>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse-glow"></div>
                    <span className="font-bold text-cyan-400">&lt; 100ms response</span>
                  </div>
                  <Separator orientation="vertical" className="h-4" />
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-cyan-400" />
                    <span className="text-muted-foreground">No scraping required</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-24 lg:py-32 bg-card/30">
        <div className="container">
          <div className="max-w-2xl mb-16 mx-auto text-center">
            <Badge className="mb-4 bg-blue-500/10 text-blue-400 border-blue-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              Pricing
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
              Same retail.
              <br />
              <span className="text-gradient-blue">Alliance unlocks more.</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              Alliance Profile pays $0.30/min. Alliance Elite pays $0.25/min.
              AI-Connect Shareholders pay $0.20/min. No credit games. No surprise overages.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-6xl mx-auto">
            {[
              {
                name: "Starter",
                price: "$169",
                tag: "1,000 minutes/mo · Alliance Profile",
                rate: "$0.30/min overage",
                features: [
                  "Inbound AI phone answering",
                  "Live ETA lookups",
                  "Impound inquiries",
                  "Smart call transfers",
                  "Email support",
                ],
                cta: "Start Free Trial",
              },
              {
                name: "Professional",
                price: "$399",
                tag: "2,500 minutes/mo · Alliance Elite",
                rate: "$0.25/min overage",
                features: [
                  "Everything in Starter",
                  "Outbound confirmation calls",
                  "Auto shop referral engine",
                  "CONVINI app integration",
                  "Priority support",
                ],
                cta: "Start Free Trial",
                popular: true,
              },
              {
                name: "Enterprise",
                price: "$699",
                tag: "5,000 minutes/mo · Shareholders",
                rate: "$0.20/min overage",
                features: [
                  "Everything in Professional",
                  "AAA Portal integration",
                  "Custom adapter requests",
                  "Multi-company dashboard",
                  "Dedicated account manager",
                ],
                cta: "Talk to Sales",
              },
            ].map((plan, i) => (
              <Card
                key={i}
                className={`relative ${
                  plan.popular
                    ? "bg-gradient-to-b from-blue-500/10 to-card border-blue-500/40 lg:scale-105 shadow-xl shadow-blue-500/20 glow-blue"
                    : "bg-card/80 border-border"
                }`}
              >
                {plan.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-blue-500 text-white text-[10px] font-bold uppercase tracking-wider px-3 py-1 rounded-full shadow-lg">
                    Most Popular
                  </div>
                )}
                <CardContent className="p-8">
                  <div className="text-sm font-bold text-blue-400 uppercase tracking-wider mb-2">{plan.name}</div>
                  <div className="flex items-baseline gap-1 mb-1">
                    <span className="text-5xl font-black tracking-tight">{plan.price}</span>
                    <span className="text-muted-foreground">/mo</span>
                  </div>
                  <div className="text-sm text-muted-foreground mb-1">{plan.tag}</div>
                  <div className="text-xs text-blue-400 font-medium mb-6">{plan.rate}</div>
                  {plan.cta === "Talk to Sales" ? (
                    <Button
                      className={`w-full mb-6 font-bold ${
                        plan.popular
                          ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                          : "bg-card border border-border hover:bg-muted text-foreground"
                      }`}
                    >
                      {plan.cta}
                    </Button>
                  ) : (
                    <Link href="/sign-up" className="w-full">
                      <Button
                        className={`w-full mb-6 font-bold ${
                          plan.popular
                            ? "bg-blue-600 hover:bg-blue-500 text-white shadow-lg shadow-blue-500/30"
                            : "bg-card border border-border hover:bg-muted text-foreground"
                        }`}
                      >
                        {plan.cta}
                      </Button>
                    </Link>
                  )}
                  <Separator className="mb-6" />
                  <ul className="space-y-3">
                    {plan.features.map((f, j) => (
                      <li key={j} className="flex items-start gap-3 text-sm">
                        <Check className="w-4 h-4 text-blue-400 flex-shrink-0 mt-0.5" />
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="text-center mt-12 max-w-2xl mx-auto">
            <Card className="bg-blue-500/10 border-blue-500/40 inline-block">
              <CardContent className="p-4 flex items-center gap-3">
                <ShieldCheck className="w-5 h-5 text-blue-400 flex-shrink-0" />
                <p className="text-sm text-left">
                  <span className="text-blue-300 font-bold">Alliance Membership unlocks lower rates.</span>
                  <span className="text-muted-foreground"> Profile $0.30/min · Elite $0.25/min · </span>
                  <span className="text-amber-400 font-semibold">Shareholders $0.20/min</span>
                  <span className="text-muted-foreground">. Complete your free profile at </span>
                  <a href="https://www.ustowalliance.com" target="_blank" rel="noreferrer" className="text-cyan-300 font-semibold hover:underline">ustowalliance.com</a>
                  <span className="text-muted-foreground"> to qualify.</span>
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>

      {/* Ownership Section */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-900/30 via-background to-cyan-900/20"></div>
          <div className="absolute inset-0 bg-grid opacity-20"></div>
        </div>
        <div className="container relative z-10">
          <div className="max-w-6xl mx-auto">
            <div className="grid lg:grid-cols-12 gap-10 items-center">
              <div className="lg:col-span-7">
                <Badge className="mb-4 bg-cyan-500/15 text-cyan-300 border-cyan-500/40 px-3 py-1.5 text-xs font-bold tracking-wider uppercase">
                  <Sparkles className="w-3 h-3 mr-2" />
                  Exclusive Investment Opportunity
                </Badge>
                <h2 className="text-4xl lg:text-6xl font-black tracking-tight mb-6 leading-[1.05]">
                  Own a piece of
                  <br />
                  <span className="text-gradient-cyan">what you use.</span>
                </h2>
                <p className="text-lg lg:text-xl text-muted-foreground leading-relaxed mb-6">
                  US Tow Alliance is releasing up to <span className="text-foreground font-bold">33% ownership</span> of every solution we build — reserved exclusively for towing business owners. <span className="text-foreground font-bold">This offering is for US Tow AI-Connect — 660 shares total</span>, first come first served.
                </p>
                <p className="text-base text-muted-foreground leading-relaxed mb-6">
                  This is a <span className="text-foreground font-semibold">closed investment opportunity</span>. Not open to the public. Not open to outside venture capital. Just towing owners building for and partnering with towing owners.
                </p>

                <Card className="bg-amber-500/10 border-amber-500/40 mb-6">
                  <CardContent className="p-4 flex items-start gap-3">
                    <Sparkles className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <span className="font-bold text-amber-300">US Tow AI-Connect shares only.</span>
                      <span className="text-muted-foreground"> The 660 shares on this page are shares of </span>
                      <span className="text-foreground font-semibold">US Tow AI-Connect</span>
                      <span className="text-muted-foreground"> — not US Tow Alliance, and not other Blue Collar AI solutions. Each solution in the ecosystem has its own separate share offering. Shareholders may purchase shares in additional solutions individually.</span>
                    </div>
                  </CardContent>
                </Card>

                <Card className="bg-blue-500/10 border-blue-500/40 mb-8">
                  <CardContent className="p-4 flex items-start gap-3">
                    <ShieldCheck className="w-5 h-5 text-blue-400 flex-shrink-0 mt-0.5" />
                    <div className="text-sm">
                      <span className="font-bold text-blue-300">Alliance Membership Required.</span>
                      <span className="text-muted-foreground"> Complete your free US Tow Alliance member profile to unlock </span>
                      <span className="text-foreground font-semibold">$0.30/min Profile</span>
                      <span className="text-muted-foreground"> or </span>
                      <span className="text-foreground font-semibold">$0.25/min Elite</span>
                      <span className="text-muted-foreground"> rates. Become a </span>
                      <span className="text-amber-400 font-semibold">Shareholder for $0.20/min</span>
                      <span className="text-muted-foreground"> — the lowest rate available.</span>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
                  <Card className="bg-card/60 border-cyan-500/30 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-1">Total Shares</div>
                      <div className="text-2xl lg:text-3xl font-black tracking-tight">660</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/60 border-cyan-500/30 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-1">Per Share</div>
                      <div className="text-2xl lg:text-3xl font-black tracking-tight">$1,000</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/60 border-cyan-500/30 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-1">Max Per Owner</div>
                      <div className="text-2xl lg:text-3xl font-black tracking-tight">5</div>
                    </CardContent>
                  </Card>
                  <Card className="bg-card/60 border-cyan-500/30 backdrop-blur-sm">
                    <CardContent className="p-4">
                      <div className="text-[10px] uppercase tracking-[0.2em] text-cyan-400 font-bold mb-1">Dividends</div>
                      <div className="text-xl lg:text-2xl font-black tracking-tight whitespace-nowrap">Quarterly</div>
                    </CardContent>
                  </Card>
                </div>

                <div className="flex flex-col sm:flex-row gap-3">
                  <a href="https://www.ustowalliance.com" target="_blank" rel="noreferrer">
                    <Button size="lg" className="bg-cyan-500 hover:bg-cyan-400 text-blue-950 font-black text-base h-14 px-8 shadow-xl shadow-cyan-500/40">
                      Complete Alliance Profile & Reserve Shares
                      <ArrowRight className="w-5 h-5 ml-2" />
                    </Button>
                  </a>
                  <Link href="/inquire-shares">
                    <Button size="lg" variant="outline" className="bg-[#1a365d] border-cyan-500/40 text-cyan-300 hover:bg-blue-900 hover:text-cyan-200 h-14 px-8 text-base font-bold">
                      Inquire About Purchasing Shares
                    </Button>
                  </Link>
                </div>
                <p className="text-xs text-muted-foreground mt-4 italic">
                  Towing owners building for and partnering with towing owners. Own what you use.
                </p>
              </div>

              <div className="lg:col-span-5">
                <Card className="bg-gradient-to-br from-blue-900 via-blue-950 to-black border-cyan-500/30 overflow-hidden relative shadow-2xl shadow-cyan-500/20">
                  <div className="absolute top-0 right-0 w-48 h-48 bg-cyan-400/10 rounded-full blur-3xl"></div>
                  <div className="absolute bottom-0 left-0 w-48 h-48 bg-blue-500/10 rounded-full blur-3xl"></div>
                  <CardContent className="p-8 relative">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <Award className="w-5 h-5 text-cyan-400" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-cyan-300 font-bold">Founding Owner Certificate</span>
                      </div>
                      <Badge className="bg-cyan-500/20 text-cyan-300 border-cyan-500/40 text-[9px]">
                        US TOW ALLIANCE
                      </Badge>
                    </div>
                    <div className="text-2xl font-black text-white mb-1 tracking-tight">
                      Up to 33% Ownership
                    </div>
                    <div className="text-sm text-blue-200 mb-6">
                      In US Tow AI-Connect specifically. Reserved for towing business owners only.
                    </div>

                    <Separator className="bg-cyan-500/20 mb-6" />

                    <div className="space-y-3 mb-6">
                      {[
                        "Quarterly profit-sharing dividends (AI-Connect only)",
                        "Closed to outside investors — owners only",
                        "21+ other solutions available as separate share offerings",
                        "Shareholders may purchase shares in other solutions individually",
                      ].map((item, i) => (
                        <div key={i} className="flex items-start gap-3 text-sm text-blue-100">
                          <Check className="w-4 h-4 text-cyan-400 flex-shrink-0 mt-0.5" strokeWidth={3} />
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>

                    <div className="bg-cyan-500/10 border border-cyan-500/30 rounded-lg p-4">
                      <div className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold mb-1">Maximum Personal Investment</div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-black text-white tabular-nums">$5,000</span>
                        <span className="text-blue-200 text-sm">(5 shares)</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Ecosystem */}
      <section className="py-24 lg:py-32">
        <div className="container">
          <div className="max-w-2xl mb-16 mx-auto text-center">
            <Badge className="mb-4 bg-cyan-500/10 text-cyan-400 border-cyan-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
              The Ecosystem
            </Badge>
            <h2 className="text-4xl lg:text-5xl font-black tracking-tight mb-4">
              You're not buying a tool.
              <br />
              <span className="text-gradient-cyan">You're joining a movement.</span>
            </h2>
            <p className="text-lg text-muted-foreground leading-relaxed">
              AI-Connect is one piece of a 20+ solution ecosystem built by Blue Collar AI for towing professionals.
            </p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 max-w-7xl mx-auto">
            {(
              [
                // US Tow branded — surfaced first
                { name: "US Tow Alliance", icon: Users, desc: "National membership network", href: "https://www.ustowalliance.com" },
                { name: "US Tow Dispatch", icon: Building2, desc: "Dispatch management software", href: "https://www.ustowdispatch.com" },
                { name: "US Tow AI-Connect", icon: Phone, desc: "Inbound / outbound AI phone attendant", href: "https://www.ustowaiconnect.com" },
                { name: "US Tow Bid", icon: Gavel, desc: "Tow truck only online auction & sales", href: "https://www.ustowbid.com" },
                { name: "US Tow Jobs", icon: Briefcase, desc: "Talent marketplace for towers", href: "https://www.ustowjobs.com" },
                { name: "US Tow Marketing", icon: Megaphone, desc: "24/7 lead generation engine" },
                { name: "US Tow Grade", icon: Star, desc: "Rate the motor clubs", href: "https://www.ustowgrade.com" },
                { name: "US Tow Fleet", icon: ShieldCheck, desc: "Fleet management software", href: "https://www.ustowfleet.com" },
                { name: "US Tow Command", icon: Camera, desc: "GPS tracking & dash cameras" },
                { name: "US Tow Shield", icon: ShieldCheck, desc: "Damages claims management", href: "https://www.ustowshield.com" },
                { name: "US Tow Credit", icon: DollarSign, desc: "Credit repair solutions", href: "https://www.ustowcredit.com" },
                { name: "US Tow News", icon: Newspaper, desc: "Industry news and events", href: "https://www.ustownews.com" },
                { name: "US Tow X", icon: Hash, desc: "X for towing professionals", href: "https://www.ustowx.com" },
                // Other ecosystem solutions
                { name: "Convini-CAR", icon: Sparkles, desc: "Vehicle transport & logistics", href: "https://www.convinicar.online" },
                { name: "RECON AI", icon: Bot, desc: "AI bookkeeping & reconciliation" },
                { name: "RECON AI DIY Toolkit", icon: PenTool, desc: "Self-service AI prompts & workflows" },
                { name: "PEER Field Press", icon: BookOpen, desc: "10-book towing leadership library" },
                { name: "Capital Bridge", icon: DollarSign, desc: "Business financing & capital" },
                { name: "MCA Debt Solutions", icon: ClipboardCheck, desc: "Merchant cash advance relief" },
                { name: "Iron Horse Tow Trucks", icon: Truck, desc: "Custom built tow trucks" },
                { name: "WrenchLink", icon: Wrench, desc: "Mechanic & shop network" },
                { name: "Insurance Solutions", icon: ShieldCheck, desc: "Get the best insurance rates in the country" },
                { name: "Shift Track", icon: Activity, desc: "Driver shift reporting app" },
              ] as Array<{
                name: string;
                icon: typeof Users;
                desc: string;
                href?: string;
              }>
            ).map((item, i) => {
              const card = (
                <Card key={i} className="bg-card/60 border-border hover:border-cyan-500/40 transition-all duration-300 group hover:scale-[1.02] h-full">
                  <CardContent className="p-5">
                    <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                      <item.icon className="w-5 h-5 text-cyan-400" />
                    </div>
                    <div className="font-bold text-sm mb-1 flex items-center gap-1.5">
                      {item.name}
                      {item.href && (
                        <ArrowRight className="w-3 h-3 text-cyan-400 opacity-0 group-hover:opacity-100 -rotate-45 transition-opacity" />
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{item.desc}</div>
                  </CardContent>
                </Card>
              );
              return item.href ? (
                <a key={i} href={item.href} target="_blank" rel="noreferrer" className="block">
                  {card}
                </a>
              ) : (
                <div key={i}>{card}</div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 lg:py-32 relative overflow-hidden">
        <div className="absolute inset-0 z-0">
          <img src={NETWORK_IMAGE} alt="Blue Collar AI network background graphic for the US Tow AI-Connect call to action" className="w-full h-full object-cover opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/90 to-background"></div>
        </div>
        <div className="container relative z-10">
          <Card className="bg-gradient-to-br from-blue-500/10 via-card to-cyan-500/5 border-blue-500/30 max-w-4xl mx-auto overflow-hidden glow-blue">
            <CardContent className="p-12 lg:p-16 text-center">
              <Badge className="mb-6 bg-blue-500/15 text-blue-400 border-blue-500/30 px-3 py-1 text-xs font-semibold tracking-wider uppercase">
                <Globe className="w-3 h-3 mr-2" />
                Built by Blue Collar AI · Powered by US Tow Alliance
              </Badge>
              <h2 className="text-4xl lg:text-6xl font-black tracking-tight mb-6">
                Stop overpaying.
                <br />
                <span className="text-gradient-blue">Start AI-Connecting.</span>
              </h2>
              <p className="text-lg text-muted-foreground leading-relaxed mb-10 max-w-2xl mx-auto">
                14-day free trial. No credit card required. Setup in minutes. Cancel anytime.
              </p>
              <div className="flex justify-center">
                <Link href="/schedule-demo">
                  <Button size="lg" className="bg-blue-600 hover:bg-blue-500 text-white font-bold text-base h-14 px-8 shadow-xl shadow-blue-500/40">
                    Schedule a Demo
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-border py-12 bg-card/30">
        <div className="container">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-10">
            <div className="col-span-2">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center shadow-lg shadow-blue-500/30">
                  <Phone className="w-5 h-5 text-white" />
                </div>
                <div>
                  <div className="font-bold text-base leading-tight">US Tow AI-Connect</div>
                  <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 font-medium">By Blue Collar AI</div>
                </div>
              </div>
              <p className="text-sm text-muted-foreground max-w-md leading-relaxed mb-4">
                The AI dispatcher built for towing companies. Alliance Profile pricing from $0.30/min — Shareholders pay just $0.20. Plus the features TowPilot doesn't have.
              </p>
              <div className="text-xs text-muted-foreground">
                Chris Peer · Founder & Lead AI Architect
                <br />
                chris@bluecollarai.online · 614-633-7935
              </div>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.15em] font-bold mb-4 text-muted-foreground">Product</div>
              <ul className="space-y-2 text-sm">
                <li><a href="#features" className="hover:text-blue-400 transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-blue-400 transition-colors">Pricing</a></li>
                <li><a href="#comparison" className="hover:text-blue-400 transition-colors">vs TowPilot</a></li>
                <li><a href="#calculator" className="hover:text-blue-400 transition-colors">ROI Calculator</a></li>
              </ul>
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.15em] font-bold mb-4 text-muted-foreground">Company</div>
              <ul className="space-y-2 text-sm">
                <li><a href="https://www.ustowalliance.com" target="_blank" rel="noreferrer" className="hover:text-blue-400 transition-colors">US Tow Alliance</a></li>
                <li><a href="https://www.bluecollarai.online" target="_blank" rel="noreferrer" className="hover:text-blue-400 transition-colors">Blue Collar AI</a></li>
                <li><a href="mailto:chris@bluecollarai.online" className="hover:text-blue-400 transition-colors">Contact</a></li>
                <li><a href="/privacy" className="hover:text-blue-400 transition-colors">Legal</a></li>
              </ul>
            </div>
          </div>
          <Separator className="mb-6" />
          <div className="flex flex-col md:flex-row justify-between items-center gap-4 text-xs text-muted-foreground">
            <div>© 2026 Blue Collar AI · US Tow Dispatch · All rights reserved.</div>
            <div className="flex items-center gap-4">
              <a href="/privacy" className="hover:text-blue-300">Privacy</a>
              <a href="/terms" className="hover:text-blue-300">Terms</a>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse-glow"></div>
                All systems operational
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
