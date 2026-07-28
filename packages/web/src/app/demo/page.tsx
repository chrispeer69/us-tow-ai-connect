'use client';

import Link from 'next/link';
import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { Menu, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icons';
import {
  type Driver,
  type Stats,
  type UnifiedJob,
  type UnifiedJobStatus,
} from '@/lib/command-center-types';
import { cn } from '@/lib/utils';
import { NAV_GROUPS } from '@/components/admin/nav-config';
import { FilterBar, type CommandCenterFilters } from '../admin/command-center/components/FilterBar';
import { JobsTable } from '../admin/command-center/components/JobsTable';
import { JobDrawer, type ManualCallScriptType } from '../admin/command-center/components/JobDrawer';
import { ScheduleDemoClient } from '../schedule-demo/ScheduleDemoClient';
import { DemoTour, type DemoTourController } from './DemoTour';

const TENANT_ID = 'demo-tenant';
const COMMAND_CENTER_HREF = '/admin/command-center';
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION || 'v0.1.0';
const DEMO_NOW_MS = Date.UTC(2026, 5, 17, 14, 0, 0);
export default function PublicDemoPage() {
  const [jobs, setJobs] = useState<UnifiedJob[]>(() => seededJobs());
  const [drivers] = useState<Driver[]>(() => seededDrivers());
  const [selectedJobId, setSelectedJobId] = useState('demo-job-1');
  const [activeHref, setActiveHref] = useState(COMMAND_CENTER_HREF);
  const [showCallDemo, setShowCallDemo] = useState(false);
  const [demoCallMode, setDemoCallMode] = useState<'checking' | 'fallback' | 'test'>('fallback');
  const [showManualJob, setShowManualJob] = useState(false);
  const [initialScriptByJobId, setInitialScriptByJobId] = useState<
    Record<string, ManualCallScriptType>
  >({});
  const [showMobileNav, setShowMobileNav] = useState(false);
  const [filters, setFilters] = useState<CommandCenterFilters>({
    status: new Set(['new', 'assigned', 'en_route', 'on_scene', 'in_tow']),
    source: 'all',
    priority: 'all',
    search: '',
  });
  const [tourOpen, setTourOpen] = useState(false);

  // Stable so the tour's step effects do not re-fire on every page render.
  const tourController = useMemo<DemoTourController>(
    () => ({
      setSection: setActiveHref,
      selectJob: setSelectedJobId,
      closeOverlays: () => {
        setShowCallDemo(false);
        setShowManualJob(false);
        setShowMobileNav(false);
      },
    }),
    [],
  );

  const selectedJob = jobs.find((j) => j.id === selectedJobId) ?? null;
  const visibleJobs = useMemo(
    () => jobs.filter((job) => jobMatchesFilters(job, filters)),
    [jobs, filters],
  );

  const stats = useMemo<Stats>(
    () => ({
      activeJobs: visibleJobs.filter((j) => !['completed', 'canceled', 'declined'].includes(j.status))
        .length,
      jobsLast24h: visibleJobs.length,
      jobsPerHour: 2.8,
      avgEtaMinutes: 33,
      byStatus: [],
      bySource: [],
    }),
    [visibleJobs],
  );

  function updateJob(jobId: string, patch: Partial<UnifiedJob>) {
    setJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, ...patch } : job)));
  }

  function assignDriver(driverId: string | null) {
    if (!selectedJob) return;
    const driver = drivers.find((d) => d.id === driverId) ?? null;
    updateJob(selectedJob.id, {
      assignedDriverId: driverId,
      driver,
      status: selectedJob.status === 'new' && driverId ? 'assigned' : selectedJob.status,
    });
  }

  function changeStatus(status: UnifiedJobStatus) {
    if (!selectedJob) return;
    updateJob(selectedJob.id, { status });
  }

  async function openTestAgentCall() {
    setShowCallDemo(true);
    setDemoCallMode('checking');
    setDemoCallMode((await publicDemoCallsEnabled()) ? 'test' : 'fallback');
  }

  async function openManualJob() {
    setShowCallDemo(true);
    setDemoCallMode('checking');
    if (await publicDemoCallsEnabled()) {
      setShowCallDemo(false);
      setShowManualJob(true);
      return;
    }
    setDemoCallMode('fallback');
  }

  async function handleDemoCallCustomer(scriptType: ManualCallScriptType) {
    if (!selectedJob) return;
    setShowCallDemo(true);
    setDemoCallMode('checking');
    if (!(await publicDemoCallsEnabled())) {
      setDemoCallMode('fallback');
      throw new Error('Demo calls are disabled. Book a live demo to enable controlled test calls.');
    }
    setShowCallDemo(false);

    const vehicle = [
      selectedJob.vehicleYear,
      selectedJob.vehicleColor,
      selectedJob.vehicleMake,
      selectedJob.vehicleModel,
    ]
      .filter(Boolean)
      .join(' ');
    const res = await fetch('/api/v1/public/demo-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scriptType,
        toPhone: selectedJob.callerPhone || '',
        customerName: selectedJob.callerName || undefined,
        vehicle: vehicle || undefined,
        pickupLocation: selectedJob.pickupAddress || undefined,
        destination: selectedJob.dropoffAddress || undefined,
        motorClub: selectedJob.source?.toUpperCase?.() || 'Demo',
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status === 'error') {
      throw new Error(body?.message || body?.error || 'Unable to start demo call.');
    }
    updateJob(selectedJob.id, {
      latestCall: {
        id: body?.callId || `demo-call-${Date.now()}`,
        purpose: 'custom',
        status: 'queued',
        attempts: 1,
        durationSeconds: null,
        error: null,
        transcript: null,
        analysisData: { script_type: scriptType },
        startedAt: null,
        endedAt: null,
        createdAt: new Date().toISOString(),
      },
    });
  }

  async function publicDemoCallsEnabled() {
    try {
      const res = await fetch('/api/v1/public/demo-call/status', { cache: 'no-store' });
      const body = await res.json().catch(() => null);
      return Boolean(body?.data?.enabled);
    } catch {
      return false;
    }
  }

  const activeLabel = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === activeHref)?.label
    ?? 'Command Center';

  return (
    <div className="flex h-screen flex-col bg-zinc-50 text-zinc-900">
      <header className="shrink-0 border-b border-zinc-200 bg-white px-3 py-2 shadow-sm sm:px-4">
        <div className="flex min-w-0 flex-col justify-between gap-3 xl:flex-row xl:items-center">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setShowMobileNav(true)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-white text-zinc-700 shadow-sm lg:hidden"
              aria-label="Open demo navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <div className="font-label text-[11px] font-semibold uppercase tracking-[0.18em] text-blue-600">
                  Demo Account
                </div>
                <DemoHelp title="Demo mode" side="right">
                  This workspace is seeded and session-only. Visitors can explore the interface, but calls and database writes are blocked.
                </DemoHelp>
              </div>
              <h1 className="font-display text-xl font-extrabold leading-tight text-zinc-900 sm:text-2xl">{activeLabel}</h1>
            </div>
          </div>
          <div
            data-tour="header-actions"
            className="flex max-w-full shrink-0 items-center gap-2 overflow-x-auto whitespace-nowrap pb-1 xl:justify-end"
          >
            <Button className="shrink-0 gap-2" onClick={() => setTourOpen(true)}>
              <Sparkles className="h-4 w-4" />
              Take the tour
            </Button>
            <ExplainedAction
              label="Test Agent Call"
              help="Shows what happens when a dispatcher tries to place an AI call from the demo. The public demo blocks the actual call."
              onClick={() => void openTestAgentCall()}
            />
            <ExplainedAction
              label="Manage Drivers"
              help="Represents driver assignment and live availability controls. In demo mode these actions stay in the browser only."
              onClick={() => setShowCallDemo(true)}
            />
            <ExplainedAction
              label="+ Manual job"
              help="Shows where a dispatcher would add a job manually when it does not arrive from an integration."
              onClick={() => void openManualJob()}
            />
            <Link href="/schedule-demo">
              <Button variant="outline" className="shrink-0">Book demo</Button>
            </Link>
            <Link href="/">
              <Button variant="outline" className="shrink-0">Home</Button>
            </Link>
          </div>
        </div>
        <p
          data-tour="demo-banner"
          className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800"
        >
          Demo mode: outbound calls and writes to the real database are disabled.
        </p>
      </header>

      <div className="flex min-h-0 flex-1">
        <DemoSidebar activeHref={activeHref} onSelect={setActiveHref} />
        {showMobileNav && (
          <DemoMobileNav
            activeHref={activeHref}
            onClose={() => setShowMobileNav(false)}
            onSelect={(href) => {
              setActiveHref(href);
              setShowMobileNav(false);
            }}
          />
        )}
        {activeHref === COMMAND_CENTER_HREF ? (
          <main className="grid min-w-0 flex-1 grid-cols-12 overflow-y-auto lg:overflow-hidden">
            <section className="col-span-12 flex min-h-0 flex-col gap-3 p-3 sm:p-4 lg:col-span-9 lg:overflow-y-auto">
              <CompactStatsStrip stats={stats} />
              <div data-tour="filters">
                <div className="mb-2 flex items-center gap-2">
                  <span className="font-label text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">
                    Filter queue
                  </span>
                  <DemoHelp title="Queue filters" side="right">
                    Narrow the dispatch board by status, integration source, priority, or search term. This affects the map and table together.
                  </DemoHelp>
                </div>
                <FilterBar filters={filters} onChange={setFilters} />
              </div>
              <GuidanceStrip
                items={[
                  ['Map pins', 'Click a job pin to open the same job in the detail drawer.'],
                  ['Driver markers', 'Shows who is available or already on a job.'],
                  ['Table rows', 'Use the table when dispatchers need dense, scannable job details.'],
                ]}
              />
              <div data-tour="map" className="h-1/2 min-h-[300px] shrink-0">
                <DemoMap jobs={visibleJobs} drivers={drivers} selectedJobId={selectedJobId} onSelect={setSelectedJobId} />
              </div>
              <div data-tour="jobs-table" className="min-h-[280px] flex-1">
                <JobsTable
                  jobs={visibleJobs}
                  hasIntegrations
                  selectedJobId={selectedJobId}
                  onSelect={setSelectedJobId}
                />
              </div>
            </section>

            <section
              data-tour="drawer-column"
              className="col-span-12 min-h-[420px] overflow-visible border-t border-zinc-200 bg-white lg:col-span-3 lg:min-h-0 lg:border-l lg:border-t-0"
            >
              <div className="border-b border-zinc-200 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                <div className="flex items-center gap-2 font-semibold">
                  Job drawer
                  <DemoHelp title="Job drawer" side="left">
                    This panel is where dispatchers assign drivers, change job status, inspect customer details, and trigger manual AI calls.
                  </DemoHelp>
                </div>
              </div>
              {selectedJob ? (
                <JobDrawer
                  job={selectedJob}
                  drivers={drivers}
                  onAssign={assignDriver}
                  onStatusChange={changeStatus}
                  onCallCustomer={handleDemoCallCustomer}
                  onClose={() => setSelectedJobId('')}
                  initialScriptType={initialScriptByJobId[selectedJob.id] ?? 'auto_flip'}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-zinc-500">
                  Select a job on the map or in the table to see its details.
                </div>
              )}
            </section>
          </main>
        ) : (
          <DemoSection href={activeHref} onAction={() => setShowCallDemo(true)} />
        )}
      </div>

      {showCallDemo && demoCallMode === 'checking' && (
        <DemoCheckingModal onClose={() => setShowCallDemo(false)} />
      )}
      {showCallDemo && demoCallMode === 'fallback' && (
        <DemoCallModal onClose={() => setShowCallDemo(false)} />
      )}
      {showCallDemo && demoCallMode === 'test' && (
        <DemoTestAgentModal onClose={() => setShowCallDemo(false)} />
      )}
      {showManualJob && (
        <DemoManualJobModal
          onClose={() => setShowManualJob(false)}
          onCreated={(job, scriptType) => {
            setShowManualJob(false);
            setJobs((prev) => [job, ...prev]);
            setInitialScriptByJobId((prev) => ({ ...prev, [job.id]: scriptType }));
            setSelectedJobId(job.id);
          }}
        />
      )}

      <DemoTour open={tourOpen} onOpenChange={setTourOpen} controller={tourController} />
    </div>
  );
}

