import React, {useMemo, useState} from 'react';
import {AlertTriangle, Building2, Plus, Search, ShieldAlert} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {UserProfile, WoredaRecord, ZoneRecord} from '../types/opcms';

interface HierarchyViewProps {
  token: string;
  user: UserProfile;
  regionName: string;
  zones: ZoneRecord[];
  woredas: WoredaRecord[];
  onRefresh: () => void;
}

export const HierarchyView: React.FC<HierarchyViewProps> = ({
  token,
  user,
  regionName,
  zones,
  woredas,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [zoneFilter, setZoneFilter] = useState<string>('ALL');
  const [flagFilter, setFlagFilter] = useState<'ALL' | 'DUPLICATES' | 'SECURITY'>('ALL');
  const [showAddWoreda, setShowAddWoreda] = useState(false);
  const [newWoredaName, setNewWoredaName] = useState('');
  const [newWoredaZoneId, setNewWoredaZoneId] = useState(zones[0]?.id || '');
  const [newWoredaTarget, setNewWoredaTarget] = useState('15000');
  const [newWoredaSecurity, setNewWoredaSecurity] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isAdmin = user.role_code === 'REGIONAL_SYSTEM_ADMIN';

  const filteredWoredas = useMemo(() => {
    const q = search.trim().toLowerCase();
    return woredas.filter((w) => {
      if (zoneFilter !== 'ALL' && w.zone_id !== zoneFilter) return false;
      if (flagFilter === 'DUPLICATES' && !w.is_duplicate_in_template) return false;
      if (flagFilter === 'SECURITY' && !w.has_security_constraints) return false;
      if (!q) return true;
      return (
        w.name.toLowerCase().includes(q) ||
        w.zone_name.toLowerCase().includes(q) ||
        w.reporting_unit_code.toLowerCase().includes(q)
      );
    });
  }, [woredas, search, zoneFilter, flagFilter]);

  const handleAddWoreda = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await apiRequest(
        '/hierarchy/woredas',
        {
          method: 'POST',
          body: JSON.stringify({
            zone_id: newWoredaZoneId || zones[0]?.id,
            name: newWoredaName,
            total_planned_target: Number(newWoredaTarget) || 0,
            has_security_constraints: newWoredaSecurity,
          }),
        },
        token,
      );
      setNewWoredaName('');
      setShowAddWoreda(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create Woreda.');
    } finally {
      setSubmitting(false);
    }
  };

  const totalFilteredPlanned = filteredWoredas.reduce((s, w) => s + w.total_planned_target, 0);
  const totalFilteredDaily = filteredWoredas.reduce((s, w) => s + w.daily_target, 0);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">Administrative Structure</p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            {regionName} Region · {zones.length} Zones · {woredas.length} Woredas
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Role-scoped administrative units imported from the Day 1 reporting template with normalized display names and preserved source codes.
          </p>
        </div>

        {isAdmin && (
          <button
            type="button"
            onClick={() => {
              setNewWoredaZoneId(zones[0]?.id || '');
              setShowAddWoreda((prev) => !prev);
            }}
            className="inline-flex items-center gap-2 rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Add Woreda Unit
          </button>
        )}
      </div>

      {showAddWoreda && isAdmin && (
        <form
          onSubmit={handleAddWoreda}
          className="bg-white border border-[#3A99CF]/40 rounded-lg p-5 space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900">Register New Woreda Reporting Unit</h3>
          {error && <p className="text-xs text-red-700 font-bold">{error}</p>}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Parent Zone / Town</label>
              <select
                value={newWoredaZoneId}
                onChange={(e) => setNewWoredaZoneId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Woreda Name</label>
              <input
                type="text"
                required
                value={newWoredaName}
                onChange={(e) => setNewWoredaName(e.target.value)}
                placeholder="e.g. Gimbichu North"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Total Planned Target (0–59m)
              </label>
              <input
                type="number"
                min={0}
                required
                value={newWoredaTarget}
                onChange={(e) => setNewWoredaTarget(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div className="flex items-end gap-3">
              <label className="inline-flex items-center gap-2 text-xs text-slate-700 pb-2">
                <input
                  type="checkbox"
                  checked={newWoredaSecurity}
                  onChange={(e) => setNewWoredaSecurity(e.target.checked)}
                />
                Security-Affected
              </label>
              <button
                type="submit"
                disabled={submitting}
                className="ml-auto rounded-md bg-[#485EA9] px-4 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] cursor-pointer"
              >
                {submitting ? 'Saving...' : 'Save Woreda'}
              </button>
            </div>
          </div>
        </form>
      )}

      {/* Filter Toolbar */}
      <div className="bg-white border border-slate-200 rounded-lg p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3 flex-1">
          <div className="relative flex-1 min-w-[220px] max-w-sm">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search Woreda, Zone, or Unit Code..."
              className="w-full rounded-md border border-slate-300 pl-9 pr-3 py-1.5 text-sm focus:border-[#3A99CF] focus:outline-none"
            />
          </div>

          <select
            value={zoneFilter}
            onChange={(e) => setZoneFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700"
          >
            <option value="ALL">All Scoped Zones ({zones.length})</option>
            {zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name} ({z.woreda_count})
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
            {(['ALL', 'DUPLICATES', 'SECURITY'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setFlagFilter(mode)}
                className={`px-3 py-1 text-xs font-bold rounded transition-colors whitespace-nowrap cursor-pointer ${
                  flagFilter === mode
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {mode === 'ALL'
                  ? 'All Units'
                  : mode === 'DUPLICATES'
                    ? 'Duplicate Template Rows'
                    : 'Security Flagged'}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs text-slate-600 tabular-nums whitespace-nowrap">
          Showing <strong>{filteredWoredas.length}</strong> units · Planned:{' '}
          <strong>{totalFilteredPlanned.toLocaleString()}</strong> · Daily:{' '}
          <strong>{totalFilteredDaily.toLocaleString()}</strong>
        </div>
      </div>

      {/* Woreda Directory Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-2.5 px-4">S/N</th>
                <th className="py-2.5 px-4">Unit Code</th>
                <th className="py-2.5 px-4">Zone / Town</th>
                <th className="py-2.5 px-4">Woreda</th>
                <th className="py-2.5 px-4 text-right">Planned Target (n)</th>
                <th className="py-2.5 px-4 text-right">Daily Target (n)</th>
                <th className="py-2.5 px-4">Template / Operational Notes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {filteredWoredas.map((w) => (
                <tr key={w.id} className="hover:bg-slate-50/80">
                  <td className="py-2.5 px-4 text-xs text-slate-500 tabular-nums">{w.source_sn ?? '—'}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-[#485EA9]">{w.reporting_unit_code}</td>
                  <td className="py-2.5 px-4 text-slate-700">{w.zone_name}</td>
                  <td className="py-2.5 px-4 font-bold text-slate-900">{w.name}</td>
                  <td className="py-2.5 px-4 text-right font-bold text-slate-900 tabular-nums">
                    {w.total_planned_target.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums">
                    {w.daily_target.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-2">
                      {w.is_duplicate_in_template && (
                        <span className="inline-flex items-center gap-1 text-[#D29441] font-bold">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Duplicate Name in CSV
                        </span>
                      )}
                      {w.has_security_constraints && (
                        <span className="inline-flex items-center gap-1 text-red-700 font-bold">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Security Priority Zone
                        </span>
                      )}
                      {!w.is_duplicate_in_template && !w.has_security_constraints && (
                        <span className="inline-flex items-center gap-1 text-slate-400">
                          <Building2 className="w-3.5 h-3.5" />
                          Standard Unit
                        </span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {filteredWoredas.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-sm text-slate-500">
                    No administrative units match your current filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
