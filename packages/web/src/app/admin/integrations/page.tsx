import React from 'react';

export default function IntegrationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Integrations</h1>
        <p className="text-zinc-400 text-sm">Configure your towing software integrations and credentials.</p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 flex flex-col gap-4">
          <h2 className="text-xl font-semibold">Towing Software Configuration</h2>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-400 font-medium">Software Provider</label>
            <select className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500">
              <option>Towbook</option>
              <option>TowLogs</option>
              <option>Omadi</option>
            </select>
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-400 font-medium">Username</label>
            <input type="text" className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500" placeholder="Username" />
          </div>
          <div className="flex flex-col gap-2">
            <label className="text-xs text-zinc-400 font-medium">Password</label>
            <input type="password" className="bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-sm focus:outline-none focus:border-blue-500" placeholder="••••••••" />
          </div>
          <button className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium py-2 px-4 rounded transition self-start">
            Save & Encrypt
          </button>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-semibold">Connection Status</h3>
            <p className="text-sm text-zinc-400 mt-1">Status check for active integrations.</p>
            <div className="flex items-center gap-2 mt-4">
              <span className="h-3 w-3 rounded-full bg-yellow-500"></span>
              <span className="text-sm">Configuring...</span>
            </div>
          </div>
          <div className="flex gap-2 mt-6">
            <button className="border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 px-4 rounded transition">
              Test Connection
            </button>
            <button className="border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-medium py-2 px-4 rounded transition">
              Force Refresh
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
