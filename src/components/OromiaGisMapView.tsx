import React, {useMemo, useState} from 'react';
import {
  ChevronRight,
  Layers,
  MapPin,
  ShieldAlert,
  Sliders,
  Trash2,
  Upload,
} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import {formatPctOrNA, safePercent} from '../lib/calculations';
import type {
  CampaignRecord,
  DailyReportRecord,
  GisBoundaryLayerRecord,
  PerformanceThresholdConfig,
  SecuritySettlementRecord,
  UserProfile,
  WoredaRecord,
  ZoneRecord,
} from '../types/opcms';
import {GisMetricMode, OromiaZoneMap} from './OromiaZoneMap';

interface OromiaGisMapViewProps {
  token: string;
  user: UserProfile;
  campaign: CampaignRecord | null;
  zones: ZoneRecord[];
  woredas: WoredaRecord[];
  reports: DailyReportRecord[];
  settlements: SecuritySettlementRecord[];
  gisLayers: GisBoundaryLayerRecord[];
  thresholds: PerformanceThresholdConfig | null;
  onRefresh: () => void;
}

export const OromiaGisMapView: React.FC<OromiaGisMapViewProps> = ({
  token,
  user,
  campaign,
  zones,
  woredas,
  reports,
  settlements,
  gisLayers,
  thresholds,
  onRefresh,
}) => {
  const [metricMode, setMetricMode] = useState<GisMetricMode>('coverage');
  const [selectedZone, setSelectedZone] = useState<ZoneRecord | null>(null);
  const [selectedDayFilter, setSelectedDayFilter] = useState<string>('all');
  const [activeLayerId, setActiveLayerId] = useState<string>(gisLayers[0]?.id || '');

  // GeoJSON Upload state
  const [showGeoImport, setShowGeoImport] = useState(false);
  const [layerName, setLayerName] = useState('');
  const [adminLevel, setAdminLevel] = useState<'Region' | 'Zone' | 'Woreda' | 'Settlement'>('Woreda');
  const [sourceCitation, setSourceCitation] = useState('');
  const [parsedGeoJson, setParsedGeoJson] = useState<Record<string, unknown> | null>(null);

  // Threshold config state
  const [showThresholds, setShowThresholds] = useState(false);
  const [highCov, setHighCov] = useState(
    thresholds?.high_coverage_min_pct !== null && thresholds?.high_coverage_min_pct !== undefined
      ? String(thresholds.high_coverage_min_pct)
      : '',
  );
  const [medCov, setMedCov] = useState(
    thresholds?.medium_coverage_min_pct !== null && thresholds?.medium_coverage_min_pct !== undefined
      ? String(thresholds.medium_coverage_min_pct)
      : '',
  );
  const [highComp, setHighComp] = useState(
    thresholds?.high_completeness_min_pct !== null && thresholds?.high_completeness_min_pct !== undefined
      ? String(thresholds.high_completeness_min_pct)
      : '',
  );
  const [highWaste, setHighWaste] = useState(
    thresholds?.high_wastage_alert_pct !== null && thresholds?.high_wastage_alert_pct !== undefined
      ? String(thresholds.high_wastage_alert_pct)
      : '',
  );
  const [lateHour, setLateHour] = useState(
    thresholds?.late_report_cutoff_hour_utc !== null && thresholds?.late_report_cutoff_hour_utc !== undefined
      ? String(thresholds.late_report_cutoff_hour_utc)
      : '',
  );
  const [dropPct, setDropPct] = useState(
    thresholds?.declining_performance_drop_pct !== null && thresholds?.declining_performance_drop_pct !== undefined
      ? String(thresholds.declining_performance_drop_pct)
      : '',
  );
  const [threshNotes, setThreshNotes] = useState(thresholds?.notes || '');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const canConfigure = ['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM'].includes(user.role_code);

  const filteredReports = useMemo(
    () =>
      selectedDayFilter === 'all'
        ? reports
        : reports.filter((r) => r.campaign_day_id === selectedDayFilter),
    [reports, selectedDayFilter],
  );

  const openDaysCount = Math.max(
    1,
    selectedDayFilter === 'all'
      ? (campaign?.days.filter((d) => d.is_open_for_reporting).length || 1)
      : 1,
  );

  const zoneStatsMap = useMemo(() => {
    const map: Record<
      string,
      {
        coveragePct: number | null;
        completenessPct: number | null;
        securityCount: number;
        securityVaccinated: number;
        securityTarget: number;
        vaccinated059: number;
        plannedTarget: number;
        submittedCount: number;
        woredaCount: number;
      }
    > = {};

    for (const z of zones) {
      const zw = woredas.filter((w) => w.zone_id === z.id);
      const zr = filteredReports.filter((r) => r.zone_id === z.id);
      const zs = settlements.filter((s) => s.zone_id === z.id);
      const planned = zw.reduce((s, w) => s + w.total_planned_target, 0);
      const daily = zw.reduce((s, w) => s + w.daily_target, 0);
      const v059 = zr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
      const submitted = zr.filter((r) => r.status !== 'Draft').length;
      const denom = selectedDayFilter === 'all' ? planned : daily;

      map[z.id] = {
        coveragePct: safePercent(v059, denom),
        completenessPct: safePercent(submitted, zw.length * openDaysCount),
        securityCount: zs.length,
        securityVaccinated: zs.reduce((s, st) => s + st.vaccinated_children_0_59m, 0),
        securityTarget: zs.reduce((s, st) => s + st.target_children_0_59m, 0),
        vaccinated059: v059,
        plannedTarget: planned,
        submittedCount: submitted,
        woredaCount: zw.length,
      };
    }
    return map;
  }, [zones, woredas, filteredReports, settlements, selectedDayFilter, openDaysCount]);

  // Regional Rollup Summary
  const regionalStats = useMemo(() => {
    const planned = woredas.reduce((s, w) => s + w.total_planned_target, 0);
    const vax = filteredReports.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
    const submitted = filteredReports.filter((r) => r.status !== 'Draft').length;
    const secCount = settlements.length;
    const secVax = settlements.reduce((s, st) => s + st.vaccinated_children_0_59m, 0);
    const secTarget = settlements.reduce((s, st) => s + st.target_children_0_59m, 0);
    return {
      planned,
      vax,
      covPct: safePercent(vax, planned),
      compPct: safePercent(submitted, woredas.length * openDaysCount),
      secCount,
      secVax,
      secTarget,
    };
  }, [woredas, filteredReports, settlements, openDaysCount]);

  // Drill-down Woredas for selected Zone
  const drilldownWoredas = useMemo(() => {
    const base = selectedZone ? woredas.filter((w) => w.zone_id === selectedZone.id) : [];
    return base.map((w) => {
      const wr = filteredReports.filter((r) => r.woreda_id === w.id);
      const v059 = wr.reduce((s, r) => s + r.total_vaccinated_0_59m, 0);
      const submitted = wr.filter((r) => r.status !== 'Draft').length;
      const denom = selectedDayFilter === 'all' ? w.total_planned_target : w.daily_target;
      const wSettles = settlements.filter((s) => s.woreda_id === w.id);
      return {
        woreda: w,
        vaccinated059: v059,
        coveragePct: safePercent(v059, denom),
        completenessPct: safePercent(submitted, openDaysCount),
        latestStatus: wr[0]?.status || 'Not Reported',
        securityCount: wSettles.length,
      };
    });
  }, [selectedZone, woredas, filteredReports, settlements, selectedDayFilter, openDaysCount]);

  const activeLayer = gisLayers.find((l) => l.id === activeLayerId) || null;

  const handleGeoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text) as Record<string, unknown>;
      if (json.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
        setError('Uploaded file is not a valid GeoJSON FeatureCollection.');
        return;
      }
      setParsedGeoJson(json);
      if (!layerName) setLayerName(file.name.replace(/\.(geo)?json$/i, ''));
      setMessage(`Loaded GeoJSON with ${json.features.length} feature(s). Add source citation and save.`);
    } catch {
      setError('Could not parse GeoJSON file.');
    }
  };

  const handleUploadGeoLayer = async () => {
    if (!parsedGeoJson || !layerName.trim() || !sourceCitation.trim()) {
      setError('Layer name, source citation, and a valid GeoJSON file are required.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const created = await apiRequest<GisBoundaryLayerRecord>(
        '/gis/layers',
        {
          method: 'POST',
          body: JSON.stringify({
            name: layerName.trim(),
            admin_level: adminLevel,
            source_citation: sourceCitation.trim(),
            geojson: parsedGeoJson,
          }),
        },
        token,
      );
      setActiveLayerId(created.id);
      setShowGeoImport(false);
      setParsedGeoJson(null);
      setLayerName('');
      setSourceCitation('');
      setMessage(`Uploaded authentic GIS boundary layer '${created.name}' (${created.matched_units_count} matched units).`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload GIS boundary layer.');
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteLayer = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/gis/layers/${id}`, {method: 'DELETE'}, token);
      if (activeLayerId === id) setActiveLayerId('');
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete layer.');
    } finally {
      setBusy(false);
    }
  };

  const handleSaveThresholds = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(
        '/monitoring-thresholds',
        {
          method: 'POST',
          body: JSON.stringify({
            high_coverage_min_pct: highCov === '' ? null : Number(highCov),
            medium_coverage_min_pct: medCov === '' ? null : Number(medCov),
            high_completeness_min_pct: highComp === '' ? null : Number(highComp),
            high_wastage_alert_pct: highWaste === '' ? null : Number(highWaste),
            late_report_cutoff_hour_utc: lateHour === '' ? null : Number(lateHour),
            declining_performance_drop_pct: dropPct === '' ? null : Number(dropPct),
            notes: threshNotes,
          }),
        },
        token,
      );
      setShowThresholds(false);
      setMessage('Administrator monitoring thresholds saved and campaign alert rules updated.');
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update thresholds.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">
            Oromia Spatial Campaign Surveillance · Verified Centroids &amp; Authentic GeoJSON Layers
          </p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Interactive Oromia GIS Map &amp; Zone-to-Woreda Drill-Down
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Displays verified Zone centroids and administrator-imported GeoJSON boundaries. Unmapped Woreda/facility coordinates are never fabricated.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <select
            value={selectedDayFilter}
            onChange={(e) => setSelectedDayFilter(e.target.value)}
            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700"
          >
            <option value="all">Cumulative (All Days)</option>
            {campaign?.days.map((d) => (
              <option key={d.id} value={d.id}>
                {d.label} ({d.campaign_date})
              </option>
            ))}
          </select>

          <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
            {(
              [
                ['coverage', 'Coverage %'],
                ['completeness', 'Completeness %'],
                ['security', 'Security Areas'],
              ] as const
            ).map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetricMode(m)}
                className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
                  metricMode === m ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {canConfigure && (
            <>
              <button
                type="button"
                onClick={() => setShowGeoImport((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#3A99CF] bg-white px-3 py-1.5 text-xs font-bold text-[#3A99CF] hover:bg-[#3A99CF]/5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                Import GeoJSON
              </button>
              <button
                type="button"
                onClick={() => setShowThresholds((v) => !v)}
                className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                <Sliders className="w-3.5 h-3.5" />
                Thresholds
              </button>
            </>
          )}
        </div>
      </div>

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

      {/* Region-Level Rollup Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Regional Scope Coverage</div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
            {formatPctOrNA(regionalStats.covPct)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {regionalStats.vax.toLocaleString()} / {regionalStats.planned.toLocaleString()} (0–59m)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Reporting Completeness</div>
          <div className="mt-1.5 text-2xl font-bold text-[#485EA9] tabular-nums">
            {formatPctOrNA(regionalStats.compPct)}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            Across {zones.length} Zones · {woredas.length} Woredas
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Security-Affected Settlements</div>
          <div className="mt-1.5 text-2xl font-bold text-[#D29441] tabular-nums">
            {regionalStats.secCount}
          </div>
          <div className="mt-1 text-xs text-slate-500 tabular-nums">
            {regionalStats.secVax.toLocaleString()} / {regionalStats.secTarget.toLocaleString()} reached (isolated)
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="text-xs font-bold text-slate-500">Boundary Datasets Loaded</div>
          <div className="mt-1.5 text-2xl font-bold text-slate-900 tabular-nums">
            {gisLayers.length}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {gisLayers.length === 0
              ? 'Zone centroids active; upload GeoJSON for polygons'
              : `Active: ${activeLayer ? activeLayer.name : 'Zone centroids only'}`}
          </div>
        </div>
      </div>

      {/* Authentic GeoJSON Boundary Importer */}
      {showGeoImport && canConfigure && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900">
              Import Authentic Administrative Boundary Layer (GeoJSON FeatureCollection)
            </h3>
            <span className="text-xs text-slate-500">CSA / OCHA / OHB verified shapefiles converted to GeoJSON</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">Layer Name</label>
              <input
                type="text"
                value={layerName}
                onChange={(e) => setLayerName(e.target.value)}
                placeholder="e.g. Oromia ADM3 Woreda Boundaries"
                className="w-full rounded border border-slate-300 px-3 py-1.5"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Administrative Level</label>
              <select
                value={adminLevel}
                onChange={(e) => setAdminLevel(e.target.value as 'Region' | 'Zone' | 'Woreda' | 'Settlement')}
                className="w-full rounded border border-slate-300 px-3 py-1.5"
              >
                <option value="Woreda">Woreda (ADM3)</option>
                <option value="Zone">Zone (ADM2)</option>
                <option value="Region">Region (ADM1)</option>
                <option value="Settlement">Security Settlements</option>
              </select>
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Official Source Citation</label>
              <input
                type="text"
                value={sourceCitation}
                onChange={(e) => setSourceCitation(e.target.value)}
                placeholder="e.g. Ethiopian CSA / HDX OCHA 2024"
                className="w-full rounded border border-slate-300 px-3 py-1.5"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Select GeoJSON File</label>
              <input
                type="file"
                accept=".geojson,.json"
                onChange={handleGeoFile}
                className="w-full text-xs file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2.5 file:py-1 file:font-bold"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !parsedGeoJson}
              onClick={() => void handleUploadGeoLayer()}
              className="rounded-md bg-[#3A99CF] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#3185b5] disabled:opacity-50 cursor-pointer"
            >
              Save Authentic GIS Layer
            </button>
            <button
              type="button"
              onClick={() => setShowGeoImport(false)}
              className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* Admin Performance Thresholds Panel */}
      {showThresholds && canConfigure && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">
              Administrator Performance &amp; Alert Thresholds
            </h3>
            <p className="text-xs text-slate-500">
              OPCMS never invents official coverage cutoffs. Set OHB-approved operational thresholds below (leave blank to keep unconfigured).
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-xs">
            <div>
              <label className="block font-bold text-slate-700 mb-1">High Coverage Min %</label>
              <input
                type="number"
                value={highCov}
                onChange={(e) => setHighCov(e.target.value)}
                placeholder="Unset"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Min Acceptable Cov %</label>
              <input
                type="number"
                value={medCov}
                onChange={(e) => setMedCov(e.target.value)}
                placeholder="Unset"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">High Completeness %</label>
              <input
                type="number"
                value={highComp}
                onChange={(e) => setHighComp(e.target.value)}
                placeholder="Unset"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Wastage Alert %</label>
              <input
                type="number"
                value={highWaste}
                onChange={(e) => setHighWaste(e.target.value)}
                placeholder="15 (default)"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Late Cutoff Hour (UTC)</label>
              <input
                type="number"
                min={0}
                max={23}
                value={lateHour}
                onChange={(e) => setLateHour(e.target.value)}
                placeholder="0-23"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 tabular-nums"
              />
            </div>
            <div>
              <label className="block font-bold text-slate-700 mb-1">Declining Drop Alert %</label>
              <input
                type="number"
                value={dropPct}
                onChange={(e) => setDropPct(e.target.value)}
                placeholder="30 (default)"
                className="w-full rounded border border-slate-300 px-2.5 py-1.5 tabular-nums"
              />
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="text"
              value={threshNotes}
              onChange={(e) => setThreshNotes(e.target.value)}
              placeholder="OHB directive / policy reference for these thresholds..."
              className="flex-1 rounded border border-slate-300 px-3 py-1.5 text-xs"
            />
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleSaveThresholds()}
              className="rounded-md bg-[#485EA9] px-4 py-1.5 text-xs font-bold text-white hover:bg-[#3b4e8f] cursor-pointer"
            >
              Save Thresholds
            </button>
          </div>
        </div>
      )}

      {/* Map + Zone Performance Split */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-[#3A99CF]" />
              <h3 className="text-base font-bold text-slate-900">
                Oromia Region {metricMode === 'coverage' ? 'Coverage' : metricMode === 'completeness' ? 'Reporting Completeness' : 'Security Settlements'} Layer
              </h3>
            </div>
            {gisLayers.length > 0 && (
              <select
                value={activeLayerId}
                onChange={(e) => setActiveLayerId(e.target.value)}
                className="rounded border border-slate-300 px-2.5 py-1 text-xs"
              >
                <option value="">Zone Centroids Only</option>
                {gisLayers.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name} ({l.feature_count} features)
                  </option>
                ))}
              </select>
            )}
          </div>

          <OromiaZoneMap
            zones={zones}
            selectedZoneId={selectedZone?.id}
            onSelectZone={(z) => setSelectedZone(z)}
            metricMode={metricMode}
            zoneStatsMap={zoneStatsMap}
            thresholds={thresholds}
            activeGeoJsonLayer={activeLayer}
            settlements={settlements}
            heightClass="h-[440px]"
          />

          <div className="pt-2 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
            <div>
              {thresholds?.is_configured ? (
                <span>
                  Thresholds Active: High &ge; {thresholds.high_coverage_min_pct ?? 'N/A'}% · Min Acceptable &ge;{' '}
                  {thresholds.medium_coverage_min_pct ?? 'N/A'}% · Completeness &ge;{' '}
                  {thresholds.high_completeness_min_pct ?? 'N/A'}%
                </span>
              ) : (
                <span>
                  Official performance thresholds not yet configured — displaying unthresholded activity markers.
                </span>
              )}
            </div>
            {gisLayers.length === 0 && (
              <span className="text-[#485EA9] font-bold">
                Authentic Zone/Woreda polygon GeoJSONs can be imported above
              </span>
            )}
          </div>

          {gisLayers.length > 0 && (
            <div className="pt-2 border-t border-slate-200 space-y-1.5">
              <div className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-[#485EA9]" />
                Uploaded Authentic Boundary Layers
              </div>
              {gisLayers.map((l) => (
                <div
                  key={l.id}
                  className="flex items-center justify-between text-xs bg-slate-50 border border-slate-200 rounded px-3 py-1.5"
                >
                  <div>
                    <strong className="text-slate-900">{l.name}</strong>{' '}
                    <span className="text-slate-500">
                      ({l.admin_level} · {l.feature_count} features · {l.matched_units_count} matched · Source: {l.source_citation})
                    </span>
                  </div>
                  {canConfigure && (
                    <button
                      type="button"
                      onClick={() => void handleDeleteLayer(l.id)}
                      className="text-red-700 hover:underline inline-flex items-center gap-1 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" />
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Zone List + Woreda Drill-Down Panel */}
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="p-4 border-b border-slate-200 flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                {selectedZone ? `${selectedZone.name} — Woreda Drill-Down` : `Zone Performance (${zones.length})`}
              </h3>
              <p className="text-xs text-slate-500">
                {selectedZone
                  ? `Showing ${drilldownWoredas.length} Woreda(s) inside ${selectedZone.name}`
                  : 'Click a Zone on the map or list below to drill down to Woredas'}
              </p>
            </div>
            {selectedZone && (
              <button
                type="button"
                onClick={() => setSelectedZone(null)}
                className="rounded border border-slate-300 bg-white px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                All Zones
              </button>
            )}
          </div>

          <div className="overflow-x-auto max-h-[480px]">
            {!selectedZone ? (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Zone / City</th>
                    <th className="py-2.5 px-3 text-right">Woredas</th>
                    <th className="py-2.5 px-3 text-right">Cov %</th>
                    <th className="py-2.5 px-3 text-right">Comp %</th>
                    <th className="py-2.5 px-3 text-right">Sec.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {zones.map((z) => {
                    const st = zoneStatsMap[z.id];
                    return (
                      <tr
                        key={z.id}
                        onClick={() => setSelectedZone(z)}
                        className="hover:bg-slate-50 cursor-pointer"
                      >
                        <td className="py-2.5 px-4 font-bold text-slate-900 flex items-center gap-1">
                          <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                          <span>{z.name}</span>
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">{st?.woredaCount || 0}</td>
                        <td className="py-2.5 px-3 text-right tabular-nums font-bold">
                          {formatPctOrNA(st?.coveragePct ?? null)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums">
                          {formatPctOrNA(st?.completenessPct ?? null)}
                        </td>
                        <td className="py-2.5 px-3 text-right tabular-nums text-[#D29441] font-bold">
                          {st?.securityCount || 0}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <table className="w-full text-left border-collapse">
                <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Woreda</th>
                    <th className="py-2.5 px-3 text-right">Planned</th>
                    <th className="py-2.5 px-3 text-right">0–59m Vax</th>
                    <th className="py-2.5 px-3 text-right">Cov %</th>
                    <th className="py-2.5 px-3">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {drilldownWoredas.map((row) => (
                    <tr key={row.woreda.id} className="hover:bg-slate-50/70">
                      <td className="py-2.5 px-4 font-bold text-slate-900">
                        <div>{row.woreda.name}</div>
                        {row.securityCount > 0 && (
                          <div className="text-[11px] font-normal text-[#D29441] inline-flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3" />
                            {row.securityCount} security settlement(s)
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums">
                        {row.woreda.total_planned_target.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold">
                        {row.vaccinated059.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right tabular-nums font-bold">
                        {formatPctOrNA(row.coveragePct)}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600">{row.latestStatus}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
