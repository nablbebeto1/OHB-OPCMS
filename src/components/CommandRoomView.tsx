import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Copy,
  KeyRound,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RefreshCw,
  ShieldAlert,
  Syringe,
  Tv,
  X,
} from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {apiRequest, ApiError} from '../lib/api';
import {formatPctOrNA} from '../lib/calculations';
import type {
  CommandDisplaySessionRecord,
  CommandRoomSnapshot,
  UserProfile,
} from '../types/opcms';
import {OromiaZoneMap} from './OromiaZoneMap';

interface CommandRoomViewProps {
  token: string | null;
  user: UserProfile | null;
  displayToken: string | null;
  onExitFullscreenCallback?: () => void;
}

const LAYOUT_TITLES: Record<1 | 2 | 3 | 4 | 5, string> = {
  1: '1 · Regional Overview',
  2: '2 · Vaccination Performance',
  3: '3 · Vaccine Management',
  4: '4 · Surveillance & Security',
  5: '5 · Reporting Compliance',
};

function formatEatClock(date: Date): {dateStr: string; timeStr: string} {
  const timeStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Addis_Ababa',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
  const dateStr = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Addis_Ababa',
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  }).format(date);
  return {dateStr, timeStr};
}

function formatEatTimeOnly(iso: string | null | undefined): string {
  if (!iso) return 'N/A';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'N/A';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Addis_Ababa',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d);
}

