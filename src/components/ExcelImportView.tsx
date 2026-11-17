import React, {useState} from 'react';
import * as XLSX from 'xlsx';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  History,
  Lock,
  Upload,
} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {
  ExcelImportHistoryRecord,
  ExcelImportPreviewRow,
  UserProfile,
} from '../types/opcms';

interface ExcelImportViewProps {
  token: string;
  user: UserProfile;
  histories: ExcelImportHistoryRecord[];
  onRefresh: () => void;
}

const TARGET_SHEETS = [
  'Day1',
  'Day2',
  'Day3',
  'Day4',
  'Day5',
  'Day6',
  'Summary',
  'Security Affected Areas',
];

function parseNumericCell(val: unknown): number | '' {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') return Number.isFinite(val) ? val : '';
  const cleaned = String(val).replace(/,/g, '').trim();
  if (cleaned === '') return '';
  const num = Number(cleaned);
  return Number.isFinite(num) ? num : '';
}

function parseWorksheetRows(sheetName: string, matrix: unknown[][]) {
  const extracted: Record<string, unknown>[] = [];
  const lowerSheet = sheetName.toLowerCase();

  // Security Affected Areas flexible parsing
  if (lowerSheet.includes('security')) {
    for (let i = 0; i < matrix.length; i++) {
      const row = matrix[i] || [];
      const c0 = String(row[0] ?? '').trim();
      const c1 = String(row[1] ?? '').trim();
      const c2 = String(row[2] ?? '').trim();
      if (!c1 && !c2) continue;
      const joined = row.map((v) => String(v ?? '').toLowerCase()).join(' ');
      if (joined.includes('settlement') || joined.includes('woreda') || joined.includes('total')) continue;

      if (/^\d+$/.test(c0) || (c1 && c2)) {
        extracted.push({
          row_index: i + 1,
          worksheet: 'Security Affected Areas',
          raw_region: 'Oromia',
          raw_zone: String(row[1] ?? ''),
          raw_woreda: String(row[2] ?? ''),
          settlement_name: String(row[3] ?? row[4] ?? `${String(row[2] ?? '').trim()} Settlement`),
          kebele_name: String(row[4] ?? ''),
          access_status: String(row[5] ?? 'Partially Accessible'),
          intervention_modality: String(row[6] ?? 'Hit-and-Run / Transit'),
          planned_target: parseNumericCell(row[7]),
          daily_target: parseNumericCell(row[8]),
          age_0_11_vb: parseNumericCell(row[9]),
          age_0_11_nv: 0,
          age_12_59_vb: parseNumericCell(row[10]),
          age_12_59_nv: 0,
          age_60_120_vb: parseNumericCell(row[11]),
          age_60_120_nv: 0,
        });
      }
    }
    return extracted;
  }

  // Standard 44-column Day1-Day6 parsing (S/N in col 0, Region in col 1, Zone in col 2, Woreda in col 3)
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i] || [];
    const snText = String(row[0] ?? '').trim();
    if (!/^\d+$/.test(snText)) continue;
    const rawZone = String(row[2] ?? '');
    const rawWoreda = String(row[3] ?? '');
    if (!rawZone.trim() && !rawWoreda.trim()) continue;

    extracted.push({
      row_index: i + 1,
      worksheet: sheetName,
      raw_region: String(row[1] ?? 'Oromia'),
      raw_zone: rawZone,
      raw_woreda: rawWoreda,
      planned_target: parseNumericCell(row[5]),
      daily_target: parseNumericCell(row[6]),
      age_0_11_vb: parseNumericCell(row[7]),
      age_0_11_nv: parseNumericCell(row[8]),
      age_12_59_vb: parseNumericCell(row[9]),
      age_12_59_nv: parseNumericCell(row[10]),
      age_60_120_vb: parseNumericCell(row[11]),
      age_60_120_nv: parseNumericCell(row[12]),
      nopv2_received: parseNumericCell(row[16]),
      nopv2_used: parseNumericCell(row[17]),
      nopv2_partial: parseNumericCell(row[18]),
      nopv2_returned_good: parseNumericCell(row[19]),
      nopv2_broken: parseNumericCell(row[20]),
      nopv2_returned_bad: parseNumericCell(row[21]),
      nopv2_lost: parseNumericCell(row[22]),
      bopv_received: parseNumericCell(row[24]),
      bopv_used: parseNumericCell(row[25]),
      bopv_partial: parseNumericCell(row[26]),
      bopv_returned_good: parseNumericCell(row[27]),
      bopv_broken: parseNumericCell(row[28]),
      bopv_returned_bad: parseNumericCell(row[29]),
      bopv_lost: parseNumericCell(row[30]),
      afp_alerts_count: parseNumericCell(row[32]),
      aefi_alerts_count: parseNumericCell(row[33]),
      hhs_visited: parseNumericCell(row[34]),
      community_meeting_participants: parseNumericCell(row[35]),
      home_to_home_ipc_reached: parseNumericCell(row[36]),
      zero_dose_identified: parseNumericCell(row[37]),
      zero_dose_linked: 0,
      zero_dose_vaccinated: parseNumericCell(row[38]),
      under_vaccinated_identified: parseNumericCell(row[39]),
      under_vaccinated_linked: 0,
      under_vaccinated_vaccinated: parseNumericCell(row[40]),
      total_teams: parseNumericCell(row[41]),
      teams_reported: parseNumericCell(row[42]),
      any_remark: String(row[43] ?? ''),
    });
  }
  return extracted;
}