function DemoSidebar({
  activeHref,
  onSelect,
}: {
  activeHref: string;
  onSelect: (href: string) => void;
}) {
  return (
    <aside className="hidden w-64 shrink-0 border-r border-[var(--border-color)] bg-[var(--surface-card)] lg:flex lg:flex-col">
      <nav className="flex h-full flex-col gap-6 overflow-y-auto p-5">
        <div className="rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
          <div className="mb-1 flex items-center gap-2 font-label font-bold uppercase tracking-[0.14em]">
            Demo navigation
            <DemoHelp title="Navigation" side="right">
              These sections mirror a real tenant account. Clicking a section swaps the demo content without changing production data.
            </DemoHelp>
          </div>
          Explore the same modules an operator would use after onboarding.
        </div>
        {NAV_GROUPS.filter((group) => group.title !== 'Super Admin').map((group) => (
          <div key={group.title} className="flex flex-col gap-1">
            <div className="px-3 pb-1 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {group.title}
            </div>
            {group.items.map((item) => {
              const active = item.href === activeHref;
              return (
                <button
                  key={item.href}
                  type="button"
                  onClick={() => onSelect(item.href)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex items-center gap-3 rounded-[10px] border-l-2 px-3 py-2 text-left text-sm transition-colors',
                    active
                      ? 'border-[var(--alliance-blue)] bg-[var(--surface)] font-semibold text-[var(--alliance-blue)]'
                      : 'border-transparent font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-low)] hover:text-[var(--text-main)]',
                  )}
                >
                  <Icon
                    name={item.icon}
                    size={18}
                    className={cn('shrink-0', active ? 'opacity-100' : 'opacity-70')}
                  />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        ))}
        <DemoSidebarFooter tenantName="Seeded Demo Account" />
      </nav>
    </aside>
  );
}

function CompactStatsStrip({ stats }: { stats: Stats }) {
  const items = [
    { label: 'Active', value: stats.activeJobs.toLocaleString(), tone: 'text-blue-700' },
    { label: 'Avg ETA', value: `${stats.avgEtaMinutes.toFixed(0)}m`, tone: 'text-emerald-700' },
    { label: '24h Jobs', value: stats.jobsLast24h.toLocaleString(), tone: 'text-zinc-900' },
    { label: 'Jobs/hr', value: stats.jobsPerHour.toFixed(1), tone: 'text-amber-700' },
  ];
  return (
    <div data-tour="stats" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-lg border border-zinc-200 bg-white px-3 py-2 shadow-sm">
          <div className={cn('text-lg font-black leading-none', item.tone)}>{item.value}</div>
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            {item.label}
          </div>
        </div>
      ))}
    </div>
  );
}

