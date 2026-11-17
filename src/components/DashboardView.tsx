import React, {useMemo, useState} from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BellRing,
  CheckCircle2,
  ClipboardList,
  MapPin,
  Search,
  ShieldAlert,
  Syringe,
  TrendingUp,
  Users,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {formatPctOrNA, safePercent} from '../lib/calculations';
import type {
  DailyReportRecord,
  DashboardOverview,
  WoredaRecord,
  ZoneRecord,
} from '../types/opcms';
import {OromiaZoneMap} from './OromiaZoneMap';

type AppNavTab =
  | 'dashboard'
  | 'gis'
  | 'alerts'
  | 'hierarchy'
  | 'campaigns'
  | 'reports'
  | 'imports'
  | 'security'
  | 'exports'
  | 'audit'
  | 'access';

interface DashboardViewProps {
  data: DashboardOverview | null;
  reports: DailyReportRecord[];
  woredas: WoredaRecord[];
  loading: boolean;
  onNavigate: (tab: AppNavTab) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  data,
  reports,
  woredas,
  loading,
  onNavigate,
}) => {
  const [selectedZone, setSelectedZone] = useState<ZoneRecord | null>(null);
  const [rankingTab, setRankingTab] = useState<'zones' | 'woredas'>('zones');
  const [rankingSort, setRankingSort] = useState<'highest' | 'lowest'>('highest');
  const [woredaSearch, setWoredaSearch] = useState('');

  const dailyTrends = useMemo(() => {
    if (!data) return [];
    const totalPlanned = data.totals.computed_planned_target;
    const totalDaily = data.totals.computed_daily_target;
    let cumulative = 0;
    return data.campaign.days.map((day) => {
      const dr = reports.filter((r) => r.campaign_day_id === day.id);
      const dailyVax = dr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
      cumulative += dailyVax;
      return {
        label: day.label,
        dailyTarget: totalDaily,
        dailyVaccinated: dailyVax,
        cumulativeVaccinated: cumulative,
        dailyCovPct: safePercent(dailyVax, totalDaily) ?? 0,
        cumulativeCovPct: safePercent(cumulative, totalPlanned) ?? 0,
      };
    });
  }, [data, reports]);

  const zoneRankings = useMemo(() => {
    if (!data) return [];
    const list = data.zones.map((z) => {
      const planned = z.total_planned_target || 0;
      const vax = z.total_vaccinated_0_59m || 0;
      return {
        ...z,
        coveragePct: safePercent(vax, planned),
      };
    });
    return list.sort((a, b) =>
      rankingSort === 'highest'
        ? (b.coveragePct ?? -1) - (a.coveragePct ?? -1)
        : (a.coveragePct ?? 999) - (b.coveragePct ?? 999),
    );
  }, [data, rankingSort]);

  const woredaRankings = useMemo(() => {
    const q = woredaSearch.trim().toLowerCase();
    const list = woredas
      .filter((w) => !q || `${w.zone_name} ${w.name}`.toLowerCase().includes(q))
      .map((w) => {
        const wr = reports.filter((r) => r.woreda_id === w.id);
        const vax = wr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
        return {
          woreda: w,
          vaccinated059: vax,
          coveragePct: safePercent(vax, w.total_planned_target),
          reportsCount: wr.filter((r) => r.status !== 'Draft').length,
        };
      });
    return list
      .sort((a, b) =>
        rankingSort === 'highest'
          ? (b.coveragePct ?? -1) - (a.coveragePct ?? -1)
          : (a.coveragePct ?? 999) - (b.coveragePct ?? 999),
      )
      .slice(0, 50);
  }, [woredas, reports, woredaSearch, rankingSort]);

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-28 rounded-lg border border-slate-200 bg-white animate-pulse p-5" />
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 h-96 rounded-lg border border-slate-200 bg-white animate-pulse" />
          <div className="lg:col-span-5 h-96 rounded-lg border border-slate-200 bg-white animate-pulse" />
        </div>
      </div>
    );
  }

  const {campaign, totals, zones, status_breakdown} = data;

  const topZonesChart = [...zones]
    .sort((a, b) => (b.total_planned_target || 0) - (a.total_planned_target || 0))
    .slice(0, 12)
    .map((z) => ({
      name: z.name.length > 14 ? `${z.name.slice(0, 13)}…` : z.name,
      fullName: z.name,
      planned: z.total_planned_target || 0,
      daily: z.daily_target || 0,
      vaccinated: z.total_vaccinated_0_59m || 0,
    }));

  const targetDiscrepancyDelta =
    totals.computed_planned_target - totals.template_reported_planned_target;

  return (
    <div className="space-y-6">
      {/* Campaign Banner Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="text-xs text-slate-500 flex flex-wrap items-center gap-2">
            <span className="font-bold text-[#485EA9]">{campaign.code}</span>
            <span aria-hidden="true">·</span>
            <span>{campaign.vaccine_types}</span>
            <span aria-hidden="true">·</span>
            <span>
              {campaign.start_date} to {campaign.end_date}
            </span>
          </div>
          <h2 className="mt-1 text-xl font-bold text-slate-900">{campaign.name}</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('reports')}
            className="inline-flex items-center gap-2 rounded-md bg-[#3A99CF] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3185b5] transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ClipboardList className="w-4 h-4" />
            Daily Reporting
          </button>
          <button
            type="button"
            onClick={() => onNavigate('gis')}
            className="inline-flex items-center gap-2 rounded-md border border-[#485EA9] bg-white px-3.5 py-2 text-xs font-bold text-[#485EA9] hover:bg-[#485EA9]/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <MapPin className="w-4 h-4" />
            Interactive GIS Map
          </button>
          <button
            type="button"
            onClick={() => onNavigate('alerts')}
            className="inline-flex items-center gap-2 rounded-md border border-[#D29441] bg-white px-3.5 py-2 text-xs font-bold text-[#D29441] hover:bg-[#D29441]/5 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            <BellRing className="w-4 h-4" />
            Alerts ({totals.open_alerts_count})
          </button>
        </div>
      </div>

      {/* 4-Column Primary KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Verified Planned Target (0–59m)</span>
            <Users className="w-4 h-4 text-[#3A99CF]" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {totals.computed_planned_target.toLocaleString()}
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {totals.total_zones} Zones · {totals.total_woredas} Woredas · Daily: {totals.computed_daily_target.toLocaleString()}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Total Vaccinated &amp; Coverage</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {totals.total_vaccinated_0_59m.toLocaleString()}
            <span className="ml-2 text-sm font-bold text-[#3A99CF]">
              ({formatPctOrNA(totals.regional_total_coverage_pct)})
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Daily Cov: {formatPctOrNA(totals.regional_daily_coverage_pct)} · 60–120m: {totals.total_vaccinated_60_120m.toLocaleString()}
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Reporting &amp; Team Completeness</span>
            <Syringe className="w-4 h-4 text-[#485EA9]" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {formatPctOrNA(totals.reporting_completeness_pct)}
            <span className="ml-2 text-sm font-normal text-slate-500">
              ({totals.reports_submitted_or_approved} submitted)
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            Teams: {totals.teams_reported.toLocaleString()} / {totals.total_teams.toLocaleString()} ({formatPctOrNA(totals.team_reporting_pct)})
          </p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Alerts &amp; Surveillance</span>
            <ShieldAlert className="w-4 h-4 text-[#D29441]" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">
            {totals.open_alerts_count} Open
            <span className="ml-2 text-sm font-bold text-red-700">
              ({totals.critical_alerts_count} Critical)
            </span>
          </p>
          <p className="mt-1 text-xs text-slate-500 tabular-nums">
            {totals.afp_alerts} AFP / {totals.aefi_alerts} AEFI · {totals.reports_approved} Approved
          </p>
        </div>
      </div>

      {/* Workbook Audit Flag */}
      {totals.total_woredas > 200 && targetDiscrepancyDelta !== 0 && (
        <div className="bg-amber-50/70 border border-amber-300 rounded-lg px-5 py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-[#D29441] shrink-0 mt-0.5" />
            <div className="text-xs text-slate-800 leading-relaxed">
              <strong className="font-bold text-slate-900">
                Workbook Formula Discrepancy Flagged for OHB Approval:
              </strong>{' '}
              Row 266 of the uploaded Day 1 CSV lists Regional Planned Target as{' '}
              <span className="font-mono font-bold tabular-nums">
                {totals.template_reported_planned_target.toLocaleString()}
              </span>
              , whereas the verified sum of 261 Woredas is{' '}
              <span className="font-mono font-bold tabular-nums">
                {totals.computed_planned_target.toLocaleString()}
              </span>
              .
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('audit')}
            className="inline-flex items-center gap-1 text-xs font-bold text-[#485EA9] hover:underline whitespace-nowrap shrink-0 cursor-pointer"
          >
            Inspect 7 Audit Findings
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Charts Row: Daily/Cumulative Trends + Zone Comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Daily &amp; Cumulative Vaccination Trend (Day 1–Day 6)
              </h3>
              <p className="text-xs text-slate-500">
                Daily 0–59m doses administered vs. cumulative regional total across campaign days
              </p>
            </div>
            <TrendingUp className="w-4 h-4 text-[#3A99CF] shrink-0" />
          </div>
          <div className="h-[310px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyTrends} margin={{top: 8, right: 16, left: 8, bottom: 8}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="label" tick={{fontSize: 12, fill: '#475569'}} />
                <YAxis
                  tick={{fontSize: 11, fill: '#475569'}}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip formatter={(value: unknown) => Number(value).toLocaleString()} />
                <Legend wrapperStyle={{fontSize: '11px'}} />
                <Line
                  type="monotone"
                  dataKey="dailyTarget"
                  name="Daily Target"
                  stroke="#94A3B8"
                  strokeDasharray="4 4"
                  strokeWidth={2}
                />
                <Line
                  type="monotone"
                  dataKey="dailyVaccinated"
                  name="Daily 0–59m Vaccinated"
                  stroke="#3A99CF"
                  strokeWidth={2.5}
                />
                <Line
                  type="monotone"
                  dataKey="cumulativeVaccinated"
                  name="Cumulative 0–59m"
                  stroke="#485EA9"
                  strokeWidth={2.5}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-6 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Zone Performance Comparison (Top {topZonesChart.length})
              </h3>
              <p className="text-xs text-slate-500">
                Planned target vs. Day 1 target and reported 0–59m vaccinated doses
              </p>
            </div>
          </div>
          <div className="h-[310px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={topZonesChart} margin={{top: 8, right: 16, left: 8, bottom: 44}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis
                  dataKey="name"
                  tick={{fontSize: 11, fill: '#475569'}}
                  angle={-32}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis
                  tick={{fontSize: 11, fill: '#475569'}}
                  tickFormatter={(v) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(v))}
                />
                <Tooltip
                  formatter={(value: unknown, name: unknown) => [
                    Number(value).toLocaleString(),
                    name === 'planned'
                      ? 'Total Planned Target'
                      : name === 'daily'
                        ? 'Day 1 Target'
                        : '0-59m Vaccinated',
                  ]}
                  labelFormatter={(_label, payload) => payload?.[0]?.payload?.fullName || ''}
                />
                <Bar dataKey="planned" name="planned" fill="#485EA9" radius={[3, 3, 0, 0]} />
                <Bar dataKey="daily" name="daily" fill="#3A99CF" radius={[3, 3, 0, 0]} />
                <Bar dataKey="vaccinated" name="vaccinated" fill="#D29441" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Interactive Map + Vaccine Utilization & Operational Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between gap-2 mb-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">Oromia Zonal Map</h3>
              <p className="text-xs text-slate-500">
                Click a Zone centroid · Use GIS Map tab for drill-down &amp; GeoJSON layers
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('gis')}
              className="text-xs font-bold text-[#3A99CF] hover:underline cursor-pointer shrink-0"
            >
              Full GIS View
            </button>
          </div>
          <OromiaZoneMap
            zones={zones}
            selectedZoneId={selectedZone?.id}
            onSelectZone={(z) => setSelectedZone(z)}
          />
          <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600">
            {selectedZone ? (
              <span>
                Selected: <strong className="text-slate-900">{selectedZone.name}</strong> ·{' '}
                {selectedZone.woreda_count} Woredas · Planned:{' '}
                <strong className="tabular-nums">
                  {(selectedZone.total_planned_target || 0).toLocaleString()}
                </strong>
              </span>
            ) : (
              <span>Showing {zones.length} administrative zone/town centroid(s) in scope</span>
            )}
          </div>
        </div>

        <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-base font-bold text-slate-900">Vaccine Utilization &amp; Wastage</h3>
            <p className="text-xs text-slate-500 mb-3">
              Co-administered nOPV2 &amp; bOPV vial accounting
            </p>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">nOPV2 Vials Received / Used</span>
                <strong className="text-slate-900 tabular-nums">
                  {totals.nopv2_vials_received.toLocaleString()} / {totals.nopv2_vials_used.toLocaleString()}
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">nOPV2 Wastage Rate</span>
                <strong className="text-[#485EA9] tabular-nums">
                  {formatPctOrNA(totals.nopv2_wastage_pct)}
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">bOPV Vials Received / Used</span>
                <strong className="text-slate-900 tabular-nums">
                  {totals.bopv_vials_received.toLocaleString()} / {totals.bopv_vials_used.toLocaleString()}
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">bOPV Wastage Rate</span>
                <strong className="text-[#485EA9] tabular-nums">
                  {formatPctOrNA(totals.bopv_wastage_pct)}
                </strong>
              </div>
            </div>

            <h4 className="mt-4 mb-2 text-xs font-bold text-slate-700">Report Workflow Pipeline</h4>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
              {status_breakdown.map((row) => (
                <div key={row.status} className="px-3.5 py-2 flex items-center justify-between">
                  <span className="text-slate-600">{row.status}</span>
                  <strong className="text-slate-900 tabular-nums">{row.count}</strong>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-5">
            <h3 className="text-base font-bold text-slate-900">Equity, Surveillance &amp; Security Areas</h3>
            <p className="text-xs text-slate-500 mb-3">
              Zero-dose, under-vaccinated, and isolated security settlements
            </p>
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">Zero-Dose (Ident / Linked / Vax)</span>
                <strong className="text-slate-900 tabular-nums">
                  {totals.zero_dose_identified.toLocaleString()} / {totals.zero_dose_linked.toLocaleString()} /{' '}
                  {totals.zero_dose_vaccinated.toLocaleString()}
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">Under-Vaccinated (Ident / Linked / Vax)</span>
                <strong className="text-slate-900 tabular-nums">
                  {totals.under_vaccinated_identified.toLocaleString()} /{' '}
                  {totals.under_vaccinated_linked.toLocaleString()} /{' '}
                  {totals.under_vaccinated_vaccinated.toLocaleString()}
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">AFP / AEFI Surveillance Alerts</span>
                <strong className="text-red-700 tabular-nums">
                  {totals.afp_alerts} AFP / {totals.aefi_alerts} AEFI
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">Security Settlements (Isolated)</span>
                <strong className="text-[#D29441] tabular-nums">
                  {totals.security_settlements_vaccinated.toLocaleString()} /{' '}
                  {totals.security_settlements_target.toLocaleString()} (
                  {formatPctOrNA(
                    safePercent(totals.security_settlements_vaccinated, totals.security_settlements_target),
                  )}
                  )
                </strong>
              </div>
              <div className="px-3.5 py-2.5 flex items-center justify-between">
                <span className="text-slate-700">Active Security Settlements</span>
                <strong className="text-slate-900 tabular-nums">{totals.security_settlements_count}</strong>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Zone & Woreda Ranking Tables */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="p-4 border-b border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-slate-900">
              Zone &amp; Woreda Performance Rankings
            </h3>
            <p className="text-xs text-slate-500">
              Compare coverage and reporting completeness across Zones and Woredas
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rankingTab === 'woredas' && (
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" />
                <input
                  type="text"
                  value={woredaSearch}
                  onChange={(e) => setWoredaSearch(e.target.value)}
                  placeholder="Filter woreda or zone..."
                  className="rounded-md border border-slate-300 pl-8 pr-3 py-1 text-xs"
                />
              </div>
            )}
            <select
              value={rankingSort}
              onChange={(e) => setRankingSort(e.target.value as 'highest' | 'lowest')}
              className="rounded-md border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700"
            >
              <option value="highest">Highest Coverage First</option>
              <option value="lowest">Lowest Coverage First</option>
            </select>
            <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
              <button
                type="button"
                onClick={() => setRankingTab('zones')}
                className={`px-3 py-1 text-xs font-bold rounded cursor-pointer ${
                  rankingTab === 'zones' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Zone Ranking ({zones.length})
              </button>
              <button
                type="button"
                onClick={() => setRankingTab('woredas')}
                className={`px-3 py-1 text-xs font-bold rounded cursor-pointer ${
                  rankingTab === 'woredas' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                Woreda Ranking ({woredas.length})
              </button>
            </div>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[380px]">
          {rankingTab === 'zones' ? (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Rank</th>
                  <th className="py-2.5 px-4">Zone / City</th>
                  <th className="py-2.5 px-4 text-right">Woredas</th>
                  <th className="py-2.5 px-4 text-right">Planned Target</th>
                  <th className="py-2.5 px-4 text-right">0–59m Vaccinated</th>
                  <th className="py-2.5 px-4 text-right">Coverage %</th>
                  <th className="py-2.5 px-4 text-right">Reports Filed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {zoneRankings.map((z, idx) => (
                  <tr key={z.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 font-bold text-slate-500 tabular-nums">#{idx + 1}</td>
                    <td className="py-2 px-4 font-bold text-slate-900">{z.name}</td>
                    <td className="py-2 px-4 text-right tabular-nums">{z.woreda_count || 0}</td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {(z.total_planned_target || 0).toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold">
                      {(z.total_vaccinated_0_59m || 0).toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold text-[#485EA9]">
                      {formatPctOrNA(z.coveragePct)}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">{z.reported_count || 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Rank</th>
                  <th className="py-2.5 px-4">Zone</th>
                  <th className="py-2.5 px-4">Woreda</th>
                  <th className="py-2.5 px-4 text-right">Planned Target</th>
                  <th className="py-2.5 px-4 text-right">0–59m Vaccinated</th>
                  <th className="py-2.5 px-4 text-right">Coverage %</th>
                  <th className="py-2.5 px-4 text-right">Reports Filed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {woredaRankings.map((row, idx) => (
                  <tr key={row.woreda.id} className="hover:bg-slate-50/70">
                    <td className="py-2 px-4 font-bold text-slate-500 tabular-nums">#{idx + 1}</td>
                    <td className="py-2 px-4 text-slate-700">{row.woreda.zone_name}</td>
                    <td className="py-2 px-4 font-bold text-slate-900">{row.woreda.name}</td>
                    <td className="py-2 px-4 text-right tabular-nums">
                      {row.woreda.total_planned_target.toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold">
                      {row.vaccinated059.toLocaleString()}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums font-bold text-[#485EA9]">
                      {formatPctOrNA(row.coveragePct)}
                    </td>
                    <td className="py-2 px-4 text-right tabular-nums">{row.reportsCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
};
