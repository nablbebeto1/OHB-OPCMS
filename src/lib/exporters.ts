import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import {formatPctOrNA, safePercent} from './calculations';
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

export type ExportReportType =
  | 'daily_reports'
  | 'six_day_summary'
  | 'region_reports'
  | 'zone_reports'
  | 'woreda_reports'
  | 'vaccine_utilization'
  | 'afp_aefi'
  | 'social_mobilization'
  | 'zero_dose_under_vax'
  | 'team_performance'
  | 'reporting_completeness'
  | 'security_settlements'
  | 'data_quality_validation';

export interface ExportTablePayload {
  title: string;
  subtitle: string;
  filenameBase: string;
  columns: string[];
  rows: (string | number)[][];
}

export const EXPORT_REPORT_DEFINITIONS: {
  id: ExportReportType;
  label: string;
  description: string;
}[] = [
  {
    id: 'daily_reports',
    label: '01. Daily Reports',
    description: 'Day-by-day Woreda vaccination performance, cohorts (0-11m, 12-59m, 60-120m), coverage & workflow status.',
  },
  {
    id: 'six_day_summary',
    label: '02. Six-Day Campaign Summary',
    description: 'Cross-day progression (Day 1 through Day 6) with daily targets, doses administered & cumulative coverage.',
  },
  {
    id: 'region_reports',
    label: '03. Region Reports',
    description: 'Oromia Regional aggregate KPIs across all 28 Zones, 261 Woredas, alerts, teams, and total coverage.',
  },
  {
    id: 'zone_reports',
    label: '04. Zone Reports',
    description: 'Zone-level aggregation of planned targets, daily targets, reporting completeness, and 0-59m coverage.',
  },
  {
    id: 'woreda_reports',
    label: '05. Woreda Reports',
    description: 'Full 261-Woreda master register showing planned targets, daily targets, cumulative vaccinated, and N/A when target=0.',
  },
  {
    id: 'vaccine_utilization',
    label: '06. Vaccine Utilization Reports',
    description: 'nOPV2 & bOPV vial accounting (Received, Used, Partial, Good Return, Broken, Stage 3/4, Lost, Wastage %).',
  },
  {
    id: 'afp_aefi',
    label: '07. AFP & AEFI Surveillance Reports',
    description: 'Active Acute Flaccid Paralysis (AFP) and Adverse Events Following Immunization (AEFI) alerts with remarks.',
  },
  {
    id: 'social_mobilization',
    label: '08. Social Mobilization Reports',
    description: 'Households visited, caregivers reached in community meetings, and home-to-home IPC engagements.',
  },
  {
    id: 'zero_dose_under_vax',
    label: '09. Zero-Dose & Under-Vaccinated Reports',
    description: 'Identified, Linked, and Vaccinated cascades for both Zero-Dose and Under-Vaccinated children.',
  },
  {
    id: 'team_performance',
    label: '10. Team Performance Reports',
    description: 'Planned teams vs teams reported, team reporting rate %, and average children vaccinated per reporting team.',
  },
  {
    id: 'reporting_completeness',
    label: '11. Reporting Completeness Reports',
    description: 'Zone-by-zone expected slots vs submitted, approved, returned, and pending/missing reports.',
  },
  {
    id: 'security_settlements',
    label: '12. Security-Affected Settlement Reports',
    description: 'Isolated settlement-level targets, access status, intervention modalities, and coverage (separate from Woreda totals).',
  },
  {
    id: 'data_quality_validation',
    label: '13. Data Quality & Validation Reports',
    description: 'Report validation warnings, campaign data quality alerts, and workbook formula discrepancy audit records.',
  },
];

function getCohortSum(r: DailyReportRecord, group: '0-11m' | '12-59m' | '60-120m') {
  const item = r.age_groups.find((a) => a.age_group === group);
  return {
    vb: item?.vaccinated_before || 0,
    nv: item?.not_vaccinated_before || 0,
    total: (item?.vaccinated_before || 0) + (item?.not_vaccinated_before || 0),
  };
}

