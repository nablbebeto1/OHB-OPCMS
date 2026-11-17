import React, {useState} from 'react';
import {CheckCircle2, Plus, Sliders} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {
  CalculationConfigRecord,
  TotalVaccinatedScope,
  UserProfile,
  WastageDenominatorMode,
} from '../types/opcms';

interface CalculationConfigViewProps {
  token: string;
  user: UserProfile;
  configs: CalculationConfigRecord[];
  onRefresh: () => void;
}

export const CalculationConfigView: React.FC<CalculationConfigViewProps> = ({
  token,
  user,
  configs,
  onRefresh,
}) => {
  const [showPropose, setShowPropose] = useState(false);
  const [version, setVersion] = useState('v1.1.0');
  const [name, setName] = useState('');
  const [divisor, setDivisor] = useState<4 | 6>(4);
  const [wastageMode, setWastageMode] = useState<WastageDenominatorMode>('used_plus_partial');
  const [scope, setScope] = useState<TotalVaccinatedScope>('0-59m_only');
  const [nopv2ByDay, setNopv2ByDay] = useState<Record<string, number>>({
    '1': 50,
    '2': 50,
    '3': 50,
    '4': 50,
    '5': 50,
    '6': 50,
  });
  const [definition, setDefinition] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canPropose =
    user.role_code === 'REGIONAL_SYSTEM_ADMIN' ||
    user.role_code === 'REGIONAL_COORDINATION_TEAM';

  const handlePropose = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(
        '/calculation-configs',
        {
          method: 'POST',
          body: JSON.stringify({
            version,
            name,
            daily_target_divisor: divisor,
            nopv2_doses_per_vial_by_day: nopv2ByDay,
            bopv_doses_per_vial_by_day: {'1': 20, '2': 20, '3': 20, '4': 20, '5': 20, '6': 20},
            wastage_denominator_mode: wastageMode,
            total_vaccinated_scope: scope,
            documented_definition: definition,
          }),
        },
        token,
      );
      setShowPropose(false);
      setName('');
      setDefinition('');
      setMessage(`Proposed calculation configuration ${version}. Awaiting authorized approval.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to propose formula version.');
    } finally {
      setBusy(false);
    }
  };

  const handleApprove = async (id: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const approved = await apiRequest<CalculationConfigRecord>(
        `/calculation-configs/${id}/approve`,
        {method: 'POST'},
        token,
      );
      setMessage(`Activated formula profile ${approved.version} across OPCMS.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to approve formula configuration.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#485EA9]" />
            <h3 className="text-base font-bold text-slate-900">
              Administrator-Controlled Calculation Configuration (Versioned &amp; Audited)
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Workbook inconsistencies (4-day vs 6-day target divisor, per-day nOPV2 vial doses, wastage denominator) are explicitly versioned and require authorized approval before taking effect.
          </p>
        </div>
        {canPropose && (
          <button
            type="button"
            onClick={() => setShowPropose(!showPropose)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#485EA9] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            {showPropose ? 'Cancel' : 'Propose Formula Version'}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2 text-xs font-bold text-red-800">
          {error}
        </div>
      )}
      {message && (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-bold text-emerald-800">
          {message}
        </div>
      )}

      {showPropose && canPropose && (
        <form onSubmit={handlePropose} className="border border-slate-200 rounded-md p-4 bg-slate-50 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Version Tag</label>
              <input
                type="text"
                required
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
              />
            </div>
            <div className="md:col-span-3">
              <label className="block text-xs font-bold text-slate-700 mb-1">Profile Title</label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., OHB Approved 6-Day Target Divisor & Standardized Wastage"
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Daily Target Divisor</label>
              <select
                value={divisor}
                onChange={(e) => setDivisor(Number(e.target.value) as 4 | 6)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value={4}>Planned ÷ 4 (Core 4 Days — CSV Baseline)</option>
                <option value={6}>Planned ÷ 6 (Full 6 Worksheets)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Wastage Denominator Mode</label>
              <select
                value={wastageMode}
                onChange={(e) => setWastageMode(e.target.value as WastageDenominatorMode)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="used_plus_partial">Vials Used + Partially Used</option>
                <option value="used_only">Vials Used Only</option>
                <option value="received_minus_returned_good">Received - Returned Unused (Good)</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Coverage Cohort Scope</label>
              <select
                value={scope}
                onChange={(e) => setScope(e.target.value as TotalVaccinatedScope)}
                className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
              >
                <option value="0-59m_only">0–59m Only (Standard SIA)</option>
                <option value="0-120m_all">0–120m Combined</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              nOPV2 Doses/Vial Assumption by Campaign Day (Day 1–Day 6)
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
              {['1', '2', '3', '4', '5', '6'].map((d) => (
                <div key={d}>
                  <span className="block text-[11px] text-slate-500">Day {d}</span>
                  <input
                    type="number"
                    min={1}
                    value={nopv2ByDay[d]}
                    onChange={(e) =>
                      setNopv2ByDay({...nopv2ByDay, [d]: Math.max(1, Number(e.target.value) || 50)})
                    }
                    className="w-full rounded border border-slate-300 bg-white px-2 py-1 text-xs tabular-nums"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 mb-1">
              Documented Formula Definition &amp; Justification
            </label>
            <textarea
              required
              rows={2}
              value={definition}
              onChange={(e) => setDefinition(e.target.value)}
              placeholder="Document exact denominator, age scope, and reconciliation assumptions for OHB governance..."
              className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm"
            />
          </div>

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer"
          >
            Submit Formula Proposal for Approval
          </button>
        </form>
      )}

      <div className="divide-y divide-slate-200 border border-slate-200 rounded-md">
        {configs.map((cfg) => (
          <div key={cfg.id} className="p-4 space-y-2 text-xs">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <span className="font-mono font-bold text-[#485EA9]">{cfg.version}</span>{' '}
                <strong className="text-sm text-slate-900">{cfg.name}</strong>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span
                  className={`font-bold ${
                    cfg.is_active
                      ? 'text-emerald-700'
                      : cfg.approval_status === 'Pending Approval'
                        ? 'text-[#D29441]'
                        : 'text-slate-500'
                  }`}
                >
                  {cfg.is_active ? 'Active Approved Formula' : cfg.approval_status}
                </span>
                {canPropose && !cfg.is_active && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleApprove(cfg.id)}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1 font-bold text-white hover:bg-emerald-700 cursor-pointer"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve &amp; Activate
                  </button>
                )}
              </div>
            </div>
            <p className="text-slate-700 leading-relaxed">{cfg.documented_definition}</p>
            <div className="text-slate-500 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
              <span>Divisor: Planned ÷ {cfg.daily_target_divisor}</span>
              <span>Wastage Mode: {cfg.wastage_denominator_mode}</span>
              <span>Scope: {cfg.total_vaccinated_scope}</span>
              <span>
                nOPV2 Doses/Vial (D1–D6):{' '}
                {['1', '2', '3', '4', '5', '6'].map((d) => `D${d}:${cfg.nopv2_doses_per_vial_by_day[d]}`).join(' ')}
              </span>
              {cfg.approved_by_username && (
                <span>
                  Approved by: <strong>{cfg.approved_by_username}</strong>
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
