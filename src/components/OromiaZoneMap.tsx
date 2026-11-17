import React, {useEffect, useRef} from 'react';
import L from 'leaflet';
import type {
  GisBoundaryLayerRecord,
  PerformanceThresholdConfig,
  SecuritySettlementRecord,
  ZoneRecord,
} from '../types/opcms';

export type GisMetricMode = 'coverage' | 'completeness' | 'security';

interface ZoneOverlayStats {
  coveragePct: number | null;
  completenessPct: number | null;
  securityCount: number;
  securityVaccinated: number;
  securityTarget: number;
}

interface OromiaZoneMapProps {
  zones: ZoneRecord[];
  selectedZoneId?: string | null;
  onSelectZone?: (zone: ZoneRecord) => void;
  metricMode?: GisMetricMode;
  zoneStatsMap?: Record<string, ZoneOverlayStats>;
  thresholds?: PerformanceThresholdConfig | null;
  activeGeoJsonLayer?: GisBoundaryLayerRecord | null;
  settlements?: SecuritySettlementRecord[];
  heightClass?: string;
}

function classifyZoneColor(
  zone: ZoneRecord,
  stats: ZoneOverlayStats | undefined,
  mode: GisMetricMode,
  thresholds?: PerformanceThresholdConfig | null,
): string {
  if (mode === 'security') {
    if (!stats || stats.securityCount === 0) return '#94A3B8';
    return '#D29441';
  }

  if (mode === 'completeness') {
    const pct = stats?.completenessPct ?? null;
    if (pct === null || pct === 0) return '#94A3B8';
    if (thresholds?.is_configured && thresholds.high_completeness_min_pct !== null) {
      if (pct >= thresholds.high_completeness_min_pct) return '#16A34A';
      if (pct >= thresholds.high_completeness_min_pct * 0.6) return '#D29441';
      return '#DC2626';
    }
    return '#485EA9';
  }

  // coverage mode
  const cov = stats?.coveragePct ?? null;
  const vax = zone.total_vaccinated_0_59m || 0;
  if (vax === 0 || cov === null) return '#94A3B8';
  if (
    thresholds?.is_configured &&
    thresholds.high_coverage_min_pct !== null &&
    thresholds.medium_coverage_min_pct !== null
  ) {
    if (cov >= thresholds.high_coverage_min_pct) return '#16A34A';
    if (cov >= thresholds.medium_coverage_min_pct) return '#D29441';
    return '#DC2626';
  }
  return '#3A99CF';
}

