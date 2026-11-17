import React, {useEffect, useMemo, useState} from 'react';
import {
  AlertTriangle,
  BarChart3,
  CheckCircle2,
  CloudOff,
  FileCheck2,
  History,
  Lock,
  RotateCcw,
  Save,
  Send,
  Unlock,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {apiRequest, ApiError} from '../lib/api';
import {
  computeVaccinationTotals,
  computeWastageRatePct,
  formatPctOrNA,
  safePercent,
  validateDailyReportData,
} from '../lib/calculations';
import {
  listOfflineDrafts,
  removeOfflineDraft,
  saveOfflineReportItem,
  updateOfflineQueueItem,
  type OfflineReportQueueItem,
} from '../lib/offlineDb';
import {useOnlineStatus} from '../hooks/usePWA';
import type {
  CalculationConfigRecord,
  CampaignRecord,
  DailyReportRecord,
  UserProfile,
  WoredaRecord,
  ZoneRecord,
} from '../types/opcms';

interface ReportsWorkflowViewProps {
  token: string;
  user: UserProfile;
  campaign: CampaignRecord | null;
  activeCalcConfig: CalculationConfigRecord | null;
  zones: ZoneRecord[];
  woredas: WoredaRecord[];
  reports: DailyReportRecord[];
  onRefresh: () => void;
  onOfflineCountChange: (count: number) => void;
}

const emptyAgeGroups = () => [
  {age_group: '0-11m' as const, vaccinated_before: 0, not_vaccinated_before: 0},
  {age_group: '12-59m' as const, vaccinated_before: 0, not_vaccinated_before: 0},
  {age_group: '60-120m' as const, vaccinated_before: 0, not_vaccinated_before: 0},
];

const emptyVaccines = () => [
  {
    vaccine_type: 'nOPV2' as const,
    vials_received: 0,
    vials_used: 0,
    vials_partially_used: 0,
    vials_returned_unused_good: 0,
    vials_broken: 0,
    vials_returned_bad_stage_3_4: 0,
    vials_lost: 0,
  },
  {
    vaccine_type: 'bOPV' as const,
    vials_received: 0,
    vials_used: 0,
    vials_partially_used: 0,
    vials_returned_unused_good: 0,
    vials_broken: 0,
    vials_returned_bad_stage_3_4: 0,
    vials_lost: 0,
  },
];

export const ReportsWorkflowView: React.FC<ReportsWorkflowViewProps> = ({
  token,
  user,
  campaign,
  activeCalcConfig,
  zones,
  woredas,
  reports,
  onRefresh,
  onOfflineCountChange,
}) => {
  const isOnline = useOnlineStatus();
  const [selectedDayId, setSelectedDayId] = useState<string>(campaign?.days[0]?.id || 'day-1');
  const [reportingLevel, setReportingLevel] = useState<'Woreda' | 'Zone' | 'Region'>(
    user.woreda_id ? 'Woreda' : user.zone_id ? 'Zone' : 'Woreda',
  );
  const [selectedWoredaId, setSelectedWoredaId] = useState<string>(
    user.woreda_id || woredas[0]?.id || '',
  );
  const [activeTab, setActiveTab] = useState<
    'entry' | 'offline_queue' | 'missing' | 'zone_review' | 'regional_overview'
  >('entry');
  const [zoneFilterId, setZoneFilterId] = useState<string>('');
  const [missingOnly, setMissingOnly] = useState<boolean>(true);

  // Sections A-H Form State
  const [ageGroups, setAgeGroups] = useState(emptyAgeGroups);
  const [vaccines, setVaccines] = useState(emptyVaccines);
  const [afpAlerts, setAfpAlerts] = useState(0);
  const [aefiAlerts, setAefiAlerts] = useState(0);
  const [hhsVisited, setHhsVisited] = useState(0);
  const [communityMeetings, setCommunityMeetings] = useState(0);
  const [ipcReached, setIpcReached] = useState(0);
  const [zeroDoseId, setZeroDoseId] = useState(0);
  const [zeroDoseLinked, setZeroDoseLinked] = useState(0);
  const [zeroDoseVax, setZeroDoseVax] = useState(0);
  const [underVaxId, setUnderVaxId] = useState(0);
  const [underVaxLinked, setUnderVaxLinked] = useState(0);
  const [underVaxVax, setUnderVaxVax] = useState(0);
  const [totalTeams, setTotalTeams] = useState(0);
  const [teamsReported, setTeamsReported] = useState(0);
  const [anyRemark, setAnyRemark] = useState('');

  const [workflowComment, setWorkflowComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [offlineDrafts, setOfflineDrafts] = useState<OfflineReportQueueItem[]>([]);

  const refreshOfflineDrafts = async () => {
    const list = await listOfflineDrafts(user.id);
    setOfflineDrafts(list);
    onOfflineCountChange(list.filter((i) => i.syncState !== 'saved_locally').length);
  };

  useEffect(() => {
    void refreshOfflineDrafts();
  }, [user.id]);

  useEffect(() => {
    if (!selectedWoredaId && woredas.length > 0) {
      setSelectedWoredaId(user.woreda_id || woredas[0].id);
    }
  }, [woredas, user.woreda_id, selectedWoredaId]);

  const selectedDay = useMemo(
    () => campaign?.days.find((d) => d.id === selectedDayId) || campaign?.days[0] || null,
    [campaign, selectedDayId],
  );

  const selectedWoreda = useMemo(
    () => woredas.find((w) => w.id === selectedWoredaId) || null,
    [woredas, selectedWoredaId],
  );

  const currentReport = useMemo(
    () =>
      reports.find(
        (r) => r.campaign_day_id === selectedDayId && r.woreda_id === selectedWoredaId,
      ) || null,
    [reports, selectedDayId, selectedWoredaId],
  );

  const currentLocalItem = useMemo(
    () =>
      offlineDrafts.find(
        (d) => d.campaign_day_id === selectedDayId && d.woreda_id === selectedWoredaId,
      ) || null,
    [offlineDrafts, selectedDayId, selectedWoredaId],
  );

  useEffect(() => {
    // Prefer locally saved/queued offline payload if present so officers can edit before sync
    if (currentLocalItem?.payload) {
      const p = currentLocalItem.payload;
      setAgeGroups(p.age_groups && p.age_groups.length === 3 ? p.age_groups : emptyAgeGroups());
      setVaccines(
        p.vaccine_utilizations && p.vaccine_utilizations.length === 2
          ? p.vaccine_utilizations.map((v) => ({
              vaccine_type: v.vaccine_type,
              vials_received: v.vials_received,
              vials_used: v.vials_used,
              vials_partially_used: v.vials_partially_used,
              vials_returned_unused_good: v.vials_returned_unused_good,
              vials_broken: v.vials_broken,
              vials_returned_bad_stage_3_4: v.vials_returned_bad_stage_3_4,
              vials_lost: v.vials_lost,
            }))
          : emptyVaccines(),
      );
      setAfpAlerts(p.afp_alerts_count || 0);
      setAefiAlerts(p.aefi_alerts_count || 0);
      setHhsVisited(p.hhs_visited || 0);
      setCommunityMeetings(p.community_meeting_participants || 0);
      setIpcReached(p.home_to_home_ipc_reached || 0);
      setZeroDoseId(p.zero_dose_identified || 0);
      setZeroDoseLinked(p.zero_dose_linked || 0);
      setZeroDoseVax(p.zero_dose_vaccinated || 0);
      setUnderVaxId(p.under_vaccinated_identified || 0);
      setUnderVaxLinked(p.under_vaccinated_linked || 0);
      setUnderVaxVax(p.under_vaccinated_vaccinated || 0);
      setTotalTeams(p.total_teams || 0);
      setTeamsReported(p.teams_reported || 0);
      setAnyRemark(p.any_remark || '');
      return;
    }

    if (currentReport) {
      setAgeGroups(currentReport.age_groups.length === 3 ? currentReport.age_groups : emptyAgeGroups());
      setVaccines(
        currentReport.vaccine_utilizations.length === 2
          ? currentReport.vaccine_utilizations.map((v) => ({
              vaccine_type: v.vaccine_type,
              vials_received: v.vials_received,
              vials_used: v.vials_used,
              vials_partially_used: v.vials_partially_used,
              vials_returned_unused_good: v.vials_returned_unused_good,
              vials_broken: v.vials_broken,
              vials_returned_bad_stage_3_4: v.vials_returned_bad_stage_3_4,
              vials_lost: v.vials_lost,
            }))
          : emptyVaccines(),
      );
      setAfpAlerts(currentReport.afp_alerts_count);
      setAefiAlerts(currentReport.aefi_alerts_count);
      setHhsVisited(currentReport.hhs_visited);
      setCommunityMeetings(currentReport.community_meeting_participants);
      setIpcReached(currentReport.home_to_home_ipc_reached);
      setZeroDoseId(currentReport.zero_dose_identified);
      setZeroDoseLinked(currentReport.zero_dose_linked || 0);
      setZeroDoseVax(currentReport.zero_dose_vaccinated);
      setUnderVaxId(currentReport.under_vaccinated_identified);
      setUnderVaxLinked(currentReport.under_vaccinated_linked || 0);
      setUnderVaxVax(currentReport.under_vaccinated_vaccinated);
      setTotalTeams(currentReport.total_teams);
      setTeamsReported(currentReport.teams_reported);
      setAnyRemark(currentReport.any_remark || '');
    } else {
      setAgeGroups(emptyAgeGroups());
      setVaccines(emptyVaccines());
      setAfpAlerts(0);
      setAefiAlerts(0);
      setHhsVisited(0);
      setCommunityMeetings(0);
      setIpcReached(0);
      setZeroDoseId(0);
      setZeroDoseLinked(0);
      setZeroDoseVax(0);
      setUnderVaxId(0);
      setUnderVaxLinked(0);
      setUnderVaxVax(0);
      setTotalTeams(0);
      setTeamsReported(0);
      setAnyRemark('');
    }
  }, [currentReport, currentLocalItem]);

  const dayNum = String(selectedDay?.day_number || 1);
  const nopv2Dpv =
    activeCalcConfig?.nopv2_doses_per_vial_by_day[dayNum] ||
    campaign?.nopv2_doses_per_vial ||
    50;
  const bopvDpv =
    activeCalcConfig?.bopv_doses_per_vial_by_day[dayNum] ||
    campaign?.bopv_doses_per_vial ||
    20;
  const wastageMode = activeCalcConfig?.wastage_denominator_mode || 'used_plus_partial';
  const totalScope = activeCalcConfig?.total_vaccinated_scope || '0-59m_only';

  const vaxTotals = useMemo(
    () => computeVaccinationTotals(ageGroups, totalScope),
    [ageGroups, totalScope],
  );

  const otherDaysTotalForWoreda = useMemo(
    () =>
      reports
        .filter((r) => r.woreda_id === selectedWoredaId && r.campaign_day_id !== selectedDayId)
        .reduce((s, r) => s + r.total_vaccinated_0_59m, 0),
    [reports, selectedWoredaId, selectedDayId],
  );

  const effectiveDailyTarget = useMemo(() => {
    if (!selectedWoreda) return 0;
    if (activeCalcConfig?.daily_target_divisor === 6) {
      return Math.round(selectedWoreda.total_planned_target / 6);
    }
    return selectedWoreda.daily_target;
  }, [selectedWoreda, activeCalcConfig]);

  const dailyCovPct = safePercent(vaxTotals.effectiveTotal, effectiveDailyTarget);
  const cumulativeVax = otherDaysTotalForWoreda + vaxTotals.effectiveTotal;
  const cumulativeCovPct = safePercent(cumulativeVax, selectedWoreda?.total_planned_target || 0);

  const validation = useMemo(
    () =>
      validateDailyReportData({
        ageGroups,
        vaccines,
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
        wastageMode,
      }),
    [
      ageGroups,
      vaccines,
      afpAlerts,
      aefiAlerts,
      hhsVisited,
      communityMeetings,
      ipcReached,
      zeroDoseId,
      zeroDoseLinked,
      zeroDoseVax,
      underVaxId,
      underVaxLinked,
      underVaxVax,
      totalTeams,
      teamsReported,
      nopv2Dpv,
      bopvDpv,
      wastageMode,
    ],
  );

  const canEnterOrEdit =
    (user.role_code === 'WOREDA_REPORTING_OFFICER' || user.role_code === 'REGIONAL_SYSTEM_ADMIN') &&
    (!currentReport || (!currentReport.is_locked && ['Draft', 'Returned for Correction'].includes(currentReport.status)));

  const canSubmit =
    (user.role_code === 'WOREDA_REPORTING_OFFICER' || user.role_code === 'REGIONAL_SYSTEM_ADMIN') &&
    currentReport &&
    ['Draft', 'Returned for Correction'].includes(currentReport.status);

  const canReviewOrApprove =
    ['ZONE_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'REGIONAL_SYSTEM_ADMIN'].includes(user.role_code) &&
    currentReport &&
    ['Submitted', 'Under Review'].includes(currentReport.status);

  const canReopen =
    user.role_code === 'REGIONAL_SYSTEM_ADMIN' &&
    currentReport &&
    currentReport.status === 'Approved';

  const buildPayload = () => ({
    campaign_day_id: selectedDayId,
    reporting_level: reportingLevel,
    woreda_id: selectedWoredaId,
    age_groups: ageGroups,
    vaccine_utilizations: vaccines,
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
    any_remark: anyRemark,
  });

  const handleSaveDraft = async () => {
    if (!selectedWoreda) return;
    setError(null);
    setMessage(null);
    if (validation.errors.length > 0) {
      setError(validation.errors.join(' '));
      return;
    }

    if (!isOnline) {
      await saveOfflineReportItem({
        userId: user.id,
        campaign_day_id: selectedDayId,
        day_label: selectedDay?.label || 'Day 1',
        woreda_id: selectedWoreda.id,
        woreda_name: selectedWoreda.name,
        zone_name: selectedWoreda.zone_name,
        payload: buildPayload(),
        intendedAction: 'draft',
        syncState: 'saved_locally',
        baseVersion: currentReport?.version ?? null,
        baseUpdatedAt: currentReport?.updated_at ?? null,
      });
      await refreshOfflineDrafts();
      setMessage(
        `Saved locally on this device for ${selectedWoreda.name} (${selectedDay?.label}). Not yet received by server.`,
      );
      return;
    }

    setBusy(true);
    try {
      const saved = await apiRequest<DailyReportRecord & {duplicate_prevented?: boolean}>(
        '/reports',
        {
          method: 'POST',
          body: JSON.stringify({
            ...buildPayload(),
            client_report_id: currentLocalItem?.client_report_id || undefined,
            base_version: currentReport?.version ?? null,
            base_updated_at: currentReport?.updated_at ?? null,
          }),
        },
        token,
      );
      if (currentLocalItem) {
        await removeOfflineDraft(currentLocalItem.localKey);
        await refreshOfflineDrafts();
      }
      setMessage(
        `Successfully received by the server (${saved.status}) at ${new Date(saved.server_received_at || saved.updated_at).toLocaleTimeString()}.`,
      );
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save draft.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveLocallyOnly = async () => {
    if (!selectedWoreda) return;
    setError(null);
    const item = await saveOfflineReportItem({
      userId: user.id,
      campaign_day_id: selectedDayId,
      day_label: selectedDay?.label || 'Day 1',
      woreda_id: selectedWoreda.id,
      woreda_name: selectedWoreda.name,
      zone_name: selectedWoreda.zone_name,
      payload: buildPayload(),
      intendedAction: 'draft',
      syncState: 'saved_locally',
      baseVersion: currentReport?.version ?? null,
      baseUpdatedAt: currentReport?.updated_at ?? null,
    });
    await refreshOfflineDrafts();
    setMessage(`Saved locally (ID ${item.client_report_id.slice(0, 8)}). Edit anytime before queueing for sync.`);
  };

  const handleQueueForSync = async (intendedAction: 'draft' | 'submit') => {
    if (!selectedWoreda) return;
    setError(null);
    if (validation.errors.length > 0) {
      setError(validation.errors.join(' '));
      return;
    }
    const item = await saveOfflineReportItem({
      userId: user.id,
      campaign_day_id: selectedDayId,
      day_label: selectedDay?.label || 'Day 1',
      woreda_id: selectedWoreda.id,
      woreda_name: selectedWoreda.name,
      zone_name: selectedWoreda.zone_name,
      payload: buildPayload(),
      intendedAction,
      syncState: 'waiting_sync',
      baseVersion: currentReport?.version ?? null,
      baseUpdatedAt: currentReport?.updated_at ?? null,
    });
    await refreshOfflineDrafts();
    setMessage(
      isOnline
        ? `Queued (${item.client_report_id.slice(0, 8)}) — synchronizing automatically with server...`
        : `Waiting for synchronization (${item.client_report_id.slice(0, 8)}) — will sync & retry automatically when internet returns.`,
    );
  };

  const handleSyncOfflineQueue = async (onlyLocalKeys?: string[]) => {
    if (!isOnline) return;
    const targets = offlineDrafts.filter((d) =>
      onlyLocalKeys ? onlyLocalKeys.includes(d.localKey) : d.syncState !== 'saved_locally',
    );
    if (targets.length === 0) return;

    setBusy(true);
    setError(null);
    let syncedCount = 0;
    let conflictCount = 0;

    for (const item of targets) {
      await updateOfflineQueueItem(item.localKey, {syncState: 'synchronizing'});
      await refreshOfflineDrafts();
      try {
        await apiRequest(
          '/reports',
          {
            method: 'POST',
            body: JSON.stringify({
              ...item.payload,
              client_report_id: item.client_report_id,
              base_version: item.baseVersion,
              base_updated_at: item.baseUpdatedAt,
              auto_submit: item.intendedAction === 'submit',
            }),
          },
          token,
        );
        await removeOfflineDraft(item.localKey);
        syncedCount += 1;
      } catch (err) {
        const msg = err instanceof ApiError ? err.message : 'Synchronization error';
        const isConflict = err instanceof ApiError && err.status === 409;
        if (isConflict) conflictCount += 1;
        await updateOfflineQueueItem(item.localKey, {
          syncState: isConflict ? 'conflict' : 'sync_error',
          retryCount: item.retryCount + 1,
          lastError: msg,
          nextRetryAt: isConflict
            ? null
            : new Date(Date.now() + Math.min(60000, 5000 * (item.retryCount + 1))).toISOString(),
        });
      }
    }

    await refreshOfflineDrafts();
    setBusy(false);
    if (conflictCount > 0) {
      setError(`${conflictCount} queued report(s) hit a version/lock conflict (409). Open Offline Queue to review.`);
    } else if (syncedCount > 0) {
      setMessage(`Synchronized ${syncedCount} report(s) and received server acknowledgement.`);
    }
    onRefresh();
  };

  const handleDiscardLocalItem = async (localKey: string) => {
    await removeOfflineDraft(localKey);
    await refreshOfflineDrafts();
    setMessage('Removed local IndexedDB draft.');
  };

  const runTransition = async (action: 'submit' | 'review' | 'approve' | 'return' | 'reopen') => {
    if (!currentReport) return;
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      await apiRequest(
        `/reports/${currentReport.id}/${action}`,
        {
          method: 'POST',
          body: JSON.stringify({comment: workflowComment.trim() || null}),
        },
        token,
      );
      setWorkflowComment('');
      setMessage(`Workflow action '${action}' completed.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Failed to execute '${action}'.`);
    } finally {
      setBusy(false);
    }
  };

  // Missing-report matrix rows
  const missingMatrixRows = useMemo(() => {
    const filteredWoredas = zoneFilterId
      ? woredas.filter((w) => w.zone_id === zoneFilterId)
      : woredas;
    return filteredWoredas
      .map((w) => {
        const rep = reports.find((r) => r.woreda_id === w.id && r.campaign_day_id === selectedDayId);
        return {woreda: w, report: rep || null};
      })
      .filter((item) => (missingOnly ? !item.report || item.report.status === 'Draft' : true));
  }, [woredas, reports, selectedDayId, zoneFilterId, missingOnly]);

  // Zone review rows
  const zoneReviewRows = useMemo(
    () =>
      zones.map((z) => {
        const zw = woredas.filter((w) => w.zone_id === z.id);
        const zr = reports.filter((r) => r.zone_id === z.id && r.campaign_day_id === selectedDayId);
        const planned = zw.reduce((s, w) => s + w.total_planned_target, 0);
        const daily = zw.reduce((s, w) => s + w.daily_target, 0);
        const vax = zr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
        return {
          zone: z,
          woredaCount: zw.length,
          submittedCount: zr.filter((r) => r.status === 'Submitted' || r.status === 'Under Review').length,
          approvedCount: zr.filter((r) => r.status === 'Approved').length,
          returnedCount: zr.filter((r) => r.status === 'Returned for Correction').length,
          missingCount: Math.max(0, zw.length - zr.filter((r) => r.status !== 'Draft').length),
          dailyTarget: daily,
          plannedTarget: planned,
          vaccinated059: vax,
          dailyCovPct: safePercent(vax, daily),
        };
      }),
    [zones, woredas, reports, selectedDayId],
  );

  // Regional 6-Day summary
  const sixDayOverview = useMemo(() => {
    const days = campaign?.days || [];
    const totalPlanned = woredas.reduce((s, w) => s + w.total_planned_target, 0);
    const totalDaily = woredas.reduce((s, w) => s + w.daily_target, 0);
    let cum = 0;
    return days.map((d) => {
      const dr = reports.filter((r) => r.campaign_day_id === d.id);
      const v059 = dr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
      const v60120 = dr.reduce((s, r) => s + r.total_vaccinated_60_120m, 0);
      cum += v059;
      return {
        dayId: d.id,
        label: d.label,
        phase: d.day_type,
        date: d.campaign_date,
        submittedOrApproved: dr.filter((r) => r.status !== 'Draft').length,
        approved: dr.filter((r) => r.status === 'Approved').length,
        dailyTarget: totalDaily,
        vaccinated059: v059,
        vaccinated60120: v60120,
        dailyCovPct: safePercent(v059, totalDaily),
        cumulativeVax: cum,
        cumulativeCovPct: safePercent(cum, totalPlanned),
      };
    });
  }, [campaign, woredas, reports]);

  return (
    <div className="space-y-6">
      {/* Header & Navigation Sub-Tabs */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">
            Daily Campaign Reporting &amp; Data Quality Control
          </p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Campaign Day Forms (Day 1–Day 6) &amp; Review Dashboards
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Formula Profile: <strong className="text-slate-700">{activeCalcConfig?.version || 'v1.0.0'}</strong> · nOPV2 {nopv2Dpv} doses/vial · bOPV {bopvDpv} doses/vial · Zero denominators render N/A
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {offlineDrafts.some((d) => d.syncState !== 'saved_locally') && isOnline && (
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSyncOfflineQueue()}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#D29441] px-3 py-2 text-xs font-bold text-white hover:bg-[#b87f35] cursor-pointer"
            >
              <CloudOff className="w-3.5 h-3.5" />
              Sync {offlineDrafts.filter((d) => d.syncState !== 'saved_locally').length} Queued
            </button>
          )}
          <div className="inline-flex flex-wrap rounded-md border border-slate-200 bg-slate-100 p-0.5">
            {(
              [
                ['entry', 'Daily Entry Form'],
                ['offline_queue', `Offline Queue (${offlineDrafts.length})`],
                ['missing', 'Woreda Status & Missing'],
                ['zone_review', 'Zone Review Dashboard'],
                ['regional_overview', 'Regional 6-Day Overview'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
                  activeTab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Separate Campaign Day Tabs (Day 1 - Day 6) */}
      {activeTab !== 'regional_overview' && activeTab !== 'offline_queue' && (
        <div className="bg-white border border-slate-200 rounded-lg p-3 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {campaign?.days.map((d) => {
              const active = d.id === selectedDayId;
              return (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setSelectedDayId(d.id)}
                  className={`px-3.5 py-2 rounded-md text-xs font-bold border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#3A99CF] border-[#3A99CF] text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  {d.label} · {d.day_type}
                </button>
              );
            })}
          </div>
          <div className="text-xs text-slate-500 tabular-nums">
            Worksheet: <strong className="text-[#485EA9]">{selectedDay?.worksheet_name}</strong> ·{' '}
            {selectedDay?.campaign_date}
          </div>
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

      {activeTab === 'offline_queue' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                IndexedDB Local Drafts &amp; Persistent Offline Sync Queue ({user.full_name})
              </h3>
              <p className="text-xs text-slate-500">
                Locally saved drafts remain strictly on this device until queued for sync. Every queued item carries a unique client_report_id for duplicate prevention and conflict detection.
              </p>
            </div>
            {isOnline && offlineDrafts.length > 0 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleSyncOfflineQueue(offlineDrafts.map((d) => d.localKey))}
                className="rounded-md bg-[#3A99CF] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3185b5] cursor-pointer shrink-0"
              >
                Sync All Local Items Now
              </button>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-2.5 px-4">Day &amp; Woreda</th>
                  <th className="py-2.5 px-4">Client Report ID</th>
                  <th className="py-2.5 px-4">Target Action</th>
                  <th className="py-2.5 px-4">Sync Lifecycle State</th>
                  <th className="py-2.5 px-4">Saved Locally At</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {offlineDrafts.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="py-10 text-center text-slate-500">
                      No local drafts or queued offline reports stored on this device.
                    </td>
                  </tr>
                ) : (
                  offlineDrafts.map((item) => {
                    const stateLabel =
                      item.syncState === 'saved_locally'
                        ? 'Saved locally (Not sent to server)'
                        : item.syncState === 'waiting_sync'
                          ? 'Waiting for synchronization'
                          : item.syncState === 'synchronizing'
                            ? 'Synchronizing...'
                            : item.syncState === 'conflict'
                              ? 'Conflict detected (409)'
                              : `Sync error (Retry #${item.retryCount})`;
                    const stateClass =
                      item.syncState === 'conflict' || item.syncState === 'sync_error'
                        ? 'text-red-700'
                        : item.syncState === 'synchronizing'
                          ? 'text-[#3A99CF]'
                          : 'text-[#D29441]';
                    return (
                      <tr key={item.localKey} className="hover:bg-slate-50/70">
                        <td className="py-2.5 px-4">
                          <div className="font-bold text-slate-900">
                            {item.zone_name} · {item.woreda_name}
                          </div>
                          <div className="text-[11px] text-slate-500">{item.day_label}</div>
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[11px] text-slate-600">
                          {item.client_report_id}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-slate-700">
                          {item.intendedAction === 'submit' ? 'Submit for Review' : 'Save Server Draft'}
                        </td>
                        <td className={`py-2.5 px-4 font-bold ${stateClass}`}>
                          <div>{stateLabel}</div>
                          {item.lastError && (
                            <div className="text-[11px] font-normal text-red-700 mt-0.5">
                              {item.lastError}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 tabular-nums text-slate-500">
                          {new Date(item.savedAt).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right space-x-1.5 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDayId(item.campaign_day_id);
                              setSelectedWoredaId(item.woreda_id);
                              setActiveTab('entry');
                            }}
                            className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            Edit Before Sync
                          </button>
                          {isOnline && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleSyncOfflineQueue([item.localKey])}
                              className="rounded bg-[#3A99CF] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#3185b5] cursor-pointer"
                            >
                              Sync Now
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleDiscardLocalItem(item.localKey)}
                            className="rounded border border-red-200 bg-white px-2.5 py-1 text-[11px] font-bold text-red-700 hover:bg-red-50 cursor-pointer"
                          >
                            Discard
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'missing' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Woreda Submission Status &amp; Missing-Report Tracking ({selectedDay?.label})
              </h3>
              <p className="text-xs text-slate-500">
                Showing {missingMatrixRows.length} Woredas in current filter
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={zoneFilterId}
                onChange={(e) => setZoneFilterId(e.target.value)}
                className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
              >
                <option value="">All Zones ({zones.length})</option>
                {zones.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.name}
                  </option>
                ))}
              </select>
              <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={missingOnly}
                  onChange={(e) => setMissingOnly(e.target.checked)}
                />
                Missing / Unsubmitted Only
              </label>
            </div>
          </div>
          <div className="overflow-x-auto max-h-[540px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Zone</th>
                  <th className="py-2.5 px-4">Woreda</th>
                  <th className="py-2.5 px-4 text-right">Planned Target</th>
                  <th className="py-2.5 px-4 text-right">0–59m Vaccinated</th>
                  <th className="py-2.5 px-4 text-right">Daily Cov %</th>
                  <th className="py-2.5 px-4">Submission Status</th>
                  <th className="py-2.5 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {missingMatrixRows.slice(0, 300).map(({woreda, report}) => (
                  <tr key={woreda.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 text-slate-700">{woreda.zone_name}</td>
                    <td className="py-2 px-4 font-bold text-slate-900">{woreda.name}</td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {woreda.total_planned_target.toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold">
                      {report ? report.total_vaccinated_0_59m.toLocaleString() : '0'}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {report ? formatPctOrNA(report.daily_coverage_pct) : 'N/A'}
                    </td>
                    <td className="py-2 px-4 font-bold">
                      {!report ? (
                        <span className="text-red-700">Missing Report</span>
                      ) : (
                        <span className="text-[#485EA9]">
                          {report.status} {report.is_locked ? '(Locked)' : ''}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedWoredaId(woreda.id);
                          setActiveTab('entry');
                        }}
                        className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        {report ? 'Open / Review' : 'Enter Report'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'zone_review' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200">
            <h3 className="text-base font-bold text-slate-900">
              Zone Review &amp; Approval Completeness Dashboard ({selectedDay?.label})
            </h3>
            <p className="text-xs text-slate-500">
              Review pending submissions, approved locked counts, returned corrections, and missing Woreda reports by Zone
            </p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-2.5 px-4">Zone / Town</th>
                  <th className="py-2.5 px-4 text-right">Woredas</th>
                  <th className="py-2.5 px-4 text-right">Pending Review</th>
                  <th className="py-2.5 px-4 text-right">Approved</th>
                  <th className="py-2.5 px-4 text-right">Returned</th>
                  <th className="py-2.5 px-4 text-right">Missing</th>
                  <th className="py-2.5 px-4 text-right">0–59m Vaccinated</th>
                  <th className="py-2.5 px-4 text-right">Daily Cov %</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {zoneReviewRows.map((zr) => (
                  <tr key={zr.zone.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-4 font-bold text-slate-900">{zr.zone.name}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums">{zr.woredaCount}</td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-[#485EA9]">
                      {zr.submittedCount}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold text-emerald-700">
                      {zr.approvedCount}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-[#D29441]">
                      {zr.returnedCount}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums text-red-700">
                      {zr.missingCount}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                      {zr.vaccinated059.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                      {formatPctOrNA(zr.dailyCovPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'regional_overview' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <div className="flex items-center gap-2 mb-4">
              <BarChart3 className="w-4 h-4 text-[#3A99CF]" />
              <h3 className="text-base font-bold text-slate-900">
                Regional Six-Day Vaccination Progression (Day 1–Day 6)
              </h3>
            </div>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sixDayOverview}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                  <XAxis dataKey="label" tick={{fontSize: 12, fill: '#475569'}} />
                  <YAxis tick={{fontSize: 11, fill: '#475569'}} />
                  <Tooltip />
                  <Bar dataKey="dailyTarget" name="Daily Target" fill="#485EA9" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="vaccinated059" name="0-59m Vaccinated" fill="#3A99CF" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="cumulativeVax" name="Cumulative 0-59m" fill="#D29441" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                    <th className="py-2.5 px-4">Day</th>
                    <th className="py-2.5 px-4">Phase</th>
                    <th className="py-2.5 px-4">Date</th>
                    <th className="py-2.5 px-4 text-right">Submitted / Approved</th>
                    <th className="py-2.5 px-4 text-right">0–59m Vaccinated</th>
                    <th className="py-2.5 px-4 text-right">Daily Cov %</th>
                    <th className="py-2.5 px-4 text-right">Cumulative 0–59m</th>
                    <th className="py-2.5 px-4 text-right">Cumulative Cov %</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {sixDayOverview.map((d) => (
                    <tr key={d.dayId} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-bold text-slate-900">{d.label}</td>
                      <td className="py-2.5 px-4 text-slate-600">{d.phase}</td>
                      <td className="py-2.5 px-4 tabular-nums">{d.date}</td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        {d.submittedOrApproved} ({d.approved} locked)
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                        {d.vaccinated059.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums">
                        {formatPctOrNA(d.dailyCovPct)}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-bold text-[#485EA9]">
                        {d.cumulativeVax.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums font-bold">
                        {formatPctOrNA(d.cumulativeCovPct)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'entry' && (
        <>
          {/* Unit, Reporting Level & Status Bar */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold text-slate-700 mb-1">Reporting Level</label>
              <select
                value={reportingLevel}
                onChange={(e) => setReportingLevel(e.target.value as 'Woreda' | 'Zone' | 'Region')}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="Woreda">Woreda Level</option>
                <option value="Zone">Zone Level</option>
                <option value="Region">Region Level</option>
              </select>
            </div>
            <div className="md:col-span-6">
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Woreda Reporting Unit ({woredas.length} accessible)
              </label>
              <select
                value={selectedWoredaId}
                onChange={(e) => setSelectedWoredaId(e.target.value)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {woredas.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.zone_name} — {w.name} ({w.reporting_unit_code})
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-4 flex items-center justify-between gap-2 border border-slate-200 rounded-md px-3.5 py-2 bg-slate-50 text-xs">
              <div>
                <span className="text-slate-500 block">Report Lifecycle State</span>
                {currentLocalItem ? (
                  <strong
                    className={
                      currentLocalItem.syncState === 'conflict' || currentLocalItem.syncState === 'sync_error'
                        ? 'text-red-700'
                        : 'text-[#D29441]'
                    }
                  >
                    {currentLocalItem.syncState === 'saved_locally'
                      ? 'Saved locally (Not sent to server)'
                      : currentLocalItem.syncState === 'waiting_sync'
                        ? 'Waiting for synchronization'
                        : currentLocalItem.syncState === 'synchronizing'
                          ? 'Synchronizing with server...'
                          : currentLocalItem.syncState === 'conflict'
                            ? 'Conflict detected (409)'
                            : `Sync retry pending (#${currentLocalItem.retryCount})`}
                  </strong>
                ) : (
                  <strong className="text-slate-900">
                    {currentReport
                      ? currentReport.status === 'Draft' && currentReport.server_received_at
                        ? `Successfully received by server (Draft v${currentReport.version})`
                        : `${currentReport.status}${currentReport.is_locked ? ' · Locked' : ''} (v${currentReport.version})`
                      : 'Not Started'}
                  </strong>
                )}
              </div>
              {selectedWoreda && (
                <div className="text-right tabular-nums">
                  <span className="text-slate-500 block">Daily / Planned Target</span>
                  <strong>
                    {effectiveDailyTarget.toLocaleString()} /{' '}
                    {selectedWoreda.total_planned_target.toLocaleString()}
                  </strong>
                </div>
              )}
            </div>
          </div>

          {currentLocalItem && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/70 px-4 py-3 text-xs text-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <strong className="text-slate-900">Local Device Copy Loaded:</strong>{' '}
                This form reflects your local IndexedDB copy (client ID{' '}
                <span className="font-mono">{currentLocalItem.client_report_id.slice(0, 8)}</span>, saved{' '}
                {new Date(currentLocalItem.savedAt).toLocaleString()}). Locally saved edits are not marked as server-received until synchronized.
              </div>
              <button
                type="button"
                onClick={() => void handleDiscardLocalItem(currentLocalItem.localKey)}
                className="text-xs font-bold text-red-700 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
              >
                Discard Local Copy
              </button>
            </div>
          )}

          {/* Data Quality Validation Panel */}
          {(validation.errors.length > 0 || validation.warnings.length > 0) && (
            <div className="rounded-lg border border-amber-300 bg-amber-50/70 p-4 space-y-1.5 text-xs">
              <div className="flex items-center gap-2 font-bold text-slate-900">
                <AlertTriangle className="w-4 h-4 text-[#D29441]" />
                Data Quality &amp; Reconciliation Checks
              </div>
              {validation.errors.map((er, idx) => (
                <div key={`err-${idx}`} className="font-bold text-red-700">
                  • Blocking Error: {er}
                </div>
              ))}
              {validation.warnings.map((wn, idx) => (
                <div key={`warn-${idx}`} className="text-amber-900">
                  • Quality Warning: {wn}
                </div>
              ))}
            </div>
          )}

          {currentReport?.is_locked && (
            <div className="rounded-lg border border-emerald-300 bg-emerald-50/70 px-4 py-3 text-xs text-emerald-900 flex items-center gap-2 font-bold">
              <Lock className="w-4 h-4 shrink-0" />
              This report is Approved and Locked. Only a Regional System Administrator can reopen it for correction.
            </div>
          )}

          {/* Sections A–H Form */}
          <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-6">
            {/* Section A: Vaccination Targets and Performance */}
            <div>
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-200">
                <h3 className="text-sm font-bold text-slate-900">
                  A. Vaccination Targets &amp; Performance ({selectedDay?.label})
                </h3>
                <div className="text-xs text-slate-700 tabular-nums">
                  Total 0–59m: <strong className="text-[#485EA9]">{vaxTotals.total059.toLocaleString()}</strong> ·{' '}
                  Daily Coverage: <strong>{formatPctOrNA(dailyCovPct)}</strong> · Cumulative 0–59m:{' '}
                  <strong>{cumulativeVax.toLocaleString()}</strong> (
                  <strong>{formatPctOrNA(cumulativeCovPct)}</strong>) · 60–120m:{' '}
                  <strong>{vaxTotals.sum60120.toLocaleString()}</strong>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-3 gap-4">
                {ageGroups.map((ag, idx) => (
                  <div key={ag.age_group} className="border border-slate-200 rounded-md p-3.5 space-y-2.5 bg-slate-50/50">
                    <div className="text-xs font-bold text-slate-900">{ag.age_group}</div>
                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-1">Vaccinated before</label>
                        <input
                          type="number"
                          min={0}
                          disabled={!canEnterOrEdit}
                          value={ag.vaccinated_before}
                          onChange={(e) => {
                            const next = [...ageGroups];
                            next[idx] = {...ag, vaccinated_before: Number(e.target.value) || 0};
                            setAgeGroups(next);
                          }}
                          className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] text-slate-600 mb-1">Not vaccinated before</label>
                        <input
                          type="number"
                          min={0}
                          disabled={!canEnterOrEdit}
                          value={ag.not_vaccinated_before}
                          onChange={(e) => {
                            const next = [...ageGroups];
                            next[idx] = {...ag, not_vaccinated_before: Number(e.target.value) || 0};
                            setAgeGroups(next);
                          }}
                          className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Section B: Vaccine Utilization */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                B. Vaccine Utilization — nOPV2 ({nopv2Dpv} doses/vial) &amp; bOPV ({bopvDpv} doses/vial)
              </h3>
              <div className="mt-3 space-y-3">
                {vaccines.map((v, idx) => {
                  const dpv = v.vaccine_type === 'nOPV2' ? nopv2Dpv : bopvDpv;
                  const wastage = computeWastageRatePct(v, vaxTotals.effectiveTotal, dpv, wastageMode);
                  return (
                    <div key={v.vaccine_type} className="border border-slate-200 rounded-md p-3.5 bg-slate-50/40">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-bold text-[#485EA9]">{v.vaccine_type} Vials</span>
                        <span className="text-xs font-bold text-slate-700 tabular-nums">
                          Computed Wastage Rate: {formatPctOrNA(wastage)}
                        </span>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2.5">
                        {(
                          [
                            ['vials_received', 'Vials Received'],
                            ['vials_used', 'Vials Used'],
                            ['vials_partially_used', 'Partially Used'],
                            ['vials_returned_unused_good', 'Unused Ret. (Good)'],
                            ['vials_broken', 'Broken'],
                            ['vials_returned_bad_stage_3_4', 'Bad Ret. (Stg 3/4)'],
                            ['vials_lost', 'Lost Vials'],
                          ] as const
                        ).map(([field, label]) => (
                          <div key={field}>
                            <label className="block text-[11px] text-slate-600 mb-1 truncate">{label}</label>
                            <input
                              type="number"
                              min={0}
                              disabled={!canEnterOrEdit}
                              value={v[field]}
                              onChange={(e) => {
                                const next = [...vaccines];
                                next[idx] = {...v, [field]: Number(e.target.value) || 0};
                                setVaccines(next);
                              }}
                              className="w-full rounded border border-slate-300 bg-white px-2 py-1.5 text-xs tabular-nums disabled:bg-slate-100"
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Sections C, D, E, F, G, H */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* C & D: Surveillance & Social Mobilization */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                    C. Surveillance Alerts
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">AFP Alerts</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={afpAlerts}
                        onChange={(e) => setAfpAlerts(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">AEFI Alerts</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={aefiAlerts}
                        onChange={(e) => setAefiAlerts(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                    D. Social Mobilization
                  </h3>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">HHs Visited</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={hhsVisited}
                        onChange={(e) => setHhsVisited(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">Community Meetings</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={communityMeetings}
                        onChange={(e) => setCommunityMeetings(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">Home-to-Home IPC</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={ipcReached}
                        onChange={(e) => setIpcReached(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* E, F, G: Zero-Dose, Under-Vaccinated & Teams */}
              <div className="space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                    E. Zero-Dose &amp; F. Under-Vaccinated Children
                  </h3>
                  <div className="mt-3 grid grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">ZD Identified</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={zeroDoseId}
                        onChange={(e) => setZeroDoseId(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">ZD Linked</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={zeroDoseLinked}
                        onChange={(e) => setZeroDoseLinked(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">ZD Vaccinated</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={zeroDoseVax}
                        onChange={(e) => setZeroDoseVax(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">UV Identified</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={underVaxId}
                        onChange={(e) => setUnderVaxId(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">UV Linked</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={underVaxLinked}
                        onChange={(e) => setUnderVaxLinked(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold text-slate-600 mb-1">UV Vaccinated</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={underVaxVax}
                        onChange={(e) => setUnderVaxVax(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200">
                    G. Vaccination Teams
                  </h3>
                  <div className="mt-3 grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Total Teams</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={totalTeams}
                        onChange={(e) => setTotalTeams(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-slate-600 mb-1">Teams Reported</label>
                      <input
                        type="number"
                        min={0}
                        disabled={!canEnterOrEdit}
                        value={teamsReported}
                        onChange={(e) => setTeamsReported(Number(e.target.value) || 0)}
                        className="w-full rounded border border-slate-300 bg-white px-2.5 py-1.5 text-sm tabular-nums disabled:bg-slate-100"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Section H: Additional Information */}
            <div>
              <h3 className="text-sm font-bold text-slate-900 pb-2 border-b border-slate-200 mb-2">
                H. Additional Information &amp; Remarks
              </h3>
              <input
                type="text"
                disabled={!canEnterOrEdit}
                value={anyRemark}
                onChange={(e) => setAnyRemark(e.target.value)}
                placeholder="Operational remarks, cold-chain excursions, security notes, or correction justification..."
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-100"
              />
            </div>

            {/* Workflow Action Bar */}
            <div className="pt-4 border-t border-slate-200 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-2.5">
                {canEnterOrEdit && (
                  <>
                    <button
                      type="button"
                      disabled={busy || validation.errors.length > 0}
                      onClick={handleSaveDraft}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] disabled:opacity-50 cursor-pointer"
                    >
                      <Save className="w-3.5 h-3.5" />
                      {isOnline ? 'Save Server Draft' : 'Save Locally (Offline)'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleSaveLocallyOnly()}
                      className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <CloudOff className="w-3.5 h-3.5" />
                      Save Locally Only
                    </button>
                    <button
                      type="button"
                      disabled={busy || validation.errors.length > 0}
                      onClick={() => void handleQueueForSync('submit')}
                      className="inline-flex items-center gap-1.5 rounded-md bg-[#D29441] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#b87f35] disabled:opacity-50 cursor-pointer"
                    >
                      <Send className="w-3.5 h-3.5" />
                      {isOnline ? 'Queue & Submit' : 'Queue Submit for Sync'}
                    </button>
                  </>
                )}

                {canSubmit && (
                  <button
                    type="button"
                    disabled={busy || validation.errors.length > 0}
                    onClick={() => runTransition('submit')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-[#485EA9] px-4 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] disabled:opacity-50 cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5" />
                    Submit / Resubmit Report
                  </button>
                )}
              </div>

              {(canReviewOrApprove || canReopen) && (
                <div className="flex flex-wrap items-center gap-2.5 flex-1 lg:justify-end">
                  <input
                    type="text"
                    value={workflowComment}
                    onChange={(e) => setWorkflowComment(e.target.value)}
                    placeholder="Reviewer comment (mandatory for Return / Reopen)..."
                    className="rounded-md border border-slate-300 px-3 py-1.5 text-xs min-w-[230px]"
                  />
                  {currentReport?.status === 'Submitted' && canReviewOrApprove && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runTransition('review')}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#485EA9] bg-white px-3 py-1.5 text-xs font-bold text-[#485EA9] hover:bg-[#485EA9]/5 cursor-pointer"
                    >
                      <FileCheck2 className="w-3.5 h-3.5" />
                      Start Review
                    </button>
                  )}
                  {canReviewOrApprove && (
                    <>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runTransition('approve')}
                        className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Approve &amp; Lock
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => runTransition('return')}
                        className="inline-flex items-center gap-1.5 rounded-md bg-[#D29441] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#b87f35] cursor-pointer"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Return for Correction
                      </button>
                    </>
                  )}
                  {canReopen && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => runTransition('reopen')}
                      className="inline-flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-red-700 cursor-pointer"
                    >
                      <Unlock className="w-3.5 h-3.5" />
                      Reopen Locked Report
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Revision & Approval History */}
          {currentReport && currentReport.histories.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-lg p-5">
              <div className="flex items-center gap-2 mb-3">
                <History className="w-4 h-4 text-[#485EA9]" />
                <h3 className="text-sm font-bold text-slate-900">
                  Approval, Rejection &amp; Revision History
                </h3>
              </div>
              <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
                {currentReport.histories.map((h) => (
                  <div key={h.id} className="px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                    <div>
                      <strong className="text-slate-900">{h.action}</strong>{' '}
                      <span className="text-slate-500">
                        ({h.from_status || 'New'} → {h.to_status} · v{h.version})
                      </span>{' '}
                      by <span className="font-bold text-[#485EA9]">{h.actor_full_name}</span>
                      {h.comment && <span className="text-slate-700"> — &ldquo;{h.comment}&rdquo;</span>}
                    </div>
                    <span className="text-slate-500 tabular-nums shrink-0">
                      {new Date(h.created_at).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};
