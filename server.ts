import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express, {NextFunction, Request, Response} from 'express';
import {createServer as createViteServer} from 'vite';
import type {
  AlertPriority,
  AlertType,
  AuditLogRecord,
  CalculationConfigRecord,
  CampaignAlertRecord,
  CampaignRecord,
  CommandDisplaySessionRecord,
  CommandRoomSnapshot,
  CommandRoomVaccineSummary,
  DailyReportRecord,
  ExcelImportHistoryRecord,
  ExcelImportPreviewRow,
  FormulaDiscrepancyRecord,
  GisBoundaryLayerRecord,
  NotificationDispatchLogRecord,
  NotificationProviderConfig,
  NotificationRecord,
  PerformanceThresholdConfig,
  RealtimeSyncTelemetry,
  ReportStatus,
  RoleCode,
  RoleDefinition,
  SecurityDailyReportRecord,
  SecuritySettlementRecord,
  UserProfile,
  WoredaRecord,
  ZoneRecord,
} from './src/types/opcms.ts';
import {
  computeVaccinationTotals,
  computeWastageRatePct,
  safePercent,
  validateDailyReportData,
} from './src/lib/calculations.ts';

dotenv.config();

const PORT = Number(process.env.PORT || 3000);
const JWT_SECRET = process.env.JWT_SECRET_KEY || 'opcms-dev-secret-change-in-production';
const CSV_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/Oromia_Region___Round_1_nOPV2_and_bOPV2_SIA_Campaign_Daily_Administrative_Report___November_2026__1__47c4f776.csv',
);
const DB_FILE = path.resolve(process.cwd(), '.opcms-runtime-db.json');

const ZONE_COORDS: Record<string, [number, number, 'Zone' | 'Town' | 'City']> = {
  'Adama City': [8.54, 39.27, 'City'],
  'Agaro Town': [7.85, 36.65, 'Town'],
  AmboTown: [8.9833, 37.85, 'Town'],
  'Arsi Zone': [7.95, 39.1333, 'Zone'],
  Asella: [7.95, 39.1333, 'Town'],
  'Batu Town': [7.9333, 38.7167, 'Town'],
  'Bishoftu City': [8.75, 38.9833, 'City'],
  'Buno Bedele': [8.45, 36.35, 'Zone'],
  'Dodola Town': [6.9833, 39.1833, 'Town'],
  'East Shewa': [8.55, 39.25, 'Zone'],
  'East Wollega': [9.0833, 36.55, 'Zone'],
  Guji: [5.8833, 38.9833, 'Zone'],
  'Holeta town': [9.0667, 38.5, 'Town'],
  'Horro Guduru Wallaga': [9.5667, 37.1, 'Zone'],
  'Jimma Town': [7.6667, 36.8333, 'Town'],
  'Jimma Zone': [7.68, 36.84, 'Zone'],
  'Modjo Town': [8.5833, 39.1167, 'Town'],
  'Nekemte Town': [9.0833, 36.55, 'Town'],
  'North shoa': [9.8, 38.7333, 'Zone'],
  'Sendafa Beke Town': [9.15, 39.0333, 'Town'],
  'Shaggar City': [9.01, 38.68, 'City'],
  'Shakiso Town': [5.7667, 38.9167, 'Town'],
  'Shashemene City': [7.2, 38.6, 'City'],
  'Sheno Town': [9.3333, 39.3, 'Town'],
  'West Arsi': [7.1833, 38.6167, 'Zone'],
  'West Shewa': [8.98, 37.86, 'Zone'],
  'Woliso Town': [8.5333, 37.9667, 'Town'],
  'south West Shewa': [8.53, 37.98, 'Zone'],
};

interface StoredUser extends UserProfile {
  password_hash: string;
}

interface CommandDisplaySessionStored extends CommandDisplaySessionRecord {
  token_hash: string;
}