export const OromiaZoneMap: React.FC<OromiaZoneMapProps> = ({
  zones,
  selectedZoneId,
  onSelectZone,
  metricMode = 'coverage',
  zoneStatsMap = {},
  thresholds,
  activeGeoJsonLayer,
  heightClass = 'h-[360px]',
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const geoLayerRef = useRef<L.LayerGroup | null>(null);
  const markerLayerRef = useRef<L.LayerGroup | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = L.map(containerRef.current, {
      center: [8.25, 38.65],
      zoom: 6,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 14,
    }).addTo(map);

    const geoGroup = L.layerGroup().addTo(map);
    const markerGroup = L.layerGroup().addTo(map);
    mapRef.current = map;
    geoLayerRef.current = geoGroup;
    markerLayerRef.current = markerGroup;

    return () => {
      map.remove();
      mapRef.current = null;
      geoLayerRef.current = null;
      markerLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const geoGroup = geoLayerRef.current;
    const markerGroup = markerLayerRef.current;
    const map = mapRef.current;
    if (!geoGroup || !markerGroup || !map) return;

    geoGroup.clearLayers();
    markerGroup.clearLayers();

    if (activeGeoJsonLayer?.geojson) {
      try {
        const gjLayer = L.geoJSON(activeGeoJsonLayer.geojson as GeoJSON.GeoJsonObject, {
          style: () => ({
            color: '#485EA9',
            weight: 1.5,
            fillColor: '#3A99CF',
            fillOpacity: 0.14,
          }),
          onEachFeature: (feature, layer) => {
            const props = (feature.properties || {}) as Record<string, unknown>;
            const title = String(
              props.ADM3_EN ||
                props.woreda ||
                props.Woreda ||
                props.ADM2_EN ||
                props.zone ||
                props.Zone ||
                props.name ||
                props.NAME ||
                activeGeoJsonLayer.name,
            );
            layer.bindPopup(
              `<div style="font-family: Arial, sans-serif; font-size: 12px;">
                <div style="font-weight:700;color:#0F172A;">${title}</div>
                <div style="color:#64748B;">Layer: ${activeGeoJsonLayer.name} (${activeGeoJsonLayer.admin_level})</div>
                <div style="color:#64748B;">Source: ${activeGeoJsonLayer.source_citation}</div>
              </div>`,
            );
          },
        });
        gjLayer.addTo(geoGroup);
      } catch {
        // Invalid geometry safely ignored
      }
    }

    const bounds: L.LatLngExpression[] = [];
    zones.forEach((zone) => {
      if (typeof zone.latitude !== 'number' || typeof zone.longitude !== 'number') return;
      bounds.push([zone.latitude, zone.longitude]);

      const planned = zone.total_planned_target || 0;
      const vaccinated = zone.total_vaccinated_0_59m || 0;
      const dailyTarget = zone.daily_target || 0;
      const stats = zoneStatsMap[zone.id];
      const radius = Math.max(7, Math.min(20, Math.sqrt(planned / 4500)));
      const isSelected = selectedZoneId === zone.id;
      const markerColor = classifyZoneColor(zone, stats, metricMode, thresholds);

      const marker = L.circleMarker([zone.latitude, zone.longitude], {
        radius,
        color: isSelected ? '#0F172A' : '#FFFFFF',
        weight: isSelected ? 3 : 1.5,
        fillColor: markerColor,
        fillOpacity: 0.88,
      });

      const covDisplay =
        stats?.coveragePct !== null && stats?.coveragePct !== undefined
          ? `${stats.coveragePct.toFixed(1)}%`
          : dailyTarget > 0
            ? `${((vaccinated / dailyTarget) * 100).toFixed(1)}%`
            : 'N/A';
      const compDisplay =
        stats?.completenessPct !== null && stats?.completenessPct !== undefined
          ? `${stats.completenessPct.toFixed(1)}%`
          : 'N/A';

      marker.bindPopup(
        `<div style="font-family: Arial, sans-serif; min-width: 210px;">
          <div style="font-weight: 700; color: #0F172A; font-size: 13px;">${zone.name}</div>
          <div style="color: #64748B; font-size: 11px; margin-bottom: 6px;">${zone.zone_type} Centroid · ${zone.woreda_count || 0} Woredas</div>
          <div style="font-size: 12px; color: #334155;">Planned Target: <strong>${planned.toLocaleString()}</strong></div>
          <div style="font-size: 12px; color: #334155;">0-59m Vaccinated: <strong>${vaccinated.toLocaleString()}</strong> (${covDisplay})</div>
          <div style="font-size: 12px; color: #334155;">Reporting Completeness: <strong>${compDisplay}</strong></div>
          ${
            stats && stats.securityCount > 0
              ? `<div style="font-size: 12px; color: #D29441; margin-top: 4px;">Security Settlements: <strong>${stats.securityCount}</strong> (${stats.securityVaccinated.toLocaleString()} / ${stats.securityTarget.toLocaleString()})</div>`
              : ''
          }
        </div>`,
      );

      marker.on('click', () => {
        if (onSelectZone) onSelectZone(zone);
      });

      marker.addTo(markerGroup);
    });

    if (bounds.length === 1) {
      map.setView(bounds[0], 9);
    } else if (bounds.length > 1) {
      map.fitBounds(L.latLngBounds(bounds), {padding: [28, 28], maxZoom: 8});
    }
  }, [zones, selectedZoneId, onSelectZone, metricMode, zoneStatsMap, thresholds, activeGeoJsonLayer]);

  return (
    <div
      ref={containerRef}
      className={`w-full ${heightClass} rounded-md border border-slate-200 bg-slate-100`}
      aria-label="Oromia Region Campaign GIS Map"
    />
  );
};
