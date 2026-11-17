import {useCallback, useEffect, useRef, useState} from 'react';
import {
  BellRing,
  Building2,
  Calendar,
  ClipboardList,
  Download,
  FileSpreadsheet,
  LayoutDashboard,
  LogOut,
  MapPin,
  Menu,
  RefreshCw,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Tv,
  Upload,
  X,
} from 'lucide-react';
import {AccessAuditView} from './components/AccessAuditView';
import {AlertsView} from './components/AlertsView';
import {CampaignConfigView} from './components/CampaignConfigView';
import {CommandRoomView} from './components/CommandRoomView';
import {DashboardView} from './components/DashboardView';
import {ExcelImportView} from './components/ExcelImportView';
import {ExportsCenterView} from './components/ExportsCenterView';
import {HierarchyView} from './components/HierarchyView';
import {LoginView} from './components/LoginView';
import {OromiaGisMapView} from './components/OromiaGisMapView';
import {ReportsWorkflowView} from './components/ReportsWorkflowView';
import {SecurityAreasView} from './components/SecurityAreasView';
import {WorkbookAuditView} from './components/WorkbookAuditView';
import {OfflineBanner, PWAInstallButton, useOnlineStatus} from './hooks/usePWA';
import {useRealtimeSync} from './hooks/useRealtimeSync';
import {apiRequest, ApiError} from './lib/api';
import {
  cacheScopedDataset,
  getCachedScopedDataset,
  listOfflineDrafts,
  purgeUnassignedUserCaches,
  removeOfflineDraft,
  updateOfflineQueueItem,
} from './lib/offlineDb';
import type {
  AuditLogRecord,
  CalculationConfigRecord,
  CampaignAlertRecord,
  CampaignRecord,
  DailyReportRecord,
  DashboardOverview,
  ExcelImportHistoryRecord,
  FormulaDiscrepancyRecord,
  GisBoundaryLayerRecord,
  NotificationDispatchLogRecord,
  NotificationProviderConfig,
  NotificationRecord,
  PerformanceThresholdConfig,
  RoleDefinition,
  SecurityDailyReportRecord,
  SecuritySettlementRecord,
  UserProfile,
  WoredaRecord,
  ZoneRecord,
} from './types/opcms';

export type NavTab =
  | 'dashboard'
  | 'command_room'
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

const NAV_ITEMS: {id: NavTab; label: string; icon: typeof LayoutDashboard}[] = [
  {id: 'dashboard', label: '01. Campaign Overview', icon: LayoutDashboard},
  {id: 'command_room', label: 'COMMAND ROOM – LARGE SCREEN MONITORING', icon: Tv},
  {id: 'gis', label: '02. Oromia GIS Map', icon: MapPin},
  {id: 'alerts', label: '03. Alerts & Dispatch', icon: BellRing},
  {id: 'reports', label: '04. Daily Reporting', icon: ClipboardList},
  {id: 'security', label: '05. Security Areas', icon: ShieldAlert},
  {id: 'hierarchy', label: '06. Admin Hierarchy', icon: Building2},
  {id: 'campaigns', label: '07. Campaign & Formulas', icon: Calendar},
  {id: 'imports', label: '08. Excel Import', icon: Upload},
  {id: 'exports', label: '09. Exports Center', icon: Download},
  {id: 'audit', label: '10. Formula Audit', icon: FileSpreadsheet},
  {id: 'access', label: '11. Roles & Audit Logs', icon: Shield},
];

const SESSION_TOKEN_KEY = 'opcms_auth_token';
const SESSION_USER_KEY = 'opcms_auth_user';