function DemoMobileNav({
  activeHref,
  onSelect,
  onClose,
}: {
  activeHref: string;
  onSelect: (href: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 lg:hidden">
      <button
        type="button"
        className="absolute inset-0 bg-zinc-950/50"
        aria-label="Close demo navigation"
        onClick={onClose}
      />
      <aside className="relative flex h-full w-[min(86vw,340px)] flex-col border-r border-zinc-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3">
          <div>
            <div className="font-label text-[11px] font-bold uppercase tracking-[0.18em] text-blue-600">
              Demo account
            </div>
            <div className="text-sm font-semibold text-zinc-900">Navigation</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-600"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto p-4">
          <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 p-3 text-xs leading-5 text-blue-800">
            Pick any section to preview how a real tenant account is organized.
          </div>
          {NAV_GROUPS.filter((group) => group.title !== 'Super Admin').map((group) => (
            <div key={group.title} className="mb-5 flex flex-col gap-1">
              <div className="px-3 pb-1 font-label text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">
                {group.title}
              </div>
              {group.items.map((item) => {
                const active = item.href === activeHref;
                return (
                  <button
                    key={item.href}
                    type="button"
                    onClick={() => onSelect(item.href)}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-lg border-l-2 px-3 py-2 text-left text-sm transition-colors',
                      active
                        ? 'border-blue-600 bg-blue-50 font-semibold text-blue-700'
                        : 'border-transparent font-medium text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
                    )}
                  >
                    <Icon name={item.icon} size={18} className="shrink-0" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="border-t border-zinc-200 p-4">
          <Link href="/schedule-demo">
            <Button className="w-full">Book live demo</Button>
          </Link>
        </div>
      </aside>
    </div>
  );
}

function DemoSidebarFooter({ tenantName }: { tenantName?: string | null }) {
  return (
    <div className="mt-auto flex flex-col gap-1 border-t border-[var(--border-color)] px-3 pb-1 pt-4">
      <span className="font-label text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
        Powered by Blue Collar AI
      </span>
      <span className="text-[11px] text-[var(--text-secondary)]">
        {tenantName ? `${tenantName} · ` : ''}
        {APP_VERSION}
      </span>
    </div>
  );
}

function DemoSection({ href, onAction }: { href: string; onAction: () => void }) {
  if (href === '/admin/outbound-voice' || href === '/admin/calls') {
    return <DemoCallsSection mode={href === '/admin/calls' ? 'inbound' : 'outbound'} onAction={onAction} />;
  }
  if (href === '/admin/sms-log') return <DemoSmsSection />;
  if (href === '/admin/flip-engine') return <DemoFlipEngineSection onAction={onAction} />;
  if (href === '/admin/ai-agent' || href === '/admin/knowledge-pack') return <DemoAgentSection href={href} onAction={onAction} />;
  if (href === '/admin/integrations') return <DemoIntegrationsSection />;
  if (href === '/admin/reports' || href === '/admin/digest') return <DemoReportsSection href={href} onAction={onAction} />;
  if (href === '/admin/drivers-live') return <DemoDriversSection />;
  if (href === '/admin/digital-dispatch') return <DemoDispatchSection onAction={onAction} />;
  if (href === '/admin/company' || href === '/admin/members' || href === '/admin/api-keys' || href === '/admin/billing' || href === '/admin/audit-log' || href === '/admin/support' || href === '/admin/routing' || href === '/admin/branding') {
    return <DemoSettingsSection href={href} onAction={onAction} />;
  }
  return <DemoGenericSection onAction={onAction} />;
}

function DemoPanel({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <main data-tour="section-panel" className="min-w-0 flex-1 overflow-y-auto p-4">
      <div className="mx-auto max-w-6xl space-y-4">
        <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
          <div className="flex items-start justify-between gap-3">
            <span>
              Seeded demo data only. Controls are shown for product context, but no database writes or outbound calls happen here.
            </span>
            <DemoHelp title="Why demo data?" side="left">
              The public demo mirrors the product interface while preventing real calls, real SMS, and accidental changes to a tenant account.
            </DemoHelp>
          </div>
        </div>
        <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-display text-xl font-extrabold text-zinc-900">{title}</h2>
              <DemoHelp title={title} side="right">
                {description}
              </DemoHelp>
            </div>
            <p className="text-sm text-zinc-500">{description}</p>
          </div>
          {children}
        </section>
      </div>
    </main>
  );
}

function DemoHelp({
  title,
  children,
  side = 'bottom',
}: {
  title: string;
  children: ReactNode;
  side?: 'left' | 'right' | 'bottom';
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [tooltipStyle, setTooltipStyle] = useState<CSSProperties | null>(null);

  function showTooltip() {
    const button = buttonRef.current;
    if (!button || typeof window === 'undefined') return;
    const rect = button.getBoundingClientRect();
    const width = 288;
    const margin = 12;
    const maxLeft = Math.max(margin, window.innerWidth - width - margin);
    const preferredLeft =
      side === 'left'
        ? rect.right - width
        : side === 'right'
          ? rect.left
          : rect.left + rect.width / 2 - width / 2;
    setTooltipStyle({
      left: Math.min(Math.max(preferredLeft, margin), maxLeft),
      top: rect.bottom + 8,
      width,
    });
  }

  return (
    <span className="relative inline-flex">
      <button
        ref={buttonRef}
        type="button"
        className="flex h-6 w-6 items-center justify-center rounded-full border border-blue-200 bg-blue-50 text-xs font-bold text-blue-700 shadow-sm transition hover:border-blue-300 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-300"
        aria-label={`Explain ${title}`}
        onMouseEnter={showTooltip}
        onMouseLeave={() => setTooltipStyle(null)}
        onFocus={showTooltip}
        onBlur={() => setTooltipStyle(null)}
      >
        ?
      </button>
      {tooltipStyle && (
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[80] block max-w-[calc(100vw-24px)] whitespace-normal break-words rounded-lg border border-zinc-200 bg-white p-3 text-left text-xs leading-5 text-zinc-600 shadow-xl"
          style={tooltipStyle}
        >
          <span className="mb-1 block font-label text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
            {title}
          </span>
          {children}
        </span>
      )}
    </span>
  );
}

function ExplainerBox({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-w-[220px] rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-3 shadow-sm md:min-w-0">
      <div className="font-label text-[11px] font-bold uppercase tracking-[0.14em] text-blue-700">
        {title}
      </div>
      <p className="mt-1 text-xs leading-5 text-zinc-600">{body}</p>
    </div>
  );
}

function ExplainedAction({
  label,
  help,
  onClick,
}: {
  label: string;
  help: string;
  onClick: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="outline" onClick={onClick} className="shrink-0">
        {label}
      </Button>
      <DemoHelp title={label} side="left">
        {help}
      </DemoHelp>
    </div>
  );
}

function GuidanceStrip({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 md:grid md:grid-cols-3 md:overflow-visible md:pb-0">
      {items.map(([title, body]) => (
        <div key={title} className="min-w-[220px] rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 md:min-w-0">
          <div className="font-label text-[11px] font-bold uppercase tracking-[0.14em] text-emerald-700">
            {title}
          </div>
          <p className="mt-1 text-xs leading-5 text-emerald-900">{body}</p>
        </div>
      ))}
    </div>
  );
}

function DemoCallsSection({ mode, onAction }: { mode: 'inbound' | 'outbound'; onAction: () => void }) {
  const rows = mode === 'outbound'
    ? [
        ['09:42', 'Jordan Reed', '+15550101001', 'Winch-out photo reminder', 'completed', '1m 12s'],
        ['09:31', 'Taylor Morgan', '+15550101002', 'Auto flip', 'completed', '1m 55s'],
        ['09:18', 'Casey Ellis', '+15550101003', 'Auto flip', 'no_answer', '0s'],
      ]
    : [
        ['09:52', 'Riley Parker', '+15550101004', 'New tow request', 'answered', '2m 41s'],
        ['09:20', 'Jordan Reed', '+15550101001', 'Status question', 'answered', '1m 08s'],
        ['08:57', 'Unknown caller', '+15550101005', 'Impound inquiry', 'voicemail', '0s'],
      ];
  return (
    <DemoPanel
      title={mode === 'outbound' ? 'Outbound Voice' : 'Calls'}
      description="Seeded call log with transcript, recording controls, extraction data, and final outcome."
    >
      <GuidanceStrip
        items={[
          ['Call history', 'Shows every AI/customer conversation and final call state.'],
          ['Recording', 'Lets managers review what the customer actually heard.'],
          ['Extraction', 'Stores structured outcomes like flip accepted, no answer, or correction made.'],
        ]}
      />
      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <table className="min-w-full text-sm">
          <thead className="bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500">
            <tr>
              {['Time', 'Customer', 'Phone', 'Purpose', 'Status', 'Duration'].map((h) => <th key={h} className="px-3 py-2 text-left">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.join('-')} className="border-t border-zinc-100">
                {row.map((cell, i) => (
                  <td key={`${cell}-${i}`} className="px-3 py-2 text-zinc-700">
                    {i === 4 ? <StatusBadge label={cell} /> : cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Recording</div>
          <div className="flex items-center gap-3 rounded-full bg-white px-4 py-3 shadow-sm">
            <button type="button" onClick={onAction} className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white">
              ▶
            </button>
            <div className="h-1 flex-1 rounded-full bg-zinc-200">
              <div className="h-1 w-2/3 rounded-full bg-blue-600" />
            </div>
            <span className="text-xs font-medium text-zinc-500">1:12</span>
          </div>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Post-call extraction</div>
          <pre className="max-h-44 overflow-auto rounded bg-white p-3 text-xs text-zinc-700">{JSON.stringify({
            flip_eligible: true,
            flip_outcome: 'accepted',
            offer_1_result: 'accepted',
            convini_link_sent: true,
            corrections_made: 'destination changed to Complete Brake Service',
          }, null, 2)}</pre>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Transcript</div>
        <p className="font-mono text-sm leading-6 text-zinc-700">
          Agent: Hi Jordan, this is Emily calling from Roadside Towing. I am calling about your winch-out request.
          Please have a few photos of the situation ready. When the driver calls, they may ask you to text those photos.
          User: Okay, I can do that. Agent: Thank you. The driver will call to learn more details.
        </p>
      </div>
    </DemoPanel>
  );
}

function DemoSmsSection() {
  return (
    <DemoPanel title="SMS Log" description="Seeded outbound and management notification messages.">
      <GuidanceStrip
        items={[
          ['Outbound texts', 'Records links, daily summaries, and management alerts.'],
          ['Inbound replies', 'Shows customer responses for operational follow-up.'],
          ['Delivery state', 'Helps identify messages that need attention.'],
        ]}
      />
      <div className="space-y-3">
        {[
          ['outbound', '+15550101901', 'AI CALL NEEDS ATTENTION - Roadside Towing. Customer: Casey Ellis +15550101003. Result: no answer / voicemail.'],
          ['outbound', '+15550101001', 'CONVINIcar link: https://convinicar.online/app'],
          ['inbound', '+15550101001', 'Yes please send it.'],
        ].map(([direction, phone, body]) => (
          <div key={`${direction}-${phone}-${body}`} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="mb-1 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-zinc-500">
              <span>{direction}</span>
              <span>{phone}</span>
            </div>
            <p className="text-sm text-zinc-800">{body}</p>
          </div>
        ))}
      </div>
    </DemoPanel>
  );
}

function DemoFlipEngineSection({ onAction }: { onAction: () => void }) {
  return (
    <DemoPanel title="Flip Engine" description="Seeded shops, blocklist, destination classification, and sandbox result.">
      <GuidanceStrip
        items={[
          ['Preferred shops', 'These are the shops the AI can suggest when a flip is appropriate.'],
          ['Classification', 'Destination and service type determine whether the AI should pitch, soften, or skip.'],
          ['Sandbox', 'Test the decision logic before trusting it in production.'],
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {['Complete Brake Service', 'Alpha Automotive', 'Roadside Collision'].map((shop, i) => (
          <div key={shop} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="font-semibold text-zinc-900">{shop}</div>
            <div className="mt-1 text-sm text-zinc-500">{i === 0 ? 'Preferred repair shop' : i === 1 ? 'Active partner shop' : 'Body shop soft mention'}</div>
            <StatusBadge label="active" />
          </div>
        ))}
      </div>
      <div data-tour="flip-sandbox" className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Classification sandbox</div>
        <pre className="overflow-auto rounded bg-white p-3 text-xs text-zinc-700">{JSON.stringify({
          destination: { tag: 'competitor_repair', resolvedName: 'Buckeye Auto Repair', reason: 'places_nearby_repair' },
          nearestShop: 'Complete Brake Service',
          final: { wouldCall: true, wouldPitchFlip: true, scenario: 'competitor_repair' },
        }, null, 2)}</pre>
        <Button className="mt-3" onClick={onAction}>Run seeded sandbox</Button>
      </div>
    </DemoPanel>
  );
}

function DemoAgentSection({ href, onAction }: { href: string; onAction: () => void }) {
  const isKnowledge = href === '/admin/knowledge-pack';
  return (
    <DemoPanel
      title={isKnowledge ? 'Knowledge Pack' : 'AI Agent'}
      description={isKnowledge ? 'Seeded towing-specific knowledge and service rules.' : 'Seeded outbound mode, service toggles, and script configuration.'}
    >
      <GuidanceStrip
        items={[
          ['Outbound mode', 'Controls whether calls are off, manual, or automatic for the tenant.'],
          ['Service toggles', 'Enable only the call types the business wants the AI to handle.'],
          ['Knowledge rules', 'Service-specific guidance keeps the agent aligned with towing workflows.'],
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="font-semibold text-zinc-900">{isKnowledge ? 'Winch-out handling' : 'Outbound AI Calls'}</div>
          <p className="mt-2 text-sm text-zinc-600">
            {isKnowledge
              ? 'A winch-out usually means the vehicle is stuck and needs to be pulled back onto solid ground. Ask the customer to have photos ready for the driver.'
              : 'Manual mode enabled. Dispatchers can choose a script before calling a customer.'}
          </p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="font-semibold text-zinc-900">Service configuration</div>
          <div className="mt-3 space-y-2 text-sm text-zinc-700">
            {['Towing', 'Jump Start', 'Tire Change', 'Fuel Delivery', 'Lockout Service', 'Winch Out & Recovery'].map((item) => (
              <div key={item} className="flex items-center justify-between rounded bg-white px-3 py-2">
                <span>{item}</span>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-700">on</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <Button className="mt-4" onClick={onAction}>Test seeded agent call</Button>
    </DemoPanel>
  );
}

function DemoIntegrationsSection() {
  return (
    <DemoPanel title="Integrations" description="Seeded integration status for a demo account.">
      <GuidanceStrip
        items={[
          ['Towbook', 'Feeds dispatch jobs into the command center.'],
          ['Retell', 'Places AI voice calls and sends call results back by webhook.'],
          ['Twilio', 'Sends SMS reports, links, and manager alerts when enabled.'],
        ]}
      />
      <div className="grid gap-4 md:grid-cols-3">
        {[
          ['Towbook', 'connected', 'Polling dispatch board every minute'],
          ['Retell AI', 'connected', 'Outbound webhook receiving call results'],
          ['Twilio', 'demo-limited', 'SMS logs shown with seeded delivery data'],
        ].map(([name, status, note]) => (
          <div key={name} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900">{name}</span>
              <StatusBadge label={status} />
            </div>
            <p className="mt-3 text-sm text-zinc-600">{note}</p>
          </div>
        ))}
      </div>
    </DemoPanel>
  );
}

function DemoReportsSection({ href, onAction }: { href: string; onAction: () => void }) {
  return (
    <DemoPanel
      title={href === '/admin/digest' ? 'Digest' : 'Reports'}
      description="Seeded metrics showing call outcomes, flip wins, and dispatch activity."
    >
      <GuidanceStrip
        items={[
          ['Performance', 'Summarizes call volume, wins, and customer follow-up.'],
          ['Digest', 'Packages the daily/weekly report for email or SMS.'],
          ['Exceptions', 'No-answer and failed calls are surfaced for human action.'],
        ]}
      />
      <div className="grid gap-4 md:grid-cols-4">
        {[
          ['AI calls', '47'],
          ['Flip wins', '8'],
          ['No-answer alerts', '5'],
          ['Convini links', '31'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
            <div className="mt-2 text-3xl font-black text-zinc-900">{value}</div>
          </div>
        ))}
      </div>
      <Button className="mt-4" onClick={onAction}>Send seeded report now</Button>
    </DemoPanel>
  );
}

function DemoDriversSection() {
  return (
    <DemoPanel title="Drivers Live" description="Seeded driver availability and location view.">
      <GuidanceStrip
        items={[
          ['Availability', 'Shows which drivers can take the next job.'],
          ['Location', 'Keeps dispatch aware of nearby capacity.'],
          ['Assignment', 'Pairs jobs with drivers from the command center.'],
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2">
        {seededDrivers().map((driver) => (
          <div key={driver.id} className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold text-zinc-900">{driver.name}</span>
              <StatusBadge label={driver.status} />
            </div>
            <p className="mt-2 text-sm text-zinc-600">{driver.phone} · Last ping just now</p>
          </div>
        ))}
      </div>
    </DemoPanel>
  );
}

function DemoDispatchSection({ onAction }: { onAction: () => void }) {
  return (
    <DemoPanel title="Digital Dispatch" description="Seeded auto-accept rules and sandbox decisions.">
      <GuidanceStrip
        items={[
          ['Rules', 'Automate repeatable accept, decline, and escalation decisions.'],
          ['Safety checks', 'Missing phone numbers and bad data can be escalated instead of ignored.'],
          ['Sandbox', 'Preview decisions before applying them to live dispatch.'],
        ]}
      />
      <div className="space-y-3">
        {['Accept AAA light-duty tows inside 35 miles', 'Decline jobs missing caller phone', 'Escalate no-answer AI calls to management'].map((rule) => (
          <div key={rule} className="flex items-center justify-between rounded-lg border border-zinc-200 bg-zinc-50 p-4">
            <span className="font-medium text-zinc-800">{rule}</span>
            <StatusBadge label="active" />
          </div>
        ))}
      </div>
      <Button className="mt-4" onClick={onAction}>Run seeded dispatch sandbox</Button>
    </DemoPanel>
  );
}

function DemoSettingsSection({ href, onAction }: { href: string; onAction: () => void }) {
  const label = NAV_GROUPS.flatMap((group) => group.items).find((item) => item.href === href)?.label ?? 'Settings';
  return (
    <DemoPanel title={label} description="Seeded tenant settings view.">
      <GuidanceStrip
        items={[
          ['Tenant profile', 'Company, users, billing, branding, and support settings live here.'],
          ['Manager contacts', 'Operational alerts route to the configured management recipients.'],
          ['Access control', 'Real accounts save these settings to the tenant database.'],
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="font-semibold text-zinc-900">Roadside Towing Demo</div>
          <p className="mt-2 text-sm text-zinc-600">Free demo plan · outbound calls disabled · browser-session changes only.</p>
        </div>
        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="font-semibold text-zinc-900">Configured contacts</div>
          <p className="mt-2 text-sm text-zinc-600">Manager alerts: +15550101901, +15550101902</p>
        </div>
      </div>
      <Button className="mt-4" onClick={onAction}>Request access to edit</Button>
    </DemoPanel>
  );
}

function DemoGenericSection({ onAction }: { onAction: () => void }) {
  return (
    <DemoPanel title="Demo section" description="This seeded section is available in a live demo walkthrough.">
      <Button onClick={onAction}>Book live walkthrough</Button>
    </DemoPanel>
  );
}

function StatusBadge({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const tone = normalized.includes('fail') || normalized.includes('no_answer') || normalized.includes('voicemail')
    ? 'bg-rose-100 text-rose-700'
    : normalized.includes('active') || normalized.includes('connected') || normalized.includes('completed') || normalized.includes('accepted') || normalized === 'on'
      ? 'bg-emerald-100 text-emerald-700'
      : 'bg-blue-100 text-blue-700';
  return (
    <span className={cn('inline-flex rounded-full px-2 py-1 text-xs font-semibold', tone)}>
      {label.replace(/_/g, ' ')}
    </span>
  );
}

function jobMatchesFilters(job: UnifiedJob, f: CommandCenterFilters): boolean {
  if (f.status.size > 0 && !f.status.has(job.status)) return false;
  if (f.source !== 'all' && job.source !== f.source) return false;
  if (f.priority !== 'all' && job.priority !== f.priority) return false;
  if (f.search.trim()) {
    const term = f.search.toLowerCase();
    const values = [
      job.callerName,
      job.callerPhone,
      job.pickupAddress,
      job.dropoffAddress,
      job.sourceJobId,
      job.serviceType,
    ];
    return values.some((value) => value?.toLowerCase().includes(term));
  }
  return true;
}

function DemoMap({
  jobs,
  drivers,
  selectedJobId,
  onSelect,
}: {
  jobs: UnifiedJob[];
  drivers: Driver[];
  selectedJobId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="relative h-72 overflow-hidden rounded-lg border border-zinc-200 bg-slate-100 shadow-sm">
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgba(148,163,184,0.22)_1px,transparent_1px),linear-gradient(rgba(148,163,184,0.22)_1px,transparent_1px)] bg-[size:40px_40px]" />
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-transparent to-emerald-50" />
      {jobs.map((job, index) => (
        <button
          key={job.id}
          type="button"
          onClick={() => onSelect(job.id)}
          className={`absolute rounded-full border-2 border-white px-3 py-1 text-xs font-bold shadow-lg transition ${
            job.id === selectedJobId
              ? 'bg-blue-600 text-white ring-4 ring-blue-200'
              : 'bg-zinc-900 text-white hover:bg-blue-700'
          }`}
          style={{
            left: `${18 + index * 18}%`,
            top: `${28 + (index % 2) * 28}%`,
          }}
        >
          {job.serviceType}
        </button>
      ))}
      {drivers.map((driver, index) => (
        <div
          key={driver.id}
          className="absolute rounded-md border border-cyan-700 bg-cyan-500 px-2 py-1 text-xs font-semibold text-white shadow"
          style={{
            right: `${16 + index * 18}%`,
            top: `${18 + (index % 2) * 42}%`,
          }}
        >
          {driver.name}
        </div>
      ))}
      <div className="absolute bottom-3 left-3 rounded bg-white/90 px-3 py-2 text-xs font-medium text-zinc-700 shadow">
        Demo map. No live GPS or customer data.
      </div>
    </div>
  );
}

function DemoCheckingModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/85 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-blue-500/30 bg-zinc-950 p-6 text-center text-zinc-100 shadow-2xl shadow-blue-950/40">
        <div className="mx-auto mb-4 h-10 w-10 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        <h2 className="text-xl font-black tracking-tight text-white">Checking demo call access</h2>
        <p className="mt-2 text-sm leading-6 text-zinc-400">
          Looking at the platform demo-call switch before showing the call tools.
        </p>
        <Button variant="outline" className="mt-5 border-zinc-700 bg-transparent text-zinc-100 hover:bg-zinc-900" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

function DemoTestAgentModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState('explicit');
  const [scenario, setScenario] = useState('competitor_repair');
  const [toPhone, setToPhone] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [motorClub, setMotorClub] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setErr(null);
    setSuccess(false);
    try {
      const res = await fetch('/api/v1/public/demo-call', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode,
          scenario: mode === 'explicit' ? scenario : undefined,
          toPhone,
          customerName: customerName || undefined,
          vehicle: vehicle || undefined,
          destination: destination || undefined,
          pickupLocation: pickupLocation || undefined,
          motorClub: motorClub || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.message || 'Demo call could not be placed.');
      }
      setSuccess(true);
    } catch (error) {
      setErr((error as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-lg border border-zinc-200 bg-white p-5 text-zinc-900 shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">Test Agent Call</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {success ? (
          <div className="p-4 text-center font-medium text-green-600">
            Call triggered successfully!
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="space-y-3">
            <label className="block text-sm font-medium text-zinc-900">
              Mode
              <select
                value={mode}
                onChange={(event) => setMode(event.target.value)}
                className="mt-1 block w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
              >
                <option value="explicit">Explicit Scenario (Fast Test)</option>
                <option value="live">Live AI Simulation (Full Engine)</option>
              </select>
            </label>
            <label className="block text-sm font-medium text-zinc-900">
              To Phone (Test Number - required)
              <span className="ml-2 text-xs font-normal text-rose-500">
                Warning: this will actually ring the number you enter. Use your own phone number, not a real customer.
              </span>
              <input
                value={toPhone}
                onChange={(event) => setToPhone(event.target.value)}
                placeholder="+1234567890"
                className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
                required
              />
            </label>
            {mode === 'explicit' && (
              <label className="block text-sm font-medium text-zinc-900">
                Scenario
                <select
                  value={scenario}
                  onChange={(event) => setScenario(event.target.value)}
                  className="mt-1 block w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
                >
                  <option value="competitor_repair">Competitor Repair</option>
                  <option value="auto_body">Auto Body</option>
                  <option value="residence">Residence</option>
                  <option value="our_shop">Our Shop</option>
                  <option value="unknown">Unknown</option>
                </select>
              </label>
            )}
            <DemoTenantCallField label="Customer Name (optional)" value={customerName} onChange={setCustomerName} />
            <DemoTenantCallField label="Vehicle (optional)" value={vehicle} onChange={setVehicle} placeholder="e.g. 2020 Honda Civic" />
            <DemoTenantCallField label="Destination (optional)" value={destination} onChange={setDestination} />
            <DemoTenantCallField label="Pickup Location (optional)" value={pickupLocation} onChange={setPickupLocation} placeholder="e.g. 123 Main St" />
            <DemoTenantCallField label="Motor Club (optional)" value={motorClub} onChange={setMotorClub} placeholder="e.g. Agero Motor Club" />
            {err && <p className="text-sm text-red-500">{err}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={busy || !toPhone.trim()}>
                {busy ? 'Triggering...' : 'Trigger Call'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

function DemoCallModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="dark fixed inset-0 z-50 overflow-y-auto bg-zinc-950/90 p-4 text-foreground backdrop-blur-sm">
      <div className="mx-auto my-6 w-full max-w-6xl rounded-2xl border border-blue-500/30 bg-background p-5 shadow-2xl shadow-blue-950/40 lg:p-8">
        <div className="mb-6 flex items-center justify-between gap-4 border-b border-border pb-4">
          <span className="rounded-full border border-blue-500/40 bg-blue-500/15 px-3 py-1 font-label text-[10px] font-bold uppercase tracking-[0.2em] text-blue-300">
            Schedule a Demo
          </span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm font-semibold text-muted-foreground hover:bg-card hover:text-foreground"
            aria-label="Close"
          >
            Close
          </button>
        </div>
        <ScheduleDemoClient />
      </div>
    </div>
  );
}

function DemoTenantCallField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-sm font-medium text-zinc-900">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
      />
    </label>
  );
}

function DemoManualJobModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (job: UnifiedJob, scriptType: ManualCallScriptType) => void;
}) {
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [vehicleYear, setVehicleYear] = useState('');
  const [vehicleMake, setVehicleMake] = useState('');
  const [vehicleModel, setVehicleModel] = useState('');
  const [vehicleColor, setVehicleColor] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [serviceType, setServiceType] = useState('Tow');
  const [priority, setPriority] = useState<'low' | 'normal' | 'urgent'>('normal');
  const [notes, setNotes] = useState('');
  const [scriptType, setScriptType] = useState<ManualCallScriptType>('auto_flip');

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const now = new Date().toISOString();
    const job: UnifiedJob = {
      id: `demo-manual-${Date.now()}`,
      tenantId: TENANT_ID,
      source: 'manual',
      sourceJobId: `MAN-${Math.floor(1000 + Math.random() * 9000)}`,
      sourcePayload: { notes, selectedScriptType: scriptType },
      status: 'new',
      callerPhone: callerPhone || null,
      callerName,
      vehicleYear: vehicleYear || null,
      vehicleMake: vehicleMake || null,
      vehicleModel: vehicleModel || null,
      vehicleColor: vehicleColor || null,
      pickupAddress: pickupAddress || null,
      pickupLat: null,
      pickupLng: null,
      dropoffAddress: dropoffAddress || null,
      dropoffLat: null,
      dropoffLng: null,
      serviceType: serviceType || null,
      priority,
      assignedDriverId: null,
      assignedTruckId: null,
      etaMinutes: null,
      acceptedAt: null,
      dispatchedAt: null,
      arrivedAt: null,
      completedAt: null,
      autoDecision: null,
      autoDecisionReason: null,
      autoDecidedAt: null,
      createdAt: now,
      updatedAt: now,
      driver: null,
      truck: null,
      events: [],
      latestCall: null,
      latestFlip: null,
    };
    onCreated(job, scriptType);
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/60 p-4"
      onClick={onClose}
    >
      <form
        onSubmit={submit}
        className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-zinc-200 bg-white p-5 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mb-5 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900">Create manual job</h2>
            <p className="text-sm text-zinc-500">
              Browser-session demo job. It opens in the same drawer with driver, status, and script controls.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        <div className="grid gap-4 sm:grid-cols-2">
          <DemoField label="Caller name" required value={callerName} onChange={setCallerName} />
          <DemoField label="Caller phone" value={callerPhone} onChange={setCallerPhone} />
          <DemoField label="Vehicle year" value={vehicleYear} onChange={setVehicleYear} />
          <DemoField label="Vehicle make" value={vehicleMake} onChange={setVehicleMake} />
          <DemoField label="Vehicle model" value={vehicleModel} onChange={setVehicleModel} />
          <DemoField label="Vehicle color" value={vehicleColor} onChange={setVehicleColor} />
          <label className="block text-sm font-medium text-zinc-900 sm:col-span-2">
            Pickup address
            <input
              value={pickupAddress}
              onChange={(event) => setPickupAddress(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-900 sm:col-span-2">
            Dropoff address
            <input
              value={dropoffAddress}
              onChange={(event) => setDropoffAddress(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            />
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            Service type
            <select
              value={serviceType}
              onChange={(event) => setServiceType(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            >
              <option value="Tow">Tow</option>
              <option value="Winch Out">Winch Out</option>
              <option value="Jump Start">Jump Start</option>
              <option value="Tire Change">Tire Change</option>
              <option value="Fuel Delivery">Fuel Delivery</option>
              <option value="Lockout">Lockout</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            Priority
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value as 'low' | 'normal' | 'urgent')}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            >
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="urgent">Urgent</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-900 sm:col-span-2">
            Call script
            <select
              value={scriptType}
              onChange={(event) => setScriptType(event.target.value as ManualCallScriptType)}
              className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
            >
              <option value="auto_flip">Auto: confirm + flip logic</option>
              <option value="eta_confirmation">ETA confirmation</option>
              <option value="status_update">Status update</option>
              <option value="winch_out">Winch-out photo reminder</option>
              <option value="convini_only">CONVINI only</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-900 sm:col-span-2">
            Notes
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="mt-1 min-h-24 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900"
            />
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={!callerName.trim()}>
            Create job
          </Button>
        </div>
      </form>
    </div>
  );
}

function DemoField({
  label,
  value,
  onChange,
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  return (
    <label className="block text-sm font-medium text-zinc-900">
      {label}
      <input
        value={value}
        required={required}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 h-10 w-full rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900"
      />
    </label>
  );
}

function seededDrivers(): Driver[] {
  const now = new Date(DEMO_NOW_MS).toISOString();
  return [
    {
      id: 'demo-driver-1',
      tenantId: TENANT_ID,
      name: 'Avery',
      phone: '+15550101911',
      status: 'available',
      currentLat: '39.9700',
      currentLng: '-82.9900',
      lastPingAt: now,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'demo-driver-2',
      tenantId: TENANT_ID,
      name: 'Morgan',
      phone: '+15550101912',
      status: 'on_job',
      currentLat: '39.9400',
      currentLng: '-83.0400',
      lastPingAt: now,
      createdAt: now,
      updatedAt: now,
    },
  ];
}

function seededJobs(): UnifiedJob[] {
  const iso = (minutesAgo: number) => new Date(DEMO_NOW_MS - minutesAgo * 60_000).toISOString();
  return [
    {
      id: 'demo-job-1',
      tenantId: TENANT_ID,
      source: 'towbook',
      sourceJobId: 'TB-1048',
      sourcePayload: {},
      status: 'new',
      callerPhone: '+15550101001',
      callerName: 'Jordan Reed',
      vehicleYear: '2017',
      vehicleMake: 'Honda',
      vehicleModel: 'Accord',
      vehicleColor: 'Silver',
      pickupAddress: 'I-71 N near Exit 108, Columbus, OH',
      pickupLat: '39.9897',
      pickupLng: '-82.9872',
      dropoffAddress: 'Reliable Collision, 2840 Banwick Rd, Columbus',
      dropoffLat: '39.9264',
      dropoffLng: '-82.9226',
      serviceType: 'Tow',
      priority: 'urgent',
      assignedDriverId: null,
      assignedTruckId: null,
      etaMinutes: 31,
      acceptedAt: null,
      dispatchedAt: null,
      arrivedAt: null,
      completedAt: null,
      autoDecision: null,
      autoDecisionReason: null,
      autoDecidedAt: null,
      createdAt: iso(9),
      updatedAt: iso(9),
      driver: null,
      truck: null,
      events: [],
      latestCall: null,
      latestFlip: {
        id: 'demo-flip-1',
        destinationType: 'auto_body',
        flipEligible: false,
        nearestOurShop: null,
        flipOutcome: 'BODY_SHOP_SOFT_MENTION',
        conviniLinkSent: true,
        managementNotified: false,
        callTime: iso(8),
      },
    },
    {
      id: 'demo-job-2',
      tenantId: TENANT_ID,
      source: 'aaa_salesforce',
      sourceJobId: 'AAA-8821',
      sourcePayload: {},
      status: 'assigned',
      callerPhone: '+15550101002',
      callerName: 'Taylor Morgan',
      vehicleYear: '2020',
      vehicleMake: 'Ford',
      vehicleModel: 'F-150',
      vehicleColor: 'Black',
      pickupAddress: '4321 Morse Rd, Columbus, OH',
      pickupLat: '40.0591',
      pickupLng: '-82.9061',
      dropoffAddress: 'Buckeye Auto Repair, Columbus',
      dropoffLat: '40.0132',
      dropoffLng: '-82.9988',
      serviceType: 'Tow',
      priority: 'normal',
      assignedDriverId: 'demo-driver-2',
      assignedTruckId: null,
      etaMinutes: 18,
      acceptedAt: iso(22),
      dispatchedAt: iso(18),
      arrivedAt: null,
      completedAt: null,
      autoDecision: null,
      autoDecisionReason: null,
      autoDecidedAt: null,
      createdAt: iso(25),
      updatedAt: iso(18),
      driver: seededDrivers()[1],
      truck: null,
      events: [],
      latestCall: {
        id: 'demo-call-2',
        purpose: 'custom',
        status: 'completed',
        attempts: 1,
        durationSeconds: 115,
        error: null,
        transcript: 'Customer confirmed the tow and accepted the preferred repair shop option.',
        analysisData: {
          flip_eligible: true,
          flip_outcome: 'accepted',
          nearest_our_shop: 'Complete Brake Service',
        },
        startedAt: iso(17),
        endedAt: iso(15),
        createdAt: iso(18),
      },
      latestFlip: {
        id: 'demo-flip-2',
        destinationType: 'competitor_repair',
        flipEligible: true,
        nearestOurShop: 'Complete Brake Service',
        flipOutcome: 'WIN_ACCEPTED',
        conviniLinkSent: true,
        managementNotified: true,
        callTime: iso(15),
      },
    },
    {
      id: 'demo-job-3',
      tenantId: TENANT_ID,
      source: 'manual',
      sourceJobId: 'MAN-221',
      sourcePayload: {},
      status: 'en_route',
      callerPhone: '+15550101003',
      callerName: 'Casey Ellis',
      vehicleYear: '2015',
      vehicleMake: 'Toyota',
      vehicleModel: 'Camry',
      vehicleColor: 'White',
      pickupAddress: 'Hilliard Rome Rd, Hilliard, OH',
      pickupLat: '40.0334',
      pickupLng: '-83.1582',
      dropoffAddress: null,
      dropoffLat: null,
      dropoffLng: null,
      serviceType: 'Winch out',
      priority: 'normal',
      assignedDriverId: 'demo-driver-1',
      assignedTruckId: null,
      etaMinutes: 42,
      acceptedAt: iso(36),
      dispatchedAt: iso(30),
      arrivedAt: null,
      completedAt: null,
      autoDecision: null,
      autoDecisionReason: null,
      autoDecidedAt: null,
      createdAt: iso(40),
      updatedAt: iso(30),
      driver: seededDrivers()[0],
      truck: null,
      events: [],
      latestCall: {
        id: 'demo-call-3',
        purpose: 'custom',
        status: 'completed',
        attempts: 1,
        durationSeconds: 72,
        error: null,
        transcript: 'Customer was advised to have photos ready for the driver.',
        analysisData: { destination_type: 'winch_out', flip_eligible: false },
        startedAt: iso(33),
        endedAt: iso(32),
        createdAt: iso(33),
      },
      latestFlip: null,
    },
  ];
}