interface RuntimeDatabase {
  region: {id: string; code: string; name: string};
  roles: RoleDefinition[];
  users: StoredUser[];
  zones: ZoneRecord[];
  woredas: WoredaRecord[];
  campaigns: CampaignRecord[];
  calculation_configs: CalculationConfigRecord[];
  reports: DailyReportRecord[];
  discrepancies: FormulaDiscrepancyRecord[];
  security_settlements: SecuritySettlementRecord[];
  security_reports: SecurityDailyReportRecord[];
  import_histories: ExcelImportHistoryRecord[];
  audit_logs: AuditLogRecord[];
  notifications: NotificationRecord[];
  alerts: CampaignAlertRecord[];
  thresholds: PerformanceThresholdConfig;
  gis_layers: GisBoundaryLayerRecord[];
  notification_providers: NotificationProviderConfig[];
  dispatch_logs: NotificationDispatchLogRecord[];
  display_sessions: CommandDisplaySessionStored[];
  processed_client_report_ids: Record<string, string>;
  realtime_meta: {
    last_server_event_at: string;
    last_report_received: RealtimeSyncTelemetry['last_report_received'];
  };
  template_summary: {
    template_reported_planned_target: number;
    template_reported_daily_target: number;
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${derived}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, expectedHex] = stored.split(':');
  if (!salt || !expectedHex) return false;
  const actual = crypto.scryptSync(password, salt, 32);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function signToken(payload: {sub: string; role: RoleCode; exp: number}): string {
  const header = Buffer.from(JSON.stringify({alg: 'HS256', typ: 'JWT'})).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

function verifyToken(token: string): {sub: string; role: RoleCode; exp: number} | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64url');
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function parseCSV(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    const next = content[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        row.push(field);
        field = '';
      } else if (ch === '\r' && next === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
      } else if (ch === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += ch;
      }
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseNum(val: string | undefined): number {
  const cleaned = (val || '').replace(/,/g, '').trim();
  const n = Number.parseInt(cleaned, 10);
  return Number.isFinite(n) ? n : 0;
}

function seedDatabaseFromCSV(): RuntimeDatabase {
  const rawCsv = fs.readFileSync(CSV_PATH, 'utf8').replace(/^\uFEFF/, '');
  const rows = parseCSV(rawCsv);

  const region = {
    id: 'reg-oromia-01',
    code: 'OR',
    name: 'Oromia',
  };

  const dataRows = rows.slice(4, 265).filter((r) => r.length >= 7 && /^\d+$/.test((r[0] || '').trim()));
  const totalsRow = rows[265] || [];
  const templatePlannedTotal = parseNum(totalsRow[5]);
  const templateDailyTotal = parseNum(totalsRow[6]);

  const pairCounts = new Map<string, number>();
  for (const r of dataRows) {
    const key = `${r[2].trim()}||${r[3].trim()}`;
    pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
  }

  const zonesMap = new Map<string, ZoneRecord>();
  const woredas: WoredaRecord[] = [];
  const unitCounter = new Map<string, number>();
  const whitespaceIssues: string[] = [];

  let computedPlannedTotal = 0;
  let computedDailyTotal = 0;

  for (const r of dataRows) {
    const sn = parseNum(r[0]);
    const rawRegion = r[1] || '';
    const rawZone = r[2] || '';
    const rawWoreda = r[3] || '';
    const zoneName = rawZone.trim();
    const woredaName = rawWoreda.trim();

    if (rawRegion !== rawRegion.trim() || rawZone !== zoneName || rawWoreda !== woredaName) {
      whitespaceIssues.push(`S/N ${sn}: ('${rawZone}', '${rawWoreda}')`);
    }

    const planned = parseNum(r[5]);
    const daily = parseNum(r[6]);
    computedPlannedTotal += planned;
    computedDailyTotal += daily;

    const normZone = zoneName.toLowerCase();
    let zone = zonesMap.get(normZone);
    if (!zone) {
      const coords = ZONE_COORDS[zoneName] || [8.5, 38.8, 'Zone'];
      const code = zoneName.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
      zone = {
        id: `zone-${code.toLowerCase()}`,
        region_id: region.id,
        code,
        name: zoneName,
        normalized_name: normZone,
        zone_type: coords[2],
        latitude: coords[0],
        longitude: coords[1],
        is_active: true,
      };
      zonesMap.set(normZone, zone);
    }

    const wKey = `${zone.code}-${woredaName.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
    const nextIdx = (unitCounter.get(wKey) || 0) + 1;
    unitCounter.set(wKey, nextIdx);
    const unitCode = `${wKey}-${String(nextIdx).padStart(2, '0')}`;

    woredas.push({
      id: `woreda-${String(sn).padStart(3, '0')}`,
      zone_id: zone.id,
      zone_name: zone.name,
      reporting_unit_code: unitCode,
      source_sn: sn,
      name: woredaName,
      raw_excel_name: rawWoreda,
      is_duplicate_in_template: (pairCounts.get(`${zoneName}||${woredaName}`) || 0) > 1,
      has_security_constraints: ['Guji', 'East Wollega', 'Horro Guduru Wallaga', 'West Shewa'].includes(zoneName),
      total_planned_target: planned,
      daily_target: daily,
      is_active: true,
    });
  }

  const zones = Array.from(zonesMap.values()).sort((a, b) => a.name.localeCompare(b.name));

  const roles: RoleDefinition[] = [
    {
      code: 'REGIONAL_SYSTEM_ADMIN',
      name: 'Regional System Administrator',
      description: 'Full regional governance: user & role management, administrative hierarchy CRUD, campaign configuration, discrepancy resolution, and reopening locked reports.',
      is_read_only: false,
      permissions: ['hierarchy:read', 'hierarchy:write', 'campaign:read', 'campaign:write', 'report:read', 'report:write', 'report:submit', 'report:review', 'report:approve', 'report:reopen', 'audit:read', 'users:manage'],
    },
    {
      code: 'REGIONAL_COORDINATION_TEAM',
      name: 'Regional Coordination Team',
      description: 'Regional monitoring, reviewing and approving/returning daily reports across Oromia, campaign schedule control, and workbook formula approval.',
      is_read_only: false,
      permissions: ['hierarchy:read', 'campaign:read', 'campaign:write', 'report:read', 'report:review', 'report:approve', 'audit:read'],
    },
    {
      code: 'ZONE_ADMIN',
      name: 'Zone Administrator',
      description: 'Zone-scoped operational oversight: inspect woredas, review, approve, or return woreda daily reports strictly within assigned Zone.',
      is_read_only: false,
      permissions: ['hierarchy:read', 'campaign:read', 'report:read', 'report:review', 'report:approve'],
    },
    {
      code: 'WOREDA_REPORTING_OFFICER',
      name: 'Woreda Reporting Officer',
      description: 'Woreda-scoped daily data entry: create Draft reports, save offline, submit for review, and revise Returned reports for assigned Woreda.',
      is_read_only: false,
      permissions: ['hierarchy:read', 'campaign:read', 'report:read', 'report:write', 'report:submit'],
    },
    {
      code: 'MONITORING_OFFICER',
      name: 'Monitoring Officer',
      description: 'Strictly read-only independent monitoring access to dashboards, campaign targets, submitted reports, and audit trails.',
      is_read_only: true,
      permissions: ['hierarchy:read', 'campaign:read', 'report:read', 'audit:read'],
    },
  ];

  const eastShewa = zones.find((z) => z.name === 'East Shewa') || zones[0];
  const adama = woredas.find((w) => w.name === 'Adama' && w.zone_id === eastShewa.id) || woredas[0];
  const defaultHash = hashPassword('OhbPolio@2026');

  const users: StoredUser[] = [
    {
      id: 'usr-admin-01',
      username: 'admin.ohb',
      email: 'admin@ohb.gov.et',
      full_name: 'Dr. Bekele Tadesse',
      role_code: 'REGIONAL_SYSTEM_ADMIN',
      role_name: 'Regional System Administrator',
      is_read_only: false,
      region_id: region.id,
      zone_id: null,
      woreda_id: null,
      zone_name: null,
      woreda_name: null,
      is_active: true,
      last_login_at: null,
      password_hash: defaultHash,
    },
    {
      id: 'usr-coord-01',
      username: 'coord.ohb',
      email: 'coordination@ohb.gov.et',
      full_name: 'Chaltu Gemechu',
      role_code: 'REGIONAL_COORDINATION_TEAM',
      role_name: 'Regional Coordination Team',
      is_read_only: false,
      region_id: region.id,
      zone_id: null,
      woreda_id: null,
      zone_name: null,
      woreda_name: null,
      is_active: true,
      last_login_at: null,
      password_hash: defaultHash,
    },
    {
      id: 'usr-zone-01',
      username: 'zone.eastshewa',
      email: 'eastshewa@ohb.gov.et',
      full_name: 'Tolera Merga',
      role_code: 'ZONE_ADMIN',
      role_name: 'Zone Administrator',
      is_read_only: false,
      region_id: region.id,
      zone_id: eastShewa.id,
      woreda_id: null,
      zone_name: eastShewa.name,
      woreda_name: null,
      is_active: true,
      last_login_at: null,
      password_hash: defaultHash,
    },
    {
      id: 'usr-woreda-01',
      username: 'woreda.adama',
      email: 'adama.officer@ohb.gov.et',
      full_name: 'Bontu Alemu',
      role_code: 'WOREDA_REPORTING_OFFICER',
      role_name: 'Woreda Reporting Officer',
      is_read_only: false,
      region_id: region.id,
      zone_id: eastShewa.id,
      woreda_id: adama.id,
      zone_name: eastShewa.name,
      woreda_name: adama.name,
      is_active: true,
      last_login_at: null,
      password_hash: defaultHash,
    },
    {
      id: 'usr-monitor-01',
      username: 'monitor.ohb',
      email: 'monitor@ohb.gov.et',
      full_name: 'Dawit Negash',
      role_code: 'MONITORING_OFFICER',
      role_name: 'Monitoring Officer',
      is_read_only: true,
      region_id: region.id,
      zone_id: null,
      woreda_id: null,
      zone_name: null,
      woreda_name: null,
      is_active: true,
      last_login_at: null,
      password_hash: defaultHash,
    },
  ];

  const campaign: CampaignRecord = {
    id: 'camp-2026-r1',
    code: 'OR-2026-R1-NOPV2-BOPV',
    name: '2026 Round 1 nOPV2 and bOPV Co-administration Campaign',
    round_number: 1,
    vaccine_types: 'nOPV2 + bOPV Co-administration',
    nopv2_doses_per_vial: 50,
    bopv_doses_per_vial: 20,
    core_target_days_divisor: 4,
    total_campaign_days: 6,
    start_date: '2026-11-20',
    end_date: '2026-11-25',
    status: 'Active',
    days: [1, 2, 3, 4, 5, 6].map((d) => ({
      id: `day-${d}`,
      campaign_id: 'camp-2026-r1',
      day_number: d,
      label: `Day ${d}`,
      worksheet_name: `Day${d}`,
      day_type: d <= 4 ? 'Core' : 'Mop-Up',
      campaign_date: `2026-11-${String(19 + d).padStart(2, '0')}`,
      is_open_for_reporting: d === 1,
    })),
  };

  const nowIso = new Date().toISOString();
  const discrepancies: FormulaDiscrepancyRecord[] = [
    {
      id: 'disc-01',
      worksheet: 'Day1',
      cell_or_column: 'Row 266 / Col F (Total Planned Target)',
      severity: 'Critical',
      title: 'Regional Total Planned Target Formula Truncation',
      observed_value: `${templatePlannedTotal.toLocaleString()}`,
      expected_value: `${computedPlannedTotal.toLocaleString()} (exact sum of 261 Woredas)`,
      recommendation: 'Replace truncated Excel SUM formula with dynamic aggregation across all 261 Woredas and confirm 7,580,915 as regional denominator.',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
    {
      id: 'disc-02',
      worksheet: 'Day1',
      cell_or_column: 'Row 266 / Col G (Daily Target)',
      severity: 'Medium',
      title: 'Daily Target Rounding Drift Between Row Sum and Regional Division',
      observed_value: `${templateDailyTotal.toLocaleString()} (round(Planned Total / 4))`,
      expected_value: `${computedDailyTotal.toLocaleString()} (sum of rounded Woreda Daily Targets)`,
      recommendation: 'Decide whether regional daily target equals sum of rounded Woreda daily targets (1,895,263) or round(7,580,915 / 4) (1,895,229).',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
    {
      id: 'disc-03',
      worksheet: 'Day1 - Day6',
      cell_or_column: 'Col E & Col G (Campaign Date / Daily Target)',
      severity: 'High',
      title: '4-Day Target Divisor vs. 6 Daily Worksheets',
      observed_value: 'Col E header specifies (1st,2nd,3rd, 4th) and Daily Target = round(Planned/4)',
      expected_value: 'Workbook structure contains 6 daily sheets (Day1 through Day6)',
      recommendation: 'Confirm Days 1-4 represent core 25% daily targets and Days 5-6 operate as Mop-Up / Catch-Up days.',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
    {
      id: 'disc-04',
      worksheet: 'Day1',
      cell_or_column: 'Cols L-P (60-120 m vs Total vaccinated 0-59 m)',
      severity: 'High',
      title: '60-120 m Age Cohort Excluded from Total Vaccinated 0-59 m & Coverage %',
      observed_value: '60-120m (Vaccinated before / Not vaccinated before) sits alongside 0-11m and 12-59m; Col N sums 0-59m only',
      expected_value: 'Explicit separation of 0-59m SIA denominator from 60-120m co-tracked cohort',
      recommendation: 'Keep Total vaccinated 0-59 m (Col N) strictly for 0-11m + 12-59m coverage %, while tracking 60-120m independently.',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
    {
      id: 'disc-05',
      worksheet: 'Day1',
      cell_or_column: 'Cols C-D (Zone / Woreda)',
      severity: 'High',
      title: 'Duplicate (Zone, Woreda) Entries with Distinct Targets',
      observed_value: 'Jimma Town (121,871 & 43,934); Asella (88,943 & 39,690); Modjo Town/Modjo (29,903 & 38,384)',
      expected_value: 'Unique reporting unit code per Woreda / Sub-city',
      recommendation: 'Preserve separate reporting_unit_code entries until OHB confirms urban sub-division vs duplicate row status.',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
    {
      id: 'disc-06',
      worksheet: 'Day1',
      cell_or_column: 'Cols X & AF (nOPV2 & bOPV Vaccine wastage rate %)',
      severity: 'Medium',
      title: 'Vaccine Wastage Rate Denominator & Partial Vial Accounting',
      observed_value: 'Template displays 0% without explicit formula documentation for partial vs used vials',
      expected_value: 'Standard WHO/EPI wastage formula with nOPV2 (50 doses/vial) and bOPV (20 doses/vial)',
      recommendation: 'Confirm whether partially used vials are counted inside vials_used when computing wastage percentage.',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
    {
      id: 'disc-07',
      worksheet: 'Day1',
      cell_or_column: 'Cols B-D & Headers',
      severity: 'Low',
      title: 'Trailing Whitespace, Inconsistent Casing & Header Typos',
      observed_value: `${whitespaceIssues.join(', ')}; 'AmboTown', 'North shoa', 'south West Shewa', 'recieved', 'Coverd'`,
      expected_value: 'Normalized Oromia administrative names & clean labels',
      recommendation: 'Normalize whitespace in OPCMS while storing raw_excel_name for lossless Excel re-import.',
      ohb_approval_status: 'Pending OHB Review',
      resolution_notes: null,
      updated_at: nowIso,
    },
  ];

  const gujiWoreda = woredas.find((w) => w.zone_name === 'Guji') || woredas[0];
  const ewWoreda = woredas.find((w) => w.zone_name === 'East Wollega') || woredas[1];

  const security_settlements: SecuritySettlementRecord[] = [
    {
      id: 'sec-01',
      woreda_id: gujiWoreda.id,
      woreda_name: gujiWoreda.name,
      zone_id: gujiWoreda.zone_id,
      zone_name: gujiWoreda.zone_name,
      settlement_name: 'Haro Adi Buffer Settlement',
      kebele_name: 'Haro Adi',
      access_status: 'Partially Accessible',
      intervention_modality: 'Hit-and-Run / Transit Point',
      target_children_0_59m: 1240,
      daily_target_0_59m: 310,
      vaccinated_children_0_59m: 0,
      security_notes: 'Tracked separately from regular Woreda administrative totals to prevent double counting.',
    },
    {
      id: 'sec-02',
      woreda_id: ewWoreda.id,
      woreda_name: ewWoreda.name,
      zone_id: ewWoreda.zone_id,
      zone_name: ewWoreda.zone_name,
      settlement_name: 'Gida Border Pocket',
      kebele_name: 'Kiremu Border Kebele',
      access_status: 'Inaccessible',
      intervention_modality: 'Local Negotiator / Buffer Zone',
      target_children_0_59m: 880,
      daily_target_0_59m: 220,
      vaccinated_children_0_59m: 0,
      security_notes: 'Awaiting security corridor verification or Excel Security Affected Areas sheet import.',
    },
  ];

  const calculation_configs: CalculationConfigRecord[] = [
    {
      id: 'calc-v1',
      campaign_id: campaign.id,
      version: 'v1.0.0',
      name: 'OHB Baseline Workbook Formula Profile (Day 1 CSV Reference)',
      daily_target_divisor: 4,
      nopv2_doses_per_vial_by_day: {'1': 50, '2': 50, '3': 50, '4': 50, '5': 50, '6': 50},
      bopv_doses_per_vial_by_day: {'1': 20, '2': 20, '3': 20, '4': 20, '5': 20, '6': 20},
      wastage_denominator_mode: 'used_plus_partial',
      total_vaccinated_scope: '0-59m_only',
      documented_definition:
        'Preserves Day 1 CSV logic pending OHB formula sign-off: Daily Target = Planned / 4; Total Vaccinated = 0-11m + 12-59m (60-120m co-tracked separately); Wastage denominator = (Vials Used + Partially Used) * Doses/Vial; Zero denominator renders N/A.',
      approval_status: 'Approved',
      is_active: true,
      created_by_username: 'admin.ohb',
      approved_by_username: 'coord.ohb',
      approved_at: nowIso,
      created_at: nowIso,
    },
  ];

  const audit_logs: AuditLogRecord[] = [
    {
      id: 'aud-01',
      actor_username: 'admin.ohb',
      actor_role: 'REGIONAL_SYSTEM_ADMIN',
      action: 'WORKBOOK_INSPECTION_SEEDED',
      entity_type: 'ExcelImportHistory',
      entity_id: 'imp-day1-csv',
      details: `Imported Day1 CSV: ${woredas.length} Woredas across ${zones.length} Zones. Computed Planned Target=${computedPlannedTotal.toLocaleString()} (Template Row 266 reported ${templatePlannedTotal.toLocaleString()}).`,
      created_at: nowIso,
    },
  ];

  const import_histories: ExcelImportHistoryRecord[] = [
    {
      id: 'imp-day1-csv',
      filename: 'Oromia Region – Round 1 nOPV2 and bOPV2 SIA Campaign Daily Administrative Report – November 2026 (1).csv',
      worksheets_detected: ['Day1'],
      rows_total: woredas.length,
      rows_imported: woredas.length,
      rows_skipped_approved: 0,
      rows_invalid: 0,
      duplicates_detected: 3,
      imported_by_username: 'admin.ohb',
      imported_by_name: 'Dr. Bekele Tadesse',
      status: 'Completed',
      notes: 'Initial administrative hierarchy & baseline target seed from Day1 reference CSV.',
      created_at: nowIso,
    },
  ];

  const notifications: NotificationRecord[] = [
    {
      id: 'notif-01',
      title: 'Critical Formula Discrepancy Detected (Day1 Row 266)',
      message: `Oromia Region Totals Col F displays ${templatePlannedTotal.toLocaleString()} instead of the true 261-Woreda sum ${computedPlannedTotal.toLocaleString()}. Pending OHB approval.`,
      severity: 'critical',
      recipient_role_code: 'REGIONAL_COORDINATION_TEAM',
      is_read: false,
      created_at: nowIso,
    },
    {
      id: 'notif-02',
      title: '2026 Round 1 Campaign Day 1 Open for Reporting',
      message: 'Day 1 (2026-11-20) is active for Woreda Reporting Officers. Approved reports lock automatically.',
      severity: 'info',
      recipient_role_code: null,
      is_read: false,
      created_at: nowIso,
    },
  ];

  const thresholds: PerformanceThresholdConfig = {
    id: 'thresh-default',
    is_configured: false,
    high_coverage_min_pct: null,
    medium_coverage_min_pct: null,
    high_completeness_min_pct: null,
    high_wastage_alert_pct: null,
    late_report_cutoff_hour_utc: null,
    declining_performance_drop_pct: null,
    notes: 'Thresholds not yet configured by Regional System Administrator or Coordination Team.',
    updated_by_username: null,
    updated_at: nowIso,
  };

  const notification_providers: NotificationProviderConfig[] = [
    {
      id: 'prov-email',
      channel: 'Email',
      provider_name: 'Unconfigured SMTP / Webhook Relay',
      endpoint_url: '',
      sender_identifier: 'opcms-alerts@ohb.gov.et',
      is_enabled: false,
      has_credentials: false,
      min_priority: 'Critical',
      updated_by_username: null,
      updated_at: nowIso,
    },
    {
      id: 'prov-sms',
      channel: 'SMS',
      provider_name: 'Unconfigured SMS Gateway',
      endpoint_url: '',
      sender_identifier: 'OHB-OPCMS',
      is_enabled: false,
      has_credentials: false,
      min_priority: 'Critical',
      updated_by_username: null,
      updated_at: nowIso,
    },
  ];

  return {
    region,
    roles,
    users,
    zones,
    woredas,
    campaigns: [campaign],
    calculation_configs,
    reports: [],
    discrepancies,
    security_settlements,
    security_reports: [],
    import_histories,
    audit_logs,
    notifications,
    alerts: [],
    thresholds,
    gis_layers: [],
    notification_providers,
    dispatch_logs: [],
    display_sessions: [],
    processed_client_report_ids: {},
    realtime_meta: {
      last_server_event_at: nowIso,
      last_report_received: null,
    },
    template_summary: {
      template_reported_planned_target: templatePlannedTotal,
      template_reported_daily_target: templateDailyTotal,
    },
  };
}

function loadDatabase(): RuntimeDatabase {
  const fresh = seedDatabaseFromCSV();
  if (fs.existsSync(DB_FILE)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<RuntimeDatabase>;
      if (parsed && Array.isArray(parsed.woredas) && parsed.woredas.length === 261) {
        const woredaMap = new Map(parsed.woredas.map((w) => [w.id, w]));
        const migratedSettlements = (parsed.security_settlements || fresh.security_settlements).map((s) => {
          const w = woredaMap.get(s.woreda_id);
          return {
            ...s,
            zone_id: s.zone_id || w?.zone_id || 'zone-guji',
            daily_target_0_59m:
              typeof s.daily_target_0_59m === 'number'
                ? s.daily_target_0_59m
                : Math.round((s.target_children_0_59m || 0) / 4),
          };
        });
        const migratedReports = (parsed.reports || []).map((r) => ({
          ...r,
          reporting_level: r.reporting_level || 'Woreda',
          cumulative_vaccinated_0_59m:
            typeof r.cumulative_vaccinated_0_59m === 'number'
              ? r.cumulative_vaccinated_0_59m
              : r.total_vaccinated_0_59m,
          zero_dose_linked: typeof r.zero_dose_linked === 'number' ? r.zero_dose_linked : 0,
          under_vaccinated_linked:
            typeof r.under_vaccinated_linked === 'number' ? r.under_vaccinated_linked : 0,
          client_report_id: r.client_report_id || null,
          server_received_at: r.server_received_at || r.updated_at,
        }));
        return {
          ...fresh,
          ...parsed,
          calculation_configs:
            Array.isArray(parsed.calculation_configs) && parsed.calculation_configs.length > 0
              ? parsed.calculation_configs
              : fresh.calculation_configs,
          security_settlements: migratedSettlements,
          security_reports: Array.isArray(parsed.security_reports) ? parsed.security_reports : [],
          import_histories:
            Array.isArray(parsed.import_histories) && parsed.import_histories.length > 0
              ? parsed.import_histories
              : fresh.import_histories,
          alerts: Array.isArray(parsed.alerts) ? parsed.alerts : [],
          thresholds: parsed.thresholds ? {...fresh.thresholds, ...parsed.thresholds} : fresh.thresholds,
          gis_layers: Array.isArray(parsed.gis_layers) ? parsed.gis_layers : [],
          notification_providers:
            Array.isArray(parsed.notification_providers) && parsed.notification_providers.length > 0
              ? parsed.notification_providers
              : fresh.notification_providers,
          dispatch_logs: Array.isArray(parsed.dispatch_logs) ? parsed.dispatch_logs : [],
          display_sessions: Array.isArray(parsed.display_sessions) ? parsed.display_sessions : [],
          processed_client_report_ids:
            parsed.processed_client_report_ids && typeof parsed.processed_client_report_ids === 'object'
              ? parsed.processed_client_report_ids
              : {},
          realtime_meta: parsed.realtime_meta || fresh.realtime_meta,
          reports: migratedReports,
        };
      }
    } catch {
      // Fall back to fresh CSV seed
    }
  }
  fs.writeFileSync(DB_FILE, JSON.stringify(fresh, null, 2));
  return fresh;
}

const db: RuntimeDatabase = loadDatabase();

function saveDatabase() {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function sanitizeUser(u: StoredUser): UserProfile {
  const {password_hash: _ph, ...rest} = u;
  return rest;
}

interface AuthedRequest extends Request {
  user?: StoredUser;
}

function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({detail: 'Authentication credentials were not provided.'});
  }
  const token = authHeader.slice(7);
  const payload = verifyToken(token);
  if (!payload) {
    return res.status(401).json({detail: 'Invalid or expired access token.'});
  }
  const user = db.users.find((u) => u.id === payload.sub && u.is_active);
  if (!user) {
    return res.status(401).json({detail: 'User account not found or inactive.'});
  }
  req.user = user;
  return next();
}

function requireRoles(allowed: RoleCode[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction) => {
    if (!req.user || !allowed.includes(req.user.role_code)) {
      return res.status(403).json({detail: 'Insufficient role permissions for this operation.'});
    }
    return next();
  };
}

function isWoredaInUserScope(user: StoredUser, woreda: WoredaRecord): boolean {
  if (user.role_code === 'REGIONAL_SYSTEM_ADMIN' || user.role_code === 'REGIONAL_COORDINATION_TEAM') {
    return true;
  }
  if (user.role_code === 'MONITORING_OFFICER') {
    if (user.woreda_id) return woreda.id === user.woreda_id;
    if (user.zone_id) return woreda.zone_id === user.zone_id;
    return true;
  }
  if (user.role_code === 'ZONE_ADMIN') {
    return woreda.zone_id === user.zone_id;
  }
  if (user.role_code === 'WOREDA_REPORTING_OFFICER') {
    return woreda.id === user.woreda_id;
  }
  return false;
}

function addAudit(user: StoredUser, action: string, entity_type: string, entity_id: string, details: string) {
  db.audit_logs.unshift({
    id: `aud-${crypto.randomUUID().slice(0, 8)}`,
    actor_username: user.username,
    actor_role: user.role_code,
    action,
    entity_type,
    entity_id,
    details,
    created_at: new Date().toISOString(),
  });
  if (db.audit_logs.length > 500) db.audit_logs.length = 500;
}

function addNotification(title: string, message: string, severity: 'info' | 'warning' | 'critical', role: RoleCode | null) {
  db.notifications.unshift({
    id: `notif-${crypto.randomUUID().slice(0, 8)}`,
    title,
    message,
    severity,
    recipient_role_code: role,
    is_read: false,
    created_at: new Date().toISOString(),
  });
  if (db.notifications.length > 100) db.notifications.length = 100;
}

function getActiveCalculationConfig(): CalculationConfigRecord {
  const active = db.calculation_configs.find((c) => c.is_active);
  if (active) return active;
  return db.calculation_configs[0];
}

function recomputeWoredaCumulative(woredaId: string) {
  const woreda = db.woredas.find((w) => w.id === woredaId);
  if (!woreda) return;
  const wReports = db.reports
    .filter((r) => r.woreda_id === woredaId)
    .sort((a, b) => a.day_number - b.day_number);
  let running = 0;
  for (const r of wReports) {
    running += r.total_vaccinated_0_59m;
    r.cumulative_vaccinated_0_59m = running;
    r.cumulative_coverage_pct = safePercent(running, woreda.total_planned_target);
  }
}

interface SseClient {
  id: string;
  user: StoredUser;
  res: Response;
}

interface DisplaySseClient {
  id: string;
  sessionId: string;
  res: Response;
}

const sseClients = new Map<string, SseClient>();
const displaySseClients = new Map<string, DisplaySseClient>();

function broadcastSseEvent(
  eventName: 'report:received' | 'report:workflow' | 'alert:updated' | 'gis:updated',
  payload: Record<string, unknown>,
  scope?: {zoneId?: string | null; woredaId?: string | null},
) {
  const now = new Date().toISOString();
  db.realtime_meta.last_server_event_at = now;
  const serialized = `event: ${eventName}\ndata: ${JSON.stringify({...payload, server_time: now})}\n\n`;
  for (const client of sseClients.values()) {
    if (scope?.woredaId) {
      const targetWoreda = db.woredas.find((w) => w.id === scope.woredaId);
      if (targetWoreda && !isWoredaInUserScope(client.user, targetWoreda)) continue;
    } else if (scope?.zoneId) {
      if (
        (client.user.role_code === 'ZONE_ADMIN' || client.user.role_code === 'WOREDA_REPORTING_OFFICER') &&
        client.user.zone_id !== scope.zoneId
      ) {
        continue;
      }
    }
    try {
      client.res.write(serialized);
    } catch {
      sseClients.delete(client.id);
    }
  }
  for (const dClient of displaySseClients.values()) {
    try {
      dClient.res.write(serialized);
    } catch {
      displaySseClients.delete(dClient.id);
    }
  }
}

const FORBIDDEN_CHILD_PII_KEYS = new Set([
  'child_name',
  'child_full_name',
  'mother_name',
  'father_name',
  'guardian_name',
  'caregiver_name',
  'caregiver_phone',
  'phone_number',
  'mobile_number',
  'national_id',
  'fayda_id',
  'passport_number',
  'birth_certificate_no',
  'child_dob',
]);

function findForbiddenChildPiiKey(obj: unknown, depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const hit = findForbiddenChildPiiKey(item, depth + 1);
      if (hit) return hit;
    }
    return null;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (FORBIDDEN_CHILD_PII_KEYS.has(k.toLowerCase())) {
      return k;
    }
    const nested = findForbiddenChildPiiKey(v, depth + 1);
    if (nested) return nested;
  }
  return null;
}

function hashDisplayToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

function sanitizeDisplaySession(s: CommandDisplaySessionStored): CommandDisplaySessionRecord {
  const {token_hash: _th, ...rest} = s;
  return rest;
}

function resolveActiveDisplaySession(rawToken: string): CommandDisplaySessionStored | null {
  if (!rawToken || !rawToken.startsWith('opcms_disp_')) return null;
  const candidateHash = hashDisplayToken(rawToken);
  const candBuf = Buffer.from(candidateHash, 'hex');
  const nowMs = Date.now();
  for (const session of db.display_sessions) {
    if (!session.is_active || session.revoked_at) continue;
    if (session.expires_at && Date.parse(session.expires_at) <= nowMs) continue;
    const storedBuf = Buffer.from(session.token_hash, 'hex');
    if (candBuf.length === storedBuf.length && crypto.timingSafeEqual(candBuf, storedBuf)) {
      session.last_accessed_at = new Date().toISOString();
      return session;
    }
  }
  return null;
}

function buildCommandRoomSnapshot(sessionLabel: string): CommandRoomSnapshot {
  const campaign = db.campaigns[0];
  const activeCalc = getActiveCalculationConfig();
  const nowIso = new Date().toISOString();
  const openDays = campaign.days.filter((d) => d.is_open_for_reporting);
  const openDaysCount = Math.max(1, openDays.length);

  const computedPlanned = db.woredas.reduce((s, w) => s + w.total_planned_target, 0);
  const computedDaily = db.woredas.reduce((s, w) => s + w.daily_target, 0);
  const total059 = db.reports.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
  const total60120 = db.reports.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);

  const zones = db.zones.map((z) => {
    const zw = db.woredas.filter((w) => w.zone_id === z.id);
    const zr = db.reports.filter((r) => r.zone_id === z.id);
    const planned = zw.reduce((s, w) => s + w.total_planned_target, 0);
    const daily = zw.reduce((s, w) => s + w.daily_target, 0);
    const v059 = zr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
    const submittedCount = zr.filter((r) => r.status !== 'Draft').length;
    const approvedCount = zr.filter((r) => r.status === 'Approved').length;
    const returnedCount = zr.filter((r) => r.status === 'Returned for Correction').length;
    const expectedSlots = zw.length * openDaysCount;
    const missingCount = Math.max(0, expectedSlots - submittedCount);
    const zSettles = db.security_settlements.filter((s) => s.zone_id === z.id).length;
    return {
      ...z,
      woreda_count: zw.length,
      total_planned_target: planned,
      daily_target: daily,
      reported_count: submittedCount,
      total_vaccinated_0_59m: v059,
      submitted_count: submittedCount,
      approved_count: approvedCount,
      returned_count: returnedCount,
      missing_count: missingCount,
      completeness_pct: safePercent(submittedCount, expectedSlots),
      coverage_pct: safePercent(v059, planned),
      security_settlements_count: zSettles,
    };
  });

  // Woreda rankings (only Woredas with >0 target or any submitted data)
  const woredaPerf = db.woredas.map((w) => {
    const wr = db.reports.filter((r) => r.woreda_id === w.id);
    const v059 = wr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
    return {
      id: w.id,
      name: w.name,
      zone_name: w.zone_name,
      planned_target: w.total_planned_target,
      vaccinated_0_59m: v059,
      coverage_pct: safePercent(v059, w.total_planned_target),
    };
  });

  const withValidTarget = woredaPerf.filter((w) => w.planned_target > 0 && w.coverage_pct !== null);
  const topCoverage = [...withValidTarget]
    .sort((a, b) => (b.coverage_pct ?? 0) - (a.coverage_pct ?? 0))
    .slice(0, 8);
  const lowestCoverage = [...withValidTarget]
    .sort((a, b) => (a.coverage_pct ?? 0) - (b.coverage_pct ?? 0))
    .slice(0, 8);

  // Daily progression across Day 1..6
  let runningCum059 = 0;
  const daily_progression = campaign.days.map((d) => {
    const dr = db.reports.filter((r) => r.campaign_day_id === d.id);
    const v059 = dr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
    const v60120 = dr.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);
    runningCum059 += v059;
    return {
      day_id: d.id,
      label: d.label,
      phase: d.day_type,
      campaign_date: d.campaign_date,
      daily_target: computedDaily,
      vaccinated_0_59m: v059,
      vaccinated_60_120m: v60120,
      cumulative_0_59m: runningCum059,
      daily_coverage_pct: safePercent(v059, computedDaily),
      cumulative_coverage_pct: safePercent(runningCum059, computedPlanned),
      reports_received: dr.filter((r) => r.status !== 'Draft').length,
      reports_approved: dr.filter((r) => r.status === 'Approved').length,
    };
  });

  // Age group VB vs NV totals
  const ageMap: Record<'0-11m' | '12-59m' | '60-120m', {vb: number; nv: number}> = {
    '0-11m': {vb: 0, nv: 0},
    '12-59m': {vb: 0, nv: 0},
    '60-120m': {vb: 0, nv: 0},
  };
  for (const r of db.reports) {
    for (const ag of r.age_groups || []) {
      if (ageMap[ag.age_group]) {
        ageMap[ag.age_group].vb += ag.vaccinated_before || 0;
        ageMap[ag.age_group].nv += ag.not_vaccinated_before || 0;
      }
    }
  }
  const age_group_breakdown = (['0-11m', '12-59m', '60-120m'] as const).map((ag) => ({
    age_group: ag,
    vaccinated_before: ageMap[ag].vb,
    not_vaccinated_before: ageMap[ag].nv,
    total: ageMap[ag].vb + ageMap[ag].nv,
  }));

  // Vaccine summaries for nOPV2 and bOPV
  const aggVac = (type: 'nOPV2' | 'bOPV', dpv: number): CommandRoomVaccineSummary => {
    let rec = 0, used = 0, partial = 0, retGood = 0, broken = 0, retBad = 0, lost = 0;
    for (const r of db.reports) {
      for (const v of r.vaccine_utilizations || []) {
        if (v.vaccine_type === type) {
          rec += v.vials_received || 0;
          used += v.vials_used || 0;
          partial += v.vials_partially_used || 0;
          retGood += v.vials_returned_unused_good || 0;
          broken += v.vials_broken || 0;
          retBad += v.vials_returned_bad_stage_3_4 || 0;
          lost += v.vials_lost || 0;
        }
      }
    }
    const wastage = computeWastageRatePct(
      {
        vaccine_type: type,
        vials_received: rec,
        vials_used: used,
        vials_partially_used: partial,
        vials_returned_unused_good: retGood,
        vials_broken: broken,
        vials_returned_bad_stage_3_4: retBad,
        vials_lost: lost,
      },
      total059,
      dpv,
      activeCalc.wastage_denominator_mode,
    );
    return {
      vaccine_type: type,
      vials_received: rec,
      vials_used: used,
      vials_partially_used: partial,
      vials_returned_unused_good: retGood,
      vials_broken: broken,
      vials_returned_bad_stage_3_4: retBad,
      vials_lost: lost,
      wastage_rate_pct: wastage,
    };
  };

  const nopv2Dpv = activeCalc.nopv2_doses_per_vial_by_day['1'] || campaign.nopv2_doses_per_vial || 50;
  const bopvDpv = activeCalc.bopv_doses_per_vial_by_day['1'] || campaign.bopv_doses_per_vial || 20;
  const nopv2 = aggVac('nOPV2', nopv2Dpv);
  const bopv = aggVac('bOPV', bopvDpv);

  const openAlerts = db.alerts.filter((a) => a.resolution_status !== 'Resolved');
  const wastageAlertsCount = openAlerts.filter((a) => a.alert_type === 'High Vaccine Wastage').length;
  const secGapCount = openAlerts.filter((a) => a.alert_type === 'Security Settlement Reporting Gap').length;
  const lateReportsCount = openAlerts.filter((a) => a.alert_type === 'Late Report').length;

  // Security Zone summary
  const secZoneMap = new Map<
    string,
    {zone_name: string; settlements: number; inaccessible: number; partially_accessible: number; target: number; vaccinated: number}
  >();
  for (const s of db.security_settlements) {
    const entry = secZoneMap.get(s.zone_name) || {
      zone_name: s.zone_name,
      settlements: 0,
      inaccessible: 0,
      partially_accessible: 0,
      target: 0,
      vaccinated: 0,
    };
    entry.settlements += 1;
    if (s.access_status === 'Inaccessible') entry.inaccessible += 1;
    if (s.access_status === 'Partially Accessible') entry.partially_accessible += 1;
    entry.target += s.target_children_0_59m || 0;
    entry.vaccinated += s.vaccinated_children_0_59m || 0;
    secZoneMap.set(s.zone_name, entry);
  }
  const secTargetTotal = db.security_settlements.reduce((s, st) => s + st.target_children_0_59m, 0);
  const secVaxTotal = db.security_settlements.reduce((s, st) => s + st.vaccinated_children_0_59m, 0);

  // Reporting compliance
  const expectedTotalReports = db.woredas.length * openDaysCount;
  const submittedOrApproved = db.reports.filter((r) => r.status !== 'Draft').length;
  const approvedCount = db.reports.filter((r) => r.status === 'Approved').length;
  const missingSample: CommandRoomSnapshot['reporting_compliance']['missing_woredas_sample'] = [];
  for (const d of openDays) {
    for (const w of db.woredas) {
      if (missingSample.length >= 18) break;
      const rep = db.reports.find((r) => r.campaign_day_id === d.id && r.woreda_id === w.id);
      if (!rep) {
        missingSample.push({zone_name: w.zone_name, woreda_name: w.name, day_label: d.label, status: 'Missing'});
      } else if (rep.status === 'Draft' || rep.status === 'Returned for Correction') {
        missingSample.push({zone_name: w.zone_name, woreda_name: w.name, day_label: d.label, status: rep.status});
      }
    }
  }

  const totalTeams = db.reports.reduce((s, r) => s + r.total_teams, 0);
  const teamsReported = db.reports.reduce((s, r) => s + r.teams_reported, 0);

  const latestActivity = [...db.reports]
    .sort((a, b) => Date.parse(b.server_received_at || b.updated_at) - Date.parse(a.server_received_at || a.updated_at))
    .slice(0, 12)
    .map((r) => ({
      report_id: r.id,
      zone_name: r.zone_name,
      woreda_name: r.woreda_name,
      day_label: r.day_label,
      status: r.status,
      total_vaccinated_0_59m: r.total_vaccinated_0_59m,
      received_at: r.server_received_at || r.updated_at,
    }));

  return {
    generated_at: nowIso,
    read_only: true,
    session_label: sessionLabel,
    campaign,
    active_calculation_config: activeCalc,
    sync_telemetry: {
      last_server_event_at: db.realtime_meta.last_server_event_at,
      last_report_received: db.realtime_meta.last_report_received,
      connected_clients: sseClients.size + displaySseClients.size,
    },
    overview_totals: {
      total_zones: zones.length,
      total_woredas: db.woredas.length,
      computed_planned_target: computedPlanned,
      template_reported_planned_target: db.template_summary.template_reported_planned_target,
      computed_daily_target: computedDaily,
      template_reported_daily_target: db.template_summary.template_reported_daily_target,
      reports_submitted_or_approved: submittedOrApproved,
      reports_approved: approvedCount,
      reports_returned: db.reports.filter((r) => r.status === 'Returned for Correction').length,
      reporting_completeness_pct: safePercent(submittedOrApproved, expectedTotalReports),
      total_vaccinated_0_59m: total059,
      total_vaccinated_60_120m: total60120,
      afp_alerts: db.reports.reduce((s, r) => s + r.afp_alerts_count, 0),
      aefi_alerts: db.reports.reduce((s, r) => s + r.aefi_alerts_count, 0),
      zero_dose_identified: db.reports.reduce((s, r) => s + r.zero_dose_identified, 0),
      zero_dose_linked: db.reports.reduce((s, r) => s + (r.zero_dose_linked || 0), 0),
      zero_dose_vaccinated: db.reports.reduce((s, r) => s + r.zero_dose_vaccinated, 0),
      under_vaccinated_identified: db.reports.reduce((s, r) => s + r.under_vaccinated_identified, 0),
      under_vaccinated_linked: db.reports.reduce((s, r) => s + (r.under_vaccinated_linked || 0), 0),
      under_vaccinated_vaccinated: db.reports.reduce((s, r) => s + r.under_vaccinated_vaccinated, 0),
      teams_reported: teamsReported,
      total_teams: totalTeams,
      team_reporting_pct: safePercent(teamsReported, totalTeams),
      nopv2_vials_received: nopv2.vials_received,
      nopv2_vials_used: nopv2.vials_used,
      nopv2_wastage_pct: nopv2.wastage_rate_pct,
      bopv_vials_received: bopv.vials_received,
      bopv_vials_used: bopv.vials_used,
      bopv_wastage_pct: bopv.wastage_rate_pct,
      regional_daily_coverage_pct: safePercent(total059, computedDaily),
      regional_total_coverage_pct: safePercent(total059, computedPlanned),
      security_settlements_count: db.security_settlements.length,
      security_settlements_target: secTargetTotal,
      security_settlements_vaccinated: secVaxTotal,
      open_alerts_count: openAlerts.length,
      critical_alerts_count: openAlerts.filter((a) => a.priority === 'Critical').length,
    },
    zones,
    woreda_rankings: {
      top_coverage: topCoverage,
      lowest_coverage: lowestCoverage,
    },
    daily_progression,
    age_group_breakdown,
    vaccine_management: {
      nopv2,
      bopv,
      wastage_alerts_count: wastageAlertsCount,
    },
    surveillance_and_security: {
      afp_alerts_total: db.reports.reduce((s, r) => s + r.afp_alerts_count, 0),
      aefi_alerts_total: db.reports.reduce((s, r) => s + r.aefi_alerts_count, 0),
      security_settlements_total: db.security_settlements.length,
      security_target_0_59m: secTargetTotal,
      security_vaccinated_0_59m: secVaxTotal,
      security_coverage_pct: safePercent(secVaxTotal, secTargetTotal),
      security_reporting_gaps_count: secGapCount,
      security_zone_summary: Array.from(secZoneMap.values()).sort((a, b) => b.settlements - a.settlements),
      recent_surveillance_alerts: openAlerts
        .filter((a) =>
          ['AFP Alert', 'AEFI Alert', 'Security Settlement Reporting Gap', 'Zero-Dose Follow-up Gap', 'Under-Vaccinated Follow-up Gap'].includes(
            a.alert_type,
          ),
        )
        .slice(0, 12)
        .map((a) => ({
          id: a.id,
          priority: a.priority,
          alert_type: a.alert_type,
          admin_location: a.admin_location,
          day_label: a.day_label,
          description: a.description,
          detected_at: a.detected_at,
          resolution_status: a.resolution_status,
        })),
    },
    reporting_compliance: {
      woredas_expected_per_day: db.woredas.length,
      open_days_count: openDaysCount,
      expected_total_reports: expectedTotalReports,
      reports_received: submittedOrApproved,
      reports_approved: approvedCount,
      reports_pending_draft_or_missing: Math.max(0, expectedTotalReports - submittedOrApproved),
      late_reports_count: lateReportsCount,
      completeness_pct: safePercent(submittedOrApproved, expectedTotalReports),
      missing_woredas_sample: missingSample,
    },
    latest_activity: latestActivity,
    thresholds: db.thresholds,
  };
}

function findResponsibleOfficer(zoneId: string | null, woredaId: string | null): string {
  if (woredaId) {
    const wOfficer = db.users.find(
      (u) => u.is_active && u.role_code === 'WOREDA_REPORTING_OFFICER' && u.woreda_id === woredaId,
    );
    if (wOfficer) return `${wOfficer.full_name} (${wOfficer.email})`;
  }
  if (zoneId) {
    const zOfficer = db.users.find(
      (u) => u.is_active && u.role_code === 'ZONE_ADMIN' && u.zone_id === zoneId,
    );
    if (zOfficer) return `${zOfficer.full_name} (${zOfficer.email})`;
  }
  return 'Unassigned (Zone/Woreda Officer Not Provisioned)';
}

function logExternalDispatchAttempt(alert: CampaignAlertRecord) {
  for (const provider of db.notification_providers) {
    if (!provider.is_enabled || !provider.has_credentials || !provider.endpoint_url) {
      const exists = db.dispatch_logs.some(
        (l) => l.alert_id === alert.id && l.channel === provider.channel,
      );
      if (!exists) {
        db.dispatch_logs.unshift({
          id: `dlog-${crypto.randomUUID().slice(0, 8)}`,
          alert_id: alert.id,
          channel: provider.channel,
          recipient: alert.responsible_officer,
          status: 'Not Configured',
          detail: `${provider.channel} gateway is not configured with live endpoint credentials.`,
          created_at: new Date().toISOString(),
        });
      }
    } else {
      const priorityRank: Record<AlertPriority, number> = {Critical: 4, High: 3, Medium: 2, Low: 1};
      if (priorityRank[alert.priority] < priorityRank[provider.min_priority]) continue;
      void fetch(provider.endpoint_url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          sender: provider.sender_identifier,
          recipient: alert.responsible_officer,
          priority: alert.priority,
          subject: `[OPCMS ${alert.priority}] ${alert.alert_type} - ${alert.admin_location}`,
          message: alert.description,
        }),
      })
        .then((resp) => {
          db.dispatch_logs.unshift({
            id: `dlog-${crypto.randomUUID().slice(0, 8)}`,
            alert_id: alert.id,
            channel: provider.channel,
            recipient: alert.responsible_officer,
            status: resp.ok ? 'Dispatched' : 'Delivery Failed',
            detail: resp.ok
              ? `HTTP ${resp.status} delivered via ${provider.provider_name}`
              : `HTTP ${resp.status} error from ${provider.provider_name}`,
            created_at: new Date().toISOString(),
          });
          if (db.dispatch_logs.length > 300) db.dispatch_logs.length = 300;
          saveDatabase();
        })
        .catch((err: unknown) => {
          db.dispatch_logs.unshift({
            id: `dlog-${crypto.randomUUID().slice(0, 8)}`,
            alert_id: alert.id,
            channel: provider.channel,
            recipient: alert.responsible_officer,
            status: 'Delivery Failed',
            detail: err instanceof Error ? err.message : 'Network dispatch failure',
            created_at: new Date().toISOString(),
          });
          if (db.dispatch_logs.length > 300) db.dispatch_logs.length = 300;
          saveDatabase();
        });
    }
  }
  if (db.dispatch_logs.length > 300) db.dispatch_logs.length = 300;
}

function evaluateCampaignAlerts() {
  const campaign = db.campaigns[0];
  if (!campaign) return;
  const thresh = db.thresholds;
  const activeCalc = getActiveCalculationConfig();
  const nowIso = new Date().toISOString();
  const nowHourUtc = new Date().getUTCHours();

  interface DetectedCondition {
    fingerprint: string;
    priority: AlertPriority;
    alert_type: AlertType;
    admin_location: string;
    zone_id: string | null;
    woreda_id: string | null;
    settlement_id: string | null;
    campaign_day_id: string | null;
    day_label: string | null;
    description: string;
  }

  const detected: DetectedCondition[] = [];
  const openDays = campaign.days.filter((d) => d.is_open_for_reporting);

  // 1 & 2. Missing Daily Reports and Late Reports on open campaign days
  for (const day of openDays) {
    for (const woreda of db.woredas) {
      const rep = db.reports.find((r) => r.campaign_day_id === day.id && r.woreda_id === woreda.id);
      if (!rep || rep.status === 'Draft') {
        detected.push({
          fingerprint: `missing:${day.id}:${woreda.id}`,
          priority: 'High',
          alert_type: 'Missing Daily Report',
          admin_location: `${woreda.zone_name} · ${woreda.name}`,
          zone_id: woreda.zone_id,
          woreda_id: woreda.id,
          settlement_id: null,
          campaign_day_id: day.id,
          day_label: day.label,
          description: !rep
            ? `No daily vaccination report received for ${day.label} (${day.campaign_date}).`
            : `Report saved in Draft status only and not yet submitted for ${day.label}.`,
        });
        if (
          thresh.is_configured &&
          thresh.late_report_cutoff_hour_utc !== null &&
          nowHourUtc >= thresh.late_report_cutoff_hour_utc
        ) {
          detected.push({
            fingerprint: `late:${day.id}:${woreda.id}`,
            priority: 'High',
            alert_type: 'Late Report',
            admin_location: `${woreda.zone_name} · ${woreda.name}`,
            zone_id: woreda.zone_id,
            woreda_id: woreda.id,
            settlement_id: null,
            campaign_day_id: day.id,
            day_label: day.label,
            description: `Submission passed configured cutoff hour (${String(thresh.late_report_cutoff_hour_utc).padStart(2, '0')}:00 UTC) without submission for ${day.label}.`,
          });
        }
      }
    }
  }

  // Evaluate submitted/active reports across campaign days
  for (const rep of db.reports) {
    // 3. Low Vaccination Coverage (uses admin-configured threshold when set)
    if (
      thresh.is_configured &&
      thresh.medium_coverage_min_pct !== null &&
      rep.daily_coverage_pct !== null &&
      rep.daily_coverage_pct < thresh.medium_coverage_min_pct
    ) {
      detected.push({
        fingerprint: `lowcov:${rep.campaign_day_id}:${rep.woreda_id}`,
        priority: rep.daily_coverage_pct < thresh.medium_coverage_min_pct * 0.6 ? 'Critical' : 'High',
        alert_type: 'Low Vaccination Coverage',
        admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
        zone_id: rep.zone_id,
        woreda_id: rep.woreda_id,
        settlement_id: null,
        campaign_day_id: rep.campaign_day_id,
        day_label: rep.day_label,
        description: `Daily coverage ${rep.daily_coverage_pct.toFixed(1)}% is below configured minimum threshold (${thresh.medium_coverage_min_pct}%).`,
      });
    }

    // 4. Declining Performance (day-over-day drop)
    if (rep.day_number > 1) {
      const prev = db.reports.find(
        (p) => p.woreda_id === rep.woreda_id && p.day_number === rep.day_number - 1,
      );
      if (prev && prev.total_vaccinated_0_59m > 0) {
        const dropPct =
          ((prev.total_vaccinated_0_59m - rep.total_vaccinated_0_59m) / prev.total_vaccinated_0_59m) * 100;
        const dropLimit = thresh.declining_performance_drop_pct;
        if (dropLimit !== null ? dropPct >= dropLimit : dropPct >= 30) {
          detected.push({
            fingerprint: `decline:${rep.campaign_day_id}:${rep.woreda_id}`,
            priority: 'Medium',
            alert_type: 'Declining Performance',
            admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
            zone_id: rep.zone_id,
            woreda_id: rep.woreda_id,
            settlement_id: null,
            campaign_day_id: rep.campaign_day_id,
            day_label: rep.day_label,
            description: `Vaccinated count dropped ${dropPct.toFixed(1)}% compared to Day ${prev.day_number} (${prev.total_vaccinated_0_59m.toLocaleString()} → ${rep.total_vaccinated_0_59m.toLocaleString()}).`,
          });
        }
      }
    }

    // 5. High Vaccine Wastage (nOPV2 or bOPV)
    const wastageLimit = thresh.high_wastage_alert_pct ?? 15;
    for (const vu of rep.vaccine_utilizations) {
      const dpv =
        vu.vaccine_type === 'nOPV2'
          ? activeCalc.nopv2_doses_per_vial_by_day[String(rep.day_number)] || 50
          : activeCalc.bopv_doses_per_vial_by_day[String(rep.day_number)] || 20;
      const wRate =
        typeof vu.wastage_rate_pct === 'number'
          ? vu.wastage_rate_pct
          : computeWastageRatePct(vu, rep.total_vaccinated_0_59m, dpv, activeCalc.wastage_denominator_mode);
      if (wRate !== null && wRate > wastageLimit) {
        detected.push({
          fingerprint: `wastage:${rep.campaign_day_id}:${rep.woreda_id}:${vu.vaccine_type}`,
          priority: wRate > wastageLimit * 1.5 ? 'High' : 'Medium',
          alert_type: 'High Vaccine Wastage',
          admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
          zone_id: rep.zone_id,
          woreda_id: rep.woreda_id,
          settlement_id: null,
          campaign_day_id: rep.campaign_day_id,
          day_label: rep.day_label,
          description: `${vu.vaccine_type} wastage rate is ${wRate.toFixed(1)}% (limit: ${wastageLimit}%).`,
        });
      }
    }

    // 6. AFP Alert
    if (rep.afp_alerts_count > 0) {
      detected.push({
        fingerprint: `afp:${rep.campaign_day_id}:${rep.woreda_id}`,
        priority: 'Critical',
        alert_type: 'AFP Alert',
        admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
        zone_id: rep.zone_id,
        woreda_id: rep.woreda_id,
        settlement_id: null,
        campaign_day_id: rep.campaign_day_id,
        day_label: rep.day_label,
        description: `${rep.afp_alerts_count} Acute Flaccid Paralysis (AFP) alert(s) reported on ${rep.day_label}. Immediate surveillance verification required.`,
      });
    }

    // 7. AEFI Alert
    if (rep.aefi_alerts_count > 0) {
      detected.push({
        fingerprint: `aefi:${rep.campaign_day_id}:${rep.woreda_id}`,
        priority: 'Critical',
        alert_type: 'AEFI Alert',
        admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
        zone_id: rep.zone_id,
        woreda_id: rep.woreda_id,
        settlement_id: null,
        campaign_day_id: rep.campaign_day_id,
        day_label: rep.day_label,
        description: `${rep.aefi_alerts_count} Adverse Event Following Immunization (AEFI) alert(s) reported on ${rep.day_label}.`,
      });
    }

    // 8. Missing Vaccination Team Reports
    if (rep.total_teams > 0 && rep.teams_reported < rep.total_teams) {
      detected.push({
        fingerprint: `teams:${rep.campaign_day_id}:${rep.woreda_id}`,
        priority: 'Medium',
        alert_type: 'Missing Team Reports',
        admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
        zone_id: rep.zone_id,
        woreda_id: rep.woreda_id,
        settlement_id: null,
        campaign_day_id: rep.campaign_day_id,
        day_label: rep.day_label,
        description: `Only ${rep.teams_reported} of ${rep.total_teams} planned vaccination teams reported for ${rep.day_label}.`,
      });
    }

    // 10. Zero-Dose Follow-up Gaps
    if (rep.zero_dose_identified > rep.zero_dose_vaccinated) {
      detected.push({
        fingerprint: `zdgap:${rep.campaign_day_id}:${rep.woreda_id}`,
        priority: 'High',
        alert_type: 'Zero-Dose Follow-up Gap',
        admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
        zone_id: rep.zone_id,
        woreda_id: rep.woreda_id,
        settlement_id: null,
        campaign_day_id: rep.campaign_day_id,
        day_label: rep.day_label,
        description: `${rep.zero_dose_identified - rep.zero_dose_vaccinated} zero-dose child(ren) identified (${rep.zero_dose_identified}) remain unvaccinated (${rep.zero_dose_vaccinated}).`,
      });
    }

    // 11. Under-Vaccinated Follow-up Gaps
    if (rep.under_vaccinated_identified > rep.under_vaccinated_vaccinated) {
      detected.push({
        fingerprint: `uvgap:${rep.campaign_day_id}:${rep.woreda_id}`,
        priority: 'Medium',
        alert_type: 'Under-Vaccinated Follow-up Gap',
        admin_location: `${rep.zone_name} · ${rep.woreda_name}`,
        zone_id: rep.zone_id,
        woreda_id: rep.woreda_id,
        settlement_id: null,
        campaign_day_id: rep.campaign_day_id,
        day_label: rep.day_label,
        description: `${rep.under_vaccinated_identified - rep.under_vaccinated_vaccinated} under-vaccinated child(ren) identified (${rep.under_vaccinated_identified}) remain unvaccinated (${rep.under_vaccinated_vaccinated}).`,
      });
    }
  }

  // 9. Security-Affected Settlement Reporting Gaps
  for (const day of openDays) {
    for (const settlement of db.security_settlements) {
      const srep = db.security_reports.find(
        (sr) => sr.settlement_id === settlement.id && sr.campaign_day_id === day.id,
      );
      if (!srep) {
        detected.push({
          fingerprint: `secgap:${day.id}:${settlement.id}`,
          priority: settlement.access_status === 'Inaccessible' ? 'High' : 'Medium',
          alert_type: 'Security Settlement Reporting Gap',
          admin_location: `${settlement.zone_name} · ${settlement.woreda_name} · ${settlement.settlement_name}`,
          zone_id: settlement.zone_id,
          woreda_id: settlement.woreda_id,
          settlement_id: settlement.id,
          campaign_day_id: day.id,
          day_label: day.label,
          description: `Security settlement '${settlement.settlement_name}' (${settlement.access_status}) has no ${day.label} report.`,
        });
      }
    }
  }

  const activeFingerprints = new Set(detected.map((d) => d.fingerprint));

  // Auto-resolve previously open alerts whose condition cleared
  for (const existing of db.alerts) {
    if (existing.resolution_status !== 'Resolved' && !activeFingerprints.has(existing.fingerprint)) {
      existing.resolution_status = 'Resolved';
      existing.resolution_notes = 'Automatically resolved after updated campaign data cleared alert condition.';
      existing.resolved_by = 'OPCMS Alert Engine';
      existing.resolved_at = nowIso;
    }
  }

  // Upsert detected alerts while preserving Acknowledged / Resolved state
  for (const cond of detected) {
    const existing = db.alerts.find((a) => a.fingerprint === cond.fingerprint);
    if (!existing) {
      const alert: CampaignAlertRecord = {
        id: `alt-${crypto.randomUUID().slice(0, 8)}`,
        fingerprint: cond.fingerprint,
        priority: cond.priority,
        alert_type: cond.alert_type,
        admin_location: cond.admin_location,
        zone_id: cond.zone_id,
        woreda_id: cond.woreda_id,
        settlement_id: cond.settlement_id,
        campaign_day_id: cond.campaign_day_id,
        day_label: cond.day_label,
        description: cond.description,
        detected_at: nowIso,
        responsible_officer: findResponsibleOfficer(cond.zone_id, cond.woreda_id),
        resolution_status: 'Open',
        resolution_notes: null,
        acknowledged_by: null,
        acknowledged_at: null,
        resolved_by: null,
        resolved_at: null,
      };
      db.alerts.unshift(alert);
      if (alert.priority === 'Critical') {
        logExternalDispatchAttempt(alert);
      }
    } else if (existing.resolution_status !== 'Resolved') {
      existing.priority = cond.priority;
      existing.description = cond.description;
      existing.responsible_officer = findResponsibleOfficer(cond.zone_id, cond.woreda_id);
    }
  }

  if (db.alerts.length > 2000) {
    db.alerts.length = 2000;
  }
}

evaluateCampaignAlerts();

async function startServer() {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({limit: '15mb'}));

  // Security Hardening Headers
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=()');
    next();
  });

  // In-memory Sliding-Window Rate Limiter
  const rateBuckets = new Map<string, {count: number; resetAt: number}>();
  const LOGIN_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_LOGIN_PER_MIN || 30);
  const API_LIMIT_PER_MIN = Number(process.env.RATE_LIMIT_API_PER_MIN || 600);

  app.use('/api/v1', (req, res, next) => {
    if (
      req.path === '/health' ||
      req.path === '/events/stream' ||
      req.path === '/command-room/stream'
    ) {
      return next();
    }
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'local')
      .split(',')[0]
      .trim();
    const isLogin = req.path === '/auth/login' && req.method === 'POST';
    const limit = isLogin ? LOGIN_LIMIT_PER_MIN : API_LIMIT_PER_MIN;
    const bucketKey = `${isLogin ? 'login' : 'api'}:${clientIp}`;
    const nowMs = Date.now();
    let bucket = rateBuckets.get(bucketKey);
    if (!bucket || bucket.resetAt <= nowMs) {
      bucket = {count: 0, resetAt: nowMs + 60_000};
      rateBuckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - bucket.count)));
    if (bucket.count > limit) {
      return res.status(429).json({
        detail: isLogin
          ? 'Too many authentication attempts. Please retry in 60 seconds.'
          : 'API rate limit exceeded. Please retry shortly.',
      });
    }
    if (rateBuckets.size > 5000) {
      for (const [k, b] of rateBuckets.entries()) {
        if (b.resetAt <= nowMs) rateBuckets.delete(k);
      }
    }
    return next();
  });

  // Zero Child PII Policy Enforcement across all API write payloads
  app.use('/api/v1', (req, res, next) => {
    if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body && typeof req.body === 'object') {
      const forbidden = findForbiddenChildPiiKey(req.body);
      if (forbidden) {
        return res.status(422).json({
          detail: `Zero child PII policy violation: field '${forbidden}' is prohibited in OPCMS campaign records.`,
        });
      }
    }
    return next();
  });

  // Health
  app.get('/api/v1/health', (_req, res) => {
    res.json({status: 'healthy', service: 'opcms-api', woredas: db.woredas.length, zones: db.zones.length});
  });

  // Real-time SSE Event Stream (supports ?token= or Authorization header)
  app.get('/api/v1/events/stream', (req, res) => {
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const authHeader = req.headers.authorization;
    const rawToken = queryToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '');
    const payload = rawToken ? verifyToken(rawToken) : null;
    if (!payload) {
      return res.status(401).json({detail: 'Invalid or missing SSE stream token.'});
    }
    const user = db.users.find((u) => u.id === payload.sub && u.is_active);
    if (!user) {
      return res.status(401).json({detail: 'User inactive or not found.'});
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const clientId = crypto.randomUUID();
    sseClients.set(clientId, {id: clientId, user, res});

    const connectedPayload = {
      server_time: new Date().toISOString(),
      last_server_event_at: db.realtime_meta.last_server_event_at,
      last_report_received: db.realtime_meta.last_report_received,
      connected_clients: sseClients.size,
    };
    res.write(`event: connected\ndata: ${JSON.stringify(connectedPayload)}\n\n`);

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({server_time: new Date().toISOString()})}\n\n`);
      } catch {
        clearInterval(heartbeat);
        sseClients.delete(clientId);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      sseClients.delete(clientId);
    });
  });

  // Auth
  app.post('/api/v1/auth/login', (req, res) => {
    const {username, password} = req.body || {};
    const user = db.users.find((u) => u.username === username && u.is_active);
    if (!user || !verifyPassword(String(password || ''), user.password_hash)) {
      return res.status(401).json({detail: 'Invalid username or password.'});
    }
    user.last_login_at = new Date().toISOString();
    addAudit(user, 'LOGIN', 'User', user.id, `Signed in as ${user.role_name}`);
    saveDatabase();
    const token = signToken({
      sub: user.id,
      role: user.role_code,
      exp: Math.floor(Date.now() / 1000) + 60 * 60 * 8,
    });
    return res.json({access_token: token, token_type: 'bearer', user: sanitizeUser(user)});
  });

  app.get('/api/v1/auth/me', requireAuth, (req: AuthedRequest, res) => {
    return res.json(sanitizeUser(req.user!));
  });

  app.get('/api/v1/roles', requireAuth, (_req, res) => {
    return res.json(db.roles);
  });

  app.get('/api/v1/users', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (_req, res) => {
    return res.json(db.users.map(sanitizeUser));
  });

  app.post('/api/v1/users', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const {username, email, full_name, password, role_code, zone_id, woreda_id} = req.body || {};
    if (!username || !email || !full_name || !role_code) {
      return res.status(400).json({detail: 'username, email, full_name, and role_code are required.'});
    }
    if (db.users.some((u) => u.username === username || u.email === email)) {
      return res.status(409).json({detail: 'Username or email already exists.'});
    }
    const roleDef = db.roles.find((r) => r.code === role_code);
    if (!roleDef) return res.status(400).json({detail: 'Invalid role_code.'});

    const zone = zone_id ? db.zones.find((z) => z.id === zone_id) || null : null;
    const woreda = woreda_id ? db.woredas.find((w) => w.id === woreda_id) || null : null;

    const newUser: StoredUser = {
      id: `usr-${crypto.randomUUID().slice(0, 8)}`,
      username: String(username).trim(),
      email: String(email).trim(),
      full_name: String(full_name).trim(),
      role_code: roleDef.code,
      role_name: roleDef.name,
      is_read_only: roleDef.is_read_only,
      region_id: db.region.id,
      zone_id: woreda ? woreda.zone_id : zone ? zone.id : null,
      woreda_id: woreda ? woreda.id : null,
      zone_name: woreda ? woreda.zone_name : zone ? zone.name : null,
      woreda_name: woreda ? woreda.name : null,
      is_active: true,
      last_login_at: null,
      password_hash: hashPassword(String(password || 'OhbPolio@2026')),
    };
    db.users.push(newUser);
    addAudit(req.user!, 'CREATE_USER', 'User', newUser.id, `Created ${newUser.username} (${newUser.role_code})`);
    saveDatabase();
    return res.status(201).json(sanitizeUser(newUser));
  });

  app.patch('/api/v1/users/:id', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const target = db.users.find((u) => u.id === req.params.id);
    if (!target) return res.status(404).json({detail: 'User not found.'});
    if (typeof req.body.is_active === 'boolean') target.is_active = req.body.is_active;
    if (req.body.role_code) {
      const roleDef = db.roles.find((r) => r.code === req.body.role_code);
      if (!roleDef) return res.status(400).json({detail: 'Invalid role_code.'});
      target.role_code = roleDef.code;
      target.role_name = roleDef.name;
      target.is_read_only = roleDef.is_read_only;
    }
    addAudit(req.user!, 'UPDATE_USER', 'User', target.id, `Updated account ${target.username}`);
    saveDatabase();
    return res.json(sanitizeUser(target));
  });

  // Hierarchy
  app.get('/api/v1/hierarchy/overview', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const scopedWoredas = db.woredas.filter((w) => isWoredaInUserScope(user, w));
    const allowedZoneIds = new Set(scopedWoredas.map((w) => w.zone_id));
    const scopedZones = db.zones
      .filter((z) => allowedZoneIds.has(z.id))
      .map((z) => {
        const zw = scopedWoredas.filter((w) => w.zone_id === z.id);
        const zReports = db.reports.filter((r) => r.zone_id === z.id);
        return {
          ...z,
          woreda_count: zw.length,
          total_planned_target: zw.reduce((acc, w) => acc + w.total_planned_target, 0),
          daily_target: zw.reduce((acc, w) => acc + w.daily_target, 0),
          reported_count: zReports.filter((r) => r.status !== 'Draft').length,
          total_vaccinated_0_59m: zReports.reduce((acc, r) => acc + r.total_vaccinated_0_59m, 0),
        };
      });

    return res.json({
      region: db.region,
      zones: scopedZones,
      woredas: scopedWoredas,
    });
  });

  app.post('/api/v1/hierarchy/zones', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const {name, zone_type, latitude, longitude} = req.body || {};
    if (!name) return res.status(400).json({detail: 'Zone name is required.'});
    const clean = String(name).trim();
    const norm = clean.toLowerCase();
    if (db.zones.some((z) => z.normalized_name === norm)) {
      return res.status(409).json({detail: 'Zone already exists.'});
    }
    const code = clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_');
    const zone: ZoneRecord = {
      id: `zone-${code.toLowerCase()}`,
      region_id: db.region.id,
      code,
      name: clean,
      normalized_name: norm,
      zone_type: zone_type || 'Zone',
      latitude: Number(latitude) || 8.5,
      longitude: Number(longitude) || 38.8,
      is_active: true,
    };
    db.zones.push(zone);
    addAudit(req.user!, 'CREATE_ZONE', 'Zone', zone.id, `Created zone ${zone.name}`);
    saveDatabase();
    return res.status(201).json(zone);
  });

  app.post('/api/v1/hierarchy/woredas', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const {zone_id, name, total_planned_target, has_security_constraints} = req.body || {};
    const zone = db.zones.find((z) => z.id === zone_id);
    if (!zone) return res.status(404).json({detail: 'Zone not found.'});
    if (!name) return res.status(400).json({detail: 'Woreda name is required.'});
    const planned = Math.max(0, Number(total_planned_target) || 0);
    const divisor = db.campaigns[0]?.core_target_days_divisor || 4;
    const clean = String(name).trim();
    const woreda: WoredaRecord = {
      id: `woreda-${crypto.randomUUID().slice(0, 6)}`,
      zone_id: zone.id,
      zone_name: zone.name,
      reporting_unit_code: `${zone.code}-${clean.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}-${db.woredas.length + 1}`,
      source_sn: db.woredas.length + 1,
      name: clean,
      raw_excel_name: clean,
      is_duplicate_in_template: false,
      has_security_constraints: Boolean(has_security_constraints),
      total_planned_target: planned,
      daily_target: Math.round(planned / divisor),
      is_active: true,
    };
    db.woredas.push(woreda);
    addAudit(req.user!, 'CREATE_WOREDA', 'Woreda', woreda.id, `Added Woreda ${woreda.name} under ${zone.name} (Planned=${planned})`);
    saveDatabase();
    return res.status(201).json(woreda);
  });

  // Campaigns
  app.get('/api/v1/campaigns', requireAuth, (_req, res) => {
    return res.json(db.campaigns);
  });

  app.patch('/api/v1/campaigns/:id', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const campaign = db.campaigns.find((c) => c.id === req.params.id);
    if (!campaign) return res.status(404).json({detail: 'Campaign not found.'});
    if (req.body.status && ['Planned', 'Active', 'Closed'].includes(req.body.status)) {
      campaign.status = req.body.status;
    }
    if (typeof req.body.nopv2_doses_per_vial === 'number') {
      campaign.nopv2_doses_per_vial = Math.max(1, req.body.nopv2_doses_per_vial);
    }
    if (typeof req.body.bopv_doses_per_vial === 'number') {
      campaign.bopv_doses_per_vial = Math.max(1, req.body.bopv_doses_per_vial);
    }
    addAudit(req.user!, 'UPDATE_CAMPAIGN_CONFIG', 'Campaign', campaign.id, `Updated configuration for ${campaign.code}`);
    saveDatabase();
    return res.json(campaign);
  });

  app.patch('/api/v1/campaigns/:id/days/:dayId', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const campaign = db.campaigns.find((c) => c.id === req.params.id);
    if (!campaign) return res.status(404).json({detail: 'Campaign not found.'});
    const day = campaign.days.find((d) => d.id === req.params.dayId);
    if (!day) return res.status(404).json({detail: 'Campaign day not found.'});
    if (typeof req.body.is_open_for_reporting === 'boolean') {
      day.is_open_for_reporting = req.body.is_open_for_reporting;
    }
    evaluateCampaignAlerts();
    addAudit(req.user!, 'TOGGLE_CAMPAIGN_DAY', 'CampaignDay', day.id, `${day.label} reporting open=${day.is_open_for_reporting}`);
    saveDatabase();
    broadcastSseEvent('alert:updated', {reason: 'campaign_day_toggled', day_id: day.id});
    return res.json(day);
  });

  // Dashboard Overview
  app.get('/api/v1/dashboard/overview', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const campaign = db.campaigns[0];
    const activeCalc = getActiveCalculationConfig();
    const scopedWoredas = db.woredas.filter((w) => isWoredaInUserScope(user, w));
    const allowedWoredaIds = new Set(scopedWoredas.map((w) => w.id));
    const scopedReports = db.reports.filter((r) => allowedWoredaIds.has(r.woreda_id));
    const scopedSettlements = db.security_settlements.filter((s) => allowedWoredaIds.has(s.woreda_id));
    const scopedAlerts = db.alerts.filter((a) => !a.woreda_id || allowedWoredaIds.has(a.woreda_id));

    const computedPlanned = scopedWoredas.reduce((s, w) => s + w.total_planned_target, 0);
    const computedDaily = scopedWoredas.reduce((s, w) => s + w.daily_target, 0);
    const total059 = scopedReports.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
    const total60120 = scopedReports.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);

    const allowedZoneIds = new Set(scopedWoredas.map((w) => w.zone_id));
    const zones = db.zones
      .filter((z) => allowedZoneIds.has(z.id))
      .map((z) => {
        const zw = scopedWoredas.filter((w) => w.zone_id === z.id);
        const zr = scopedReports.filter((r) => r.zone_id === z.id);
        return {
          ...z,
          woreda_count: zw.length,
          total_planned_target: zw.reduce((s, w) => s + w.total_planned_target, 0),
          daily_target: zw.reduce((s, w) => s + w.daily_target, 0),
          reported_count: zr.filter((r) => r.status !== 'Draft').length,
          total_vaccinated_0_59m: zr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0),
        };
      });

    const openDaysCount = Math.max(1, campaign.days.filter((d) => d.is_open_for_reporting).length);
    const expectedReportSlots = scopedWoredas.length * openDaysCount;
    const submittedOrApproved = scopedReports.filter((r) => r.status !== 'Draft').length;

    let nopv2Received = 0;
    let nopv2Used = 0;
    let nopv2Partial = 0;
    let nopv2ReturnedGood = 0;
    let bopvReceived = 0;
    let bopvUsed = 0;
    let bopvPartial = 0;
    let bopvReturnedGood = 0;
    for (const r of scopedReports) {
      for (const vu of r.vaccine_utilizations || []) {
        if (vu.vaccine_type === 'nOPV2') {
          nopv2Received += vu.vials_received || 0;
          nopv2Used += vu.vials_used || 0;
          nopv2Partial += vu.vials_partially_used || 0;
          nopv2ReturnedGood += vu.vials_returned_unused_good || 0;
        } else if (vu.vaccine_type === 'bOPV') {
          bopvReceived += vu.vials_received || 0;
          bopvUsed += vu.vials_used || 0;
          bopvPartial += vu.vials_partially_used || 0;
          bopvReturnedGood += vu.vials_returned_unused_good || 0;
        }
      }
    }
    const nopv2Dpv = activeCalc.nopv2_doses_per_vial_by_day['1'] || campaign.nopv2_doses_per_vial || 50;
    const bopvDpv = activeCalc.bopv_doses_per_vial_by_day['1'] || campaign.bopv_doses_per_vial || 20;

    const totalTeams = scopedReports.reduce((s, r) => s + r.total_teams, 0);
    const teamsReported = scopedReports.reduce((s, r) => s + r.teams_reported, 0);
    const openAlerts = scopedAlerts.filter((a) => a.resolution_status !== 'Resolved');

    const statuses: ReportStatus[] = ['Draft', 'Submitted', 'Under Review', 'Approved', 'Returned for Correction'];
    const status_breakdown = statuses.map((status) => ({
      status,
      count: scopedReports.filter((r) => r.status === status).length,
    }));

    return res.json({
      campaign,
      active_calculation_config: activeCalc,
      sync_telemetry: {
        last_server_event_at: db.realtime_meta.last_server_event_at,
        last_report_received: db.realtime_meta.last_report_received,
        connected_clients: sseClients.size,
      },
      totals: {
        total_zones: zones.length,
        total_woredas: scopedWoredas.length,
        computed_planned_target: computedPlanned,
        template_reported_planned_target: db.template_summary.template_reported_planned_target,
        computed_daily_target: computedDaily,
        template_reported_daily_target: db.template_summary.template_reported_daily_target,
        reports_submitted_or_approved: submittedOrApproved,
        reports_approved: scopedReports.filter((r) => r.status === 'Approved').length,
        reports_returned: scopedReports.filter((r) => r.status === 'Returned for Correction').length,
        reporting_completeness_pct: safePercent(submittedOrApproved, expectedReportSlots),
        total_vaccinated_0_59m: total059,
        total_vaccinated_60_120m: total60120,
        afp_alerts: scopedReports.reduce((s, r) => s + r.afp_alerts_count, 0),
        aefi_alerts: scopedReports.reduce((s, r) => s + r.aefi_alerts_count, 0),
        zero_dose_identified: scopedReports.reduce((s, r) => s + r.zero_dose_identified, 0),
        zero_dose_linked: scopedReports.reduce((s, r) => s + (r.zero_dose_linked || 0), 0),
        zero_dose_vaccinated: scopedReports.reduce((s, r) => s + r.zero_dose_vaccinated, 0),
        under_vaccinated_identified: scopedReports.reduce((s, r) => s + r.under_vaccinated_identified, 0),
        under_vaccinated_linked: scopedReports.reduce((s, r) => s + (r.under_vaccinated_linked || 0), 0),
        under_vaccinated_vaccinated: scopedReports.reduce((s, r) => s + r.under_vaccinated_vaccinated, 0),
        teams_reported: teamsReported,
        total_teams: totalTeams,
        team_reporting_pct: safePercent(teamsReported, totalTeams),
        nopv2_vials_received: nopv2Received,
        nopv2_vials_used: nopv2Used,
        nopv2_wastage_pct: computeWastageRatePct(
          {
            vaccine_type: 'nOPV2',
            vials_received: nopv2Received,
            vials_used: nopv2Used,
            vials_partially_used: nopv2Partial,
            vials_returned_unused_good: nopv2ReturnedGood,
            vials_broken: 0,
            vials_returned_bad_stage_3_4: 0,
            vials_lost: 0,
          },
          total059,
          nopv2Dpv,
          activeCalc.wastage_denominator_mode,
        ),
        bopv_vials_received: bopvReceived,
        bopv_vials_used: bopvUsed,
        bopv_wastage_pct: computeWastageRatePct(
          {
            vaccine_type: 'bOPV',
            vials_received: bopvReceived,
            vials_used: bopvUsed,
            vials_partially_used: bopvPartial,
            vials_returned_unused_good: bopvReturnedGood,
            vials_broken: 0,
            vials_returned_bad_stage_3_4: 0,
            vials_lost: 0,
          },
          total059,
          bopvDpv,
          activeCalc.wastage_denominator_mode,
        ),
        regional_daily_coverage_pct: safePercent(total059, computedDaily),
        regional_total_coverage_pct: safePercent(total059, computedPlanned),
        security_settlements_count: scopedSettlements.length,
        security_settlements_target: scopedSettlements.reduce((s, st) => s + st.target_children_0_59m, 0),
        security_settlements_vaccinated: scopedSettlements.reduce((s, st) => s + st.vaccinated_children_0_59m, 0),
        open_alerts_count: openAlerts.length,
        critical_alerts_count: openAlerts.filter((a) => a.priority === 'Critical').length,
      },
      zones,
      status_breakdown,
      recent_notifications: db.notifications.slice(0, 8),
    });
  });

  // Calculation Configurations (Admin-Controlled Formulas)
  app.get('/api/v1/calculation-configs', requireAuth, (_req, res) => {
    return res.json(db.calculation_configs);
  });

  app.post('/api/v1/calculation-configs', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const body = req.body || {};
    if (!body.version || !body.name || !body.documented_definition) {
      return res.status(400).json({detail: 'version, name, and documented_definition are required.'});
    }
    const divisor = Number(body.daily_target_divisor) || 4;
    if (divisor !== 4 && divisor !== 6) {
      return res.status(400).json({detail: 'daily_target_divisor must be 4 or 6.'});
    }
    const cfg: CalculationConfigRecord = {
      id: `calc-${crypto.randomUUID().slice(0, 8)}`,
      campaign_id: db.campaigns[0].id,
      version: String(body.version).trim(),
      name: String(body.name).trim(),
      daily_target_divisor: divisor,
      nopv2_doses_per_vial_by_day: body.nopv2_doses_per_vial_by_day || {'1': 50, '2': 50, '3': 50, '4': 50, '5': 50, '6': 50},
      bopv_doses_per_vial_by_day: body.bopv_doses_per_vial_by_day || {'1': 20, '2': 20, '3': 20, '4': 20, '5': 20, '6': 20},
      wastage_denominator_mode: body.wastage_denominator_mode || 'used_plus_partial',
      total_vaccinated_scope: body.total_vaccinated_scope || '0-59m_only',
      documented_definition: String(body.documented_definition).trim(),
      approval_status: 'Pending Approval',
      is_active: false,
      created_by_username: req.user!.username,
      approved_by_username: null,
      approved_at: null,
      created_at: new Date().toISOString(),
    };
    db.calculation_configs.unshift(cfg);
    addAudit(req.user!, 'PROPOSE_CALCULATION_CONFIG', 'CalculationConfig', cfg.id, `Proposed ${cfg.version}: ${cfg.name}`);
    saveDatabase();
    return res.status(201).json(cfg);
  });

  app.post('/api/v1/calculation-configs/:id/approve', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const target = db.calculation_configs.find((c) => c.id === req.params.id);
    if (!target) return res.status(404).json({detail: 'Calculation configuration not found.'});
    const now = new Date().toISOString();
    for (const c of db.calculation_configs) {
      if (c.is_active && c.id !== target.id) {
        c.is_active = false;
        c.approval_status = 'Superseded';
      }
    }
    target.approval_status = 'Approved';
    target.is_active = true;
    target.approved_by_username = req.user!.username;
    target.approved_at = now;

    // Sync campaign parameters for consistent display
    const camp = db.campaigns[0];
    camp.core_target_days_divisor = target.daily_target_divisor;
    camp.nopv2_doses_per_vial = target.nopv2_doses_per_vial_by_day['1'] || camp.nopv2_doses_per_vial;
    camp.bopv_doses_per_vial = target.bopv_doses_per_vial_by_day['1'] || camp.bopv_doses_per_vial;

    addAudit(req.user!, 'APPROVE_CALCULATION_CONFIG', 'CalculationConfig', target.id, `Approved & activated formula profile ${target.version}`);
    addNotification('Calculation Formula Version Activated', `Formula ${target.version} (${target.name}) approved by ${req.user!.full_name}.`, 'info', null);
    saveDatabase();
    return res.json(target);
  });

  // Reports & Workflow
  app.get('/api/v1/reports', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const allowedWoredaIds = new Set(db.woredas.filter((w) => isWoredaInUserScope(user, w)).map((w) => w.id));
    const filtered = db.reports.filter((r) => allowedWoredaIds.has(r.woreda_id));
    return res.json(filtered);
  });

  app.post('/api/v1/reports', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'WOREDA_REPORTING_OFFICER']), (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = req.body || {};
    const clientReportId = typeof body.client_report_id === 'string' && body.client_report_id.trim()
      ? body.client_report_id.trim()
      : null;

    // Duplicate prevention via client-generated idempotency key
    if (clientReportId && db.processed_client_report_ids[clientReportId]) {
      const existingId = db.processed_client_report_ids[clientReportId];
      const existingRep = db.reports.find((r) => r.id === existingId);
      if (existingRep) {
        return res.status(200).json({...existingRep, duplicate_prevented: true, acknowledged: true});
      }
    }

    const woreda = db.woredas.find((w) => w.id === body.woreda_id);
    if (!woreda) return res.status(404).json({detail: 'Woreda not found.'});
    if (!isWoredaInUserScope(user, woreda)) {
      return res.status(403).json({detail: 'You cannot create or edit reports outside your assigned Woreda scope.'});
    }
    const campaign = db.campaigns[0];
    const day = campaign.days.find((d) => d.id === body.campaign_day_id);
    if (!day) return res.status(404).json({detail: 'Campaign day not found.'});

    let report = db.reports.find((r) => r.campaign_day_id === day.id && r.woreda_id === woreda.id);
    if (report && (report.is_locked || !['Draft', 'Returned for Correction'].includes(report.status))) {
      return res.status(409).json({
        detail: `Report is locked or currently in '${report.status}' status and cannot be modified.`,
        conflict: true,
        server_report: report,
      });
    }

    // Conflict detection when an offline client edits a stale version/timestamp
    if (report && body.base_version !== undefined && body.base_version !== null) {
      if (Number(body.base_version) !== report.version) {
        return res.status(409).json({
          detail: `Version conflict detected: offline report based on v${body.base_version}, but server holds v${report.version}.`,
          conflict: true,
          server_report: report,
        });
      }
    }
    if (report && body.base_updated_at && report.updated_at !== body.base_updated_at) {
      return res.status(409).json({
        detail: `Edit conflict detected: server report was updated at ${report.updated_at} after offline draft was captured (${body.base_updated_at}).`,
        conflict: true,
        server_report: report,
      });
    }

    const activeCalc = getActiveCalculationConfig();
    const nopv2Dpv = activeCalc.nopv2_doses_per_vial_by_day[String(day.day_number)] || campaign.nopv2_doses_per_vial || 50;
    const bopvDpv = activeCalc.bopv_doses_per_vial_by_day[String(day.day_number)] || campaign.bopv_doses_per_vial || 20;

    const ageGroups = Array.isArray(body.age_groups) ? body.age_groups : [];
    const rawVaccines = Array.isArray(body.vaccine_utilizations) ? body.vaccine_utilizations : [];

    const afpAlerts = Number(body.afp_alerts_count) || 0;
    const aefiAlerts = Number(body.aefi_alerts_count) || 0;
    const hhsVisited = Number(body.hhs_visited) || 0;
    const communityMeetings = Number(body.community_meeting_participants) || 0;
    const ipcReached = Number(body.home_to_home_ipc_reached) || 0;
    const zeroDoseId = Number(body.zero_dose_identified) || 0;
    const zeroDoseLinked = Number(body.zero_dose_linked) || 0;
    const zeroDoseVax = Number(body.zero_dose_vaccinated) || 0;
    const underVaxId = Number(body.under_vaccinated_identified) || 0;
    const underVaxLinked = Number(body.under_vaccinated_linked) || 0;
    const underVaxVax = Number(body.under_vaccinated_vaccinated) || 0;
    const totalTeams = Number(body.total_teams) || 0;
    const teamsReported = Number(body.teams_reported) || 0;

    const validation = validateDailyReportData({
      ageGroups,
      vaccines: rawVaccines,
      afpAlerts,
      aefiAlerts,
      hhsVisited,
      communityMeetings,
      ipcReached,
      zeroDoseIdentified: zeroDoseId,
      zeroDoseLinked,
      zeroDoseVaccinated: zeroDoseVax,
      underVaxIdentified: underVaxId,
      underVaxLinked,
      underVaxVaccinated: underVaxVax,
      totalTeams,
      teamsReported,
      nopv2DosesPerVial: nopv2Dpv,
      bopvDosesPerVial: bopvDpv,
      wastageMode: activeCalc.wastage_denominator_mode,
    });

    if (validation.errors.length > 0) {
      return res.status(422).json({detail: validation.errors.join(' ')});
    }

    const totals = computeVaccinationTotals(ageGroups, activeCalc.total_vaccinated_scope);
    const vaccineUtils = rawVaccines.map((vu: any) => {
      const dpv = vu.vaccine_type === 'nOPV2' ? nopv2Dpv : bopvDpv;
      const wastage = computeWastageRatePct(vu, totals.effectiveTotal, dpv, activeCalc.wastage_denominator_mode);
      return {...vu, wastage_rate_pct: wastage};
    });

    const dailyTarget =
      activeCalc.daily_target_divisor === 6
        ? Math.round(woreda.total_planned_target / 6)
        : woreda.daily_target;
    const dailyCov = safePercent(totals.effectiveTotal, dailyTarget);
    const now = new Date().toISOString();
    const reportingLevel: 'Woreda' | 'Zone' | 'Region' = ['Woreda', 'Zone', 'Region'].includes(body.reporting_level)
      ? body.reporting_level
      : 'Woreda';
    const shouldSubmit = body.auto_submit === true;

    if (!report) {
      report = {
        id: `rep-${crypto.randomUUID().slice(0, 8)}`,
        campaign_id: campaign.id,
        campaign_day_id: day.id,
        day_number: day.day_number,
        day_label: day.label,
        reporting_level: reportingLevel,
        woreda_id: woreda.id,
        woreda_name: woreda.name,
        zone_id: woreda.zone_id,
        zone_name: woreda.zone_name,
        total_planned_target: woreda.total_planned_target,
        daily_target: dailyTarget,
        status: shouldSubmit ? 'Submitted' : 'Draft',
        is_locked: false,
        version: 1,
        age_groups: ageGroups,
        vaccine_utilizations: vaccineUtils,
        total_vaccinated_0_59m: totals.effectiveTotal,
        total_vaccinated_60_120m: totals.sum60120,
        cumulative_vaccinated_0_59m: totals.effectiveTotal,
        daily_coverage_pct: dailyCov,
        cumulative_coverage_pct: safePercent(totals.effectiveTotal, woreda.total_planned_target),
        afp_alerts_count: afpAlerts,
        aefi_alerts_count: aefiAlerts,
        hhs_visited: hhsVisited,
        community_meeting_participants: communityMeetings,
        home_to_home_ipc_reached: ipcReached,
        zero_dose_identified: zeroDoseId,
        zero_dose_linked: zeroDoseLinked,
        zero_dose_vaccinated: zeroDoseVax,
        under_vaccinated_identified: underVaxId,
        under_vaccinated_linked: underVaxLinked,
        under_vaccinated_vaccinated: underVaxVax,
        total_teams: totalTeams,
        teams_reported: teamsReported,
        any_remark: String(body.any_remark || ''),
        validation_warnings: validation.warnings,
        client_report_id: clientReportId,
        server_received_at: now,
        updated_at: now,
        histories: [],
      };
      db.reports.unshift(report);
    } else {
      const prevStatus = report.status;
      Object.assign(report, {
        reporting_level: reportingLevel,
        daily_target: dailyTarget,
        status: shouldSubmit ? 'Submitted' : report.status,
        age_groups: ageGroups,
        vaccine_utilizations: vaccineUtils,
        total_vaccinated_0_59m: totals.effectiveTotal,
        total_vaccinated_60_120m: totals.sum60120,
        daily_coverage_pct: dailyCov,
        afp_alerts_count: afpAlerts,
        aefi_alerts_count: aefiAlerts,
        hhs_visited: hhsVisited,
        community_meeting_participants: communityMeetings,
        home_to_home_ipc_reached: ipcReached,
        zero_dose_identified: zeroDoseId,
        zero_dose_linked: zeroDoseLinked,
        zero_dose_vaccinated: zeroDoseVax,
        under_vaccinated_identified: underVaxId,
        under_vaccinated_linked: underVaxLinked,
        under_vaccinated_vaccinated: underVaxVax,
        total_teams: totalTeams,
        teams_reported: teamsReported,
        any_remark: String(body.any_remark || ''),
        validation_warnings: validation.warnings,
        client_report_id: clientReportId || report.client_report_id,
        server_received_at: now,
        updated_at: now,
      });
      if (shouldSubmit && prevStatus !== 'Submitted') {
        report.histories.unshift({
          id: `hist-${crypto.randomUUID().slice(0, 8)}`,
          from_status: prevStatus,
          to_status: 'Submitted',
          action: 'OfflineSyncSubmit',
          actor_username: user.username,
          actor_full_name: user.full_name,
          comment: 'Synchronized and submitted from offline queue.',
          version: report.version,
          created_at: now,
        });
      }
    }

    if (clientReportId) {
      db.processed_client_report_ids[clientReportId] = report.id;
    }

    recomputeWoredaCumulative(woreda.id);

    if (!shouldSubmit || report.histories.length === 0) {
      report.histories.unshift({
        id: `hist-${crypto.randomUUID().slice(0, 8)}`,
        from_status: report.status,
        to_status: report.status,
        action: shouldSubmit ? 'OfflineSyncSubmit' : 'SaveDraft',
        actor_username: user.username,
        actor_full_name: user.full_name,
        comment: shouldSubmit ? 'Synchronized and submitted from offline queue.' : 'Saved daily report draft.',
        version: report.version,
        created_at: now,
      });
    }

    db.realtime_meta.last_report_received = {
      report_id: report.id,
      woreda_name: report.woreda_name,
      zone_name: report.zone_name,
      day_label: report.day_label,
      status: report.status,
      received_at: now,
    };

    evaluateCampaignAlerts();
    addAudit(
      user,
      shouldSubmit ? 'SYNC_SUBMIT_REPORT' : 'SAVE_DRAFT_REPORT',
      'DailyVaccinationReport',
      report.id,
      `${woreda.name} (${day.label}): 0-59m=${totals.effectiveTotal}${clientReportId ? ` [client_id=${clientReportId}]` : ''}`,
    );
    saveDatabase();

    broadcastSseEvent(
      'report:received',
      {
        report_id: report.id,
        woreda_id: report.woreda_id,
        woreda_name: report.woreda_name,
        zone_id: report.zone_id,
        zone_name: report.zone_name,
        day_label: report.day_label,
        status: report.status,
        received_at: now,
      },
      {zoneId: report.zone_id, woredaId: report.woreda_id},
    );

    return res.status(201).json({...report, acknowledged: true, duplicate_prevented: false});
  });

  function transitionReport(
    req: AuthedRequest,
    res: Response,
    allowedFrom: ReportStatus[],
    toStatus: ReportStatus,
    action: string,
    lock: boolean | null,
    requireComment: boolean,
  ) {
    const user = req.user!;
    const report = db.reports.find((r) => r.id === req.params.id);
    if (!report) return res.status(404).json({detail: 'Report not found.'});
    const woreda = db.woredas.find((w) => w.id === report.woreda_id);
    if (!woreda || !isWoredaInUserScope(user, woreda)) {
      return res.status(403).json({detail: 'Report is outside your administrative scope.'});
    }
    if (!allowedFrom.includes(report.status)) {
      return res.status(409).json({detail: `Cannot transition report from '${report.status}' to '${toStatus}'.`});
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (requireComment && !comment) {
      return res.status(400).json({detail: 'A comment or justification is mandatory for this workflow action.'});
    }

    const prevStatus = report.status;
    report.status = toStatus;
    if (lock !== null) report.is_locked = lock;
    if (action === 'Reopen') report.version += 1;
    const now = new Date().toISOString();
    report.server_received_at = report.server_received_at || now;
    report.updated_at = now;

    report.histories.unshift({
      id: `hist-${crypto.randomUUID().slice(0, 8)}`,
      from_status: prevStatus,
      to_status: toStatus,
      action,
      actor_username: user.username,
      actor_full_name: user.full_name,
      comment: comment || null,
      version: report.version,
      created_at: report.updated_at,
    });

    if (report.afp_alerts_count > 0 || report.aefi_alerts_count > 0) {
      addNotification(
        `Surveillance Alert: ${report.woreda_name} (${report.day_label})`,
        `AFP Alerts: ${report.afp_alerts_count}, AEFI Alerts: ${report.aefi_alerts_count}`,
        'critical',
        'REGIONAL_COORDINATION_TEAM',
      );
    } else {
      addNotification(
        `Report ${toStatus}: ${report.woreda_name}`,
        comment || `${report.day_label} report transitioned from ${prevStatus} to ${toStatus} by ${user.full_name}.`,
        toStatus === 'Returned for Correction' ? 'warning' : 'info',
        toStatus === 'Submitted' ? 'ZONE_ADMIN' : 'WOREDA_REPORTING_OFFICER',
      );
    }

    db.realtime_meta.last_report_received = {
      report_id: report.id,
      woreda_name: report.woreda_name,
      zone_name: report.zone_name,
      day_label: report.day_label,
      status: report.status,
      received_at: now,
    };

    evaluateCampaignAlerts();
    addAudit(user, `REPORT_${action.toUpperCase()}`, 'DailyVaccinationReport', report.id, `${report.woreda_name} ${prevStatus} -> ${toStatus}${comment ? ` (${comment})` : ''}`);
    saveDatabase();

    broadcastSseEvent(
      'report:workflow',
      {
        report_id: report.id,
        woreda_id: report.woreda_id,
        woreda_name: report.woreda_name,
        zone_id: report.zone_id,
        zone_name: report.zone_name,
        day_label: report.day_label,
        status: report.status,
        received_at: now,
      },
      {zoneId: report.zone_id, woredaId: report.woreda_id},
    );

    return res.json(report);
  }

  app.post('/api/v1/reports/:id/submit', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'WOREDA_REPORTING_OFFICER']), (req: AuthedRequest, res) => {
    return transitionReport(req, res, ['Draft', 'Returned for Correction'], 'Submitted', 'Submit', false, false);
  });

  app.post('/api/v1/reports/:id/review', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    return transitionReport(req, res, ['Submitted'], 'Under Review', 'StartReview', null, false);
  });

  app.post('/api/v1/reports/:id/approve', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    return transitionReport(req, res, ['Submitted', 'Under Review'], 'Approved', 'Approve', true, false);
  });

  app.post('/api/v1/reports/:id/return', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    return transitionReport(req, res, ['Submitted', 'Under Review'], 'Returned for Correction', 'ReturnForCorrection', false, true);
  });

  app.post('/api/v1/reports/:id/reopen', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    return transitionReport(req, res, ['Approved'], 'Returned for Correction', 'Reopen', false, true);
  });

  // Workbook Audit & Discrepancies
  app.get('/api/v1/workbook-audit/discrepancies', requireAuth, (_req, res) => {
    return res.json({
      discrepancies: db.discrepancies,
      template_summary: db.template_summary,
    });
  });

  app.post('/api/v1/workbook-audit/discrepancies/:id/resolve', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const disc = db.discrepancies.find((d) => d.id === req.params.id);
    if (!disc) return res.status(404).json({detail: 'Discrepancy not found.'});
    const {ohb_approval_status, resolution_notes} = req.body || {};
    if (!ohb_approval_status) return res.status(400).json({detail: 'ohb_approval_status is required.'});
    disc.ohb_approval_status = ohb_approval_status;
    disc.resolution_notes = resolution_notes || null;
    disc.updated_at = new Date().toISOString();
    addAudit(req.user!, 'RESOLVE_FORMULA_DISCREPANCY', 'FormulaDiscrepancy', disc.id, `${disc.title} -> ${ohb_approval_status}`);
    saveDatabase();
    return res.json(disc);
  });

  // Excel Import Preview, Commit & History
  app.get('/api/v1/imports/history', requireAuth, (_req, res) => {
    return res.json(db.import_histories);
  });

  app.post('/api/v1/imports/preview', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const body = req.body || {};
    const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
    const seenKeys = new Set<string>();
    const preview: ExcelImportPreviewRow[] = [];

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i] || {};
      const worksheet = String(r.worksheet || 'Day1').trim();
      const rawRegion = String(r.raw_region ?? r.region ?? '');
      const rawZone = String(r.raw_zone ?? r.zone ?? '');
      const rawWoreda = String(r.raw_woreda ?? r.woreda ?? '');
      const normZone = rawZone.trim().toLowerCase();
      const normWoreda = rawWoreda.trim().toLowerCase();

      const matchedDay =
        db.campaigns[0].days.find(
          (d) =>
            d.worksheet_name.toLowerCase() === worksheet.toLowerCase() ||
            d.label.toLowerCase() === worksheet.toLowerCase(),
        ) || db.campaigns[0].days[0];

      const matchedZone = db.zones.find(
        (z) => z.normalized_name === normZone || z.name.toLowerCase() === normZone,
      );
      const matchedWoreda = matchedZone
        ? db.woredas.find(
            (w) =>
              w.zone_id === matchedZone.id &&
              (w.name.toLowerCase() === normWoreda || w.raw_excel_name.trim().toLowerCase() === normWoreda),
          )
        : db.woredas.find(
            (w) => w.name.toLowerCase() === normWoreda || w.raw_excel_name.trim().toLowerCase() === normWoreda,
          );

      const issues: string[] = [];
      if (!rawZone.trim() || !rawWoreda.trim()) {
        issues.push('Missing Zone or Woreda identifier.');
      } else if (!matchedWoreda) {
        issues.push(`Administrative unit not found in Oromia hierarchy: '${rawZone.trim()} / ${rawWoreda.trim()}'.`);
      }

      if (rawZone !== rawZone.trim() || rawWoreda !== rawWoreda.trim()) {
        issues.push('Raw Excel name contains leading/trailing whitespace (normalized on match, raw preserved).');
      }

      const age011vb = Number(r.age_0_11_vb) || 0;
      const age011nv = Number(r.age_0_11_nv) || 0;
      const age1259vb = Number(r.age_12_59_vb) || 0;
      const age1259nv = Number(r.age_12_59_nv) || 0;
      const age60120vb = Number(r.age_60_120_vb) || 0;
      const age60120nv = Number(r.age_60_120_nv) || 0;

      const total059 = age011vb + age011nv + age1259vb + age1259nv;
      const total60120 = age60120vb + age60120nv;

      const numericValues = [
        Number(r.planned_target) || 0,
        Number(r.daily_target) || 0,
        age011vb,
        age011nv,
        age1259vb,
        age1259nv,
        age60120vb,
        age60120nv,
        Number(r.afp_alerts_count) || 0,
        Number(r.aefi_alerts_count) || 0,
        Number(r.total_teams) || 0,
        Number(r.teams_reported) || 0,
      ];
      if (numericValues.some((v) => v < 0)) {
        issues.push('Negative numeric value detected.');
      }
      if ((Number(r.teams_reported) || 0) > (Number(r.total_teams) || 0) && (Number(r.total_teams) || 0) > 0) {
        issues.push('Teams reported exceeds total vaccination teams.');
      }
      if (r.planned_target === '' || r.planned_target === null || r.planned_target === undefined) {
        issues.push('Missing Planned Target cell in workbook.');
      }

      const dedupKey = `${matchedDay.id}::${matchedWoreda ? matchedWoreda.id : `${normZone}::${normWoreda}`}::${String(r.settlement_name || '')}`;
      const isDup = seenKeys.has(dedupKey);
      seenKeys.add(dedupKey);
      if (isDup) {
        issues.push('Duplicate record for same Worksheet + Woreda in import file.');
      }

      const existing =
        matchedWoreda && worksheet.toLowerCase() !== 'security affected areas'
          ? db.reports.find((rep) => rep.campaign_day_id === matchedDay.id && rep.woreda_id === matchedWoreda.id)
          : null;
      const approvedProtected = Boolean(existing && (existing.status === 'Approved' || existing.is_locked));
      if (approvedProtected) {
        issues.push('Existing Approved (Locked) report exists — protected from accidental overwrite.');
      }

      let validation_status: ExcelImportPreviewRow['validation_status'] = 'Valid';
      if (approvedProtected) {
        validation_status = 'Protected (Approved)';
      } else if (!matchedWoreda || numericValues.some((v) => v < 0) || isDup) {
        validation_status = 'Invalid';
      } else if (issues.length > 0) {
        validation_status = 'Warning';
      }

      preview.push({
        row_index: Number(r.row_index) || i + 1,
        worksheet,
        raw_region: rawRegion,
        raw_zone: rawZone,
        raw_woreda: rawWoreda,
        matched_woreda_id: matchedWoreda ? matchedWoreda.id : null,
        matched_woreda_name: matchedWoreda ? matchedWoreda.name : null,
        matched_zone_name: matchedWoreda ? matchedWoreda.zone_name : matchedZone?.name || null,
        campaign_day_id: matchedDay.id,
        day_label: matchedDay.label,
        planned_target: Number(r.planned_target) || matchedWoreda?.total_planned_target || 0,
        daily_target: Number(r.daily_target) || matchedWoreda?.daily_target || 0,
        total_vaccinated_0_59m: total059,
        total_vaccinated_60_120m: total60120,
        validation_status,
        issues,
        is_duplicate: isDup,
        existing_approved_protected: approvedProtected,
        payload: r,
      });
    }

    return res.json({
      filename: body.filename || 'workbook.xlsx',
      total_rows: preview.length,
      valid_count: preview.filter((p) => p.validation_status === 'Valid').length,
      warning_count: preview.filter((p) => p.validation_status === 'Warning').length,
      invalid_count: preview.filter((p) => p.validation_status === 'Invalid').length,
      protected_count: preview.filter((p) => p.validation_status === 'Protected (Approved)').length,
      preview_rows: preview,
    });
  });

  app.post('/api/v1/imports/commit', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = req.body || {};
    const filename = String(body.filename || 'imported_campaign_workbook.xlsx');
    const previewRows: ExcelImportPreviewRow[] = Array.isArray(body.rows) ? body.rows : [];
    const activeCalc = getActiveCalculationConfig();
    const campaign = db.campaigns[0];
    const now = new Date().toISOString();

    let importedCount = 0;
    let skippedApproved = 0;
    let invalidCount = 0;
    let duplicates = 0;
    const sheetsSet = new Set<string>();

    for (const row of previewRows) {
      sheetsSet.add(row.worksheet);
      if (row.is_duplicate) duplicates += 1;
      if (row.existing_approved_protected || row.validation_status === 'Protected (Approved)') {
        skippedApproved += 1;
        continue;
      }
      if (row.validation_status === 'Invalid' || !row.matched_woreda_id) {
        invalidCount += 1;
        continue;
      }

      const woreda = db.woredas.find((w) => w.id === row.matched_woreda_id);
      if (!woreda) {
        invalidCount += 1;
        continue;
      }
      const p: any = row.payload || {};

      // Security Affected Areas sheet routes strictly to isolated SecuritySettlement registry
      if (row.worksheet.toLowerCase().includes('security')) {
        const settleName = String(p.settlement_name || p.kebele_name || `${woreda.name} Security Settlement`);
        const target = Math.max(0, Number(p.planned_target) || Number(p.target_children_0_59m) || 0);
        const dailyT = Math.max(0, Number(p.daily_target) || Math.round(target / activeCalc.daily_target_divisor));
        const vax = Math.max(0, row.total_vaccinated_0_59m);
        let settle = db.security_settlements.find(
          (s) => s.woreda_id === woreda.id && s.settlement_name.toLowerCase() === settleName.toLowerCase(),
        );
        if (!settle) {
          settle = {
            id: `sec-${crypto.randomUUID().slice(0, 8)}`,
            woreda_id: woreda.id,
            woreda_name: woreda.name,
            zone_id: woreda.zone_id,
            zone_name: woreda.zone_name,
            settlement_name: settleName,
            kebele_name: String(p.kebele_name || settleName),
            access_status: p.access_status || 'Partially Accessible',
            intervention_modality: String(p.intervention_modality || 'Special Campaign Modality'),
            target_children_0_59m: target,
            daily_target_0_59m: dailyT,
            vaccinated_children_0_59m: vax,
            security_notes: `Imported from ${filename} (${row.worksheet})`,
          };
          db.security_settlements.push(settle);
        } else {
          settle.target_children_0_59m = target || settle.target_children_0_59m;
          settle.daily_target_0_59m = dailyT || settle.daily_target_0_59m;
          settle.vaccinated_children_0_59m = vax;
        }
        importedCount += 1;
        continue;
      }

      const day = campaign.days.find((d) => d.id === row.campaign_day_id) || campaign.days[0];
      let report = db.reports.find((r) => r.campaign_day_id === day.id && r.woreda_id === woreda.id);
      if (report && (report.is_locked || report.status === 'Approved')) {
        skippedApproved += 1;
        continue;
      }

      const ageGroups = [
        {age_group: '0-11m' as const, vaccinated_before: Number(p.age_0_11_vb) || 0, not_vaccinated_before: Number(p.age_0_11_nv) || 0},
        {age_group: '12-59m' as const, vaccinated_before: Number(p.age_12_59_vb) || 0, not_vaccinated_before: Number(p.age_12_59_nv) || 0},
        {age_group: '60-120m' as const, vaccinated_before: Number(p.age_60_120_vb) || 0, not_vaccinated_before: Number(p.age_60_120_nv) || 0},
      ];
      const totals = computeVaccinationTotals(ageGroups, activeCalc.total_vaccinated_scope);
      const nopv2Dpv = activeCalc.nopv2_doses_per_vial_by_day[String(day.day_number)] || 50;
      const bopvDpv = activeCalc.bopv_doses_per_vial_by_day[String(day.day_number)] || 20;

      const nopv2Vu = {
        vaccine_type: 'nOPV2' as const,
        vials_received: Number(p.nopv2_received) || 0,
        vials_used: Number(p.nopv2_used) || 0,
        vials_partially_used: Number(p.nopv2_partial) || 0,
        vials_returned_unused_good: Number(p.nopv2_returned_good) || 0,
        vials_broken: Number(p.nopv2_broken) || 0,
        vials_returned_bad_stage_3_4: Number(p.nopv2_returned_bad) || 0,
        vials_lost: Number(p.nopv2_lost) || 0,
      };
      const bopvVu = {
        vaccine_type: 'bOPV' as const,
        vials_received: Number(p.bopv_received) || 0,
        vials_used: Number(p.bopv_used) || 0,
        vials_partially_used: Number(p.bopv_partial) || 0,
        vials_returned_unused_good: Number(p.bopv_returned_good) || 0,
        vials_broken: Number(p.bopv_broken) || 0,
        vials_returned_bad_stage_3_4: Number(p.bopv_returned_bad) || 0,
        vials_lost: Number(p.bopv_lost) || 0,
      };

      const vaccineUtils = [
        {...nopv2Vu, wastage_rate_pct: computeWastageRatePct(nopv2Vu, totals.effectiveTotal, nopv2Dpv, activeCalc.wastage_denominator_mode)},
        {...bopvVu, wastage_rate_pct: computeWastageRatePct(bopvVu, totals.effectiveTotal, bopvDpv, activeCalc.wastage_denominator_mode)},
      ];

      const dailyTarget = row.daily_target || woreda.daily_target;
      const dailyCov = safePercent(totals.effectiveTotal, dailyTarget);

      if (!report) {
        report = {
          id: `rep-${crypto.randomUUID().slice(0, 8)}`,
          campaign_id: campaign.id,
          campaign_day_id: day.id,
          day_number: day.day_number,
          day_label: day.label,
          reporting_level: 'Woreda',
          woreda_id: woreda.id,
          woreda_name: woreda.name,
          zone_id: woreda.zone_id,
          zone_name: woreda.zone_name,
          total_planned_target: woreda.total_planned_target,
          daily_target: dailyTarget,
          status: 'Submitted',
          is_locked: false,
          version: 1,
          age_groups: ageGroups,
          vaccine_utilizations: vaccineUtils,
          total_vaccinated_0_59m: totals.effectiveTotal,
          total_vaccinated_60_120m: totals.sum60120,
          cumulative_vaccinated_0_59m: totals.effectiveTotal,
          daily_coverage_pct: dailyCov,
          cumulative_coverage_pct: safePercent(totals.effectiveTotal, woreda.total_planned_target),
          afp_alerts_count: Number(p.afp_alerts_count) || 0,
          aefi_alerts_count: Number(p.aefi_alerts_count) || 0,
          hhs_visited: Number(p.hhs_visited) || 0,
          community_meeting_participants: Number(p.community_meeting_participants) || 0,
          home_to_home_ipc_reached: Number(p.home_to_home_ipc_reached) || 0,
          zero_dose_identified: Number(p.zero_dose_identified) || 0,
          zero_dose_linked: Number(p.zero_dose_linked) || 0,
          zero_dose_vaccinated: Number(p.zero_dose_vaccinated) || 0,
          under_vaccinated_identified: Number(p.under_vaccinated_identified) || 0,
          under_vaccinated_linked: Number(p.under_vaccinated_linked) || 0,
          under_vaccinated_vaccinated: Number(p.under_vaccinated_vaccinated) || 0,
          total_teams: Number(p.total_teams) || 0,
          teams_reported: Number(p.teams_reported) || 0,
          any_remark: String(p.any_remark || `Imported from ${filename} (${row.worksheet})`),
          updated_at: now,
          histories: [],
        };
        db.reports.unshift(report);
      } else {
        Object.assign(report, {
          age_groups: ageGroups,
          vaccine_utilizations: vaccineUtils,
          total_vaccinated_0_59m: totals.effectiveTotal,
          total_vaccinated_60_120m: totals.sum60120,
          daily_coverage_pct: dailyCov,
          afp_alerts_count: Number(p.afp_alerts_count) || 0,
          aefi_alerts_count: Number(p.aefi_alerts_count) || 0,
          hhs_visited: Number(p.hhs_visited) || 0,
          community_meeting_participants: Number(p.community_meeting_participants) || 0,
          home_to_home_ipc_reached: Number(p.home_to_home_ipc_reached) || 0,
          zero_dose_identified: Number(p.zero_dose_identified) || 0,
          zero_dose_linked: Number(p.zero_dose_linked) || 0,
          zero_dose_vaccinated: Number(p.zero_dose_vaccinated) || 0,
          under_vaccinated_identified: Number(p.under_vaccinated_identified) || 0,
          under_vaccinated_linked: Number(p.under_vaccinated_linked) || 0,
          under_vaccinated_vaccinated: Number(p.under_vaccinated_vaccinated) || 0,
          total_teams: Number(p.total_teams) || 0,
          teams_reported: Number(p.teams_reported) || 0,
          any_remark: String(p.any_remark || report.any_remark),
          updated_at: now,
        });
      }
      report.histories.unshift({
        id: `hist-${crypto.randomUUID().slice(0, 8)}`,
        from_status: report.status,
        to_status: report.status,
        action: 'ExcelImport',
        actor_username: user.username,
        actor_full_name: user.full_name,
        comment: `Imported from ${filename} (${row.worksheet}); raw=${row.raw_zone.trim()}/${row.raw_woreda.trim()}`,
        version: report.version,
        created_at: now,
      });
      recomputeWoredaCumulative(woreda.id);
      importedCount += 1;
    }

    const hist: ExcelImportHistoryRecord = {
      id: `imp-${crypto.randomUUID().slice(0, 8)}`,
      filename,
      worksheets_detected: Array.from(sheetsSet),
      rows_total: previewRows.length,
      rows_imported: importedCount,
      rows_skipped_approved: skippedApproved,
      rows_invalid: invalidCount,
      duplicates_detected: duplicates,
      imported_by_username: user.username,
      imported_by_name: user.full_name,
      status: invalidCount > 0 || skippedApproved > 0 ? 'Partial with Warnings' : 'Completed',
      notes: `Imported ${importedCount}/${previewRows.length} rows. Approved skipped: ${skippedApproved}. Invalid skipped: ${invalidCount}.`,
      created_at: now,
    };
    db.import_histories.unshift(hist);
    evaluateCampaignAlerts();
    addAudit(user, 'COMMIT_EXCEL_IMPORT', 'ExcelImportHistory', hist.id, `${filename}: ${importedCount} imported, ${skippedApproved} protected skipped, ${invalidCount} invalid`);
    saveDatabase();
    broadcastSseEvent('report:received', {reason: 'excel_import_commit', imported_count: importedCount});
    return res.status(201).json(hist);
  });

  // Security-Affected Settlements & Daily Settlement Reporting (Isolated from Woreda totals)
  app.get('/api/v1/security-settlements', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const allowedWoredaIds = new Set(db.woredas.filter((w) => isWoredaInUserScope(user, w)).map((w) => w.id));
    return res.json(db.security_settlements.filter((s) => allowedWoredaIds.has(s.woreda_id)));
  });

  app.post('/api/v1/security-settlements', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    const body = req.body || {};
    const woreda = db.woredas.find((w) => w.id === body.woreda_id);
    if (!woreda) return res.status(404).json({detail: 'Woreda not found.'});
    if (!isWoredaInUserScope(req.user!, woreda)) {
      return res.status(403).json({detail: 'Woreda is outside your assigned administrative scope.'});
    }
    if (!body.settlement_name) return res.status(400).json({detail: 'settlement_name is required.'});
    const target = Math.max(0, Number(body.target_children_0_59m) || 0);
    const divisor = getActiveCalculationConfig().daily_target_divisor || 4;
    const settle: SecuritySettlementRecord = {
      id: `sec-${crypto.randomUUID().slice(0, 8)}`,
      woreda_id: woreda.id,
      woreda_name: woreda.name,
      zone_id: woreda.zone_id,
      zone_name: woreda.zone_name,
      settlement_name: String(body.settlement_name).trim(),
      kebele_name: String(body.kebele_name || '').trim() || 'Unspecified Kebele',
      access_status: body.access_status || 'Partially Accessible',
      intervention_modality: String(body.intervention_modality || 'Hit-and-Run / Transit'),
      target_children_0_59m: target,
      daily_target_0_59m: Number(body.daily_target_0_59m) > 0 ? Number(body.daily_target_0_59m) : Math.round(target / divisor),
      vaccinated_children_0_59m: 0,
      security_notes: String(body.security_notes || ''),
    };
    db.security_settlements.push(settle);
    addAudit(req.user!, 'CREATE_SECURITY_SETTLEMENT', 'SecurityAffectedSettlement', settle.id, `${settle.settlement_name} (${woreda.name})`);
    saveDatabase();
    return res.status(201).json(settle);
  });

  app.get('/api/v1/security-reports', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const allowedWoredaIds = new Set(db.woredas.filter((w) => isWoredaInUserScope(user, w)).map((w) => w.id));
    return res.json(db.security_reports.filter((r) => allowedWoredaIds.has(r.woreda_id)));
  });

  app.post('/api/v1/security-reports', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN', 'WOREDA_REPORTING_OFFICER']), (req: AuthedRequest, res) => {
    const user = req.user!;
    const body = req.body || {};
    const settlement = db.security_settlements.find((s) => s.id === body.settlement_id);
    if (!settlement) return res.status(404).json({detail: 'Security-affected settlement not found.'});
    const woreda = db.woredas.find((w) => w.id === settlement.woreda_id);
    if (!woreda || !isWoredaInUserScope(user, woreda)) {
      return res.status(403).json({detail: 'Settlement is outside your administrative scope.'});
    }
    const day = db.campaigns[0].days.find((d) => d.id === body.campaign_day_id);
    if (!day) return res.status(404).json({detail: 'Campaign day not found.'});

    const v011 = Number(body.vaccinated_0_11m) || 0;
    const v1259 = Number(body.vaccinated_12_59m) || 0;
    const v60120 = Number(body.vaccinated_60_120m) || 0;
    const teams = Number(body.teams_deployed) || 0;
    if (v011 < 0 || v1259 < 0 || v60120 < 0 || teams < 0) {
      return res.status(422).json({detail: 'Negative values are prohibited in security settlement reports.'});
    }

    const total059 = v011 + v1259;
    const now = new Date().toISOString();
    let rec = db.security_reports.find((r) => r.settlement_id === settlement.id && r.campaign_day_id === day.id);
    if (!rec) {
      rec = {
        id: `secrep-${crypto.randomUUID().slice(0, 8)}`,
        campaign_day_id: day.id,
        day_number: day.day_number,
        day_label: day.label,
        settlement_id: settlement.id,
        settlement_name: settlement.settlement_name,
        woreda_id: settlement.woreda_id,
        woreda_name: settlement.woreda_name,
        zone_id: settlement.zone_id,
        zone_name: settlement.zone_name,
        target_children_0_59m: settlement.target_children_0_59m,
        daily_target_0_59m: settlement.daily_target_0_59m,
        vaccinated_0_11m: v011,
        vaccinated_12_59m: v1259,
        vaccinated_60_120m: v60120,
        total_vaccinated_0_59m: total059,
        daily_coverage_pct: safePercent(total059, settlement.daily_target_0_59m),
        cumulative_coverage_pct: null,
        teams_deployed: teams,
        status: 'Submitted',
        remarks: String(body.remarks || ''),
        reported_by_username: user.username,
        updated_at: now,
      };
      db.security_reports.unshift(rec);
    } else {
      Object.assign(rec, {
        vaccinated_0_11m: v011,
        vaccinated_12_59m: v1259,
        vaccinated_60_120m: v60120,
        total_vaccinated_0_59m: total059,
        daily_coverage_pct: safePercent(total059, settlement.daily_target_0_59m),
        teams_deployed: teams,
        remarks: String(body.remarks || ''),
        reported_by_username: user.username,
        updated_at: now,
      });
    }

    // Recompute isolated settlement cumulative total across Days 1..6 (never touches regular woreda totals)
    const settleReports = db.security_reports
      .filter((r) => r.settlement_id === settlement.id)
      .sort((a, b) => a.day_number - b.day_number);
    let cum = 0;
    for (const sr of settleReports) {
      cum += sr.total_vaccinated_0_59m;
      sr.cumulative_coverage_pct = safePercent(cum, settlement.target_children_0_59m);
    }
    settlement.vaccinated_children_0_59m = cum;

    evaluateCampaignAlerts();
    addAudit(user, 'SAVE_SECURITY_SETTLEMENT_REPORT', 'SecurityDailyReport', rec.id, `${settlement.settlement_name} (${day.label}): 0-59m=${total059}`);
    saveDatabase();
    broadcastSseEvent(
      'report:received',
      {
        report_id: rec.id,
        woreda_id: rec.woreda_id,
        woreda_name: `${rec.woreda_name} (${rec.settlement_name})`,
        zone_id: rec.zone_id,
        zone_name: rec.zone_name,
        day_label: rec.day_label,
        status: rec.status,
        received_at: now,
      },
      {zoneId: rec.zone_id, woredaId: rec.woreda_id},
    );
    return res.status(201).json(rec);
  });

  // Audit Logs & Notifications
  app.get('/api/v1/audit-logs', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'MONITORING_OFFICER']), (_req, res) => {
    return res.json(db.audit_logs);
  });

  app.get('/api/v1/notifications', requireAuth, (_req, res) => {
    return res.json(db.notifications);
  });

  app.post('/api/v1/notifications/:id/read', requireAuth, (req: AuthedRequest, res) => {
    const n = db.notifications.find((item) => item.id === req.params.id);
    if (n) {
      n.is_read = true;
      saveDatabase();
    }
    return res.json({ok: true});
  });

  // Performance Threshold Configuration (Never Invent Official Thresholds)
  app.get('/api/v1/monitoring-thresholds', requireAuth, (_req, res) => {
    return res.json(db.thresholds);
  });

  app.post('/api/v1/monitoring-thresholds', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const b = req.body || {};
    const numOrNull = (val: unknown) =>
      val === '' || val === null || val === undefined ? null : Number.isFinite(Number(val)) ? Number(val) : null;

    db.thresholds.high_coverage_min_pct = numOrNull(b.high_coverage_min_pct);
    db.thresholds.medium_coverage_min_pct = numOrNull(b.medium_coverage_min_pct);
    db.thresholds.high_completeness_min_pct = numOrNull(b.high_completeness_min_pct);
    db.thresholds.high_wastage_alert_pct = numOrNull(b.high_wastage_alert_pct);
    db.thresholds.late_report_cutoff_hour_utc = numOrNull(b.late_report_cutoff_hour_utc);
    db.thresholds.declining_performance_drop_pct = numOrNull(b.declining_performance_drop_pct);
    db.thresholds.notes = typeof b.notes === 'string' ? b.notes.trim() : db.thresholds.notes;
    db.thresholds.is_configured = [
      db.thresholds.high_coverage_min_pct,
      db.thresholds.medium_coverage_min_pct,
      db.thresholds.high_completeness_min_pct,
      db.thresholds.high_wastage_alert_pct,
      db.thresholds.late_report_cutoff_hour_utc,
      db.thresholds.declining_performance_drop_pct,
    ].some((v) => v !== null);
    db.thresholds.updated_by_username = req.user!.username;
    db.thresholds.updated_at = new Date().toISOString();

    evaluateCampaignAlerts();
    addAudit(req.user!, 'UPDATE_MONITORING_THRESHOLDS', 'PerformanceThresholdConfig', db.thresholds.id, `Configured=${db.thresholds.is_configured}`);
    saveDatabase();
    broadcastSseEvent('alert:updated', {reason: 'thresholds_updated'});
    return res.json(db.thresholds);
  });

  // GIS Authentic Administrative Boundary Layers (No Fabricated Polygons/Coordinates)
  app.get('/api/v1/gis/layers', requireAuth, (_req, res) => {
    return res.json(db.gis_layers);
  });

  app.post('/api/v1/gis/layers', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const b = req.body || {};
    if (!b.name || !b.admin_level || !b.source_citation || !b.geojson) {
      return res.status(400).json({detail: 'name, admin_level, source_citation, and geojson are required.'});
    }
    const geojson = b.geojson;
    if (geojson.type !== 'FeatureCollection' || !Array.isArray(geojson.features)) {
      return res.status(400).json({detail: 'GeoJSON must be a valid FeatureCollection with a features array.'});
    }

    const adminLevel: GisBoundaryLayerRecord['admin_level'] = ['Region', 'Zone', 'Woreda', 'Settlement'].includes(b.admin_level)
      ? b.admin_level
      : 'Woreda';

    // Count features that match known Oromia Zones or Woredas by common GeoJSON property keys
    const zoneNames = new Set(db.zones.map((z) => z.name.toLowerCase()));
    const woredaNames = new Set(db.woredas.map((w) => w.name.toLowerCase()));
    let matchedCount = 0;
    for (const f of geojson.features) {
      const props = (f && typeof f === 'object' ? f.properties : {}) || {};
      const candidates = [
        props.woreda,
        props.Woreda,
        props.WOREDA,
        props.ADM3_EN,
        props.zone,
        props.Zone,
        props.ZONE,
        props.ADM2_EN,
        props.name,
        props.NAME,
      ]
        .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
        .map((v) => v.trim().toLowerCase());
      if (candidates.some((c) => woredaNames.has(c) || zoneNames.has(c))) {
        matchedCount += 1;
      }
    }

    const layer: GisBoundaryLayerRecord = {
      id: `gis-${crypto.randomUUID().slice(0, 8)}`,
      name: String(b.name).trim(),
      admin_level: adminLevel,
      source_citation: String(b.source_citation).trim(),
      feature_count: geojson.features.length,
      matched_units_count: matchedCount,
      geojson,
      uploaded_by_username: req.user!.username,
      created_at: new Date().toISOString(),
    };
    db.gis_layers.unshift(layer);
    addAudit(req.user!, 'UPLOAD_GIS_LAYER', 'GisBoundaryLayer', layer.id, `${layer.name} (${layer.admin_level}, ${layer.feature_count} features, ${layer.matched_units_count} matched)`);
    saveDatabase();
    broadcastSseEvent('gis:updated', {layer_id: layer.id, name: layer.name});
    return res.status(201).json(layer);
  });

  app.delete('/api/v1/gis/layers/:id', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']), (req: AuthedRequest, res) => {
    const idx = db.gis_layers.findIndex((l) => l.id === req.params.id);
    if (idx === -1) return res.status(404).json({detail: 'GIS boundary layer not found.'});
    const [removed] = db.gis_layers.splice(idx, 1);
    addAudit(req.user!, 'DELETE_GIS_LAYER', 'GisBoundaryLayer', removed.id, `Removed boundary layer ${removed.name}`);
    saveDatabase();
    broadcastSseEvent('gis:updated', {layer_id: removed.id, deleted: true});
    return res.json({ok: true});
  });

  // Alert & Notification Engine Endpoints
  app.get('/api/v1/alerts', requireAuth, (req: AuthedRequest, res) => {
    const user = req.user!;
    const allowedWoredaIds = new Set(db.woredas.filter((w) => isWoredaInUserScope(user, w)).map((w) => w.id));
    const scoped = db.alerts.filter((a) => !a.woreda_id || allowedWoredaIds.has(a.woreda_id));
    return res.json(scoped);
  });

  app.post('/api/v1/alerts/scan', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    evaluateCampaignAlerts();
    addAudit(req.user!, 'SCAN_CAMPAIGN_ALERTS', 'CampaignAlert', 'batch', `Scanned campaign alerts (total=${db.alerts.length})`);
    saveDatabase();
    broadcastSseEvent('alert:updated', {reason: 'manual_scan'});
    const allowedWoredaIds = new Set(db.woredas.filter((w) => isWoredaInUserScope(req.user!, w)).map((w) => w.id));
    return res.json(db.alerts.filter((a) => !a.woreda_id || allowedWoredaIds.has(a.woreda_id)));
  });

  app.post('/api/v1/alerts/:id/acknowledge', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN', 'WOREDA_REPORTING_OFFICER']), (req: AuthedRequest, res) => {
    const alert = db.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({detail: 'Alert not found.'});
    if (alert.woreda_id) {
      const woreda = db.woredas.find((w) => w.id === alert.woreda_id);
      if (woreda && !isWoredaInUserScope(req.user!, woreda)) {
        return res.status(403).json({detail: 'Alert is outside your administrative scope.'});
      }
    }
    alert.resolution_status = 'Acknowledged';
    alert.acknowledged_by = req.user!.full_name;
    alert.acknowledged_at = new Date().toISOString();
    addAudit(req.user!, 'ACKNOWLEDGE_ALERT', 'CampaignAlert', alert.id, `${alert.alert_type} - ${alert.admin_location}`);
    saveDatabase();
    broadcastSseEvent('alert:updated', {alert_id: alert.id, status: alert.resolution_status}, {zoneId: alert.zone_id, woredaId: alert.woreda_id});
    return res.json(alert);
  });

  app.post('/api/v1/alerts/:id/resolve', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    const alert = db.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({detail: 'Alert not found.'});
    if (alert.woreda_id) {
      const woreda = db.woredas.find((w) => w.id === alert.woreda_id);
      if (woreda && !isWoredaInUserScope(req.user!, woreda)) {
        return res.status(403).json({detail: 'Alert is outside your administrative scope.'});
      }
    }
    const notes = typeof req.body?.resolution_notes === 'string' ? req.body.resolution_notes.trim() : '';
    if (!notes) {
      return res.status(400).json({detail: 'Resolution notes are mandatory when resolving an alert.'});
    }
    alert.resolution_status = 'Resolved';
    alert.resolution_notes = notes;
    alert.resolved_by = req.user!.full_name;
    alert.resolved_at = new Date().toISOString();
    addAudit(req.user!, 'RESOLVE_ALERT', 'CampaignAlert', alert.id, `${alert.alert_type} resolved: ${notes}`);
    saveDatabase();
    broadcastSseEvent('alert:updated', {alert_id: alert.id, status: alert.resolution_status}, {zoneId: alert.zone_id, woredaId: alert.woreda_id});
    return res.json(alert);
  });

  app.post('/api/v1/alerts/:id/reopen', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'ZONE_ADMIN']), (req: AuthedRequest, res) => {
    const alert = db.alerts.find((a) => a.id === req.params.id);
    if (!alert) return res.status(404).json({detail: 'Alert not found.'});
    alert.resolution_status = 'Open';
    alert.resolved_by = null;
    alert.resolved_at = null;
    addAudit(req.user!, 'REOPEN_ALERT', 'CampaignAlert', alert.id, `${alert.alert_type} reopened`);
    saveDatabase();
    broadcastSseEvent('alert:updated', {alert_id: alert.id, status: alert.resolution_status}, {zoneId: alert.zone_id, woredaId: alert.woreda_id});
    return res.json(alert);
  });

  // Configurable Email/SMS Alert Providers & Honest Dispatch Logs
  app.get('/api/v1/notifications/providers', requireAuth, (_req, res) => {
    return res.json({
      providers: db.notification_providers,
      dispatch_logs: db.dispatch_logs.slice(0, 100),
    });
  });

  app.patch('/api/v1/notifications/providers/:channel', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const channel = req.params.channel === 'Email' ? 'Email' : req.params.channel === 'SMS' ? 'SMS' : null;
    if (!channel) return res.status(400).json({detail: 'Channel must be Email or SMS.'});
    const cfg = db.notification_providers.find((p) => p.channel === channel);
    if (!cfg) return res.status(404).json({detail: 'Provider config not found.'});
    const b = req.body || {};
    cfg.provider_name = typeof b.provider_name === 'string' ? b.provider_name.trim() : cfg.provider_name;
    cfg.endpoint_url = typeof b.endpoint_url === 'string' ? b.endpoint_url.trim() : cfg.endpoint_url;
    cfg.sender_identifier = typeof b.sender_identifier === 'string' ? b.sender_identifier.trim() : cfg.sender_identifier;
    cfg.has_credentials = Boolean(b.has_credentials && cfg.endpoint_url.length > 0);
    cfg.is_enabled = Boolean(b.is_enabled && cfg.has_credentials && cfg.endpoint_url.length > 0);
    if (['Critical', 'High', 'Medium', 'Low'].includes(b.min_priority)) {
      cfg.min_priority = b.min_priority;
    }
    cfg.updated_by_username = req.user!.username;
    cfg.updated_at = new Date().toISOString();
    addAudit(req.user!, 'UPDATE_NOTIFICATION_PROVIDER', 'NotificationProviderConfig', cfg.id, `${channel} enabled=${cfg.is_enabled}`);
    saveDatabase();
    return res.json(cfg);
  });

  app.post('/api/v1/notifications/providers/:channel/test', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), async (req: AuthedRequest, res) => {
    const channel = req.params.channel === 'Email' ? 'Email' : req.params.channel === 'SMS' ? 'SMS' : null;
    if (!channel) return res.status(400).json({detail: 'Channel must be Email or SMS.'});
    const cfg = db.notification_providers.find((p) => p.channel === channel);
    if (!cfg || !cfg.is_enabled || !cfg.has_credentials || !cfg.endpoint_url) {
      const log: NotificationDispatchLogRecord = {
        id: `dlog-${crypto.randomUUID().slice(0, 8)}`,
        alert_id: 'test-probe',
        channel,
        recipient: req.user!.email,
        status: 'Not Configured',
        detail: `${channel} provider is not configured with live credentials/endpoint. No delivery simulated.`,
        created_at: new Date().toISOString(),
      };
      db.dispatch_logs.unshift(log);
      saveDatabase();
      return res.status(400).json({detail: log.detail, log});
    }
    try {
      const resp = await fetch(cfg.endpoint_url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({
          test: true,
          sender: cfg.sender_identifier,
          recipient: req.user!.email,
          message: 'OHB OPCMS Alert Provider Connectivity Verification',
        }),
      });
      const log: NotificationDispatchLogRecord = {
        id: `dlog-${crypto.randomUUID().slice(0, 8)}`,
        alert_id: 'test-probe',
        channel,
        recipient: req.user!.email,
        status: resp.ok ? 'Dispatched' : 'Delivery Failed',
        detail: `Endpoint responded with HTTP ${resp.status}.`,
        created_at: new Date().toISOString(),
      };
      db.dispatch_logs.unshift(log);
      saveDatabase();
      return res.json({ok: resp.ok, log});
    } catch (err: unknown) {
      const log: NotificationDispatchLogRecord = {
        id: `dlog-${crypto.randomUUID().slice(0, 8)}`,
        alert_id: 'test-probe',
        channel,
        recipient: req.user!.email,
        status: 'Delivery Failed',
        detail: err instanceof Error ? err.message : 'Connection failed.',
        created_at: new Date().toISOString(),
      };
      db.dispatch_logs.unshift(log);
      saveDatabase();
      return res.status(502).json({detail: log.detail, log});
    }
  });

  // Command Room: Read-Only Snapshot, Live Display SSE & Revocable Display Sessions
  app.get(
    '/api/v1/command-room/sessions',
    requireAuth,
    requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']),
    (_req, res) => {
      return res.json(db.display_sessions.map(sanitizeDisplaySession));
    },
  );

  app.post(
    '/api/v1/command-room/sessions',
    requireAuth,
    requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']),
    (req: AuthedRequest, res) => {
      const b = req.body || {};
      const label = typeof b.label === 'string' && b.label.trim() ? b.label.trim() : 'OHB Command Video Wall';
      const layoutNum = [1, 2, 3, 4, 5].includes(Number(b.default_layout))
        ? (Number(b.default_layout) as 1 | 2 | 3 | 4 | 5)
        : 1;
      const rotationSec = Math.max(10, Math.min(300, Number(b.rotation_seconds) || 30));
      const expiresHours = Number(b.expires_in_hours) > 0 ? Math.min(720, Number(b.expires_in_hours)) : 24;
      const rawToken = `opcms_disp_${crypto.randomBytes(24).toString('hex')}`;
      const now = new Date();
      const session: CommandDisplaySessionStored = {
        id: `disp-${crypto.randomUUID().slice(0, 8)}`,
        label,
        token_prefix: `${rawToken.slice(0, 18)}...`,
        token_hash: hashDisplayToken(rawToken),
        default_layout: layoutNum,
        rotation_seconds: rotationSec,
        is_active: true,
        created_by_username: req.user!.username,
        created_at: now.toISOString(),
        expires_at: new Date(now.getTime() + expiresHours * 3600_000).toISOString(),
        revoked_at: null,
        revoked_by_username: null,
        last_accessed_at: null,
      };
      db.display_sessions.unshift(session);
      addAudit(
        req.user!,
        'CREATE_COMMAND_DISPLAY_SESSION',
        'CommandDisplaySession',
        session.id,
        `Created read-only display token '${session.label}' (expires ${session.expires_at})`,
      );
      saveDatabase();
      return res.status(201).json({
        session: sanitizeDisplaySession(session),
        display_token: rawToken,
      });
    },
  );

  app.post(
    '/api/v1/command-room/sessions/:id/revoke',
    requireAuth,
    requireRoles(['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM']),
    (req: AuthedRequest, res) => {
      const session = db.display_sessions.find((s) => s.id === req.params.id);
      if (!session) return res.status(404).json({detail: 'Command Room display session not found.'});
      session.is_active = false;
      session.revoked_at = new Date().toISOString();
      session.revoked_by_username = req.user!.username;

      // Immediately disconnect any live SSE display clients bound to this session
      for (const [cid, client] of displaySseClients.entries()) {
        if (client.sessionId === session.id) {
          try {
            client.res.write(`event: revoked\ndata: ${JSON.stringify({session_id: session.id})}\n\n`);
            client.res.end();
          } catch {
            // ignore
          }
          displaySseClients.delete(cid);
        }
      }

      addAudit(
        req.user!,
        'REVOKE_COMMAND_DISPLAY_SESSION',
        'CommandDisplaySession',
        session.id,
        `Revoked read-only display session '${session.label}'`,
      );
      saveDatabase();
      return res.json(sanitizeDisplaySession(session));
    },
  );

  app.get('/api/v1/command-room/snapshot', (req, res) => {
    const authHeader = req.headers.authorization;
    const bearer = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const displayToken =
      (typeof req.query.display_token === 'string' && req.query.display_token) ||
      (typeof req.headers['x-display-token'] === 'string' ? req.headers['x-display-token'] : '');

    if (bearer) {
      const payload = verifyToken(bearer);
      const user = payload ? db.users.find((u) => u.id === payload.sub && u.is_active) : null;
      if (!user) {
        return res.status(401).json({detail: 'Invalid or expired access token.'});
      }
      return res.json(buildCommandRoomSnapshot(`Authenticated Command Session · ${user.role_name}`));
    }

    if (displayToken) {
      const session = resolveActiveDisplaySession(displayToken);
      if (!session) {
        return res.status(401).json({detail: 'Command Room display token is invalid, expired, or revoked.'});
      }
      saveDatabase();
      return res.json(buildCommandRoomSnapshot(session.label));
    }

    return res.status(401).json({detail: 'Authentication or valid Command Room display_token is required.'});
  });

  app.get('/api/v1/command-room/stream', (req, res) => {
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    const authHeader = req.headers.authorization;
    const bearer = queryToken || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '');
    const displayToken =
      (typeof req.query.display_token === 'string' && req.query.display_token) ||
      (typeof req.headers['x-display-token'] === 'string' ? req.headers['x-display-token'] : '');

    let sessionId = 'authenticated-user';
    if (bearer) {
      const payload = verifyToken(bearer);
      const user = payload ? db.users.find((u) => u.id === payload.sub && u.is_active) : null;
      if (!user) return res.status(401).json({detail: 'Invalid SSE stream token.'});
    } else if (displayToken) {
      const session = resolveActiveDisplaySession(displayToken);
      if (!session) {
        return res.status(401).json({detail: 'Command Room display token is invalid, expired, or revoked.'});
      }
      sessionId = session.id;
    } else {
      return res.status(401).json({detail: 'Missing token or display_token for Command Room stream.'});
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const clientId = crypto.randomUUID();
    displaySseClients.set(clientId, {id: clientId, sessionId, res});

    res.write(
      `event: connected\ndata: ${JSON.stringify({
        server_time: new Date().toISOString(),
        last_server_event_at: db.realtime_meta.last_server_event_at,
        last_report_received: db.realtime_meta.last_report_received,
      })}\n\n`,
    );

    const heartbeat = setInterval(() => {
      try {
        res.write(`event: heartbeat\ndata: ${JSON.stringify({server_time: new Date().toISOString()})}\n\n`);
      } catch {
        clearInterval(heartbeat);
        displaySseClients.delete(clientId);
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      displaySseClients.delete(clientId);
    });
  });

  // Database Backup & Verified Restoration (Regional System Admin Only)
  app.get('/api/v1/admin/backup', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const exportedAt = new Date().toISOString();
    const canonicalData = JSON.stringify(db);
    const checksum = crypto.createHash('sha256').update(canonicalData).digest('hex');
    const bundle = {
      app: 'OPCMS',
      organization: 'Oromia Health Bureau (OHB)',
      campaign: db.campaigns[0]?.code || 'OHB-2026-R1-NOPV2-BOPV',
      schema_version: '4.0',
      exported_at: exportedAt,
      exported_by: req.user!.username,
      record_counts: {
        zones: db.zones.length,
        woredas: db.woredas.length,
        reports: db.reports.length,
        security_settlements: db.security_settlements.length,
        security_reports: db.security_reports.length,
        alerts: db.alerts.length,
        audit_logs: db.audit_logs.length,
      },
      checksum_sha256: checksum,
      data: JSON.parse(canonicalData),
    };
    addAudit(
      req.user!,
      'EXPORT_DATABASE_BACKUP',
      'SystemDatabase',
      'runtime-db',
      `Exported SHA-256 verified backup (${checksum.slice(0, 12)}..., ${db.reports.length} reports)`,
    );
    saveDatabase();
    res.setHeader('Content-Disposition', `attachment; filename="opcms_backup_${exportedAt.slice(0, 10)}.json"`);
    return res.json(bundle);
  });

  app.post('/api/v1/admin/restore', requireAuth, requireRoles(['REGIONAL_SYSTEM_ADMIN']), (req: AuthedRequest, res) => {
    const body = req.body || {};
    if (body.app !== 'OPCMS' || !body.data || typeof body.data !== 'object' || typeof body.checksum_sha256 !== 'string') {
      return res.status(400).json({detail: 'Invalid OPCMS backup bundle format. Expected app, checksum_sha256, and data.'});
    }
    const candidateJson = JSON.stringify(body.data);
    const computedChecksum = crypto.createHash('sha256').update(candidateJson).digest('hex');
    if (computedChecksum !== body.checksum_sha256) {
      return res.status(400).json({
        detail: `Backup integrity verification failed (SHA-256 checksum mismatch: expected ${body.checksum_sha256.slice(0, 12)}, got ${computedChecksum.slice(0, 12)}).`,
      });
    }
    const d = body.data as Partial<RuntimeDatabase>;
    if (!Array.isArray(d.woredas) || !Array.isArray(d.zones) || !Array.isArray(d.campaigns) || !Array.isArray(d.users)) {
      return res.status(400).json({detail: 'Backup payload is missing required OPCMS hierarchy or campaign collections.'});
    }

    // Write pre-restore safety snapshot before overwriting active state
    const safetyFile = path.resolve(process.cwd(), `.opcms-pre-restore-${Date.now()}.json`);
    fs.writeFileSync(safetyFile, JSON.stringify(db, null, 2));

    Object.assign(db, {
      ...db,
      ...d,
      display_sessions: Array.isArray(d.display_sessions) ? d.display_sessions : [],
      processed_client_report_ids: d.processed_client_report_ids || {},
    });
    evaluateCampaignAlerts();
    addAudit(
      req.user!,
      'RESTORE_DATABASE_BACKUP',
      'SystemDatabase',
      'runtime-db',
      `Restored verified backup (${computedChecksum.slice(0, 12)}..., pre-restore snapshot saved)`,
    );
    saveDatabase();
    broadcastSseEvent('report:workflow', {reason: 'database_restored'});
    return res.json({
      ok: true,
      restored_checksum: computedChecksum,
      pre_restore_snapshot_created: true,
      counts: {
        zones: db.zones.length,
        woredas: db.woredas.length,
        reports: db.reports.length,
        alerts: db.alerts.length,
      },
    });
  });

  // Vite or Static Hosting
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {middlewareMode: true},
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`OPCMS Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start OPCMS server:', err);
  process.exit(1);
});
