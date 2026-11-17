import React, {useState} from 'react';
import {AlertTriangle, CheckCircle2, FileSpreadsheet} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {FormulaDiscrepancyRecord, UserProfile} from '../types/opcms';

interface WorkbookAuditViewProps {
  token: string;
  user: UserProfile;
  discrepancies: FormulaDiscrepancyRecord[];
  templateSummary: {
    template_reported_planned_target: number;
    template_reported_daily_target: number;
  };
  computedPlannedTotal: number;
  computedDailyTotal: number;
  onRefresh: () => void;
}

const WORKSHEETS = [
  {name: 'Day1', status: 'Inspected (Attached CSV)', rows: '261 Woredas + Totals Row (44 Columns)'},
  {name: 'Day2', status: 'Schema Ready (Pending .xlsx)', rows: 'Daily Template Structure'},
  {name: 'Day3', status: 'Schema Ready (Pending .xlsx)', rows: 'Daily Template Structure'},
  {name: 'Day4', status: 'Schema Ready (Pending .xlsx)', rows: 'Daily Template Structure'},
  {name: 'Day5', status: 'Schema Ready (Pending .xlsx)', rows: 'Mop-Up Day Structure'},
  {name: 'Day6', status: 'Schema Ready (Pending .xlsx)', rows: 'Mop-Up Day Structure'},
  {name: 'Summary', status: 'Computed Dynamically in OPCMS', rows: 'Regional & Zonal Aggregation'},
  {name: 'Security Affected Areas', status: 'Schema Ready (Pending .xlsx)', rows: 'Settlement Access & Modalities'},
];

export const WorkbookAuditView: React.FC<WorkbookAuditViewProps> = ({
  token,
  user,
  discrepancies,
  templateSummary,
  computedPlannedTotal,
  computedDailyTotal,
  onRefresh,
}) => {
  const [notesById, setNotesById] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canResolve =
    user.role_code === 'REGIONAL_SYSTEM_ADMIN' || user.role_code === 'REGIONAL_COORDINATION_TEAM';

  const resolveItem = async (
    id: string,
    ohb_approval_status: 'Approved Correction' | 'Keep As-Is' | 'Deferred',
  ) => {
    setError(null);
    setBusyId(id);
    try {
      await apiRequest(
        `/workbook-audit/discrepancies/${id}/resolve`,
        {
          method: 'POST',
          body: JSON.stringify({
            ohb_approval_status,
            resolution_notes:
              notesById[id]?.trim() || `Marked '${ohb_approval_status}' by ${user.full_name}.`,
          }),
        },
        token,
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to save resolution.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs font-bold text-[#D29441]">Workbook Inspection &amp; Formula Audit</p>
            <h2 className="mt-0.5 text-xl font-bold text-slate-900">
              Oromia 2026 Round 1 Template Verification
            </h2>
            <p className="mt-1 text-xs text-slate-600 max-w-3xl">
              No indicators were invented or silently altered. All discrepancies discovered in the uploaded Day 1 CSV template are documented below for formal Oromia Health Bureau (OHB) approval.
            </p>
          </div>
          <div className="text-xs text-slate-600 tabular-nums border border-slate-200 rounded-md px-3.5 py-2 bg-slate-50">
            <div>
              CSV Totals Row (Col F): <strong className="text-red-700">{templateSummary.template_reported_planned_target.toLocaleString()}</strong>
            </div>
            <div>
              Verified 261-Woreda Sum: <strong className="text-emerald-700">{computedPlannedTotal.toLocaleString()}</strong>
            </div>
            <div>
              CSV Daily (Col G) vs Row Sum: <strong>{templateSummary.template_reported_daily_target.toLocaleString()}</strong> vs <strong>{computedDailyTotal.toLocaleString()}</strong>
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-800">
          {error}
        </div>
      )}

      {/* 8-Worksheet Specification Coverage */}
      <div className="bg-white border border-slate-200 rounded-lg p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileSpreadsheet className="w-4 h-4 text-[#485EA9]" />
          <h3 className="text-base font-bold text-slate-900">Workbook Worksheet Inventory (8 Sheets)</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {WORKSHEETS.map((ws) => (
            <div key={ws.name} className="border border-slate-200 rounded-md p-3 bg-slate-50/50">
              <div className="font-bold text-sm text-slate-900">{ws.name}</div>
              <div className="mt-0.5 text-xs text-[#485EA9] font-medium">{ws.status}</div>
              <div className="mt-1 text-xs text-slate-500">{ws.rows}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Formula & Structure Discrepancies */}
      <div className="space-y-4">
        {discrepancies.map((d) => {
          const isResolved = d.ohb_approval_status !== 'Pending OHB Review';
          return (
            <div key={d.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`font-bold ${
                      d.severity === 'Critical'
                        ? 'text-red-700'
                        : d.severity === 'High'
                          ? 'text-[#D29441]'
                          : 'text-[#485EA9]'
                    }`}
                  >
                    [{d.severity}]
                  </span>
                  <span className="font-mono text-slate-600">{d.worksheet}</span>
                  <span aria-hidden="true">·</span>
                  <span className="text-slate-600">{d.cell_or_column}</span>
                </div>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-bold ${
                    isResolved ? 'text-emerald-700' : 'text-[#D29441]'
                  }`}
                >
                  {isResolved ? (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  ) : (
                    <AlertTriangle className="w-3.5 h-3.5" />
                  )}
                  {d.ohb_approval_status}
                </span>
              </div>

              <h4 className="text-base font-bold text-slate-900">{d.title}</h4>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs bg-slate-50 border border-slate-200 rounded-md p-3.5">
                <div>
                  <span className="font-bold text-slate-700 block mb-1">Observed in Template</span>
                  <span className="text-slate-800">{d.observed_value}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 block mb-1">Verified / Expected</span>
                  <span className="text-slate-800">{d.expected_value}</span>
                </div>
                <div>
                  <span className="font-bold text-slate-700 block mb-1">Recommendation</span>
                  <span className="text-slate-800">{d.recommendation}</span>
                </div>
              </div>

              {d.resolution_notes && (
                <p className="text-xs text-slate-600">
                  <strong>OHB Decision Note:</strong> {d.resolution_notes}
                </p>
              )}

              {canResolve && (
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                  <input
                    type="text"
                    value={notesById[d.id] ?? ''}
                    onChange={(e) => setNotesById({...notesById, [d.id]: e.target.value})}
                    placeholder="Add OHB approval or governance note..."
                    className="flex-1 rounded-md border border-slate-300 px-3 py-1.5 text-xs"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => resolveItem(d.id, 'Approved Correction')}
                      className="rounded-md bg-[#3A99CF] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer"
                    >
                      Approve Correction
                    </button>
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => resolveItem(d.id, 'Keep As-Is')}
                      className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      Keep As-Is
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
