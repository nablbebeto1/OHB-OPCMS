export type RoleCode =
  | 'REGIONAL_SYSTEM_ADMIN'
  | 'REGIONAL_COORDINATION_TEAM'
  | 'ZONE_ADMIN'
  | 'WOREDA_REPORTING_OFFICER'
  | 'MONITORING_OFFICER';

export type ReportStatus =
  | 'Draft'
  | 'Submitted'
  | 'Under Review'
  | 'Approved'
  | 'Returned for Correction';

export type WastageDenominatorMode =
  | 'used_plus_partial'
  | 'used_only'
  | 'received_minus_returned_good';

export type TotalVaccinatedScope = '0-59m_only' | '0-120m_all';

export interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  is_read_only: boolean;
  permissions: string[];
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role_code: RoleCode;
  role_name: string;
  is_read_only: boolean;
  region_id: string;
  zone_id: string | null;
  woreda_id: string | null;
  zone_name: string | null;
  woreda_name: string | null;
  is_active: boolean;
  last_login_at: string | null;
}

export interface ZoneRecord {
  id: string;
  region_id: string;
  code: string;
  name: string;
  normalized_name: string;
  zone_type: 'Zone' | 'Town' | 'City';
  latitude: number;
  longitude: number;
  is_active: boolean;
  woreda_count?: number;
  total_planned_target?: number;
  daily_target?: number;
  reported_count?: number;
  total_vaccinated_0_59m?: number;
}

export interface WoredaRecord {
  id: string;
  zone_id: string;
  zone_name: string;
  reporting_unit_code: string;
  source_sn: number | null;
  name: string;
  raw_excel_name: string;
  is_duplicate_in_template: boolean;
  has_security_constraints: boolean;
  total_planned_target: number;
  daily_target: number;
  is_active: boolean;
}

export interface CampaignDayRecord {
  id: string;
  campaign_id: string;
  day_number: number;
  label: string;
  worksheet_name: string;
  day_type: 'Core' | 'Mop-Up';
  campaign_date: string;
  is_open_for_reporting: boolean;
}

export interface CampaignRecord {
  id: string;
  code: string;
  name: string;
  round_number: number;
  vaccine_types: string;
  nopv2_doses_per_vial: number;
  bopv_doses_per_vial: number;
  core_target_days_divisor: number;
  total_campaign_days: number;
  start_date: string;
  end_date: string;
  status: 'Planned' | 'Active' | 'Closed';
  days: CampaignDayRecord[];
}

export interface CalculationConfigRecord {
  id: string;
  campaign_id: string;
  version: string;
  name: string;
  daily_target_divisor: number;
  nopv2_doses_per_vial_by_day: Record<string, number>;
  bopv_doses_per_vial_by_day: Record<string, number>;
  wastage_denominator_mode: WastageDenominatorMode;
  total_vaccinated_scope: TotalVaccinatedScope;
  documented_definition: string;
  approval_status: 'Draft' | 'Pending Approval' | 'Approved' | 'Superseded';
  is_active: boolean;
  created_by_username: string;
  approved_by_username: string | null;
  approved_at: string | null;
  created_at: string;
}

export interface AgeGroupInput {
  age_group: '0-11m' | '12-59m' | '60-120m';
  vaccinated_before: number;
  not_vaccinated_before: number;
}

export interface VaccineUtilizationInput {
  vaccine_type: 'nOPV2' | 'bOPV';
  vials_received: number;
  vials_used: number;
  vials_partially_used: number;
  vials_returned_unused_good: number;
  vials_broken: number;
  vials_returned_bad_stage_3_4: number;
  vials_lost: number;
  wastage_rate_pct?: number | null;
}

export interface ReportHistoryEntry {
  id: string;
  from_status: ReportStatus | null;
  to_status: ReportStatus;
  action: string;
  actor_username: string;
  actor_full_name: string;
  comment: string | null;
  version: number;
  created_at: string;
}

