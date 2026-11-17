import React, {useMemo, useState} from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  Mail,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {
  AlertPriority,
  AlertResolutionStatus,
  AlertType,
  CampaignAlertRecord,
  NotificationDispatchLogRecord,
  NotificationProviderConfig,
  UserProfile,
  ZoneRecord,
} from '../types/opcms';

interface AlertsViewProps {
  token: string;
  user: UserProfile;
  zones: ZoneRecord[];
  alerts: CampaignAlertRecord[];
  providers: NotificationProviderConfig[];
  dispatchLogs: NotificationDispatchLogRecord[];
  onRefresh: () => void;
}

const ALERT_TYPES: AlertType[] = [
  'Missing Daily Report',
  'Late Report',
  'Low Vaccination Coverage',
  'Declining Performance',
  'High Vaccine Wastage',
  'AFP Alert',
  'AEFI Alert',
  'Missing Team Reports',
  'Security Settlement Reporting Gap',
  'Zero-Dose Follow-up Gap',
  'Under-Vaccinated Follow-up Gap',
];

const PRIORITY_TEXT_CLASS: Record<AlertPriority, string> = {
  Critical: 'text-red-700',
  High: 'text-[#D29441]',
  Medium: 'text-[#485EA9]',
  Low: 'text-slate-600',
};

