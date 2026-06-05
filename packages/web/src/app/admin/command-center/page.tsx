'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  STATUS_LABEL,
  type Driver,
  type Stats,
  type Truck,
  type UnifiedJob,
  type UnifiedJobStatus,
} from '@/lib/command-center-types';
import { getCommandCenterSocket } from '@/lib/socket';
import { api } from '@/lib/utils';
import { DriversModal } from './components/DriversModal';
import { FilterBar, type CommandCenterFilters } from './components/FilterBar';
import { JobDrawer } from './components/JobDrawer';
import { JobsTable } from './components/JobsTable';
import { MapPanel } from './components/MapPanel';
import { StatsStrip } from './components/StatsStrip';

interface JobsResponse {
  items: UnifiedJob[];
  total: number;
}

export default function CommandCenterPage() {
  const [filters, setFilters] = useState<CommandCenterFilters>({
    status: new Set(['new', 'assigned', 'en_route', 'on_scene', 'in_tow']),
    source: 'all',
    priority: 'all',
    search: '',
  });
  const [jobs, setJobs] = useState<UnifiedJob[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [, setTrucks] = useState<Truck[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<UnifiedJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showManualJob, setShowManualJob] = useState(false);
  const [showAddDriver, setShowAddDriver] = useState(false);
  const [showDriversModal, setShowDriversModal] = useState(false);
  const [showTestAgent, setShowTestAgent] = useState(false);
  const filtersRef = useRef(filters);
  filtersRef.current = filters;

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    if (filters.status.size > 0) params.set('status', Array.from(filters.status).join(','));
    if (filters.source !== 'all') params.set('source', filters.source);
    if (filters.priority !== 'all') params.set('priority', filters.priority);
    if (filters.search.trim()) params.set('search', filters.search.trim());
    return params.toString();
  }, [filters]);

  const refreshJobs = useCallback(async () => {
    try {
      const data = await api<JobsResponse>(
        `/v1/admin/command-center/jobs${queryString ? `?${queryString}` : ''}`,
      );
      setJobs(data.items);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [queryString]);

  const refreshAux = useCallback(async () => {
    try {
      const [d, t, s] = await Promise.all([
        api<Driver[]>(`/v1/admin/command-center/drivers`),
        api<Truck[]>(`/v1/admin/command-center/trucks`),
        api<Stats>(`/v1/admin/command-center/stats`),
      ]);
      setDrivers(d);
      setTrucks(t);
      setStats(s);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    void refreshJobs();
  }, [refreshJobs]);

  useEffect(() => {
    void refreshAux();
    const id = setInterval(() => void refreshAux(), 30_000);
    return () => clearInterval(id);
  }, [refreshAux]);

  // Real-time websocket updates.
  useEffect(() => {
    const sock = getCommandCenterSocket();
    const onJobCreated = (job: UnifiedJob) => {
      if (jobMatchesFilters(job, filtersRef.current)) {
        setJobs((prev) => [job, ...prev.filter((j) => j.id !== job.id)]);
      }
    };
    const onJobUpdated = (job: UnifiedJob) => {
      setJobs((prev) => {
        const exists = prev.some((j) => j.id === job.id);
        if (!exists) {
          return jobMatchesFilters(job, filtersRef.current) ? [job, ...prev] : prev;
        }
        return prev.map((j) => (j.id === job.id ? { ...j, ...job } : j));
      });
      setSelectedJob((cur) => (cur && cur.id === job.id ? { ...cur, ...job } : cur));
    };
    const onDriverUpdated = (driver: Driver) => {
      setDrivers((prev) => {
        const exists = prev.some((d) => d.id === driver.id);
        if (!exists) return [...prev, driver];
        return prev.map((d) => (d.id === driver.id ? driver : d));
      });
    };
    sock.on('job.created', onJobCreated);
    sock.on('job.updated', onJobUpdated);
    sock.on('driver.updated', onDriverUpdated);
    return () => {
      sock.off('job.created', onJobCreated);
      sock.off('job.updated', onJobUpdated);
      sock.off('driver.updated', onDriverUpdated);
    };
  }, []);

  // Load the full job detail (with events) whenever the selection changes.
  useEffect(() => {
    if (!selectedJobId) {
      setSelectedJob(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const data = await api<UnifiedJob>(`/v1/admin/command-center/jobs/${selectedJobId}`);
        if (!cancelled) setSelectedJob(data);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedJobId]);

  async function handleAssign(driverId: string | null) {
    if (!selectedJobId) return;
    await api(`/v1/admin/command-center/jobs/${selectedJobId}/assign`, {
      method: 'POST',
      json: { driver_id: driverId, truck_id: null },
    });
    await refreshJobs();
    const fresh = await api<UnifiedJob>(`/v1/admin/command-center/jobs/${selectedJobId}`);
    setSelectedJob(fresh);
  }

  async function handleStatus(next: UnifiedJobStatus) {
    if (!selectedJobId) return;
    await api(`/v1/admin/command-center/jobs/${selectedJobId}/status`, {
      method: 'POST',
      json: { status: next },
    });
    await refreshJobs();
    const fresh = await api<UnifiedJob>(`/v1/admin/command-center/jobs/${selectedJobId}`);
    setSelectedJob(fresh);
  }

  return (
    <div className="-mx-5 -my-8 flex h-[calc(100vh-70px)] flex-col bg-zinc-50 sm:-mx-8">
      <div className="border-b border-zinc-200 bg-white p-4 shadow-sm z-10">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="font-label text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
              Operations
            </div>
            <h1 className="font-display text-2xl font-extrabold text-zinc-900">Command Center</h1>
            <p className="text-sm text-zinc-500">
              Live dispatch board across every connected source.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={() => setShowTestAgent(true)}>
              Test Agent Call
            </Button>
            <Button variant="outline" onClick={() => setShowDriversModal(true)}>
              Manage Drivers
            </Button>
            <Button variant="outline" onClick={() => setShowManualJob(true)}>
              + Manual job
            </Button>
            <Button onClick={() => void refreshJobs()}>Refresh</Button>
          </div>
        </div>
        <StatsStrip stats={stats} />
        {error && (
          <p className="mt-3 text-sm text-red-500 break-words">{error}</p>
        )}
      </div>

      <div className="px-4 pt-4 shrink-0">
        <FilterBar filters={filters} onChange={setFilters} />
      </div>

      <div className="grid flex-1 grid-cols-12 overflow-hidden">
        <div className="col-span-9 xl:col-span-9 flex flex-col gap-3 p-4 overflow-y-auto">
          <div className="h-1/2 min-h-[300px] shrink-0">
            <MapPanel
              jobs={jobs}
              drivers={drivers}
              selectedJobId={selectedJobId}
              onSelectJob={setSelectedJobId}
            />
          </div>
          <div className="h-1/2 min-h-[300px] shrink-0">
            <JobsTable
              jobs={jobs}
              selectedJobId={selectedJobId}
              onSelect={setSelectedJobId}
            />
          </div>
        </div>
        <div className="col-span-3 h-full overflow-hidden border-l border-zinc-200">
          {selectedJob ? (
            <JobDrawer
              job={selectedJob}
              drivers={drivers}
              onAssign={handleAssign}
              onStatusChange={handleStatus}
              onClose={() => setSelectedJobId(null)}
            />
          ) : (
            <div className="flex h-full items-center justify-center bg-white p-6 text-center text-sm text-zinc-500">
              Select a job on the map or in the table to see its details.
            </div>
          )}
        </div>
      </div>

      {showTestAgent && (
        <TestAgentModal onClose={() => setShowTestAgent(false)} />
      )}

      {showManualJob && (
        <ManualJobModal
          onClose={() => setShowManualJob(false)}
          onCreated={(j) => {
            setShowManualJob(false);
            setJobs((prev) => [j, ...prev]);
            setSelectedJobId(j.id);
          }}
        />
      )}

      {showDriversModal && (
        <DriversModal
          drivers={drivers}
          onCreate={() => {
            setShowDriversModal(false);
            setShowAddDriver(true);
          }}
          onClose={() => setShowDriversModal(false)}
        />
      )}

      {showAddDriver && (
        <AddDriverModal
          onClose={() => setShowAddDriver(false)}
          onCreated={(d) => {
            setShowAddDriver(false);
            setDrivers((prev) => [...prev, d]);
            setShowDriversModal(true);
          }}
        />
      )}
    </div>
  );
}

function jobMatchesFilters(job: UnifiedJob, f: CommandCenterFilters): boolean {
  if (f.status.size > 0 && !f.status.has(job.status)) return false;
  if (f.source !== 'all' && job.source !== f.source) return false;
  if (f.priority !== 'all' && job.priority !== f.priority) return false;
  if (f.search.trim()) {
    const t = f.search.toLowerCase();
    const haystacks = [
      job.callerName,
      job.callerPhone,
      job.pickupAddress,
      job.dropoffAddress,
      job.sourceJobId,
    ];
    if (!haystacks.some((h) => h?.toLowerCase().includes(t))) return false;
  }
  return true;
}

function ManualJobModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (j: UnifiedJob) => void;
}) {
  const [callerName, setCallerName] = useState('');
  const [callerPhone, setCallerPhone] = useState('');
  const [pickupAddress, setPickupAddress] = useState('');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const job = await api<UnifiedJob>(`/v1/admin/command-center/jobs/manual`, {
        method: 'POST',
        json: {
          caller_name: callerName,
          caller_phone: callerPhone || null,
          pickup_address: pickupAddress || null,
          dropoff_address: dropoffAddress || null,
          service_type: serviceType || null,
          priority: 'normal',
        },
      });
      onCreated(job);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Create manual job" onClose={onClose}>
      <label className="block text-sm font-medium text-zinc-900">
        Caller name
        <Input value={callerName} onChange={(e) => setCallerName(e.target.value)} className="mt-1" />
      </label>
      <label className="block text-sm font-medium text-zinc-900">
        Caller phone
        <Input value={callerPhone} onChange={(e) => setCallerPhone(e.target.value)} className="mt-1" />
      </label>
      <label className="block text-sm font-medium text-zinc-900">
        Pickup address
        <Input value={pickupAddress} onChange={(e) => setPickupAddress(e.target.value)} className="mt-1" />
      </label>
      <label className="block text-sm font-medium text-zinc-900">
        Dropoff address
        <Input value={dropoffAddress} onChange={(e) => setDropoffAddress(e.target.value)} className="mt-1" />
      </label>
      <label className="block text-sm font-medium text-zinc-900">
        Service type
        <Input value={serviceType} onChange={(e) => setServiceType(e.target.value)} className="mt-1" />
      </label>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !callerName.trim()}>
          {busy ? 'Creating…' : 'Create job'}
        </Button>
      </div>
    </Modal>
  );
}

function AddDriverModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (d: Driver) => void;
}) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      const d = await api<Driver>(`/v1/admin/command-center/drivers`, {
        method: 'POST',
        json: { name, phone: phone || null, status: 'available' },
      });
      onCreated(d);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Add driver" onClose={onClose}>
      <label className="block text-sm font-medium text-zinc-900">
        Name
        <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1" />
      </label>
      <label className="block text-sm font-medium text-zinc-900">
        Phone
        <Input value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1" />
      </label>
      {err && <p className="text-sm text-red-500">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Add driver'}
        </Button>
      </div>
    </Modal>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md space-y-3 rounded-lg border border-zinc-200 bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-zinc-900">{title}</h2>
          <button
            onClick={onClose}
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-900"
          >
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function TestAgentModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState('explicit');
  const [toPhone, setToPhone] = useState('');
  const [scenario, setScenario] = useState('competitor_repair');
  const [customerName, setCustomerName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [destination, setDestination] = useState('');
  const [pickupLocation, setPickupLocation] = useState('');
  const [motorClub, setMotorClub] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function submit() {
    setBusy(true);
    setErr(null);
    setSuccess(false);
    try {
      const endpoint = mode === 'live' ? `/v1/admin/flip-engine/debug/live-test-call` : `/v1/admin/outbound-voice/debug/test-call`;
      await api(endpoint, {
        method: 'POST',
        json: {
          toPhone,
          scenario: mode === 'explicit' ? scenario : undefined,
          customerName: customerName || undefined,
          vehicle: vehicle || undefined,
          destination: destination || undefined,
          pickupLocation: pickupLocation || undefined,
          motorClub: motorClub || undefined,
        },
      });
      setSuccess(true);
      setTimeout(onClose, 2000);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Test Agent Call" onClose={onClose}>
      {success ? (
        <div className="p-4 text-center text-green-600 font-medium">Call triggered successfully!</div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-zinc-900">
            Mode
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="mt-1 block w-full rounded-md border border-zinc-200 p-2 text-sm focus:border-blue-500 focus:ring-blue-500"
            >
              <option value="explicit">Explicit Scenario (Fast Test)</option>
              <option value="live">Live AI Simulation (Full Engine)</option>
            </select>
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            To Phone (required)
            <Input value={toPhone} onChange={(e) => setToPhone(e.target.value)} placeholder="+1234567890" className="mt-1" />
          </label>
          {mode === 'explicit' && (
            <label className="block text-sm font-medium text-zinc-900">
              Scenario
            <select
              value={scenario}
              onChange={(e) => setScenario(e.target.value)}
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
          <label className="block text-sm font-medium text-zinc-900">
            Customer Name (optional)
            <Input value={customerName} onChange={(e) => setCustomerName(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            Vehicle (optional)
            <Input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder="e.g. 2020 Honda Civic" className="mt-1" />
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            Destination (optional)
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} className="mt-1" />
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            Pickup Location (optional)
            <Input value={pickupLocation} onChange={(e) => setPickupLocation(e.target.value)} placeholder="e.g. 123 Main St" className="mt-1" />
          </label>
          <label className="block text-sm font-medium text-zinc-900">
            Motor Club (optional)
            <Input value={motorClub} onChange={(e) => setMotorClub(e.target.value)} placeholder="e.g. Agero Motor Club" className="mt-1" />
          </label>
          {err && <p className="text-sm text-red-500">{err}</p>}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={busy || !toPhone.trim()}>
              {busy ? 'Triggering…' : 'Trigger Call'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

void STATUS_LABEL; // silence "imported but unused" if tree-shake misses it