export interface DailyReportRecord {
  id: string;
  campaign_id: string;
  campaign_day_id: string;
  day_number: number;
  day_label: string;
  reporting_level: 'Woreda' | 'Zone' | 'Region';
  woreda_id: string;
  woreda_name: string;
  zone_id: string;
  zone_name: string;
  total_planned_target: number;
  daily_target: number;
  status: ReportStatus;
  is_locked: boolean;
  version: number;
  age_groups: AgeGroupInput[];
  vaccine_utilizations: VaccineUtilizationInput[];
  total_vaccinated_0_59m: number;
  total_vaccinated_60_120m: number;
  cumulative_vaccinated_0_59m: number;
  daily_coverage_pct: number | null;
  cumulative_coverage_pct: number | null;
  afp_alerts_count: number;
  aefi_alerts_count: number;
  hhs_visited: number;
  community_meeting_participants: number;
  home_to_home_ipc_reached: number;
  zero_dose_identified: number;
  zero_dose_linked: number;
  zero_dose_vaccinated: number;
  under_vaccinated_identified: number;
  under_vaccinated_linked: number;
  under_vaccinated_vaccinated: number;
  total_teams: number;
  teams_reported: number;
  any_remark: string;
  validation_warnings?: string[];
  client_report_id?: string | null;
  server_received_at?: string | null;
  updated_at: string;
  histories: ReportHistoryEntry[];
}

export interface FormulaDiscrepancyRecord {
  id: string;
  worksheet: string;
  cell_or_column: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low' | 'Info';
  title: string;
  observed_value: string;
  expected_value: string;
  recommendation: string;
  ohb_approval_status: 'Pending OHB Review' | 'Approved Correction' | 'Keep As-Is' | 'Deferred';
  resolution_notes: string | null;
  updated_at: string;
}

export interface SecuritySettlementRecord {
  id: string;
  woreda_id: string;
  woreda_name: string;
  zone_id: string;
  zone_name: string;
  settlement_name: string;
  kebele_name: string;
  access_status: 'Accessible' | 'Partially Accessible' | 'Inaccessible';
  intervention_modality: string;
  target_children_0_59m: number;
  daily_target_0_59m: number;
  vaccinated_children_0_59m: number;
  security_notes: string;
}

export interface SecurityDailyReportRecord {
  id: string;
  campaign_day_id: string;
  day_number: number;
  day_label: string;
  settlement_id: string;
  settlement_name: string;
  woreda_id: string;
  woreda_name: string;
  zone_id: string;
  zone_name: string;
  target_children_0_59m: number;
  daily_target_0_59m: number;
  vaccinated_0_11m: number;
  vaccinated_12_59m: number;
  vaccinated_60_120m: number;
  total_vaccinated_0_59m: number;
  daily_coverage_pct: number | null;
  cumulative_coverage_pct: number | null;
  teams_deployed: number;
  status: ReportStatus;
  remarks: string;
  reported_by_username: string;
  updated_at: string;
}

export interface ExcelImportPreviewRow {
  row_index: number;
  worksheet: string;
  raw_region: string;
  raw_zone: string;
  raw_woreda: string;
  matched_woreda_id: string | null;
  matched_woreda_name: string | null;
  matched_zone_name: string | null;
  campaign_day_id: string;
  day_label: string;
  planned_target: number;
  daily_target: number;
  total_vaccinated_0_59m: number;
  total_vaccinated_60_120m: number;
  validation_status: 'Valid' | 'Warning' | 'Invalid' | 'Protected (Approved)';
  issues: string[];
  is_duplicate: boolean;
  existing_approved_protected: boolean;
  payload: Record<string, unknown> | null;
}

export interface ExcelImportHistoryRecord {
  id: string;
  filename: string;
  worksheets_detected: string[];
  rows_total: number;
  rows_imported: number;
  rows_skipped_approved: number;
  rows_invalid: number;
  duplicates_detected: number;
  imported_by_username: string;
  imported_by_name: string;
  status: 'Completed' | 'Partial with Warnings';
  notes: string;
  created_at: string;
}