export const AlertsView: React.FC<AlertsViewProps> = ({
  token,
  user,
  zones,
  alerts,
  providers,
  dispatchLogs,
  onRefresh,
}) => {
  const [tab, setTab] = useState<'alerts' | 'providers'>('alerts');
  const [priorityFilter, setPriorityFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('active');
  const [zoneFilter, setZoneFilter] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [resolutionNotes, setResolutionNotes] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  // Provider edit states
  const emailProv = providers.find((p) => p.channel === 'Email');
  const smsProv = providers.find((p) => p.channel === 'SMS');
  const [editingChannel, setEditingChannel] = useState<'Email' | 'SMS' | null>(null);
  const [provName, setProvName] = useState('');
  const [provEndpoint, setProvEndpoint] = useState('');
  const [provSender, setProvSender] = useState('');
  const [provMinPriority, setProvMinPriority] = useState<AlertPriority>('Critical');
  const [provHasCreds, setProvHasCreds] = useState(false);
  const [provEnabled, setProvEnabled] = useState(false);

  const canScanOrResolve = [
    'REGIONAL_SYSTEM_ADMIN',
    'REGIONAL_COORDINATION_TEAM',
    'ZONE_ADMIN',
  ].includes(user.role_code);
  const canAcknowledge = !user.is_read_only;
  const isAdmin = user.role_code === 'REGIONAL_SYSTEM_ADMIN';

  const summary = useMemo(() => {
    const open = alerts.filter((a) => a.resolution_status === 'Open').length;
    const ack = alerts.filter((a) => a.resolution_status === 'Acknowledged').length;
    const resolved = alerts.filter((a) => a.resolution_status === 'Resolved').length;
    const criticalActive = alerts.filter(
      (a) => a.priority === 'Critical' && a.resolution_status !== 'Resolved',
    ).length;
    return {open, ack, resolved, criticalActive};
  }, [alerts]);

  const filteredAlerts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return alerts.filter((a) => {
      if (statusFilter === 'active' && a.resolution_status === 'Resolved') return false;
      if (
        ['Open', 'Acknowledged', 'Resolved'].includes(statusFilter) &&
        a.resolution_status !== (statusFilter as AlertResolutionStatus)
      ) {
        return false;
      }
      if (priorityFilter && a.priority !== priorityFilter) return false;
      if (typeFilter && a.alert_type !== typeFilter) return false;
      if (zoneFilter && a.zone_id !== zoneFilter) return false;
      if (
        q &&
        !`${a.admin_location} ${a.alert_type} ${a.description} ${a.responsible_officer}`
          .toLowerCase()
          .includes(q)
      ) {
        return false;
      }
      return true;
    });
  }, [alerts, statusFilter, priorityFilter, typeFilter, zoneFilter, searchQuery]);

  const runScan = async () => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest('/alerts/scan', {method: 'POST'}, token);
      setMessage('Campaign alert rules re-evaluated across open days, reports, and settlements.');
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Alert scan failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleAcknowledge = async (alertId: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/alerts/${alertId}/acknowledge`, {method: 'POST'}, token);
      setMessage('Alert marked as Acknowledged.');
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to acknowledge alert.');
    } finally {
      setBusy(false);
    }
  };

  const handleResolveSubmit = async (alertId: string) => {
    if (!resolutionNotes.trim()) {
      setError('Resolution notes are mandatory before resolving an alert.');
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(
        `/alerts/${alertId}/resolve`,
        {method: 'POST', body: JSON.stringify({resolution_notes: resolutionNotes.trim()})},
        token,
      );
      setResolvingId(null);
      setResolutionNotes('');
      setMessage('Alert resolved with audit notes.');
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to resolve alert.');
    } finally {
      setBusy(false);
    }
  };

  const handleReopen = async (alertId: string) => {
    setBusy(true);
    setError(null);
    try {
      await apiRequest(`/alerts/${alertId}/reopen`, {method: 'POST'}, token);
      setMessage('Alert reopened.');
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to reopen alert.');
    } finally {
      setBusy(false);
    }
  };

  const startEditProvider = (p: NotificationProviderConfig) => {
    setEditingChannel(p.channel);
    setProvName(p.provider_name);
    setProvEndpoint(p.endpoint_url);
    setProvSender(p.sender_identifier);
    setProvMinPriority(p.min_priority);
    setProvHasCreds(p.has_credentials);
    setProvEnabled(p.is_enabled);
  };

  const saveProvider = async () => {
    if (!editingChannel) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(
        `/notifications/providers/${editingChannel}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            provider_name: provName,
            endpoint_url: provEndpoint,
            sender_identifier: provSender,
            min_priority: provMinPriority,
            has_credentials: provHasCreds,
            is_enabled: provEnabled,
          }),
        },
        token,
      );
      setEditingChannel(null);
      setMessage(`${editingChannel} notification gateway configuration updated.`);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update notification provider.');
    } finally {
      setBusy(false);
    }
  };

  const testProvider = async (channel: 'Email' | 'SMS') => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await apiRequest(`/notifications/providers/${channel}/test`, {method: 'POST'}, token);
      setMessage(`${channel} gateway connectivity test succeeded.`);
      onRefresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : `${channel} provider test did not succeed (see dispatch log).`,
      );
      onRefresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">
            Campaign Surveillance, Reporting Gaps &amp; Operational Follow-Up
          </p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Alert &amp; Notification Engine
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Monitors 11 operational &amp; epidemiological triggers across open campaign days, reports, and security settlements
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {canScanOrResolve && (
            <button
              type="button"
              disabled={busy}
              onClick={runScan}
              className="inline-flex items-center gap-1.5 rounded-md bg-[#3A99CF] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3185b5] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
              Run Alert Scan
            </button>
          )}
          <div className="inline-flex rounded-md border border-slate-200 bg-slate-100 p-0.5">
            <button
              type="button"
              onClick={() => setTab('alerts')}
              className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
                tab === 'alerts' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Active &amp; Historical Alerts ({alerts.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('providers')}
              className={`px-3 py-1.5 text-xs font-bold rounded cursor-pointer ${
                tab === 'providers' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600'
              }`}
            >
              Email / SMS Gateways &amp; Dispatch Logs
            </button>
          </div>
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

      {/* 4 Summary Tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Critical Active Alerts</span>
            <AlertTriangle className="w-4 h-4 text-red-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-red-700 tabular-nums">{summary.criticalActive}</p>
          <p className="mt-1 text-xs text-slate-500">AFP, AEFI, or severe coverage alerts</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Open Alerts</span>
            <BellRing className="w-4 h-4 text-[#D29441]" />
          </div>
          <p className="mt-2 text-2xl font-bold text-slate-900 tabular-nums">{summary.open}</p>
          <p className="mt-1 text-xs text-slate-500">Unacknowledged operational items</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Acknowledged (In Progress)</span>
            <ShieldCheck className="w-4 h-4 text-[#485EA9]" />
          </div>
          <p className="mt-2 text-2xl font-bold text-[#485EA9] tabular-nums">{summary.ack}</p>
          <p className="mt-1 text-xs text-slate-500">Assigned for field verification</p>
        </div>

        <div className="bg-white border border-slate-200 rounded-lg p-4">
          <div className="flex items-center justify-between text-xs font-bold text-slate-500">
            <span>Resolved Alerts</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="mt-2 text-2xl font-bold text-emerald-700 tabular-nums">{summary.resolved}</p>
          <p className="mt-1 text-xs text-slate-500">Closed with documented action</p>
        </div>
      </div>

      {tab === 'alerts' && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          {/* Filters */}
          <div className="p-4 border-b border-slate-200 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search location, officer..."
                className="w-full rounded-md border border-slate-300 pl-8 pr-3 py-1.5 text-xs"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
            >
              <option value="active">Active (Open + Acknowledged)</option>
              <option value="">All Statuses</option>
              <option value="Open">Open Only</option>
              <option value="Acknowledged">Acknowledged Only</option>
              <option value="Resolved">Resolved Only</option>
            </select>
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
            >
              <option value="">All Priorities</option>
              <option value="Critical">Critical</option>
              <option value="High">High</option>
              <option value="Medium">Medium</option>
              <option value="Low">Low</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
            >
              <option value="">All 11 Alert Types</option>
              {ALERT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <select
              value={zoneFilter}
              onChange={(e) => setZoneFilter(e.target.value)}
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs"
            >
              <option value="">All Accessible Zones ({zones.length})</option>
              {zones.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.name}
                </option>
              ))}
            </select>
          </div>

          {/* Alerts Table */}
          <div className="overflow-x-auto max-h-[600px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                <tr>
                  <th className="py-2.5 px-4">Priority</th>
                  <th className="py-2.5 px-4">Alert Type</th>
                  <th className="py-2.5 px-4">Location &amp; Day</th>
                  <th className="py-2.5 px-4">Description</th>
                  <th className="py-2.5 px-4">Responsible Officer</th>
                  <th className="py-2.5 px-4">Detected</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 text-xs">
                {filteredAlerts.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-10 text-center text-slate-500">
                      No alerts match the selected filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredAlerts.slice(0, 250).map((alert) => (
                    <React.Fragment key={alert.id}>
                      <tr className="hover:bg-slate-50/70 align-top">
                        <td className={`py-2.5 px-4 font-bold whitespace-nowrap ${PRIORITY_TEXT_CLASS[alert.priority]}`}>
                          {alert.priority}
                        </td>
                        <td className="py-2.5 px-4 font-bold text-slate-900 whitespace-nowrap">
                          {alert.alert_type}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700">
                          <div className="font-bold text-slate-900">{alert.admin_location}</div>
                          {alert.day_label && (
                            <div className="text-[11px] text-slate-500">{alert.day_label}</div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 max-w-md">
                          <div>{alert.description}</div>
                          {alert.resolution_notes && (
                            <div className="mt-1 text-[11px] text-emerald-700 font-bold">
                              Resolution: {alert.resolution_notes}
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-slate-600">{alert.responsible_officer}</td>
                        <td className="py-2.5 px-4 text-slate-500 tabular-nums whitespace-nowrap">
                          {new Date(alert.detected_at).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 font-bold whitespace-nowrap">
                          <span
                            className={
                              alert.resolution_status === 'Resolved'
                                ? 'text-emerald-700'
                                : alert.resolution_status === 'Acknowledged'
                                  ? 'text-[#485EA9]'
                                  : 'text-[#D29441]'
                            }
                          >
                            {alert.resolution_status}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-right whitespace-nowrap space-x-1.5">
                          {alert.resolution_status === 'Open' && canAcknowledge && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleAcknowledge(alert.id)}
                              className="rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              Acknowledge
                            </button>
                          )}
                          {alert.resolution_status !== 'Resolved' && canScanOrResolve && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => {
                                setResolvingId(resolvingId === alert.id ? null : alert.id);
                                setResolutionNotes('');
                              }}
                              className="rounded bg-[#3A99CF] px-2.5 py-1 text-[11px] font-bold text-white hover:bg-[#3185b5] cursor-pointer"
                            >
                              Resolve
                            </button>
                          )}
                          {alert.resolution_status === 'Resolved' && canScanOrResolve && (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void handleReopen(alert.id)}
                              className="inline-flex items-center gap-1 rounded border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                              Reopen
                            </button>
                          )}
                        </td>
                      </tr>
                      {resolvingId === alert.id && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-4 py-3">
                            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                              <input
                                type="text"
                                value={resolutionNotes}
                                onChange={(e) => setResolutionNotes(e.target.value)}
                                placeholder="Enter mandatory corrective action / resolution verification notes..."
                                className="flex-1 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs"
                              />
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => void handleResolveSubmit(alert.id)}
                                className="rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white hover:bg-emerald-700 cursor-pointer"
                              >
                                Confirm Resolution
                              </button>
                              <button
                                type="button"
                                onClick={() => setResolvingId(null)}
                                className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer"
                              >
                                Cancel
                              </button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {filteredAlerts.length > 250 && (
            <div className="px-4 py-2.5 border-t border-slate-200 bg-slate-50 text-xs text-slate-500">
              Showing first 250 of {filteredAlerts.length} matching alerts. Use Zone or Alert Type filters to narrow results.
            </div>
          )}
        </div>
      )}

      {tab === 'providers' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {[emailProv, smsProv].filter(Boolean).map((prov) => {
              if (!prov) return null;
              const Icon = prov.channel === 'Email' ? Mail : MessageSquare;
              const isEditing = editingChannel === prov.channel;
              return (
                <div key={prov.id} className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <Icon className="w-5 h-5 text-[#485EA9]" />
                      <div>
                        <h3 className="text-base font-bold text-slate-900">
                          {prov.channel} Alert Gateway
                        </h3>
                        <p className="text-xs text-slate-500">{prov.provider_name}</p>
                      </div>
                    </div>
                    <span
                      className={`text-xs font-bold ${
                        prov.is_enabled && prov.has_credentials ? 'text-emerald-700' : 'text-[#D29441]'
                      }`}
                    >
                      {prov.is_enabled && prov.has_credentials ? 'Configured & Enabled' : 'Not Configured'}
                    </span>
                  </div>

                  {!isEditing ? (
                    <div className="border-t border-slate-200 pt-3 text-xs space-y-1.5 text-slate-600">
                      <div>
                        Webhook / Relay URL:{' '}
                        <strong className="text-slate-900">
                          {prov.endpoint_url || 'Not provided'}
                        </strong>
                      </div>
                      <div>
                        Sender Identifier: <strong className="text-slate-900">{prov.sender_identifier}</strong>
                      </div>
                      <div>
                        Minimum Trigger Priority:{' '}
                        <strong className="text-slate-900">{prov.min_priority}</strong>
                      </div>
                      <p className="text-[11px] text-slate-500 pt-1">
                        External alerts are dispatched strictly when live provider credentials and an endpoint URL are supplied by a Regional System Administrator.
                      </p>
                      {isAdmin && (
                        <div className="pt-2 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => startEditProvider(prov)}
                            className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            Configure {prov.channel}
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void testProvider(prov.channel)}
                            className="inline-flex items-center gap-1 rounded-md border border-[#3A99CF] bg-white px-3 py-1.5 text-xs font-bold text-[#3A99CF] hover:bg-[#3A99CF]/5 cursor-pointer"
                          >
                            <Send className="w-3 h-3" />
                            Test Delivery
                          </button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="border-t border-slate-200 pt-3 space-y-3 text-xs">
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Provider Name</label>
                        <input
                          type="text"
                          value={provName}
                          onChange={(e) => setProvName(e.target.value)}
                          className="w-full rounded border border-slate-300 px-3 py-1.5"
                        />
                      </div>
                      <div>
                        <label className="block font-bold text-slate-700 mb-1">Webhook / Gateway Endpoint URL</label>
                        <input
                          type="url"
                          value={provEndpoint}
                          onChange={(e) => setProvEndpoint(e.target.value)}
                          placeholder="https://..."
                          className="w-full rounded border border-slate-300 px-3 py-1.5"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">Sender ID / From</label>
                          <input
                            type="text"
                            value={provSender}
                            onChange={(e) => setProvSender(e.target.value)}
                            className="w-full rounded border border-slate-300 px-3 py-1.5"
                          />
                        </div>
                        <div>
                          <label className="block font-bold text-slate-700 mb-1">Minimum Priority</label>
                          <select
                            value={provMinPriority}
                            onChange={(e) => setProvMinPriority(e.target.value as AlertPriority)}
                            className="w-full rounded border border-slate-300 px-3 py-1.5"
                          >
                            <option value="Critical">Critical</option>
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-4 pt-1">
                        <label className="inline-flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={provHasCreds}
                            onChange={(e) => setProvHasCreds(e.target.checked)}
                          />
                          Live endpoint credentials verified
                        </label>
                        <label className="inline-flex items-center gap-1.5 font-bold text-slate-700 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={provEnabled}
                            onChange={(e) => setProvEnabled(e.target.checked)}
                          />
                          Enable {prov.channel} dispatch
                        </label>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void saveProvider()}
                          className="rounded-md bg-[#3A99CF] px-3.5 py-1.5 font-bold text-white hover:bg-[#3185b5] cursor-pointer"
                        >
                          Save Gateway Config
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingChannel(null)}
                          className="rounded-md border border-slate-300 bg-white px-3 py-1.5 font-bold text-slate-600 cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
            <div className="p-4 border-b border-slate-200">
              <h3 className="text-base font-bold text-slate-900">External Dispatch Audit Log</h3>
              <p className="text-xs text-slate-500">
                Records actual Email/SMS gateway responses or explicit Not Configured states
              </p>
            </div>
            <div className="overflow-x-auto max-h-[360px]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <tr>
                    <th className="py-2.5 px-4">Timestamp</th>
                    <th className="py-2.5 px-4">Channel</th>
                    <th className="py-2.5 px-4">Recipient</th>
                    <th className="py-2.5 px-4">Delivery Status</th>
                    <th className="py-2.5 px-4">Gateway Response / Detail</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200 text-xs">
                  {dispatchLogs.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center text-slate-500">
                        No external alert dispatch events recorded yet.
                      </td>
                    </tr>
                  ) : (
                    dispatchLogs.map((log) => (
                      <tr key={log.id}>
                        <td className="py-2 px-4 tabular-nums text-slate-500 whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </td>
                        <td className="py-2 px-4 font-bold text-slate-900">{log.channel}</td>
                        <td className="py-2 px-4 text-slate-700">{log.recipient}</td>
                        <td className="py-2 px-4 font-bold">
                          <span
                            className={
                              log.status === 'Dispatched'
                                ? 'text-emerald-700'
                                : log.status === 'Delivery Failed'
                                  ? 'text-red-700'
                                  : 'text-[#D29441]'
                            }
                          >
                            {log.status}
                          </span>
                        </td>
                        <td className="py-2 px-4 text-slate-600">{log.detail}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
