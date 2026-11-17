import React, {useMemo, useState} from 'react';
import {Download, FileSpreadsheet, FileText} from 'lucide-react';
import {
  buildExportTable,
  EXPORT_REPORT_DEFINITIONS,
  exportTableToCSV,
  exportTableToExcel,
  exportTableToPDF,
  type ExportReportType,
} from '../lib/exporters';
import type {
  CampaignAlertRecord,
  CampaignRecord,
  DailyReportRecord,
  FormulaDiscrepancyRecord,
  SecurityDailyReportRecord,
  SecuritySettlementRecord,
  WoredaRecord,
  ZoneRecord,
} from '../types/opcms';

interface ExportsCenterViewProps {
  campaign: CampaignRecord | null;
  zones: ZoneRecord[];
  woredas: WoredaRecord[];
  reports: DailyReportRecord[];
  settlements: SecuritySettlementRecord[];
  securityReports: SecurityDailyReportRecord[];
  alerts?: CampaignAlertRecord[];
  discrepancies?: FormulaDiscrepancyRecord[];
}

export const ExportsCenterView: React.FC<ExportsCenterViewProps> = ({
  campaign,
  zones,
  woredas,
  reports,
  settlements,
  securityReports,
  alerts = [],
  discrepancies = [],
}) => {
  const [selectedType, setSelectedType] = useState<ExportReportType>('daily_reports');
  const [selectedDayId, setSelectedDayId] = useState<string>('ALL');
  const [selectedZoneId, setSelectedZoneId] = useState<string>('');

  const payload = useMemo(
    () =>
      buildExportTable(selectedType, {
        campaign,
        zones,
        woredas,
        reports,
        settlements,
        securityReports,
        alerts,
        discrepancies,
        selectedDayId,
        selectedZoneId: selectedZoneId || undefined,
      }),
    [
      selectedType,
      campaign,
      zones,
      woredas,
      reports,
      settlements,
      securityReports,
      alerts,
      discrepancies,
      selectedDayId,
      selectedZoneId,
    ],
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">Official OHB Campaign Exports</p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Reporting Exports Center (Excel, CSV &amp; PDF)
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Generate standardized Excel (.xlsx), CSV (.csv), and PDF (.pdf) reports across all {EXPORT_REPORT_DEFINITIONS.length} campaign reporting domains. Zero denominators display N/A.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => exportTableToExcel(payload)}
            className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
          >
            <FileSpreadsheet className="w-4 h-4" />
            Export Excel (.xlsx)
          </button>
          <button
            type="button"
            onClick={() => exportTableToCSV(payload)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#3A99CF] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer"
          >
            <Download className="w-4 h-4" />
            Export CSV (.csv)
          </button>
          <button
            type="button"
            onClick={() => exportTableToPDF(payload)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#485EA9] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] cursor-pointer"
          >
            <FileText className="w-4 h-4" />
            Export PDF (.pdf)
          </button>
        </div>
      </div>

      {/* Report Selector Grid + Filters */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-4 bg-white border border-slate-200 rounded-lg p-4 space-y-2">
          <div className="text-xs font-bold text-slate-600 pb-2 border-b border-slate-200">
            Select Campaign Report Type ({EXPORT_REPORT_DEFINITIONS.length} Datasets)
          </div>
          <div className="space-y-1">
            {EXPORT_REPORT_DEFINITIONS.map((def) => {
              const active = def.id === selectedType;
              return (
                <button
                  key={def.id}
                  type="button"
                  onClick={() => setSelectedType(def.id)}
                  className={`w-full text-left px-3 py-2 rounded-md border transition-colors cursor-pointer ${
                    active
                      ? 'border-[#3A99CF] bg-sky-50/70 text-slate-900'
                      : 'border-transparent hover:bg-slate-50 text-slate-700'
                  }`}
                >
                  <div className="text-xs font-bold">{def.label}</div>
                  <div className="text-[11px] text-slate-500 mt-0.5 leading-snug">
                    {def.description}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="lg:col-span-8 space-y-4">
          {/* Scope Filters */}
          <div className="bg-white border border-slate-200 rounded-lg p-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Filter by Campaign Day
              </label>
              <select
                value={selectedDayId}
                onChange={(e) => setSelectedDayId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="ALL">All Campaign Days (Day 1–Day 6)</option>
                {campaign?.days.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.label} ({d.worksheet_name}) — {d.campaign_date}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Filter by Zone (Scoped)
              </label>
              <select
                value={selectedZoneId}
                onChange={(e) => setSelectedZoneId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="">All Accessible Zones ({zones.length})</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name} ({z.zone_type})
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Live Data Preview */}
          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-slate-900">{payload.title}</h3>
                <p className="text-xs text-slate-500">{payload.subtitle}</p>
              </div>
              <span className="text-xs font-bold text-[#485EA9] tabular-nums">
                {payload.rows.length} row(s)
              </span>
            </div>
            <div className="overflow-x-auto max-h-[520px]">
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <tr>
                    {payload.columns.map((col) => (
                      <th key={col} className="py-2.5 px-3 whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {payload.rows.slice(0, 200).map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/70">
                      {row.map((cell, cIdx) => (
                        <td
                          key={cIdx}
                          className={`py-2 px-3 whitespace-nowrap ${
                            typeof cell === 'number' ? 'tabular-nums font-bold text-slate-900' : 'text-slate-700'
                          }`}
                        >
                          {typeof cell === 'number' ? cell.toLocaleString() : cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {payload.rows.length === 0 && (
                    <tr>
                      <td
                        colSpan={payload.columns.length}
                        className="py-10 text-center text-sm text-slate-500"
                      >
                        No records match the selected Day / Zone filter yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