export interface AuditLogRecord {
  id: string;
  actor_username: string;
  actor_role: string;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export interface NotificationRecord {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  recipient_role_code: RoleCode | null;
  is_read: boolean;
  created_at: string;
}

export type AlertType =
  | 'Missing Daily Report'
  | 'Late Report'
  | 'Low Vaccination Coverage'
  | 'Declining Performance'
  | 'High Vaccine Wastage'
  | 'AFP Alert'
  | 'AEFI Alert'
  | 'Missing Team Reports'
  | 'Security Settlement Reporting Gap'
  | 'Zero-Dose Follow-up Gap'
  | 'Under-Vaccinated Follow-up Gap';

export type AlertPriority = 'Critical' | 'High' | 'Medium' | 'Low';

export type AlertResolutionStatus = 'Open' | 'Acknowledged' | 'Resolved';

export interface CampaignAlertRecord {
  id: string;
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
  detected_at: string;
  responsible_officer: string;
  resolution_status: AlertResolutionStatus;
  resolution_notes: string | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  resolved_by: string | null;
  resolved_at: string | null;
}

export interface PerformanceThresholdConfig {
  id: string;
  is_configured: boolean;
  high_coverage_min_pct: number | null;
  medium_coverage_min_pct: number | null;
  high_completeness_min_pct: number | null;
  high_wastage_alert_pct: number | null;
  late_report_cutoff_hour_utc: number | null;
  declining_performance_drop_pct: number | null;
  notes: string;
  updated_by_username: string | null;
  updated_at: string;
}

export interface GisBoundaryLayerRecord {
  id: string;
  name: string;
  admin_level: 'Region' | 'Zone' | 'Woreda' | 'Settlement';
  source_citation: string;
  feature_count: number;
  matched_units_count: number;
  geojson: {
    type: 'FeatureCollection';
    features: Array<{
      type: 'Feature';
      properties: Record<string, unknown>;
      geometry: unknown;
    }>;
  };
  uploaded_by_username: string;
  created_at: string;
}

export interface NotificationProviderConfig {
  id: string;
  channel: 'Email' | 'SMS';
  provider_name: string;
  endpoint_url: string;
  sender_identifier: string;
  is_enabled: boolean;
  has_credentials: boolean;
  min_priority: AlertPriority;
  updated_by_username: string | null;
  updated_at: string;
}

export interface NotificationDispatchLogRecord {
  id: string;
  alert_id: string;
  channel: 'Email' | 'SMS';
  recipient: string;
  status: 'Dispatched' | 'Not Configured' | 'Delivery Failed';
  detail: string;
  created_at: string;
}

export interface RealtimeSyncTelemetry {
  last_server_event_at: string;
  last_report_received: {
    report_id: string;
    woreda_name: string;
    zone_name: string;
    day_label: string;
    status: ReportStatus;
    received_at: string;
  } | null;
  connected_clients: number;
}

export interface DashboardOverview {
  campaign: CampaignRecord;
  active_calculation_config: CalculationConfigRecord;
  sync_telemetry: RealtimeSyncTelemetry;
  totals: {
    total_zones: number;
    total_woredas: number;
    computed_planned_target: number;
    template_reported_planned_target: number;
    computed_daily_target: number;
    template_reported_daily_target: number;
    reports_submitted_or_approved: number;
    reports_approved: number;
    reports_returned: number;
    reporting_completeness_pct: number | null;
    total_vaccinated_0_59m: number;
    total_vaccinated_60_120m: number;
    afp_alerts: number;
    aefi_alerts: number;
    zero_dose_identified: number;
    zero_dose_linked: number;
    zero_dose_vaccinated: number;
    under_vaccinated_identified: number;
    under_vaccinated_linked: number;
    under_vaccinated_vaccinated: number;
    teams_reported: number;
    total_teams: number;
    team_reporting_pct: number | null;
    nopv2_vials_received: number;
    nopv2_vials_used: number;
    nopv2_wastage_pct: number | null;
    bopv_vials_received: number;
    bopv_vials_used: number;
    bopv_wastage_pct: number | null;
    regional_daily_coverage_pct: number | null;
    regional_total_coverage_pct: number | null;
    security_settlements_count: number;
    security_settlements_target: number;
    security_settlements_vaccinated: number;
    open_alerts_count: number;
    critical_alerts_count: number;
  };
  zones: ZoneRecord[];
  status_breakdown: {status: ReportStatus; count: number}[];
  recent_notifications: NotificationRecord[];
}

export interface CommandDisplaySessionRecord {
  id: string;
  label: string;
  token_prefix: string;
  default_layout: 1 | 2 | 3 | 4 | 5;
  rotation_seconds: number;
  is_active: boolean;
  created_by_username: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_username: string | null;
  last_accessed_at: string | null;
}

export interface CommandRoomVaccineSummary {
  vaccine_type: 'nOPV2' | 'bOPV';
  vials_received: number;
  vials_used: number;
  vials_partially_used: number;
  vials_returned_unused_good: number;
  vials_broken: number;
  vials_returned_bad_stage_3_4: number;
  vials_lost: number;
  wastage_rate_pct: number | null;
}

export interface CommandRoomSnapshot {
  generated_at: string;
  read_only: true;
  session_label: string;
  campaign: CampaignRecord;
  active_calculation_config: CalculationConfigRecord;
  sync_telemetry: RealtimeSyncTelemetry;
  overview_totals: DashboardOverview['totals'];
  zones: Array<
    ZoneRecord & {
      submitted_count: number;
      approved_count: number;
      returned_count: number;
      missing_count: number;
      completeness_pct: number | null;
      coverage_pct: number | null;
      security_settlements_count: number;
    }
  >;
  woreda_rankings: {
    top_coverage: Array<{
      id: string;
      name: string;
      zone_name: string;
      planned_target: number;
      vaccinated_0_59m: number;
      coverage_pct: number | null;
    }>;
    lowest_coverage: Array<{
      id: string;
      name: string;
      zone_name: string;
      planned_target: number;
      vaccinated_0_59m: number;
      coverage_pct: number | null;
    }>;
  };
  daily_progression: Array<{
    day_id: string;
    label: string;
    phase: 'Core' | 'Mop-Up';
    campaign_date: string;
    daily_target: number;
    vaccinated_0_59m: number;
    vaccinated_60_120m: number;
    cumulative_0_59m: number;
    daily_coverage_pct: number | null;
    cumulative_coverage_pct: number | null;
    reports_received: number;
    reports_approved: number;
  }>;
  age_group_breakdown: Array<{
    age_group: '0-11m' | '12-59m' | '60-120m';
    vaccinated_before: number;
    not_vaccinated_before: number;
    total: number;
  }>;
  vaccine_management: {
    nopv2: CommandRoomVaccineSummary;
    bopv: CommandRoomVaccineSummary;
    wastage_alerts_count: number;
  };
  surveillance_and_security: {
    afp_alerts_total: number;
    aefi_alerts_total: number;
    security_settlements_total: number;
    security_target_0_59m: number;
    security_vaccinated_0_59m: number;
    security_coverage_pct: number | null;
    security_reporting_gaps_count: number;
    security_zone_summary: Array<{
      zone_name: string;
      settlements: number;
      inaccessible: number;
      partially_accessible: number;
      target: number;
      vaccinated: number;
    }>;
    recent_surveillance_alerts: Array<{
      id: string;
      priority: AlertPriority;
      alert_type: AlertType;
      admin_location: string;
      day_label: string | null;
      description: string;
      detected_at: string;
      resolution_status: AlertResolutionStatus;
    }>;
  };
  reporting_compliance: {
    woredas_expected_per_day: number;
    open_days_count: number;
    expected_total_reports: number;
    reports_received: number;
    reports_approved: number;
    reports_pending_draft_or_missing: number;
    late_reports_count: number;
    completeness_pct: number | null;
    missing_woredas_sample: Array<{
      zone_name: string;
      woreda_name: string;
      day_label: string;
      status: string;
    }>;
  };
  latest_activity: Array<{
    report_id: string;
    zone_name: string;
    woreda_name: string;
    day_label: string;
    status: ReportStatus;
    total_vaccinated_0_59m: number;
    received_at: string;
  }>;
  thresholds: PerformanceThresholdConfig;
}

