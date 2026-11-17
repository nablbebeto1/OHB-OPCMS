import React, {useState} from 'react';
import {Calendar, Lock, ShieldAlert, Sliders, Unlock} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {
  CalculationConfigRecord,
  CampaignRecord,
  SecuritySettlementRecord,
  UserProfile,
} from '../types/opcms';
import {CalculationConfigView} from './CalculationConfigView';

interface CampaignConfigViewProps {
  token: string;
  user: UserProfile;
  campaign: CampaignRecord | null;
  calculationConfigs: CalculationConfigRecord[];
  settlements: SecuritySettlementRecord[];
  onRefresh: () => void;
}

export const CampaignConfigView: React.FC<CampaignConfigViewProps> = ({
  token,
  user,
  campaign,
  calculationConfigs,
  settlements,
  onRefresh,
}) => {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nopv2Doses, setNopv2Doses] = useState(campaign?.nopv2_doses_per_vial || 50);
  const [bopvDoses, setBopvDoses] = useState(campaign?.bopv_doses_per_vial || 20);

  if (!campaign) return null;

  const canConfigure =
    user.role_code === 'REGIONAL_SYSTEM_ADMIN' || user.role_code === 'REGIONAL_COORDINATION_TEAM';

  const toggleDayOpen = async (dayId: string, nextOpen: boolean) => {
    setError(null);
    setBusyId(dayId);
    try {
      await apiRequest(
        `/campaigns/${campaign.id}/days/${dayId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({is_open_for_reporting: nextOpen}),
        },
        token,
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to update campaign day.');
    } finally {
      setBusyId(null);
    }
  };

  const saveVaccineParams = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusyId('params');
    try {
      await apiRequest(
        `/campaigns/${campaign.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            nopv2_doses_per_vial: Number(nopv2Doses),
            bopv_doses_per_vial: Number(bopvDoses),
          }),
        },
        token,
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save campaign parameters.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">Campaign Configuration</p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">{campaign.name}</h2>
          <p className="mt-1 text-xs text-slate-500">
            Code: <span className="font-mono">{campaign.code}</span> · Status:{' '}
            <strong className="text-emerald-700">{campaign.status}</strong> · Window:{' '}
            {campaign.start_date} to {campaign.end_date}
          </p>
        </div>
        <div className="text-xs text-slate-600 tabular-nums">
          Core Target Divisor: <strong>Planned ÷ {campaign.core_target_days_divisor}</strong> · Total Sheets:{' '}
          <strong>{campaign.total_campaign_days} Days</strong>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-800">
          {error}
        </div>
      )}

      {/* Campaign Days Schedule (Day1 .. Day6) */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[#3A99CF]" />
            <h3 className="text-base font-bold text-slate-900">
              Campaign Day Schedule (Workbook Sheets Day1–Day6)
            </h3>
          </div>
          <span className="text-xs text-slate-500">
            {canConfigure
              ? 'Regional Admin / Coordination can open or close daily entry windows'
              : 'Read-only schedule view'}
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-2.5 px-4">Day</th>
                <th className="py-2.5 px-4">Excel Worksheet</th>
                <th className="py-2.5 px-4">Phase</th>
                <th className="py-2.5 px-4">Campaign Date</th>
                <th className="py-2.5 px-4">Reporting Window</th>
                {canConfigure && <th className="py-2.5 px-4 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {campaign.days.map((d) => (
                <tr key={d.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 font-bold text-slate-900">{d.label}</td>
                  <td className="py-2.5 px-4 font-mono text-xs text-[#485EA9]">{d.worksheet_name}</td>
                  <td className="py-2.5 px-4 text-slate-700">
                    {d.day_type === 'Core' ? 'Core Campaign (25% Daily Target)' : 'Mop-Up / Catch-Up'}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700 tabular-nums">{d.campaign_date}</td>
                  <td className="py-2.5 px-4 text-xs font-bold">
                    {d.is_open_for_reporting ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Unlock className="w-3.5 h-3.5" /> Open for Entry
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-slate-500">
                        <Lock className="w-3.5 h-3.5" /> Closed
                      </span>
                    )}
                  </td>
                  {canConfigure && (
                    <td className="py-2.5 px-4 text-right">
                      <button
                        type="button"
                        disabled={busyId === d.id}
                        onClick={() => toggleDayOpen(d.id, !d.is_open_for_reporting)}
                        className="rounded-md border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {d.is_open_for_reporting ? 'Close Window' : 'Open Window'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Vaccine Vial Parameters & Security-Affected Areas */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <form
          onSubmit={saveVaccineParams}
          className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#485EA9]" />
            <h3 className="text-base font-bold text-slate-900">Co-administration Vial Factors</h3>
          </div>
          <p className="text-xs text-slate-600">
            Used to compute nOPV2 and bOPV vaccine wastage percentages automatically during daily reporting.
          </p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">nOPV2 Doses / Vial</label>
              <input
                type="number"
                min={1}
                disabled={!canConfigure}
                value={nopv2Doses}
                onChange={(e) => setNopv2Doses(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums disabled:bg-slate-50"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">bOPV Doses / Vial</label>
              <input
                type="number"
                min={1}
                disabled={!canConfigure}
                value={bopvDoses}
                onChange={(e) => setBopvDoses(Number(e.target.value))}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm tabular-nums disabled:bg-slate-50"
              />
            </div>
          </div>
          {canConfigure && (
            <button
              type="submit"
              disabled={busyId === 'params'}
              className="rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer"
            >
              {busyId === 'params' ? 'Saving...' : 'Update Vial Parameters'}
            </button>
          )}
        </form>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-2">
            <ShieldAlert className="w-4 h-4 text-[#D29441]" />
            <h3 className="text-base font-bold text-slate-900">
              Security-Affected Areas Registry (Workbook Sheet 8)
            </h3>
          </div>
          <p className="text-xs text-slate-600 mb-4">
            Tracked separately in the Security Areas module and populated via Security Affected Areas worksheet import.
          </p>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
            {settlements.map((s) => (
              <div key={s.id} className="p-3.5 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">
                    {s.zone_name} · {s.woreda_name}
                  </span>
                  <span className="font-bold text-[#D29441]">{s.access_status}</span>
                </div>
                <p className="text-slate-700">{s.settlement_name}</p>
                <p className="text-slate-500">
                  Modality: {s.intervention_modality} · {s.security_notes}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Administrator-Controlled Calculation Formulas */}
      <CalculationConfigView
        token={token}
        user={user}
        configs={calculationConfigs}
        onRefresh={onRefresh}
      />
    </div>
  );
};
