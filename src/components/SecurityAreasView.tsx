import React, {useMemo, useState} from 'react';
import {Plus, ShieldAlert, ShieldCheck} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import {formatPctOrNA, safePercent} from '../lib/calculations';
import type {
  CampaignRecord,
  SecurityDailyReportRecord,
  SecuritySettlementRecord,
  UserProfile,
  WoredaRecord,
} from '../types/opcms';

interface SecurityAreasViewProps {
  token: string;
  user: UserProfile;
  campaign: CampaignRecord | null;
  woredas: WoredaRecord[];
  settlements: SecuritySettlementRecord[];
  securityReports: SecurityDailyReportRecord[];
  onRefresh: () => void;
}

export const SecurityAreasView: React.FC<SecurityAreasViewProps> = ({
  token,
  user,
  campaign,
  woredas,
  settlements,
  securityReports,
  onRefresh,
}) => {
  const [selectedDayId, setSelectedDayId] = useState(campaign?.days[0]?.id || 'day-1');
  const [selectedSettlementId, setSelectedSettlementId] = useState(settlements[0]?.id || '');

  // Daily settlement report form
  const [v011, setV011] = useState(0);
  const [v1259, setV1259] = useState(0);
  const [v60120, setV60120] = useState(0);
  const [teamsDeployed, setTeamsDeployed] = useState(0);
  const [remarks, setRemarks] = useState('');

  // Add settlement form
  const [showAddForm, setShowAddForm] = useState(false);
  const [newWoredaId, setNewWoredaId] = useState(woredas[0]?.id || '');
  const [newSettlementName, setNewSettlementName] = useState('');
  const [newKebeleName, setNewKebeleName] = useState('');
  const [newAccess, setNewAccess] = useState<'Accessible' | 'Partially Accessible' | 'Inaccessible'>(
    'Partially Accessible',
  );
  const [newModality, setNewModality] = useState('Hit-and-Run / Transit Point');
  const [newTarget, setNewTarget] = useState(500);
  const [newNotes, setNewNotes] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canManageSettlements = ['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN'].includes(
    user.role_code,
  );
  const canReport = user.role_code !== 'MONITORING_OFFICER';

  const activeSettlement = useMemo(
    () => settlements.find((s) => s.id === selectedSettlementId) || settlements[0] || null,
    [settlements, selectedSettlementId],
  );

  const totalTarget = settlements.reduce((s, st) => s + st.target_children_0_59m, 0);
  const totalVax = settlements.reduce((s, st) => s + st.vaccinated_children_0_59m, 0);

  const handleSaveDailyReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeSettlement) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(
        '/security-reports',
        {
          method: 'POST',
          body: JSON.stringify({
            settlement_id: activeSettlement.id,
            campaign_day_id: selectedDayId,
            vaccinated_0_11m: v011,
            vaccinated_12_59m: v1259,
            vaccinated_60_120m: v60120,
            teams_deployed: teamsDeployed,
            remarks,
          }),
        },
        token,
      );
      setMessage(`Recorded isolated settlement report for ${activeSettlement.settlement_name}.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save settlement report.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddSettlement = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await apiRequest<SecuritySettlementRecord>(
        '/security-settlements',
        {
          method: 'POST',
          body: JSON.stringify({
            woreda_id: newWoredaId,
            settlement_name: newSettlementName,
            kebele_name: newKebeleName,
            access_status: newAccess,
            intervention_modality: newModality,
            target_children_0_59m: newTarget,
            security_notes: newNotes,
          }),
        },
        token,
      );
      setSelectedSettlementId(created.id);
      setNewSettlementName('');
      setNewKebeleName('');
      setNewNotes('');
      setShowAddForm(false);
      setMessage(`Added security-affected settlement '${created.settlement_name}'.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add settlement.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header + Isolation Notice */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#D29441]">
            Security Affected Areas Worksheet (Sheet 8)
          </p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Security-Affected Settlement Registry &amp; Daily Reporting
          </h2>
          <p className="mt-1 text-xs text-slate-600">
            Maintained strictly separate from regular Woreda administrative vaccination totals to prevent double counting.
          </p>
        </div>

        {canManageSettlements && (
          <button
            type="button"
            onClick={() => setShowAddForm(!showAddForm)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#485EA9] px-4 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {showAddForm ? 'Close Add Form' : 'Register Security Settlement'}
          </button>
        )}
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Tracked Settlements</div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
            {settlements.length}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Settlement Planned Target (0–59m)</div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
            {totalTarget.toLocaleString()}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Settlement Vaccinated (0–59m)</div>
          <div className="mt-1.5 text-2xl font-bold text-[#3A99CF] tabular-nums">
            {totalVax.toLocaleString()}
          </div>
        </div>
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Isolated Settlement Coverage</div>
          <div className="mt-1.5 text-2xl font-bold text-[#D29441] tabular-nums">
            {formatPctOrNA(safePercent(totalVax, totalTarget))}
          </div>
        </div>
      </div>

      <div className="rounded-md border border-sky-200 bg-sky-50/70 px-4 py-3 text-xs text-slate-800 flex items-center gap-2.5">
        <ShieldCheck className="w-4 h-4 text-[#3A99CF] shrink-0" />
        <span>
          <strong>Double-Counting Safeguard Active:</strong> Settlement totals recorded here never increment regular Woreda Day 1–Day 6 totals or regional administrative coverage denominators.
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-800">
          {message}
        </div>
      )}

      {/* Register Settlement Form */}
      {showAddForm && canManageSettlements && (
        <form
          onSubmit={handleAddSettlement}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <h3 className="text-sm font-bold text-slate-900">
            New Security-Affected Settlement
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Parent Woreda</label>
              <select
                value={newWoredaId}
                onChange={(e) => setNewWoredaId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {woredas.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.zone_name} — {w.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Settlement Name</label>
              <input
                type="text"
                required
                value={newSettlementName}
                onChange={(e) => setNewSettlementName(e.target.value)}
                placeholder="e.g., Boke Special Settlement"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Kebele Name</label>
              <input
                type="text"
                value={newKebeleName}
                onChange={(e) => setNewKebeleName(e.target.value)}
                placeholder="Kebele"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Access Status</label>
              <select
                value={newAccess}
                onChange={(e) => setNewAccess(e.target.value as any)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="Accessible">Accessible</option>
                <option value="Partially Accessible">Partially Accessible</option>
                <option value="Inaccessible">Inaccessible</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Intervention Modality</label>
              <input
                type="text"
                value={newModality}
                onChange={(e) => setNewModality(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Planned Target (0–59m)</label>
              <input
                type="number"
                min={0}
                value={newTarget}
                onChange={(e) => setNewTarget(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">Security Notes</label>
            <input
              type="text"
              value={newNotes}
              onChange={(e) => setNewNotes(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer"
          >
            Save Settlement
          </button>
        </form>
      )}

      {/* Daily Entry for Selected Settlement */}
      {canReport && activeSettlement && (
        <form
          onSubmit={handleSaveDailyReport}
          className="bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
            <ShieldAlert className="w-4 h-4 text-[#D29441]" />
            <h3 className="text-sm font-bold text-slate-900">
              Daily Security-Affected Settlement Report Entry
            </h3>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Settlement</label>
              <select
                value={activeSettlement.id}
                onChange={(e) => setSelectedSettlementId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {settlements.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.zone_name} · {s.woreda_name} — {s.settlement_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Campaign Day</label>
              <select
                value={selectedDayId}
                onChange={(e) => setSelectedDayId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {campaign?.days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.campaign_date})
                  </option>
                ))}
              </select>
            </div>
            <div className="border border-slate-200 rounded-md px-3.5 py-2 bg-slate-50 text-xs tabular-nums flex items-center justify-between">
              <div>
                <div className="text-slate-500">Daily / Planned Target</div>
                <strong className="text-slate-900">
                  {activeSettlement.daily_target_0_59m.toLocaleString()} /{' '}
                  {activeSettlement.target_children_0_59m.toLocaleString()}
                </strong>
              </div>
              <div className="text-right">
                <div className="text-slate-500">Access</div>
                <strong className="text-[#D29441]">{activeSettlement.access_status}</strong>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">0–11m Vaccinated</label>
              <input
                type="number"
                min={0}
                value={v011}
                onChange={(e) => setV011(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">12–59m Vaccinated</label>
              <input
                type="number"
                min={0}
                value={v1259}
                onChange={(e) => setV1259(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">60–120m Vaccinated</label>
              <input
                type="number"
                min={0}
                value={v60120}
                onChange={(e) => setV60120(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Teams Deployed</label>
              <input
                type="number"
                min={0}
                value={teamsDeployed}
                onChange={(e) => setTeamsDeployed(Math.max(0, Number(e.target.value) || 0))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums"
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              type="text"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="Field modality notes, security corridor window, or cold-chain constraints..."
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] shrink-0 cursor-pointer"
            >
              Submit Settlement Daily Record
            </button>
          </div>
        </form>
      )}

      {/* Settlements Registry Table */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200">
          <h3 className="text-base font-bold text-slate-900">
            Settlement Coverage Ledger (Isolated Totals)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-2.5 px-4">Zone / Woreda</th>
                <th className="py-2.5 px-4">Settlement (Kebele)</th>
                <th className="py-2.5 px-4">Access Status</th>
                <th className="py-2.5 px-4">Modality</th>
                <th className="py-2.5 px-4 text-right">Planned Target</th>
                <th className="py-2.5 px-4 text-right">Cumulative Vax</th>
                <th className="py-2.5 px-4 text-right">Coverage %</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {settlements.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-bold text-slate-900">
                    {s.zone_name} · {s.woreda_name}
                  </td>
                  <td className="py-2.5 px-4 text-slate-800">
                    <div className="font-bold">{s.settlement_name}</div>
                    <div className="text-slate-500">{s.kebele_name}</div>
                  </td>
                  <td className="py-2.5 px-4 font-bold text-[#D29441]">{s.access_status}</td>
                  <td className="py-2.5 px-4 text-slate-600">{s.intervention_modality}</td>
                  <td className="py-2.5 px-4 text-right tabular-nums">
                    {s.target_children_0_59m.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-bold text-[#3A99CF]">
                    {s.vaccinated_children_0_59m.toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                    {formatPctOrNA(safePercent(s.vaccinated_children_0_59m, s.target_children_0_59m))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily Settlement Submissions */}
      {securityReports.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Daily Settlement Activity Log ({securityReports.length})
            </h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-2.5 px-4">Day</th>
                  <th className="py-2.5 px-4">Settlement</th>
                  <th className="py-2.5 px-4 text-right">0–11m</th>
                  <th className="py-2.5 px-4 text-right">12–59m</th>
                  <th className="py-2.5 px-4 text-right">Total 0–59m</th>
                  <th className="py-2.5 px-4 text-right">Daily Cov %</th>
                  <th className="py-2.5 px-4 text-right">Teams</th>
                  <th className="py-2.5 px-4">Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {securityReports.map((sr) => (
                  <tr key={sr.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-bold text-slate-900">{sr.day_label}</td>
                    <td className="py-2.5 px-4 text-slate-800">{sr.settlement_name}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{sr.vaccinated_0_11m.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{sr.vaccinated_12_59m.toLocaleString()}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                      {sr.total_vaccinated_0_59m.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">
                      {formatPctOrNA(sr.daily_coverage_pct)}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{sr.teams_deployed}</td>
                    <td className="py-2.5 px-4 text-slate-600">{sr.remarks || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