export const ExcelImportView: React.FC<ExcelImportViewProps> = ({
  token,
  user,
  histories,
  onRefresh,
}) => {
  const [filename, setFilename] = useState<string>('');
  const [detectedSheets, setDetectedSheets] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<ExcelImportPreviewRow[]>([]);
  const [summaryCounts, setSummaryCounts] = useState<{
    total_rows: number;
    valid_count: number;
    warning_count: number;
    invalid_count: number;
    protected_count: number;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canImport =
    user.role_code === 'REGIONAL_SYSTEM_ADMIN' ||
    user.role_code === 'REGIONAL_COORDINATION_TEAM';

  const runPreview = async (name: string, sheets: string[], rawRows: Record<string, unknown>[]) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const res = await apiRequest<{
        filename: string;
        total_rows: number;
        valid_count: number;
        warning_count: number;
        invalid_count: number;
        protected_count: number;
        preview_rows: ExcelImportPreviewRow[];
      }>(
        '/imports/preview',
        {
          method: 'POST',
          body: JSON.stringify({filename: name, worksheets: sheets, rows: rawRows}),
        },
        token,
      );
      setFilename(res.filename);
      setDetectedSheets(sheets);
      setPreviewRows(res.preview_rows);
      setSummaryCounts({
        total_rows: res.total_rows,
        valid_count: res.valid_count,
        warning_count: res.warning_count,
        invalid_count: res.invalid_count,
        protected_count: res.protected_count,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to validate Excel workbook.');
    } finally {
      setBusy(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setMessage(null);

    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, {type: 'array'});
      const sheets = wb.SheetNames;
      const allRows: Record<string, unknown>[] = [];

      for (const sName of sheets) {
        const lower = sName.toLowerCase();
        // Summary worksheet is an aggregate sheet; Day1-Day6 and Security Affected Areas hold transactional rows
        if (lower === 'summary') continue;
        const sheet = wb.Sheets[sName];
        const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {header: 1, defval: ''});
        const parsed = parseWorksheetRows(sName, matrix);
        allRows.push(...parsed);
      }

      if (allRows.length === 0) {
        setError('No valid reporting rows found across Day1–Day6 or Security Affected Areas sheets.');
        return;
      }

      await runPreview(file.name, sheets, allRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to parse Excel / CSV file.');
    } finally {
      e.target.value = '';
    }
  };

  const handleLoadReferenceDay1Sample = async () => {
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch(
        '/assets/aistudio/Oromia_Region___Round_1_nOPV2_and_bOPV2_SIA_Campaign_Daily_Administrative_Report___November_2026__1__47c4f776.csv',
      );
      const text = await resp.text();
      const wb = XLSX.read(text, {type: 'string'});
      const firstSheet = wb.SheetNames[0];
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[firstSheet], {header: 1, defval: ''});
      const parsed = parseWorksheetRows('Day1', matrix);
      await runPreview(
        'Oromia_Region_Round1_Nov2026_Day1_Reference.csv',
        ['Day1'],
        parsed,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reference CSV.');
      setBusy(false);
    }
  };

  const handleCommitImport = async () => {
    if (previewRows.length === 0) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const hist = await apiRequest<ExcelImportHistoryRecord>(
        '/imports/commit',
        {
          method: 'POST',
          body: JSON.stringify({filename, rows: previewRows}),
        },
        token,
      );
      setMessage(
        `Import committed: ${hist.rows_imported} rows imported, ${hist.rows_skipped_approved} approved reports protected, ${hist.rows_invalid} invalid rows skipped.`,
      );
      setPreviewRows([]);
      setSummaryCounts(null);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to commit Excel import.');
    } finally {
      setBusy(false);
    }
  };

  const filteredPreview = previewRows.filter((r) =>
    statusFilter === 'ALL' ? true : r.validation_status === statusFilter,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">Historical Campaign Workbook Integration</p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Excel Multi-Sheet Import &amp; Pre-Save Validation
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Supports .xlsx, .xls, and .csv workbooks across Day1–Day6, Summary, and Security Affected Areas with Approved-report protection.
          </p>
        </div>

        {canImport && (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <button
              type="button"
              disabled={busy}
              onClick={handleLoadReferenceDay1Sample}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#485EA9] bg-white px-3.5 py-2 text-xs font-bold text-[#485EA9] hover:bg-[#485EA9]/5 cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Preview Attached Day1 CSV
            </button>
            <label className="inline-flex items-center gap-1.5 rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer">
              <Upload className="w-4 h-4" />
              Select Excel / CSV File
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileChange}
                className="hidden"
              />
            </label>
          </div>
        )}
      </div>

      {/* Supported Worksheet Schema Strip */}
      <div className="bg-white border border-slate-200 rounded-lg p-4">
        <div className="text-xs font-bold text-slate-700 mb-2">
          Expected Workbook Worksheets (8 Sheets)
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-xs">
          {TARGET_SHEETS.map((sheet) => {
            const isFound = detectedSheets.some(
              (s) => s.toLowerCase() === sheet.toLowerCase(),
            );
            return (
              <div
                key={sheet}
                className={`border rounded px-2.5 py-2 font-bold text-center ${
                  isFound
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800'
                    : 'border-slate-200 bg-slate-50 text-slate-700'
                }`}
              >
                {sheet}
              </div>
            );
          })}
        </div>
      </div>

      {!canImport && (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-xs font-bold text-amber-900">
          Excel workbook import is restricted to Regional System Administrators and Regional Coordination Team members.
        </div>
      )}

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

      {/* Pre-Commit Preview */}
      {summaryCounts && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Import Validation Preview — {filename}
              </h3>
              <p className="text-xs text-slate-500 mt-0.5 tabular-nums">
                Total Rows: <strong>{summaryCounts.total_rows}</strong> · Valid:{' '}
                <strong className="text-emerald-700">{summaryCounts.valid_count}</strong> · Warnings:{' '}
                <strong className="text-[#D29441]">{summaryCounts.warning_count}</strong> · Invalid:{' '}
                <strong className="text-red-700">{summaryCounts.invalid_count}</strong> · Protected (Approved):{' '}
                <strong className="text-[#485EA9]">{summaryCounts.protected_count}</strong>
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-bold text-slate-700"
              >
                <option value="ALL">All Rows ({summaryCounts.total_rows})</option>
                <option value="Valid">Valid ({summaryCounts.valid_count})</option>
                <option value="Warning">Warnings ({summaryCounts.warning_count})</option>
                <option value="Invalid">Invalid ({summaryCounts.invalid_count})</option>
                <option value="Protected (Approved)">
                  Protected Approved ({summaryCounts.protected_count})
                </option>
              </select>

              <button
                type="button"
                disabled={busy || summaryCounts.valid_count + summaryCounts.warning_count === 0}
                onClick={handleCommitImport}
                className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-4 py-2 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                Commit Valid Rows ({summaryCounts.valid_count + summaryCounts.warning_count})
              </button>
            </div>
          </div>

          <div className="overflow-x-auto max-h-[460px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <tr>
                  <th className="py-2.5 px-3">Row</th>
                  <th className="py-2.5 px-3">Worksheet</th>
                  <th className="py-2.5 px-3">Raw Zone / Woreda (Preserved)</th>
                  <th className="py-2.5 px-3">Matched Unit</th>
                  <th className="py-2.5 px-3 text-right">Planned</th>
                  <th className="py-2.5 px-3 text-right">0–59m Vax</th>
                  <th className="py-2.5 px-3">Validation Status</th>
                  <th className="py-2.5 px-3">Diagnostic Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredPreview.slice(0, 300).map((row, idx) => (
                  <tr key={`${row.worksheet}-${row.row_index}-${idx}`} className="hover:bg-slate-50/70">
                    <td className="py-2 px-3 tabular-nums text-slate-500">{row.row_index}</td>
                    <td className="py-2 px-3 font-mono font-bold text-[#485EA9]">{row.worksheet}</td>
                    <td className="py-2 px-3 text-slate-700">
                      &ldquo;{row.raw_zone}&rdquo; / &ldquo;{row.raw_woreda}&rdquo;
                    </td>
                    <td className="py-2 px-3 font-bold text-slate-900">
                      {row.matched_woreda_name ? `${row.matched_zone_name} · ${row.matched_woreda_name}` : 'Unmatched'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{row.planned_target.toLocaleString()}</td>
                    <td className="py-2 px-3 text-right tabular-nums font-bold">
                      {row.total_vaccinated_0_59m.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-bold whitespace-nowrap">
                      {row.validation_status === 'Valid' && (
                        <span className="inline-flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="w-3.5 h-3.5" /> Valid
                        </span>
                      )}
                      {row.validation_status === 'Warning' && (
                        <span className="inline-flex items-center gap-1 text-[#D29441]">
                          <AlertTriangle className="w-3.5 h-3.5" /> Warning
                        </span>
                      )}
                      {row.validation_status === 'Invalid' && (
                        <span className="text-red-700">Invalid</span>
                      )}
                      {row.validation_status === 'Protected (Approved)' && (
                        <span className="inline-flex items-center gap-1 text-[#485EA9]">
                          <Lock className="w-3.5 h-3.5" /> Protected (Approved)
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-slate-600">
                      {row.issues.length > 0 ? row.issues.join(' | ') : 'Clean match'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Import History */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex items-center gap-2">
          <History className="w-4 h-4 text-[#485EA9]" />
          <h3 className="text-base font-bold text-slate-900">Excel Import Audit History</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">Workbook Filename</th>
                <th className="py-2.5 px-4">Worksheets</th>
                <th className="py-2.5 px-4 text-right">Imported / Total</th>
                <th className="py-2.5 px-4 text-right">Approved Skipped</th>
                <th className="py-2.5 px-4 text-right">Invalid / Dup</th>
                <th className="py-2.5 px-4">Imported By</th>
                <th className="py-2.5 px-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-xs">
              {histories.map((h) => (
                <tr key={h.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-4 tabular-nums text-slate-500">
                    {new Date(h.created_at).toLocaleString()}
                  </td>
                  <td className="py-2.5 px-4 font-bold text-slate-900">{h.filename}</td>
                  <td className="py-2.5 px-4 font-mono text-[#485EA9]">
                    {h.worksheets_detected.join(', ')}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                    {h.rows_imported} / {h.rows_total}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums text-[#485EA9] font-bold">
                    {h.rows_skipped_approved}
                  </td>
                  <td className="py-2.5 px-4 text-right tabular-nums">
                    {h.rows_invalid} / {h.duplicates_detected}
                  </td>
                  <td className="py-2.5 px-4 text-slate-700">{h.imported_by_name}</td>
                  <td className="py-2.5 px-4 font-bold text-emerald-700">{h.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