export function buildExportTable(
  type: ExportReportType,
  params: {
    campaign: CampaignRecord | null;
    zones: ZoneRecord[];
    woredas: WoredaRecord[];
    reports: DailyReportRecord[];
    settlements: SecuritySettlementRecord[];
    securityReports: SecurityDailyReportRecord[];
    alerts?: CampaignAlertRecord[];
    discrepancies?: FormulaDiscrepancyRecord[];
    selectedDayId?: string;
    selectedZoneId?: string;
  },
): ExportTablePayload {
  const {
    campaign,
    zones,
    woredas,
    reports,
    settlements,
    securityReports,
    alerts = [],
    discrepancies = [],
    selectedDayId,
    selectedZoneId,
  } = params;
  const scopedWoredas = selectedZoneId ? woredas.filter((w) => w.zone_id === selectedZoneId) : woredas;
  const scopedZones = selectedZoneId ? zones.filter((z) => z.id === selectedZoneId) : zones;
  const scopedReports = reports.filter((r) => {
    if (selectedDayId && selectedDayId !== 'ALL' && r.campaign_day_id !== selectedDayId) return false;
    if (selectedZoneId && r.zone_id !== selectedZoneId) return false;
    return true;
  });
  const campTitle = campaign?.name || '2026 Round 1 nOPV2 & bOPV Campaign';

  switch (type) {
    case 'daily_reports':
      return {
        title: 'OHB Polio Campaign — Daily Vaccination Reports',
        subtitle: campTitle,
        filenameBase: 'ohb_daily_reports',
        columns: [
          'Day',
          'Zone',
          'Woreda',
          'Planned Target',
          'Daily Target',
          '0-11m',
          '12-59m',
          'Total 0-59m',
          '60-120m',
          'Daily Cov %',
          'Cumulative Cov %',
          'Teams Rep / Tot',
          'Status',
        ],
        rows: scopedReports.map((r) => [
          r.day_label,
          r.zone_name,
          r.woreda_name,
          r.total_planned_target,
          r.daily_target,
          getCohortSum(r, '0-11m').total,
          getCohortSum(r, '12-59m').total,
          r.total_vaccinated_0_59m,
          r.total_vaccinated_60_120m,
          formatPctOrNA(r.daily_coverage_pct),
          formatPctOrNA(r.cumulative_coverage_pct),
          `${r.teams_reported}/${r.total_teams}`,
          r.status,
        ]),
      };

    case 'six_day_summary': {
      const days = campaign?.days || [];
      const totalPlanned = scopedWoredas.reduce((s, w) => s + w.total_planned_target, 0);
      const totalDaily = scopedWoredas.reduce((s, w) => s + w.daily_target, 0);
      let runningCum = 0;
      return {
        title: 'OHB Polio Campaign — Six-Day Campaign Summary (Day 1–Day 6)',
        subtitle: campTitle,
        filenameBase: 'ohb_six_day_summary',
        columns: [
          'Day',
          'Phase',
          'Date',
          'Reports Submitted/Approved',
          'Daily Target',
          '0-59m Vaccinated',
          '60-120m Vaccinated',
          'Daily Cov %',
          'Cumulative 0-59m',
          'Cumulative Cov %',
          'AFP Alerts',
          'AEFI Alerts',
        ],
        rows: days.map((d) => {
          const dayReps = reports.filter(
            (r) => r.campaign_day_id === d.id && (!selectedZoneId || r.zone_id === selectedZoneId),
          );
          const v059 = dayReps.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
          const v60120 = dayReps.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);
          runningCum += v059;
          return [
            d.label,
            d.day_type,
            d.campaign_date,
            dayReps.filter((r) => r.status !== 'Draft').length,
            totalDaily,
            v059,
            v60120,
            formatPctOrNA(safePercent(v059, totalDaily)),
            runningCum,
            formatPctOrNA(safePercent(runningCum, totalPlanned)),
            dayReps.reduce((s, r) => s + r.afp_alerts_count, 0),
            dayReps.reduce((s, r) => s + r.aefi_alerts_count, 0),
          ];
        }),
      };
    }

    case 'region_reports': {
      const planned = woredas.reduce((s, w) => s + w.total_planned_target, 0);
      const daily = woredas.reduce((s, w) => s + w.daily_target, 0);
      const v059 = reports.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
      const v60120 = reports.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);
      return {
        title: 'OHB Polio Campaign — Oromia Regional Aggregate Report',
        subtitle: campTitle,
        filenameBase: 'ohb_region_report',
        columns: [
          'Region',
          'Zones',
          'Woredas',
          'Planned Target',
          'Daily Target',
          '0-59m Vaccinated',
          '60-120m Vaccinated',
          'Daily Cov %',
          'Cumulative Cov %',
          'AFP Alerts',
          'AEFI Alerts',
          'Reports Approved',
        ],
        rows: [
          [
            'Oromia',
            zones.length,
            woredas.length,
            planned,
            daily,
            v059,
            v60120,
            formatPctOrNA(safePercent(v059, daily)),
            formatPctOrNA(safePercent(v059, planned)),
            reports.reduce((s, r) => s + r.afp_alerts_count, 0),
            reports.reduce((s, r) => s + r.aefi_alerts_count, 0),
            reports.filter((r) => r.status === 'Approved').length,
          ],
        ],
      };
    }

    case 'zone_reports':
      return {
        title: 'OHB Polio Campaign — Zonal Administrative Summary Report',
        subtitle: campTitle,
        filenameBase: 'ohb_zone_reports',
        columns: [
          'Zone / Town',
          'Type',
          'Woredas',
          'Planned Target',
          'Daily Target',
          '0-59m Vaccinated',
          '60-120m Vaccinated',
          'Daily Cov %',
          'Total Cov %',
          'Reports Submitted/Approved',
          'Approved',
        ],
        rows: scopedZones.map((z) => {
          const zw = woredas.filter((w) => w.zone_id === z.id);
          const zr = scopedReports.filter((r) => r.zone_id === z.id);
          const planned = zw.reduce((s, w) => s + w.total_planned_target, 0);
          const daily = zw.reduce((s, w) => s + w.daily_target, 0);
          const v059 = zr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
          const v60120 = zr.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);
          return [
            z.name,
            z.zone_type,
            zw.length,
            planned,
            daily,
            v059,
            v60120,
            formatPctOrNA(safePercent(v059, daily)),
            formatPctOrNA(safePercent(v059, planned)),
            zr.filter((r) => r.status !== 'Draft').length,
            zr.filter((r) => r.status === 'Approved').length,
          ];
        }),
      };

    case 'woreda_reports':
      return {
        title: 'OHB Polio Campaign — Woreda Master Performance Report',
        subtitle: campTitle,
        filenameBase: 'ohb_woreda_reports',
        columns: [
          'S/N',
          'Unit Code',
          'Zone',
          'Woreda',
          'Planned Target',
          'Daily Target',
          'Cumulative 0-59m',
          'Cumulative 60-120m',
          'Cumulative Cov %',
          'Reports Filed',
          'Approved Reports',
        ],
        rows: scopedWoredas.map((w) => {
          const wr = scopedReports.filter((r) => r.woreda_id === w.id);
          const cum059 = wr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
          const cum60120 = wr.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);
          return [
            w.source_sn ?? '-',
            w.reporting_unit_code,
            w.zone_name,
            w.name,
            w.total_planned_target,
            w.daily_target,
            cum059,
            cum60120,
            formatPctOrNA(safePercent(cum059, w.total_planned_target)),
            wr.length,
            wr.filter((r) => r.status === 'Approved').length,
          ];
        }),
      };

    case 'vaccine_utilization': {
      const rows: (string | number)[][] = [];
      for (const r of scopedReports) {
        for (const v of r.vaccine_utilizations) {
          rows.push([
            r.day_label,
            r.zone_name,
            r.woreda_name,
            v.vaccine_type,
            v.vials_received,
            v.vials_used,
            v.vials_partially_used,
            v.vials_returned_unused_good,
            v.vials_broken,
            v.vials_returned_bad_stage_3_4,
            v.vials_lost,
            formatPctOrNA(v.wastage_rate_pct),
          ]);
        }
      }
      return {
        title: 'OHB Polio Campaign — nOPV2 & bOPV Vaccine Utilization Report',
        subtitle: campTitle,
        filenameBase: 'ohb_vaccine_utilization',
        columns: [
          'Day',
          'Zone',
          'Woreda',
          'Vaccine',
          'Received',
          'Used',
          'Partial',
          'Ret. Good',
          'Broken',
          'Ret. Bad (Stg 3/4)',
          'Lost',
          'Wastage %',
        ],
        rows,
      };
    }

    case 'afp_aefi':
      return {
        title: 'OHB Polio Campaign — AFP & AEFI Surveillance Alerts Report',
        subtitle: campTitle,
        filenameBase: 'ohb_afp_aefi_alerts',
        columns: [
          'Day',
          'Zone',
          'Woreda',
          'AFP Alerts',
          'AEFI Alerts',
          'Total Alerts',
          '0-59m Vaccinated',
          'Status',
          'Remarks',
        ],
        rows: scopedReports
          .filter((r) => r.afp_alerts_count > 0 || r.aefi_alerts_count > 0 || r.any_remark)
          .map((r) => [
            r.day_label,
            r.zone_name,
            r.woreda_name,
            r.afp_alerts_count,
            r.aefi_alerts_count,
            r.afp_alerts_count + r.aefi_alerts_count,
            r.total_vaccinated_0_59m,
            r.status,
            r.any_remark || '-',
          ]),
      };

    case 'social_mobilization':
      return {
        title: 'OHB Polio Campaign — Social Mobilization & IPC Report',
        subtitle: campTitle,
        filenameBase: 'ohb_social_mobilization',
        columns: [
          'Day',
          'Zone',
          'Woreda',
          'HHs Visited',
          'Caregivers (Community Meetings)',
          'Caregivers (Home-to-Home IPC)',
          'Total Caregivers Reached',
          'Status',
        ],
        rows: scopedReports.map((r) => [
          r.day_label,
          r.zone_name,
          r.woreda_name,
          r.hhs_visited,
          r.community_meeting_participants,
          r.home_to_home_ipc_reached,
          r.community_meeting_participants + r.home_to_home_ipc_reached,
          r.status,
        ]),
      };

    case 'zero_dose_under_vax':
      return {
        title: 'OHB Polio Campaign — Zero-Dose & Under-Vaccinated Cascade Report',
        subtitle: campTitle,
        filenameBase: 'ohb_zero_dose_under_vaccinated',
        columns: [
          'Day',
          'Zone',
          'Woreda',
          'ZD Identified',
          'ZD Linked',
          'ZD Vaccinated',
          'ZD Vax Rate %',
          'UV Identified',
          'UV Linked',
          'UV Vaccinated',
          'UV Vax Rate %',
        ],
        rows: scopedReports.map((r) => [
          r.day_label,
          r.zone_name,
          r.woreda_name,
          r.zero_dose_identified,
          r.zero_dose_linked,
          r.zero_dose_vaccinated,
          formatPctOrNA(safePercent(r.zero_dose_vaccinated, r.zero_dose_identified)),
          r.under_vaccinated_identified,
          r.under_vaccinated_linked,
          r.under_vaccinated_vaccinated,
          formatPctOrNA(safePercent(r.under_vaccinated_vaccinated, r.under_vaccinated_identified)),
        ]),
      };

    case 'security_settlements': {
      const filteredSettle = selectedZoneId
        ? settlements.filter((s) => s.zone_id === selectedZoneId)
        : settlements;
      return {
        title: 'OHB Polio Campaign — Security-Affected Settlement Report (Isolated)',
        subtitle: `${campTitle} — Excluded from regular Woreda totals to prevent double counting`,
        filenameBase: 'ohb_security_settlements',
        columns: [
          'Zone',
          'Woreda',
          'Settlement',
          'Kebele',
          'Access Status',
          'Intervention Modality',
          'Planned Target (0-59m)',
          'Daily Target',
          'Cumulative Vaccinated',
          'Cumulative Cov %',
          'Daily Reports Filed',
        ],
        rows: filteredSettle.map((s) => {
          const sr = securityReports.filter((r) => r.settlement_id === s.id);
          return [
            s.zone_name,
            s.woreda_name,
            s.settlement_name,
            s.kebele_name,
            s.access_status,
            s.intervention_modality,
            s.target_children_0_59m,
            s.daily_target_0_59m,
            s.vaccinated_children_0_59m,
            formatPctOrNA(safePercent(s.vaccinated_children_0_59m, s.target_children_0_59m)),
            sr.length,
          ];
        }),
      };
    }

    case 'team_performance':
      return {
        title: 'OHB Polio Campaign — Team Deployment & Productivity Report',
        subtitle: campTitle,
        filenameBase: 'ohb_team_performance',
        columns: [
          'Day',
          'Zone',
          'Woreda',
          'Total Teams',
          'Teams Reported',
          'Team Reporting %',
          '0-59m Vaccinated',
          'Avg Vaccinated / Team',
          'Status',
        ],
        rows: scopedReports.map((r) => [
          r.day_label,
          r.zone_name,
          r.woreda_name,
          r.total_teams,
          r.teams_reported,
          formatPctOrNA(safePercent(r.teams_reported, r.total_teams)),
          r.total_vaccinated_0_59m,
          r.teams_reported > 0 ? Math.round((r.total_vaccinated_0_59m / r.teams_reported) * 10) / 10 : 'N/A',
          r.status,
        ]),
      };

    case 'reporting_completeness': {
      const openDays = Math.max(1, campaign?.days.filter((d) => d.is_open_for_reporting).length || 1);
      const daySlots = selectedDayId && selectedDayId !== 'ALL' ? 1 : openDays;
      return {
        title: 'OHB Polio Campaign — Reporting Completeness & Submission Compliance',
        subtitle: campTitle,
        filenameBase: 'ohb_reporting_completeness',
        columns: [
          'Zone / Town',
          'Woredas',
          'Expected Reports',
          'Submitted / Approved',
          'Approved (Locked)',
          'Returned',
          'Missing / Draft',
          'Completeness %',
        ],
        rows: scopedZones.map((z) => {
          const zw = woredas.filter((w) => w.zone_id === z.id);
          const zr = scopedReports.filter((r) => r.zone_id === z.id);
          const expected = zw.length * daySlots;
          const submitted = zr.filter((r) => r.status !== 'Draft').length;
          const approved = zr.filter((r) => r.status === 'Approved').length;
          const returned = zr.filter((r) => r.status === 'Returned for Correction').length;
          const missing = Math.max(0, expected - submitted);
          return [
            z.name,
            zw.length,
            expected,
            submitted,
            approved,
            returned,
            missing,
            formatPctOrNA(safePercent(submitted, expected)),
          ];
        }),
      };
    }

    case 'data_quality_validation': {
      const rows: (string | number)[][] = [];
      for (const r of scopedReports) {
        const warns = r.validation_warnings || [];
        if (warns.length > 0 || r.status === 'Returned for Correction') {
          rows.push([
            'Daily Report Validation',
            r.day_label,
            `${r.zone_name} · ${r.woreda_name}`,
            r.status,
            warns.length > 0 ? warns.join(' | ') : 'Returned for Correction by supervisor',
            r.updated_at,
          ]);
        }
      }
      for (const d of discrepancies) {
        rows.push([
          'Workbook Formula Audit',
          d.worksheet,
          d.cell_or_column,
          `${d.severity} · ${d.ohb_approval_status}`,
          `${d.title} (Observed: ${d.observed_value}, Expected: ${d.expected_value})`,
          d.updated_at,
        ]);
      }
      for (const a of alerts.filter((al) => al.resolution_status !== 'Resolved').slice(0, 100)) {
        rows.push([
          'Automated Alert Engine',
          a.day_label || '-',
          a.admin_location,
          `${a.priority} · ${a.resolution_status}`,
          `${a.alert_type}: ${a.description}`,
          a.detected_at,
        ]);
      }
      return {
        title: 'OHB Polio Campaign — Data Quality, Validation & Formula Audit Report',
        subtitle: campTitle,
        filenameBase: 'ohb_data_quality_validation',
        columns: [
          'Source Check',
          'Day / Sheet',
          'Location / Cell',
          'Severity / Status',
          'Validation Finding',
          'Timestamp',
        ],
        rows,
      };
    }
  }
}