export const CommandRoomView: React.FC<CommandRoomViewProps> = ({
  token,
  user,
  displayToken,
}) => {
  const isKioskMode = Boolean(displayToken);
  const canManageDisplaySessions =
    !isKioskMode &&
    Boolean(user && ['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM'].includes(user.role_code));

  const containerRef = useRef<HTMLDivElement | null>(null);
  const [snapshot, setSnapshot] = useState<CommandRoomSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [revokedNotice, setRevokedNotice] = useState(false);

  const [activeLayout, setActiveLayout] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [isPaused, setIsPaused] = useState(false);
  const [rotationSeconds] = useState(30);
  const [countdown, setCountdown] = useState(30);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [eatNow, setEatNow] = useState(() => new Date());
  const [connectionState, setConnectionState] = useState<'LIVE' | 'SYNCING' | 'DELAYED' | 'OFFLINE'>(
    'SYNCING',
  );

  // Display Session Manager state (never accessible in kiosk token mode)
  const [showSessionsModal, setShowSessionsModal] = useState(false);
  const [sessions, setSessions] = useState<CommandDisplaySessionRecord[]>([]);
  const [newLabel, setNewLabel] = useState('OHB Regional EOC Video Wall');
  const [newHours, setNewHours] = useState(24);
  const [createdDisplayUrl, setCreatedDisplayUrl] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);

  const fetchSnapshot = useCallback(async () => {
    setErrorMsg(null);
    setConnectionState((prev) => (prev === 'OFFLINE' ? 'OFFLINE' : 'SYNCING'));
    try {
      const url = displayToken
        ? `/api/v1/command-room/snapshot?display_token=${encodeURIComponent(displayToken)}`
        : `/api/v1/command-room/snapshot`;
      const headers: Record<string, string> = {'Content-Type': 'application/json'};
      if (!displayToken && token) {
        headers.Authorization = `Bearer ${token}`;
      }
      const res = await fetch(url, {headers});
      if (res.status === 401 || res.status === 403) {
        if (displayToken) setRevokedNotice(true);
        const body = await res.json().catch(() => ({}));
        throw new Error(body.detail || 'Command Room session is unauthorized or revoked.');
      }
      if (!res.ok) {
        throw new Error(`Snapshot fetch failed (${res.status}).`);
      }
      const data = (await res.json()) as CommandRoomSnapshot;
      setSnapshot(data);
      setRevokedNotice(false);
      setConnectionState('LIVE');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to load Command Room telemetry.');
      setConnectionState(navigator.onLine ? 'DELAYED' : 'OFFLINE');
    } finally {
      setLoading(false);
    }
  }, [displayToken, token]);

  useEffect(() => {
    void fetchSnapshot();
  }, [fetchSnapshot]);

  // Live SSE Stream for Command Room (authenticates via display_token OR Bearer JWT)
  useEffect(() => {
    if (!displayToken && !token) return;
    let es: EventSource | null = null;
    let retryTimer: number | null = null;
    let closed = false;

    const connect = () => {
      if (closed) return;
      if (!navigator.onLine) {
        setConnectionState('OFFLINE');
        return;
      }
      const streamUrl = displayToken
        ? `/api/v1/command-room/stream?display_token=${encodeURIComponent(displayToken)}`
        : `/api/v1/command-room/stream?token=${encodeURIComponent(token || '')}`;
      es = new EventSource(streamUrl);

      es.addEventListener('connected', () => {
        setConnectionState('LIVE');
      });
      es.addEventListener('heartbeat', () => {
        setConnectionState('LIVE');
      });
      const refreshHandler = () => {
        setConnectionState('LIVE');
        void fetchSnapshot();
      };
      es.addEventListener('report:received', refreshHandler);
      es.addEventListener('report:workflow', refreshHandler);
      es.addEventListener('alert:updated', refreshHandler);
      es.addEventListener('gis:updated', refreshHandler);
      es.addEventListener('revoked', () => {
        setRevokedNotice(true);
        setConnectionState('OFFLINE');
        es?.close();
      });
      es.onerror = () => {
        setConnectionState(navigator.onLine ? 'DELAYED' : 'OFFLINE');
        es?.close();
        if (!closed && !revokedNotice) {
          retryTimer = window.setTimeout(connect, 5000);
        }
      };
    };

    connect();
    return () => {
      closed = true;
      es?.close();
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [displayToken, token, fetchSnapshot, revokedNotice]);

  // EAT Clock 1s ticker + Auto-rotate 30s countdown
  useEffect(() => {
    const timer = window.setInterval(() => {
      setEatNow(new Date());
      if (!isPaused && !showSessionsModal && !revokedNotice) {
        setCountdown((prev) => {
          if (prev <= 1) {
            setActiveLayout((cur) => ((cur % 5) + 1) as 1 | 2 | 3 | 4 | 5);
            return rotationSeconds;
          }
          return prev - 1;
        });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [isPaused, showSessionsModal, revokedNotice, rotationSeconds]);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await (containerRef.current || document.documentElement).requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback visual fullscreen class handles environments blocking Fullscreen API
      setIsFullscreen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  // Keyboard shortcuts: F (Fullscreen), Space (Pause/Resume), 1-5 (Select Layout), R (Refresh), Esc (Exit)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      } else if (e.code === 'Space') {
        e.preventDefault();
        setIsPaused((p) => !p);
      } else if (['1', '2', '3', '4', '5'].includes(e.key)) {
        e.preventDefault();
        setActiveLayout(Number(e.key) as 1 | 2 | 3 | 4 | 5);
        setCountdown(rotationSeconds);
      } else if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        void fetchSnapshot();
      } else if (e.key === 'Escape') {
        if (showSessionsModal) {
          setShowSessionsModal(false);
        } else if (document.fullscreenElement) {
          void document.exitFullscreen();
        } else {
          setIsFullscreen(false);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleFullscreen, fetchSnapshot, rotationSeconds, showSessionsModal]);

  const loadSessions = useCallback(async () => {
    if (!canManageDisplaySessions || !token) return;
    try {
      const list = await apiRequest<CommandDisplaySessionRecord[]>(
        '/command-room/sessions',
        {},
        token,
      );
      setSessions(list);
    } catch {
      // ignore
    }
  }, [canManageDisplaySessions, token]);

  useEffect(() => {
    if (showSessionsModal) {
      void loadSessions();
    }
  }, [showSessionsModal, loadSessions]);

  const handleCreateDisplaySession = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setSessionBusy(true);
    setCreatedDisplayUrl(null);
    try {
      const res = await apiRequest<{
        session: CommandDisplaySessionRecord;
        display_token: string;
      }>(
        '/command-room/sessions',
        {
          method: 'POST',
          body: JSON.stringify({
            label: newLabel,
            default_layout: activeLayout,
            rotation_seconds: rotationSeconds,
            expires_in_hours: newHours,
          }),
        },
        token,
      );
      const url = `${window.location.origin}/?display_token=${encodeURIComponent(res.display_token)}`;
      setCreatedDisplayUrl(url);
      setCopiedUrl(false);
      await loadSessions();
    } catch (err) {
      setErrorMsg(err instanceof ApiError ? err.message : 'Unable to create display session.');
    } finally {
      setSessionBusy(false);
    }
  };

  const handleRevokeSession = async (id: string) => {
    if (!token) return;
    await apiRequest(`/command-room/sessions/${id}/revoke`, {method: 'POST'}, token);
    await loadSessions();
  };

  const zoneStatsMap = useMemo(() => {
    const map: Record<
      string,
      {
        coveragePct: number | null;
        completenessPct: number | null;
        securityCount: number;
        securityVaccinated: number;
        securityTarget: number;
      }
    > = {};
    if (!snapshot) return map;
    for (const z of snapshot.zones) {
      map[z.id] = {
        coveragePct: z.coverage_pct,
        completenessPct: z.completeness_pct,
        securityCount: z.security_settlements_count,
        securityVaccinated: 0,
        securityTarget: 0,
      };
    }
    return map;
  }, [snapshot]);

  const {dateStr, timeStr} = formatEatClock(eatNow);

  if (revokedNotice) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="max-w-lg w-full bg-slate-900 border border-red-500/40 rounded-xl p-8 text-center space-y-4">
          <ShieldAlert className="w-12 h-12 text-red-400 mx-auto" />
          <h1 className="text-2xl font-bold text-white">Command Display Session Revoked or Expired</h1>
          <p className="text-sm text-slate-300">
            This read-only large-screen monitoring token has been revoked or has expired. Contact the OHB Regional System Administrator or Coordination Team to issue a new display URL.
          </p>
        </div>
      </div>
    );
  }

  if (loading && !snapshot) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-8">
        <div className="text-center space-y-3">
          <Tv className="w-10 h-10 text-[#3A99CF] mx-auto animate-pulse" />
          <div className="text-lg font-bold">Connecting OHB Command Room Telemetry...</div>
        </div>
      </div>
    );
  }

  const t = snapshot?.overview_totals;
  const connBadgeClass =
    connectionState === 'LIVE'
      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
      : connectionState === 'SYNCING'
        ? 'bg-sky-500/20 text-sky-300 border-sky-500/40'
        : connectionState === 'DELAYED'
          ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
          : 'bg-red-500/20 text-red-300 border-red-500/40';

  const topZonesChart = snapshot
    ? [...snapshot.zones]
        .sort((a, b) => (b.coverage_pct ?? -1) - (a.coverage_pct ?? -1))
        .slice(0, 12)
        .map((z) => ({
          name: z.name.replace(' Zone', '').replace(' City', ''),
          vaccinated: z.total_vaccinated_0_59m || 0,
          planned: z.total_planned_target || 0,
          coverage: z.coverage_pct ?? 0,
          completeness: z.completeness_pct ?? 0,
        }))
    : [];

  return (
    <div
      ref={containerRef}
      className={`${
        isFullscreen ? 'fixed inset-0 z-50 overflow-y-auto' : 'rounded-xl'
      } bg-slate-950 text-slate-100 min-h-[calc(100vh-7rem)] flex flex-col justify-between border border-slate-800`}
    >
      {/* Top Command Room Bar */}
      <header className="bg-slate-900/95 border-b border-slate-800 px-6 py-3.5 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-11 h-11 rounded-lg bg-[#3A99CF] flex items-center justify-center shrink-0">
            <Tv className="w-6 h-6 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-lg xl:text-xl font-bold text-white tracking-tight truncate">
                OROMIA HEALTH BUREAU · POLIO CAMPAIGN COMMAND ROOM
              </h1>
              <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-[#485EA9] text-white">
                READ-ONLY DISPLAY
              </span>
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded border ${connBadgeClass}`}>
                {connectionState}
              </span>
            </div>
            <p className="text-xs text-slate-400 truncate mt-0.5">
              2026 Round 1 nOPV2 &amp; bOPV Co-administration Campaign · {snapshot?.session_label} · Last Update:{' '}
              <span className="text-slate-200 font-bold tabular-nums">
                {formatEatTimeOnly(snapshot?.generated_at)} EAT
              </span>
            </p>
          </div>
        </div>

        {/* EAT Clock & Controls */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="bg-slate-950 border border-slate-800 rounded-lg px-4 py-1.5 text-right">
            <div className="text-xl xl:text-2xl font-bold text-white tabular-nums leading-tight">
              {timeStr} <span className="text-xs text-[#3A99CF]">EAT</span>
            </div>
            <div className="text-[11px] text-slate-400">{dateStr} · Africa/Addis_Ababa</div>
          </div>

          <button
            type="button"
            onClick={() => setIsPaused((p) => !p)}
            title="Space: Pause/Resume Auto-Rotation"
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3.5 py-2 text-xs font-bold text-white cursor-pointer tabular-nums"
          >
            {isPaused ? <Play className="w-4 h-4 text-emerald-400" /> : <Pause className="w-4 h-4 text-[#D29441]" />}
            {isPaused ? 'Resume' : `Auto ${countdown}s`}
          </button>

          <button
            type="button"
            onClick={() => void fetchSnapshot()}
            title="R: Refresh Data"
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-700 bg-slate-800 hover:bg-slate-700 px-3 py-2 text-xs font-bold text-white cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>

          <button
            type="button"
            onClick={() => void toggleFullscreen()}
            title="F: Toggle Fullscreen (Esc to Exit)"
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3A99CF] hover:bg-[#3185b5] px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
          >
            {isFullscreen ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
            {isFullscreen ? 'Exit Full' : 'Full Screen'}
          </button>

          {canManageDisplaySessions && (
            <button
              type="button"
              onClick={() => setShowSessionsModal(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#D29441]/60 bg-[#D29441]/15 hover:bg-[#D29441]/25 px-3 py-2 text-xs font-bold text-[#f3c27a] cursor-pointer"
            >
              <KeyRound className="w-4 h-4" />
              Display URLs
            </button>
          )}
        </div>
      </header>

      {/* Layout Navigation Strip */}
      <div className="bg-slate-900/60 border-b border-slate-800 px-6 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {([1, 2, 3, 4, 5] as const).map((num) => (
            <button
              key={num}
              type="button"
              onClick={() => {
                setActiveLayout(num);
                setCountdown(rotationSeconds);
              }}
              className={`px-3.5 py-1.5 rounded-md text-xs font-bold transition-colors cursor-pointer ${
                activeLayout === num
                  ? 'bg-[#3A99CF] text-white'
                  : 'bg-slate-800/80 text-slate-300 hover:bg-slate-800 hover:text-white'
              }`}
            >
              {LAYOUT_TITLES[num]}
            </button>
          ))}
        </div>
        <div className="text-[11px] text-slate-400 hidden xl:block">
          Shortcuts: <strong className="text-slate-200">1–5</strong> Layouts ·{' '}
          <strong className="text-slate-200">Space</strong> Pause/Resume ·{' '}
          <strong className="text-slate-200">F</strong> Fullscreen ·{' '}
          <strong className="text-slate-200">R</strong> Refresh ·{' '}
          <strong className="text-slate-200">Esc</strong> Exit
        </div>
      </div>

      {errorMsg && (
        <div className="mx-6 mt-4 rounded-lg bg-red-950/60 border border-red-500/40 px-4 py-2.5 text-xs font-bold text-red-200">
          {errorMsg}
        </div>
      )}

      {/* Main 16:9 Command Canvas */}
      <main className="flex-1 p-6 space-y-6">
        {/* ================= LAYOUT 1: REGIONAL OVERVIEW ================= */}
        {activeLayout === 1 && snapshot && t && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Overall Campaign Coverage</div>
                <div className="mt-2 text-4xl xl:text-5xl font-bold text-[#3A99CF] tabular-nums">
                  {formatPctOrNA(t.regional_total_coverage_pct)}
                </div>
                <div className="mt-1 text-xs text-slate-400 tabular-nums">
                  Daily Target Cov: {formatPctOrNA(t.regional_daily_coverage_pct)}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Total Vaccinated (0–59m)</div>
                <div className="mt-2 text-4xl xl:text-5xl font-bold text-emerald-400 tabular-nums">
                  {t.total_vaccinated_0_59m.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-slate-400 tabular-nums">
                  + {t.total_vaccinated_60_120m.toLocaleString()} (60–120m)
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Computed Planned Target</div>
                <div className="mt-2 text-4xl xl:text-5xl font-bold text-white tabular-nums">
                  {t.computed_planned_target.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-slate-400 tabular-nums">
                  Daily Target: {t.computed_daily_target.toLocaleString()} · {t.total_woredas} Woredas
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Reporting Completeness</div>
                <div className="mt-2 text-4xl xl:text-5xl font-bold text-[#D29441] tabular-nums">
                  {formatPctOrNA(t.reporting_completeness_pct)}
                </div>
                <div className="mt-1 text-xs text-slate-400 tabular-nums">
                  {t.reports_submitted_or_approved} Recv · {t.reports_approved} Approved
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Active Alerts (Open)</div>
                <div className="mt-2 text-4xl xl:text-5xl font-bold text-red-400 tabular-nums">
                  {t.open_alerts_count.toLocaleString()}
                </div>
                <div className="mt-1 text-xs text-slate-400 tabular-nums">
                  Critical: {t.critical_alerts_count} · AFP: {t.afp_alerts} · AEFI: {t.aefi_alerts}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Oromia GIS Map */}
              <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-bold text-white">Oromia Spatial Coverage Map (28 Zones)</h2>
                  <span className="text-xs text-slate-400">Centroid Overlay</span>
                </div>
                <div className="rounded-lg overflow-hidden border border-slate-700">
                  <OromiaZoneMap
                    zones={snapshot.zones}
                    metricMode="coverage"
                    zoneStatsMap={zoneStatsMap}
                    thresholds={snapshot.thresholds}
                    heightClass="h-[400px]"
                  />
                </div>
              </div>

              {/* Zone Performance Bar Chart */}
              <div className="xl:col-span-4 bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <h2 className="text-base font-bold text-white">Zone Vaccinated vs Planned (Top 12)</h2>
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={topZonesChart} layout="vertical" margin={{left: 16, right: 16}}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis type="number" tick={{fill: '#94a3b8', fontSize: 11}} />
                      <YAxis type="category" dataKey="name" width={95} tick={{fill: '#e2e8f0', fontSize: 11}} />
                      <Tooltip
                        contentStyle={{backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc'}}
                      />
                      <Bar dataKey="vaccinated" name="0-59m Vaccinated" fill="#3A99CF" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Latest Reporting Activity */}
              <div className="xl:col-span-3 bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col">
                <h2 className="text-base font-bold text-white mb-3">Latest Reporting Activity</h2>
                <div className="flex-1 overflow-y-auto divide-y divide-slate-800 max-h-[400px]">
                  {snapshot.latest_activity.length === 0 ? (
                    <div className="py-12 text-center text-sm text-slate-400">
                      Awaiting first daily report submission from Oromia Woredas.
                    </div>
                  ) : (
                    snapshot.latest_activity.map((act) => (
                      <div key={act.report_id} className="py-2.5 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-sm font-bold text-white truncate">{act.woreda_name}</div>
                          <div className="text-xs text-slate-400 truncate">
                            {act.zone_name} · {act.day_label} · {act.status}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold text-emerald-400 tabular-nums">
                            {act.total_vaccinated_0_59m.toLocaleString()}
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {formatEatTimeOnly(act.received_at)} EAT
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= LAYOUT 2: VACCINATION PERFORMANCE ================= */}
        {activeLayout === 2 && snapshot && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              {/* Daily Trend & Cumulative Coverage */}
              <div className="xl:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-bold text-white">
                  Daily Vaccination Trend &amp; Cumulative Coverage (Day 1–Day 6)
                </h2>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={snapshot.daily_progression}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="label" tick={{fill: '#e2e8f0', fontSize: 12}} />
                      <YAxis yAxisId="left" tick={{fill: '#94a3b8', fontSize: 11}} />
                      <YAxis yAxisId="right" orientation="right" unit="%" tick={{fill: '#D29441', fontSize: 11}} />
                      <Tooltip
                        contentStyle={{backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc'}}
                      />
                      <Legend />
                      <Bar yAxisId="left" dataKey="vaccinated_0_59m" name="Daily 0–59m Vaccinated" fill="#3A99CF" />
                      <Bar yAxisId="left" dataKey="daily_target" name="Daily Target" fill="#485EA9" />
                      <Line
                        yAxisId="right"
                        type="monotone"
                        dataKey="cumulative_coverage_pct"
                        name="Cumulative Cov %"
                        stroke="#D29441"
                        strokeWidth={3}
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Age-Group Breakdown (VB vs NV) */}
              <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <h2 className="text-lg font-bold text-white">
                  Age-Group Disaggregation (Vaccinated Before vs Not Vaccinated Before)
                </h2>
                <div className="h-[340px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={snapshot.age_group_breakdown}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                      <XAxis dataKey="age_group" tick={{fill: '#e2e8f0', fontSize: 12}} />
                      <YAxis tick={{fill: '#94a3b8', fontSize: 11}} />
                      <Tooltip
                        contentStyle={{backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc'}}
                      />
                      <Legend />
                      <Bar dataKey="vaccinated_before" stackId="a" name="Vaccinated Before" fill="#3A99CF" />
                      <Bar dataKey="not_vaccinated_before" stackId="a" name="Not Vaccinated Before" fill="#D29441" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>

            {/* Top & Lowest Performing Woredas */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-base font-bold text-emerald-400 mb-3">
                  Highest Coverage Woredas (Target vs Achievement)
                </h3>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2">Woreda</th>
                      <th className="py-2">Zone</th>
                      <th className="py-2 text-right">Planned</th>
                      <th className="py-2 text-right">0–59m Vax</th>
                      <th className="py-2 text-right">Cov %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {snapshot.woreda_rankings.top_coverage.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400">
                          No Woreda reports recorded yet.
                        </td>
                      </tr>
                    ) : (
                      snapshot.woreda_rankings.top_coverage.map((w) => (
                        <tr key={w.id}>
                          <td className="py-2 font-bold text-white">{w.name}</td>
                          <td className="py-2 text-slate-400">{w.zone_name}</td>
                          <td className="py-2 text-right tabular-nums">{w.planned_target.toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums text-emerald-400 font-bold">
                            {w.vaccinated_0_59m.toLocaleString()}
                          </td>
                          <td className="py-2 text-right tabular-nums font-bold">{formatPctOrNA(w.coverage_pct)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h3 className="text-base font-bold text-[#D29441] mb-3">
                  Lowest Coverage Woredas Requiring Priority Follow-up
                </h3>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2">Woreda</th>
                      <th className="py-2">Zone</th>
                      <th className="py-2 text-right">Planned</th>
                      <th className="py-2 text-right">0–59m Vax</th>
                      <th className="py-2 text-right">Cov %</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {snapshot.woreda_rankings.lowest_coverage.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-6 text-center text-slate-400">
                          No Woreda reports recorded yet.
                        </td>
                      </tr>
                    ) : (
                      snapshot.woreda_rankings.lowest_coverage.map((w) => (
                        <tr key={w.id}>
                          <td className="py-2 font-bold text-white">{w.name}</td>
                          <td className="py-2 text-slate-400">{w.zone_name}</td>
                          <td className="py-2 text-right tabular-nums">{w.planned_target.toLocaleString()}</td>
                          <td className="py-2 text-right tabular-nums text-amber-300 font-bold">
                            {w.vaccinated_0_59m.toLocaleString()}
                          </td>
                          <td className="py-2 text-right tabular-nums font-bold">{formatPctOrNA(w.coverage_pct)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ================= LAYOUT 3: VACCINE MANAGEMENT ================= */}
        {activeLayout === 3 && snapshot && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              {[snapshot.vaccine_management.nopv2, snapshot.vaccine_management.bopv].map((vac) => (
                <div key={vac.vaccine_type} className="bg-slate-900 border border-slate-800 rounded-xl p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Syringe className="w-6 h-6 text-[#3A99CF]" />
                      <h2 className="text-2xl font-bold text-white">{vac.vaccine_type}</h2>
                    </div>
                    <span className="text-2xl font-bold text-[#D29441] tabular-nums">
                      Wastage: {formatPctOrNA(vac.wastage_rate_pct)}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-xs text-slate-400">Vials Received</div>
                      <div className="text-2xl font-bold text-white tabular-nums">{vac.vials_received.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-xs text-slate-400">Vials Used (Full)</div>
                      <div className="text-2xl font-bold text-emerald-400 tabular-nums">{vac.vials_used.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-xs text-slate-400">Partially Used</div>
                      <div className="text-xl font-bold text-sky-300 tabular-nums">{vac.vials_partially_used.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-xs text-slate-400">Returned Good (Unused)</div>
                      <div className="text-xl font-bold text-white tabular-nums">{vac.vials_returned_unused_good.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-xs text-slate-400">Returned Bad (Stage 3/4)</div>
                      <div className="text-xl font-bold text-amber-400 tabular-nums">{vac.vials_returned_bad_stage_3_4.toLocaleString()}</div>
                    </div>
                    <div className="bg-slate-950 rounded-lg p-3 border border-slate-800">
                      <div className="text-xs text-slate-400">Broken / Lost Vials</div>
                      <div className="text-xl font-bold text-red-400 tabular-nums">
                        {vac.vials_broken.toLocaleString()} / {vac.vials_lost.toLocaleString()}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              {/* Reconciliation Alerts & Formula Summary */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-4">
                <div>
                  <h2 className="text-lg font-bold text-white mb-2">Vaccine Reconciliation &amp; Formula Control</h2>
                  <p className="text-xs text-slate-400">
                    Active Calculation Profile:{' '}
                    <strong className="text-[#3A99CF]">
                      {snapshot.active_calculation_config.version} · {snapshot.active_calculation_config.name}
                    </strong>
                  </p>
                  <div className="mt-4 bg-slate-950 border border-slate-800 rounded-lg p-4 space-y-2">
                    <div className="text-xs text-slate-400">High Vaccine Wastage Alerts (Open)</div>
                    <div className="text-4xl font-bold text-[#D29441] tabular-nums">
                      {snapshot.vaccine_management.wastage_alerts_count}
                    </div>
                    <div className="text-xs text-slate-400">
                      Denominator Mode: <strong className="text-slate-200">{snapshot.active_calculation_config.wastage_denominator_mode}</strong>
                    </div>
                  </div>
                </div>
                <div className="text-xs text-slate-300 bg-slate-950 border border-slate-800 rounded-lg p-4">
                  <div className="font-bold text-white mb-1">Doses-Per-Vial Policy</div>
                  <div>nOPV2 Day 1 Default: {snapshot.campaign.nopv2_doses_per_vial} doses/vial</div>
                  <div>bOPV Day 1 Default: {snapshot.campaign.bopv_doses_per_vial} doses/vial</div>
                  <div className="text-slate-400 mt-1">
                    Zero denominators automatically render as N/A.
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h3 className="text-base font-bold text-white mb-3">nOPV2 vs bOPV Regional Vial Reconciliation</h3>
              <div className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={[
                      {
                        metric: 'Received',
                        nOPV2: snapshot.vaccine_management.nopv2.vials_received,
                        bOPV: snapshot.vaccine_management.bopv.vials_received,
                      },
                      {
                        metric: 'Used',
                        nOPV2: snapshot.vaccine_management.nopv2.vials_used,
                        bOPV: snapshot.vaccine_management.bopv.vials_used,
                      },
                      {
                        metric: 'Partial',
                        nOPV2: snapshot.vaccine_management.nopv2.vials_partially_used,
                        bOPV: snapshot.vaccine_management.bopv.vials_partially_used,
                      },
                      {
                        metric: 'Ret. Good',
                        nOPV2: snapshot.vaccine_management.nopv2.vials_returned_unused_good,
                        bOPV: snapshot.vaccine_management.bopv.vials_returned_unused_good,
                      },
                      {
                        metric: 'Stage 3/4',
                        nOPV2: snapshot.vaccine_management.nopv2.vials_returned_bad_stage_3_4,
                        bOPV: snapshot.vaccine_management.bopv.vials_returned_bad_stage_3_4,
                      },
                      {
                        metric: 'Broken+Lost',
                        nOPV2: snapshot.vaccine_management.nopv2.vials_broken + snapshot.vaccine_management.nopv2.vials_lost,
                        bOPV: snapshot.vaccine_management.bopv.vials_broken + snapshot.vaccine_management.bopv.vials_lost,
                      },
                    ]}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="metric" tick={{fill: '#e2e8f0', fontSize: 12}} />
                    <YAxis tick={{fill: '#94a3b8', fontSize: 11}} />
                    <Tooltip contentStyle={{backgroundColor: '#0f172a', borderColor: '#334155', color: '#f8fafc'}} />
                    <Legend />
                    <Bar dataKey="nOPV2" fill="#3A99CF" />
                    <Bar dataKey="bOPV" fill="#D29441" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}

        {/* ================= LAYOUT 4: SURVEILLANCE & SECURITY ================= */}
        {activeLayout === 4 && snapshot && t && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="bg-slate-900 border border-red-500/40 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">AFP Alerts (Total)</div>
                <div className="mt-2 text-4xl font-bold text-red-400 tabular-nums">
                  {snapshot.surveillance_and_security.afp_alerts_total}
                </div>
              </div>
              <div className="bg-slate-900 border border-amber-500/40 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">AEFI Alerts (Total)</div>
                <div className="mt-2 text-4xl font-bold text-[#D29441] tabular-nums">
                  {snapshot.surveillance_and_security.aefi_alerts_total}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Security Settlements</div>
                <div className="mt-2 text-4xl font-bold text-white tabular-nums">
                  {snapshot.surveillance_and_security.security_settlements_total}
                </div>
                <div className="text-xs text-slate-400 mt-1 tabular-nums">
                  Reporting Gaps: {snapshot.surveillance_and_security.security_reporting_gaps_count}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Zero-Dose Cascade</div>
                <div className="mt-2 text-2xl font-bold text-emerald-400 tabular-nums">
                  {t.zero_dose_identified} → {t.zero_dose_linked} → {t.zero_dose_vaccinated}
                </div>
                <div className="text-xs text-slate-400 mt-1">Identified → Linked → Vaccinated</div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Under-Vaccinated Cascade</div>
                <div className="mt-2 text-2xl font-bold text-[#3A99CF] tabular-nums">
                  {t.under_vaccinated_identified} → {t.under_vaccinated_linked} → {t.under_vaccinated_vaccinated}
                </div>
                <div className="text-xs text-slate-400 mt-1">Identified → Linked → Vaccinated</div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              <div className="xl:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-3">
                  Security-Affected Zones &amp; Settlements (Isolated from Woreda Totals)
                </h2>
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2">Zone</th>
                      <th className="py-2 text-right">Settlements</th>
                      <th className="py-2 text-right">Inaccessible</th>
                      <th className="py-2 text-right">Target 0–59m</th>
                      <th className="py-2 text-right">Vaccinated</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {snapshot.surveillance_and_security.security_zone_summary.map((sz) => (
                      <tr key={sz.zone_name}>
                        <td className="py-2 font-bold text-white">{sz.zone_name}</td>
                        <td className="py-2 text-right tabular-nums">{sz.settlements}</td>
                        <td className="py-2 text-right tabular-nums text-red-400 font-bold">{sz.inaccessible}</td>
                        <td className="py-2 text-right tabular-nums">{sz.target.toLocaleString()}</td>
                        <td className="py-2 text-right tabular-nums text-emerald-400 font-bold">
                          {sz.vaccinated.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="xl:col-span-6 bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-3">
                  Active Surveillance, Security &amp; Zero-Dose Alerts
                </h2>
                <div className="divide-y divide-slate-800 max-h-[380px] overflow-y-auto">
                  {snapshot.surveillance_and_security.recent_surveillance_alerts.length === 0 ? (
                    <div className="py-10 text-center text-sm text-slate-400">
                      No active AFP, AEFI, or security settlement alerts.
                    </div>
                  ) : (
                    snapshot.surveillance_and_security.recent_surveillance_alerts.map((al) => (
                      <div key={al.id} className="py-3 flex items-start justify-between gap-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <AlertTriangle
                              className={`w-4 h-4 ${
                                al.priority === 'Critical' ? 'text-red-400' : 'text-[#D29441]'
                              }`}
                            />
                            <span className="text-sm font-bold text-white">{al.alert_type}</span>
                            <span className="text-xs text-slate-400">· {al.admin_location}</span>
                          </div>
                          <p className="text-xs text-slate-300 mt-1">{al.description}</p>
                        </div>
                        <span className="text-xs font-bold text-slate-400 shrink-0">{al.resolution_status}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ================= LAYOUT 5: REPORTING COMPLIANCE ================= */}
        {activeLayout === 5 && snapshot && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 xl:grid-cols-5 gap-4">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Reporting Completeness</div>
                <div className="mt-2 text-4xl font-bold text-[#3A99CF] tabular-nums">
                  {formatPctOrNA(snapshot.reporting_compliance.completeness_pct)}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Expected Reports (Open Days)</div>
                <div className="mt-2 text-4xl font-bold text-white tabular-nums">
                  {snapshot.reporting_compliance.expected_total_reports.toLocaleString()}
                </div>
                <div className="text-xs text-slate-400 mt-1 tabular-nums">
                  {snapshot.reporting_compliance.woredas_expected_per_day} Woredas ×{' '}
                  {snapshot.reporting_compliance.open_days_count} Open Day(s)
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Reports Received</div>
                <div className="mt-2 text-4xl font-bold text-emerald-400 tabular-nums">
                  {snapshot.reporting_compliance.reports_received.toLocaleString()}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Approved &amp; Locked</div>
                <div className="mt-2 text-4xl font-bold text-white tabular-nums">
                  {snapshot.reporting_compliance.reports_approved.toLocaleString()}
                </div>
              </div>
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
                <div className="text-xs font-bold text-slate-400 uppercase">Missing / Pending / Late</div>
                <div className="mt-2 text-4xl font-bold text-[#D29441] tabular-nums">
                  {snapshot.reporting_compliance.reports_pending_draft_or_missing.toLocaleString()}
                </div>
                <div className="text-xs text-red-400 mt-1 tabular-nums">
                  Late Report Alerts: {snapshot.reporting_compliance.late_reports_count}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
              <div className="xl:col-span-7 bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-3">Zone Submission Status (All 28 Zones)</h2>
                <div className="max-h-[400px] overflow-y-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="sticky top-0 bg-slate-900 text-xs text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2">Zone</th>
                        <th className="py-2 text-right">Woredas</th>
                        <th className="py-2 text-right">Submitted</th>
                        <th className="py-2 text-right">Approved</th>
                        <th className="py-2 text-right">Missing</th>
                        <th className="py-2 text-right">Completeness</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800">
                      {snapshot.zones.map((z) => (
                        <tr key={z.id}>
                          <td className="py-2 font-bold text-white">{z.name}</td>
                          <td className="py-2 text-right tabular-nums">{z.woreda_count}</td>
                          <td className="py-2 text-right tabular-nums text-emerald-400 font-bold">
                            {z.submitted_count}
                          </td>
                          <td className="py-2 text-right tabular-nums">{z.approved_count}</td>
                          <td className="py-2 text-right tabular-nums text-amber-300">{z.missing_count}</td>
                          <td className="py-2 text-right tabular-nums font-bold">
                            {formatPctOrNA(z.completeness_pct)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="xl:col-span-5 bg-slate-900 border border-slate-800 rounded-xl p-5">
                <h2 className="text-base font-bold text-white mb-3">
                  Sample Pending / Missing Woreda Submissions
                </h2>
                <div className="divide-y divide-slate-800 max-h-[400px] overflow-y-auto">
                  {snapshot.reporting_compliance.missing_woredas_sample.length === 0 ? (
                    <div className="py-10 text-center text-sm text-emerald-400 flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-5 h-5" />
                      All expected Woreda reports have been submitted.
                    </div>
                  ) : (
                    snapshot.reporting_compliance.missing_woredas_sample.map((m, idx) => (
                      <div key={idx} className="py-2.5 flex items-center justify-between gap-2 text-sm">
                        <div>
                          <div className="font-bold text-white">{m.woreda_name}</div>
                          <div className="text-xs text-slate-400">
                            {m.zone_name} · {m.day_label}
                          </div>
                        </div>
                        <span className="text-xs font-bold text-[#D29441]">{m.status}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer Telemetry Strip */}
      <footer className="bg-slate-900/90 border-t border-slate-800 px-6 py-2.5 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-400">
        <div className="flex items-center gap-4">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-[#3A99CF]" />
            Last Report Received:{' '}
            <strong className="text-slate-200">
              {snapshot?.sync_telemetry.last_report_received
                ? `${snapshot.sync_telemetry.last_report_received.woreda_name} (${snapshot.sync_telemetry.last_report_received.day_label})`
                : 'Awaiting first submission'}
            </strong>
          </span>
          <span className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock className="w-3.5 h-3.5 text-slate-400" />
            Layout {activeLayout} of 5
          </span>
        </div>
        <div>
          OHB Polio Campaign Management System · Read-Only Command Display · Zero Child PII
        </div>
      </footer>

      {/* Secure Read-Only Display URL & Session Manager Modal (Admin & Coordination Only) */}
      {showSessionsModal && canManageDisplaySessions && (
        <div className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-3xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Read-Only Command Room Display URLs (Revocable Tokens)
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Issue scoped, read-only URLs for EOC video walls and projectors. Tokens never expose user accounts or write permissions and can be revoked immediately.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowSessionsModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateDisplaySession} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-300 mb-1">Display Screen Label</label>
                <input
                  type="text"
                  required
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">Expires (Hours)</label>
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={newHours}
                  onChange={(e) => setNewHours(Number(e.target.value) || 24)}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-white"
                />
              </div>
              <button
                type="submit"
                disabled={sessionBusy}
                className="rounded-md bg-[#3A99CF] hover:bg-[#3185b5] px-4 py-2 text-xs font-bold text-white cursor-pointer"
              >
                {sessionBusy ? 'Issuing...' : 'Issue Display Token'}
              </button>
            </form>

            {createdDisplayUrl && (
              <div className="bg-emerald-950/60 border border-emerald-500/40 rounded-lg p-4 space-y-2">
                <div className="text-xs font-bold text-emerald-300">
                  One-Time Read-Only Display URL Generated (Copy Now — Token Is Hashed on Server):
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={createdDisplayUrl}
                    className="flex-1 rounded border border-emerald-700 bg-slate-950 px-3 py-1.5 text-xs font-mono text-emerald-200"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      void navigator.clipboard?.writeText(createdDisplayUrl);
                      setCopiedUrl(true);
                    }}
                    className="inline-flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    {copiedUrl ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}

            <div className="divide-y divide-slate-800 border border-slate-800 rounded-lg">
              {sessions.length === 0 ? (
                <div className="p-4 text-xs text-slate-400">No display URLs issued yet.</div>
              ) : (
                sessions.map((s) => (
                  <div key={s.id} className="p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                    <div>
                      <div className="font-bold text-white">
                        {s.label}{' '}
                        <span className="font-mono text-slate-400">({s.token_prefix})</span>
                      </div>
                      <div className="text-slate-400 mt-0.5">
                        Created by {s.created_by_username} · Expires:{' '}
                        {s.expires_at ? new Date(s.expires_at).toLocaleString() : 'Never'}
                      </div>
                    </div>
                    {s.is_active && !s.revoked_at ? (
                      <button
                        type="button"
                        onClick={() => void handleRevokeSession(s.id)}
                        className="rounded border border-red-500/50 bg-red-500/15 hover:bg-red-500/30 px-3 py-1.5 font-bold text-red-300 cursor-pointer"
                      >
                        Revoke Immediately
                      </button>
                    ) : (
                      <span className="font-bold text-slate-500">Revoked</span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
