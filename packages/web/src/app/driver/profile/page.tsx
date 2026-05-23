'use client';

import { useState } from 'react';
import { BottomNav } from '../_components/BottomNav';
import { TopBar } from '../_components/TopBar';
import { clearProfile, loadProfile, saveProfile, type DriverProfile } from '../_lib/driver-api';

const INTERVALS = [15, 30, 60];

export default function ProfilePage() {
  const [profile, setProfile] = useState<DriverProfile>(() => loadProfile());
  const [saved, setSaved] = useState(false);

  const update = (patch: Partial<DriverProfile>) => {
    const next = { ...profile, ...patch };
    setProfile(next);
    setSaved(false);
  };

  const onSave = () => {
    saveProfile(profile);
    // Storage event only fires across tabs — same-tab listeners need a manual
    // poke to re-read. The home page re-reads on visibility change anyway.
    window.dispatchEvent(new Event('storage'));
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1500);
  };

  const onLogOut = () => {
    if (!confirm('Sign out and clear local data?')) return;
    clearProfile();
    setProfile({
      driver_phone: '',
      driver_name: '',
      ping_interval_sec: 30,
      high_accuracy_gps: true,
    });
  };

  return (
    <>
      <TopBar
        driverName={profile.driver_name}
        onShift={false}
        batteryPct={null}
        onToggleShift={() => {}}
      />
      <main className="flex-1 px-4 py-4 space-y-5" data-testid="driver-profile">
        <h1 className="text-lg font-semibold">Profile</h1>

        <label className="block text-sm space-y-1">
          <span className="text-zinc-400">Driver name</span>
          <input
            type="text"
            value={profile.driver_name}
            onChange={(e) => update({ driver_name: e.target.value })}
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-emerald-500"
            data-testid="profile-name"
          />
        </label>

        <label className="block text-sm space-y-1">
          <span className="text-zinc-400">Phone (E.164, e.g. +17408129489)</span>
          <input
            type="tel"
            value={profile.driver_phone}
            onChange={(e) => update({ driver_phone: e.target.value.trim() })}
            placeholder="+17408129489"
            className="w-full rounded bg-zinc-800 border border-zinc-700 px-3 py-2 focus:outline-none focus:border-emerald-500"
            data-testid="profile-phone"
          />
        </label>

        <fieldset className="space-y-2">
          <legend className="text-sm text-zinc-400">Ping interval</legend>
          <div className="flex gap-2" data-testid="profile-interval">
            {INTERVALS.map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => update({ ping_interval_sec: s })}
                className={
                  'flex-1 rounded px-3 py-2 text-sm border ' +
                  (profile.ping_interval_sec === s
                    ? 'border-emerald-500 bg-emerald-500/10 text-emerald-200'
                    : 'border-zinc-700 bg-zinc-800 text-zinc-300')
                }
              >
                {s}s
              </button>
            ))}
          </div>
        </fieldset>

        <label className="flex items-center justify-between text-sm bg-zinc-800 border border-zinc-700 rounded px-3 py-3">
          <div>
            <p>High-accuracy GPS</p>
            <p className="text-xs text-zinc-500">Uses more battery</p>
          </div>
          <input
            type="checkbox"
            checked={profile.high_accuracy_gps}
            onChange={(e) => update({ high_accuracy_gps: e.target.checked })}
            data-testid="profile-high-accuracy"
            className="h-5 w-5 accent-emerald-500"
          />
        </label>

        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={onSave}
            data-testid="profile-save"
            className="flex-1 rounded bg-emerald-500 hover:bg-emerald-400 text-emerald-950 px-4 py-3 font-semibold"
          >
            {saved ? 'Saved ✓' : 'Save'}
          </button>
          <button
            type="button"
            onClick={onLogOut}
            data-testid="profile-logout"
            className="rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 px-4 py-3"
          >
            Log out
          </button>
        </div>

        <p className="text-xs text-zinc-500 pt-4 border-t border-zinc-800">
          Changes apply on next ping. The home screen will pick up your new phone
          immediately when you switch tabs back.
        </p>
      </main>
      <BottomNav />
    </>
  );
}