export default function App() {
  const [displayToken] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    const dt = params.get('display_token');
    return dt && dt.trim() ? dt.trim() : null;
  });
  const isOnline = useOnlineStatus();
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(SESSION_TOKEN_KEY));
  const [user, setUser] = useState<UserProfile | null>(() => {
    const raw = localStorage.getItem(SESSION_USER_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  });

  const [activeTab, setActiveTab] = useState<NavTab>('dashboard');
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pendingOfflineCount, setPendingOfflineCount] = useState(0);
  const [isSyncingQueue, setIsSyncingQueue] = useState(false);
  const syncingRef = useRef(false);

  // Domain state
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [regionName, setRegionName] = useState('Oromia');
  const [zones, setZones] = useState<ZoneRecord[]>([]);
  const [woredas, setWoredas] = useState<WoredaRecord[]>([]);
  const [campaigns, setCampaigns] = useState<CampaignRecord[]>([]);
  const [reports, setReports] = useState<DailyReportRecord[]>([]);
  const [discrepancies, setDiscrepancies] = useState<FormulaDiscrepancyRecord[]>([]);
  const [templateSummary, setTemplateSummary] = useState({
    template_reported_planned_target: 33537,
    template_reported_daily_target: 1895229,
  });
  const [settlements, setSettlements] = useState<SecuritySettlementRecord[]>([]);
  const [securityReports, setSecurityReports] = useState<SecurityDailyReportRecord[]>([]);
  const [calculationConfigs, setCalculationConfigs] = useState<CalculationConfigRecord[]>([]);
  const [importHistories, setImportHistories] = useState<ExcelImportHistoryRecord[]>([]);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogRecord[]>([]);
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [alerts, setAlerts] = useState<CampaignAlertRecord[]>([]);
  const [thresholds, setThresholds] = useState<PerformanceThresholdConfig | null>(null);
  const [gisLayers, setGisLayers] = useState<GisBoundaryLayerRecord[]>([]);
  const [providers, setProviders] = useState<NotificationProviderConfig[]>([]);
  const [dispatchLogs, setDispatchLogs] = useState<NotificationDispatchLogRecord[]>([]);

  const handleLogout = useCallback(() => {
    localStorage.removeItem(SESSION_TOKEN_KEY);
    localStorage.removeItem(SESSION_USER_KEY);
    setToken(null);
    setUser(null);
    setOverview(null);
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    if (!token || !user) return;
    setLoading(true);
    try {
      await purgeUnassignedUserCaches(user.id);
      const drafts = await listOfflineDrafts(user.id);
      setPendingOfflineCount(drafts.filter((d) => d.syncState !== 'saved_locally').length);

      if (!isOnline) {
        const cachedOverview = await getCachedScopedDataset<DashboardOverview>(user.id, 'overview');
        const cachedHier = await getCachedScopedDataset<{
          region: {name: string};
          zones: ZoneRecord[];
          woredas: WoredaRecord[];
        }>(user.id, 'hierarchy');
        const cachedCamps = await getCachedScopedDataset<CampaignRecord[]>(user.id, 'campaigns');
        const cachedReps = await getCachedScopedDataset<DailyReportRecord[]>(user.id, 'reports');
        const cachedSettles = await getCachedScopedDataset<SecuritySettlementRecord[]>(
          user.id,
          'settlements',
        );
        if (cachedOverview) setOverview(cachedOverview.data);
        if (cachedHier) {
          setRegionName(cachedHier.data.region.name);
          setZones(cachedHier.data.zones);
          setWoredas(cachedHier.data.woredas);
        }
        if (cachedCamps) setCampaigns(cachedCamps.data);
        if (cachedReps) setReports(cachedReps.data);
        if (cachedSettles) setSettlements(cachedSettles.data);
        setLoading(false);
        return;
      }

      const [
        ov,
        hier,
        camps,
        reps,
        auditRes,
        settles,
        secReps,
        calcCfgs,
        impHists,
        rls,
        notifs,
        alrts,
        thresh,
        layers,
        provData,
      ] = await Promise.all([
        apiRequest<DashboardOverview>('/dashboard/overview', {}, token),
        apiRequest<{region: {name: string}; zones: ZoneRecord[]; woredas: WoredaRecord[]}>(
          '/hierarchy/overview',
          {},
          token,
        ),
        apiRequest<CampaignRecord[]>('/campaigns', {}, token),
        apiRequest<DailyReportRecord[]>('/reports', {}, token),
        apiRequest<{
          discrepancies: FormulaDiscrepancyRecord[];
          template_summary: {
            template_reported_planned_target: number;
            template_reported_daily_target: number;
          };
        }>('/workbook-audit/discrepancies', {}, token),
        apiRequest<SecuritySettlementRecord[]>('/security-settlements', {}, token),
        apiRequest<SecurityDailyReportRecord[]>('/security-reports', {}, token),
        apiRequest<CalculationConfigRecord[]>('/calculation-configs', {}, token),
        apiRequest<ExcelImportHistoryRecord[]>('/imports/history', {}, token),
        apiRequest<RoleDefinition[]>('/roles', {}, token),
        apiRequest<NotificationRecord[]>('/notifications', {}, token),
        apiRequest<CampaignAlertRecord[]>('/alerts', {}, token),
        apiRequest<PerformanceThresholdConfig>('/monitoring-thresholds', {}, token),
        apiRequest<GisBoundaryLayerRecord[]>('/gis/layers', {}, token),
        apiRequest<{
          providers: NotificationProviderConfig[];
          dispatch_logs: NotificationDispatchLogRecord[];
        }>('/notifications/providers', {}, token),
      ]);

      setOverview(ov);
      setRegionName(hier.region.name);
      setZones(hier.zones);
      setWoredas(hier.woredas);
      setCampaigns(camps);
      setReports(reps);
      setDiscrepancies(auditRes.discrepancies);
      setTemplateSummary(auditRes.template_summary);
      setSettlements(settles);
      setSecurityReports(secReps);
      setCalculationConfigs(calcCfgs);
      setImportHistories(impHists);
      setRoles(rls);
      setNotifications(notifs);
      setAlerts(alrts);
      setThresholds(thresh);
      setGisLayers(layers);
      setProviders(provData.providers);
      setDispatchLogs(provData.dispatch_logs);

      // Cache strictly the scoped datasets needed for this user's assigned administrative location
      await Promise.all([
        cacheScopedDataset(user.id, 'overview', ov),
        cacheScopedDataset(user.id, 'hierarchy', hier),
        cacheScopedDataset(user.id, 'campaigns', camps),
        cacheScopedDataset(user.id, 'reports', reps),
        cacheScopedDataset(user.id, 'settlements', settles),
      ]);

      if (['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM'].includes(user.role_code)) {
        const uList = await apiRequest<UserProfile[]>('/users', {}, token);
        setUsersList(uList);
      } else {
        setUsersList([]);
      }

      if (
        ['REGIONAL_SYSTEM_ADMIN', 'REGIONAL_COORDINATION_TEAM', 'MONITORING_OFFICER'].includes(
          user.role_code,
        )
      ) {
        const logs = await apiRequest<AuditLogRecord[]>('/audit-logs', {}, token);
        setAuditLogs(logs);
      } else {
        setAuditLogs([]);
      }
    } catch (err: any) {
      if (err?.status === 401) {
        handleLogout();
      }
    } finally {
      setLoading(false);
    }
  }, [token, user, isOnline, handleLogout]);

  useEffect(() => {
    void loadWorkspaceData();
  }, [loadWorkspaceData]);

  // Automatic Background Offline Sync & Retry Worker when Online
  const syncQueuedReports = useCallback(async () => {
    if (!token || !user || !isOnline || syncingRef.current) return;
    const allItems = await listOfflineDrafts(user.id);
    const nowMs = Date.now();
    const dueItems = allItems.filter(
      (item) =>
        (item.syncState === 'waiting_sync' || item.syncState === 'sync_error') &&
        (!item.nextRetryAt || Date.parse(item.nextRetryAt) <= nowMs),
    );
    if (dueItems.length === 0) return;

    syncingRef.current = true;
    setIsSyncingQueue(true);
    let anySynced = false;

    for (const item of dueItems) {
      await updateOfflineQueueItem(item.localKey, {syncState: 'synchronizing'});
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
        anySynced = true;
      } catch (err) {
        const isConflict = err instanceof ApiError && err.status === 409;
        const msg = err instanceof ApiError ? err.message : 'Background sync retry pending.';
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

    const remaining = await listOfflineDrafts(user.id);
    setPendingOfflineCount(remaining.filter((i) => i.syncState !== 'saved_locally').length);
    syncingRef.current = false;
    setIsSyncingQueue(false);
    if (anySynced) {
      void loadWorkspaceData();
    }
  }, [token, user, isOnline, loadWorkspaceData]);

  useEffect(() => {
    if (!token || !user || !isOnline) return;
    void syncQueuedReports();
    const timer = window.setInterval(() => {
      void syncQueuedReports();
    }, 10000);
    return () => window.clearInterval(timer);
  }, [token, user, isOnline, syncQueuedReports]);

  const realtime = useRealtimeSync({
    token,
    pendingCount: pendingOfflineCount,
    isSyncingQueue,
    initialTelemetry: overview?.sync_telemetry || null,
    onRemoteUpdate: () => {
      void loadWorkspaceData();
    },
  });

  const handleLoginSuccess = (newToken: string, loggedUser: UserProfile) => {
    localStorage.setItem(SESSION_TOKEN_KEY, newToken);
    localStorage.setItem(SESSION_USER_KEY, JSON.stringify(loggedUser));
    setToken(newToken);
    setUser(loggedUser);
    setActiveTab('dashboard');
  };

  if (displayToken) {
    return <CommandRoomView token={null} user={null} displayToken={displayToken} />;
  }

  if (!token || !user) {
    return <LoginView onLoginSuccess={handleLoginSuccess} />;
  }

  const currentNav = NAV_ITEMS.find((i) => i.id === activeTab)!;
  const activeCampaign = campaigns[0] || null;
  const computedPlannedTotal = woredas.reduce((s, w) => s + w.total_planned_target, 0);
  const computedDailyTotal = woredas.reduce((s, w) => s + w.daily_target, 0);

  const freshnessColor =
    realtime.freshnessState === 'LIVE'
      ? 'text-emerald-700'
      : realtime.freshnessState === 'SYNCING'
        ? 'text-[#3A99CF]'
        : realtime.freshnessState === 'DELAYED'
          ? 'text-[#D29441]'
          : 'text-red-700';

  const freshnessDotColor =
    realtime.freshnessState === 'LIVE'
      ? 'bg-emerald-500'
      : realtime.freshnessState === 'SYNCING'
        ? 'bg-[#3A99CF]'
        : realtime.freshnessState === 'DELAYED'
          ? 'bg-[#D29441]'
          : 'bg-red-500';

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 bg-[#485EA9] text-white flex flex-col justify-between transition-transform duration-200 lg:static lg:translate-x-0 ${
          mobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div>
          <div className="px-5 py-4 border-b border-white/15 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-8 h-8 rounded bg-[#3A99CF] flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-bold text-white truncate">OHB OPCMS</div>
                <div className="text-[11px] text-sky-200 truncate">Oromia Health Bureau</div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setMobileMenuOpen(false)}
              className="lg:hidden text-white/80 hover:text-white cursor-pointer"
              aria-label="Close navigation menu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <nav className="p-3 space-y-1">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(item.id);
                    setMobileMenuOpen(false);
                  }}
                  className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-xs font-bold transition-colors text-left whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[#3A99CF] text-white'
                      : 'text-sky-100 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        <div className="p-4 border-t border-white/15 text-xs space-y-2">
          <div className="font-bold text-white truncate">{user.full_name}</div>
          <div className="text-sky-200 truncate">{user.role_name}</div>
          <div className="text-[11px] text-sky-100/80 truncate">
            Scope:{' '}
            {user.woreda_name
              ? `${user.zone_name} · ${user.woreda_name}`
              : user.zone_name
                ? `${user.zone_name} Zone`
                : 'Oromia Region'}
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="mt-2 w-full inline-flex items-center justify-center gap-1.5 rounded-md border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-bold text-white hover:bg-white/20 transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <OfflineBanner pendingCount={pendingOfflineCount} />

        {/* Top Bar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden rounded-md border border-slate-200 p-1.5 text-slate-700 cursor-pointer"
              aria-label="Open navigation menu"
            >
              <Menu className="w-5 h-5" />
            </button>
            <div className="text-xs text-slate-500 flex items-center gap-2 truncate">
              <span className="font-bold text-[#485EA9] whitespace-nowrap">OHB Polio Campaign</span>
              <span aria-hidden="true">/</span>
              <span className="text-slate-900 font-bold truncate">{currentNav.label}</span>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <PWAInstallButton />
            <button
              type="button"
              onClick={() => void loadWorkspaceData()}
              disabled={loading}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </header>

        {/* Real-time Synchronization Telemetry Strip */}
        <div className="bg-slate-100/90 border-b border-slate-200 px-6 py-2 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 text-[11px] text-slate-600">
          <div className="flex flex-wrap items-center gap-4">
            <span className={`inline-flex items-center gap-1.5 font-bold ${freshnessColor}`}>
              <span className={`w-2 h-2 rounded-full ${freshnessDotColor}`} />
              {realtime.freshnessState}
            </span>
            <span className="tabular-nums">
              Last Sync:{' '}
              <strong className="text-slate-800">
                {realtime.lastSyncAt ? new Date(realtime.lastSyncAt).toLocaleTimeString() : 'Connecting...'}
              </strong>
            </span>
            <span className="tabular-nums">
              Pending Sync Queue: <strong className="text-slate-800">{realtime.pendingCount}</strong>
            </span>
            <span>
              Last Report Received:{' '}
              <strong className="text-slate-800">
                {realtime.lastReportReceived
                  ? `${realtime.lastReportReceived.woreda_name} (${realtime.lastReportReceived.day_label} · ${realtime.lastReportReceived.status})`
                  : 'None yet'}
              </strong>
            </span>
          </div>

          {realtime.isStale && (
            <span className="font-bold text-[#D29441]">
              Dashboard data may be stale — automatic SSE reconnection active
            </span>
          )}
        </div>

        <main className="flex-1 p-6 max-w-[1440px] w-full mx-auto">
          {activeTab === 'dashboard' && (
            <DashboardView
              data={overview}
              reports={reports}
              woredas={woredas}
              loading={loading}
              onNavigate={(t) => setActiveTab(t)}
            />
          )}
          {activeTab === 'command_room' && (
            <CommandRoomView token={token} user={user} displayToken={null} />
          )}
          {activeTab === 'gis' && (
            <OromiaGisMapView
              token={token}
              user={user}
              campaign={activeCampaign}
              zones={zones}
              woredas={woredas}
              reports={reports}
              settlements={settlements}
              gisLayers={gisLayers}
              thresholds={thresholds}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'alerts' && (
            <AlertsView
              token={token}
              user={user}
              zones={zones}
              alerts={alerts}
              providers={providers}
              dispatchLogs={dispatchLogs}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'hierarchy' && (
            <HierarchyView
              token={token}
              user={user}
              regionName={regionName}
              zones={zones}
              woredas={woredas}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'campaigns' && (
            <CampaignConfigView
              token={token}
              user={user}
              campaign={activeCampaign}
              calculationConfigs={calculationConfigs}
              settlements={settlements}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'reports' && (
            <ReportsWorkflowView
              token={token}
              user={user}
              campaign={activeCampaign}
              activeCalcConfig={
                calculationConfigs.find((c) => c.is_active) ||
                overview?.active_calculation_config ||
                null
              }
              zones={zones}
              woredas={woredas}
              reports={reports}
              onRefresh={() => void loadWorkspaceData()}
              onOfflineCountChange={setPendingOfflineCount}
            />
          )}
          {activeTab === 'imports' && (
            <ExcelImportView
              token={token}
              user={user}
              histories={importHistories}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'security' && (
            <SecurityAreasView
              token={token}
              user={user}
              campaign={activeCampaign}
              woredas={woredas}
              settlements={settlements}
              securityReports={securityReports}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'exports' && (
            <ExportsCenterView
              campaign={activeCampaign}
              zones={zones}
              woredas={woredas}
              reports={reports}
              settlements={settlements}
              securityReports={securityReports}
              alerts={alerts}
              discrepancies={discrepancies}
            />
          )}
          {activeTab === 'audit' && (
            <WorkbookAuditView
              token={token}
              user={user}
              discrepancies={discrepancies}
              templateSummary={templateSummary}
              computedPlannedTotal={computedPlannedTotal}
              computedDailyTotal={computedDailyTotal}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
          {activeTab === 'access' && (
            <AccessAuditView
              token={token}
              user={user}
              roles={roles}
              users={usersList}
              zones={zones}
              woredas={woredas}
              auditLogs={auditLogs}
              notifications={notifications}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
        </main>
      </div>
    </div>
  );
}