export function exportTableToCSV(payload: ExportTablePayload) {
  const escape = (val: string | number) => {
    const s = String(val ?? '');
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [
    payload.columns.map(escape).join(','),
    ...payload.rows.map((r) => r.map(escape).join(',')),
  ];
  const blob = new Blob([`\uFEFF${lines.join('\n')}`], {type: 'text/csv;charset=utf-8;'});
  triggerDownload(blob, `${payload.filenameBase}.csv`);
}

export function exportTableToExcel(payload: ExportTablePayload) {
  const wb = XLSX.utils.book_new();
  const sheetData = [
    [payload.title],
    [payload.subtitle],
    [`Generated: ${new Date().toISOString()}`],
    [],
    payload.columns,
    ...payload.rows,
  ];
  const ws = XLSX.utils.aoa_to_sheet(sheetData);
  XLSX.utils.book_append_sheet(wb, ws, 'OHB_Report');
  XLSX.writeFile(wb, `${payload.filenameBase}.xlsx`);
}

export function exportTableToPDF(payload: ExportTablePayload) {
  const doc = new jsPDF({orientation: 'landscape', unit: 'pt', format: 'a4'});
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(72, 94, 169); // OHB Deep Blue #485EA9
  doc.text(payload.title, 36, 36);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80, 90, 105);
  doc.text(`${payload.subtitle} | Generated: ${new Date().toLocaleString()}`, 36, 52);

  autoTable(doc, {
    startY: 64,
    head: [payload.columns],
    body: payload.rows.map((r) => r.map((c) => String(c))),
    styles: {fontSize: 7.5, cellPadding: 4},
    headStyles: {fillColor: [58, 153, 207], textColor: 255, fontStyle: 'bold'}, // OHB Blue #3A99CF
    alternateRowStyles: {fillColor: [248, 250, 252]},
    margin: {left: 36, right: 36},
  });

  doc.save(`${payload.filenameBase}.pdf`);
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
