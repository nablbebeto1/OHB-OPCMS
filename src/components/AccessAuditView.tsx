import React, {useState} from 'react';
import {Activity, Bell, Database, Download, Plus, Shield, Upload, Users} from 'lucide-react';
import {apiRequest, ApiError} from '../lib/api';
import type {
  AuditLogRecord,
  NotificationRecord,
  RoleCode,
  RoleDefinition,
  UserProfile,
  WoredaRecord,
  ZoneRecord,
} from '../types/opcms';

interface AccessAuditViewProps {
  token: string;
  user: UserProfile;
  roles: RoleDefinition[];
  users: UserProfile[];
  zones: ZoneRecord[];
  woredas: WoredaRecord[];
  auditLogs: AuditLogRecord[];
  notifications: NotificationRecord[];
  onRefresh: () => void;
}

export const AccessAuditView: React.FC<AccessAuditViewProps> = ({
  token,
  user,
  roles,
  users,
  zones,
  woredas,
  auditLogs,
  notifications,
  onRefresh,
}) => {
  const isAdmin = user.role_code === 'REGIONAL_SYSTEM_ADMIN';
  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newFullName, setNewFullName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRoleCode, setNewRoleCode] = useState<RoleCode>('WOREDA_REPORTING_OFFICER');
  const [newZoneId, setNewZoneId] = useState(zones[0]?.id || '');
  const [newWoredaId, setNewWoredaId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupMsg, setBackupMsg] = useState<string | null>(null);
  const [backupErr, setBackupErr] = useState<string | null>(null);
  const [backupBusy, setBackupBusy] = useState(false);

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await apiRequest(
        '/users',
        {
          method: 'POST',
          body: JSON.stringify({
            username: newUsername,
            full_name: newFullName,
            email: newEmail,
            role_code: newRoleCode,
            zone_id: ['ZONE_ADMIN', 'WOREDA_REPORTING_OFFICER'].includes(newRoleCode) ? newZoneId || null : null,
            woreda_id: newRoleCode === 'WOREDA_REPORTING_OFFICER' ? newWoredaId || null : null,
          }),
        },
        token,
      );
      setNewUsername('');
      setNewFullName('');
      setNewEmail('');
      setShowCreateUser(false);
      onRefresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to create user.');
    } finally {
      setBusy(false);
    }
  };

  const toggleUserActive = async (target: UserProfile) => {
    try {
      await apiRequest(
        `/users/${target.id}`,
        {
          method: 'PATCH',
          body: JSON.stringify({is_active: !target.is_active}),
        },
        token,
      );
      onRefresh();
    } catch {
      // ignore
    }
  };

  const markRead = async (id: string) => {
    await apiRequest(`/notifications/${id}/read`, {method: 'POST'}, token);
    onRefresh();
  };

  const handleDownloadBackup = async () => {
    setBackupErr(null);
    setBackupMsg(null);
    setBackupBusy(true);
    try {
      const bundle = await apiRequest<{
        exported_at: string;
        checksum_sha256: string;
        record_counts: {reports: number; woredas: number};
      }>('/admin/backup', {}, token);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], {type: 'application/json'});
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `opcms_backup_${bundle.exported_at.slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setBackupMsg(
        `Verified backup exported (${bundle.record_counts.woredas} Woredas, ${bundle.record_counts.reports} Reports · SHA-256: ${bundle.checksum_sha256.slice(0, 12)}...).`,
      );
      onRefresh();
    } catch (err) {
      setBackupErr(err instanceof ApiError ? err.message : 'Failed to export database backup.');
    } finally {
      setBackupBusy(false);
    }
  };

  const handleRestoreBackupFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setBackupErr(null);
    setBackupMsg(null);
    setBackupBusy(true);
    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const res = await apiRequest<{
        ok: boolean;
        restored_checksum: string;
        counts: {woredas: number; reports: number};
      }>(
        '/admin/restore',
        {
          method: 'POST',
          body: JSON.stringify(parsed),
        },
        token,
      );
      setBackupMsg(
        `Database restored safely (${res.counts.woredas} Woredas, ${res.counts.reports} Reports · SHA-256 verified: ${res.restored_checksum.slice(0, 12)}...). Pre-restore snapshot created.`,
      );
      onRefresh();
    } catch (err) {
      setBackupErr(err instanceof ApiError ? err.message : 'Backup restoration failed or file checksum invalid.');
    } finally {
      setBackupBusy(false);
    }
  };

  const zoneWoredas = woredas.filter((w) => w.zone_id === newZoneId);

  return (
    <div className="space-y-6">
      <div className="bg-white border border-slate-200 rounded-lg p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#485EA9]">Security &amp; Governance</p>
          <h2 className="mt-0.5 text-xl font-bold text-slate-900">
            Role-Based Access Control, Users &amp; Audit Logs
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Users are strictly bound to their assigned role permissions and Region / Zone / Woreda administrative scope.
          </p>
        </div>
        {isAdmin && (
          <button
            type="button"
            onClick={() => setShowCreateUser((prev) => !prev)}
            className="inline-flex items-center gap-1.5 rounded-md bg-[#3A99CF] px-4 py-2 text-xs font-bold text-white hover:bg-[#3185b5] whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Provision User Account
          </button>
        )}
      </div>

      {showCreateUser && isAdmin && (
        <form onSubmit={handleCreateUser} className="bg-white border border-[#3A99CF]/40 rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-bold text-slate-900">Provision New OPCMS User</h3>
          {error && <p className="text-xs text-red-700 font-bold">{error}</p>}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Username</label>
              <input
                type="text"
                required
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="e.g. woreda.lume"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Full Name</label>
              <input
                type="text"
                required
                value={newFullName}
                onChange={(e) => setNewFullName(e.target.value)}
                placeholder="e.g. Abebe Kebede"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                placeholder="abebe@ohb.gov.et"
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">Role</label>
              <select
                value={newRoleCode}
                onChange={(e) => setNewRoleCode(e.target.value as RoleCode)}
                className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                {roles.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.name}
                  </option>
                ))}
              </select>
            </div>
            {['ZONE_ADMIN', 'WOREDA_REPORTING_OFFICER'].includes(newRoleCode) && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Zone</label>
                <select
                  value={newZoneId}
                  onChange={(e) => {
                    setNewZoneId(e.target.value);
                    setNewWoredaId('');
                  }}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {zones.map((z) => (
                    <option key={z.id} value={z.id}>
                      {z.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {newRoleCode === 'WOREDA_REPORTING_OFFICER' && (
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Assigned Woreda</label>
                <select
                  required
                  value={newWoredaId}
                  onChange={(e) => setNewWoredaId(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  <option value="">Select Woreda...</option>
                  {zoneWoredas.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.name} ({w.reporting_unit_code})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-[#485EA9] px-4 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] cursor-pointer"
          >
            {busy ? 'Creating...' : 'Create Account (Default Password: OhbPolio@2026)'}
          </button>
        </form>
      )}

      {/* 5 Roles Matrix */}
      <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
          <Shield className="w-4 h-4 text-[#485EA9]" />
          <h3 className="text-base font-bold text-slate-900">OPCMS Role Permission Matrix</h3>
        </div>
        <div className="divide-y divide-slate-200 text-xs">
          {roles.map((r) => (
            <div key={r.code} className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-2">
              <div>
                <div className="text-sm font-bold text-slate-900">
                  {r.name}{' '}
                  {r.is_read_only && <span className="text-[#D29441] font-bold">(Read-Only)</span>}
                </div>
                <p className="text-slate-600 mt-0.5">{r.description}</p>
              </div>
              <div className="font-mono text-[11px] text-[#485EA9] md:text-right max-w-md">
                {r.permissions.join(' · ')}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* User Directory (Admin & Coordination) */}
      {users.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-200 flex items-center gap-2">
            <Users className="w-4 h-4 text-[#3A99CF]" />
            <h3 className="text-base font-bold text-slate-900">Registered System Accounts</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-bold text-slate-600">
                  <th className="py-2.5 px-4">Username</th>
                  <th className="py-2.5 px-4">Full Name</th>
                  <th className="py-2.5 px-4">Role</th>
                  <th className="py-2.5 px-4">Administrative Scope</th>
                  <th className="py-2.5 px-4">Status</th>
                  {isAdmin && <th className="py-2.5 px-4 text-right">Action</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {users.map((u) => (
                  <tr key={u.id}>
                    <td className="py-2.5 px-4 font-mono text-xs text-[#485EA9]">{u.username}</td>
                    <td className="py-2.5 px-4 font-bold text-slate-900">{u.full_name}</td>
                    <td className="py-2.5 px-4 text-slate-700">{u.role_name}</td>
                    <td className="py-2.5 px-4 text-xs text-slate-600">
                      {u.woreda_name
                        ? `${u.zone_name} → ${u.woreda_name}`
                        : u.zone_name
                          ? `${u.zone_name} Zone`
                          : 'Oromia Region (All Zones)'}
                    </td>
                    <td className="py-2.5 px-4 text-xs font-bold">
                      <span className={u.is_active ? 'text-emerald-700' : 'text-red-700'}>
                        {u.is_active ? 'Active' : 'Suspended'}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="py-2.5 px-4 text-right">
                        {u.id !== user.id && (
                          <button
                            type="button"
                            onClick={() => toggleUserActive(u)}
                            className="rounded border border-slate-300 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                          >
                            {u.is_active ? 'Suspend' : 'Activate'}
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Notifications & Audit Logs */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-5 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Bell className="w-4 h-4 text-[#D29441]" />
            <h3 className="text-base font-bold text-slate-900">Campaign Notifications</h3>
          </div>
          <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs">
            {notifications.map((n) => (
              <div key={n.id} className={`p-3 space-y-1 ${n.is_read ? 'opacity-65' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-bold text-slate-900">{n.title}</span>
                  {!n.is_read && (
                    <button
                      type="button"
                      onClick={() => markRead(n.id)}
                      className="text-[#3A99CF] font-bold hover:underline cursor-pointer"
                    >
                      Mark Read
                    </button>
                  )}
                </div>
                <p className="text-slate-600">{n.message}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-lg p-5">
          <div className="flex items-center gap-2 mb-3">
            <Activity className="w-4 h-4 text-[#485EA9]" />
            <h3 className="text-base font-bold text-slate-900">Immutable Audit Log</h3>
          </div>
          {auditLogs.length === 0 ? (
            <p className="text-xs text-slate-500">
              Audit log viewer is restricted to Regional System Administrator, Coordination Team, and Monitoring Officer roles.
            </p>
          ) : (
            <div className="divide-y divide-slate-200 border border-slate-200 rounded-md text-xs max-h-96 overflow-y-auto">
              {auditLogs.map((log) => (
                <div key={log.id} className="p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-1">
                  <div>
                    <span className="font-mono font-bold text-[#485EA9]">{log.action}</span>{' '}
                    <span className="text-slate-500">· {log.actor_username}</span>
                    <div className="text-slate-700 mt-0.5">{log.details}</div>
                  </div>
                  <span className="text-slate-400 tabular-nums shrink-0">
                    {new Date(log.created_at).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Database Backup & Verified Restoration (Admin Only) */}
      {isAdmin && (
        <div className="bg-white border border-slate-200 rounded-lg p-5 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#485EA9]" />
                <h3 className="text-base font-bold text-slate-900">
                  Database Backup &amp; Checksum-Verified Restoration
                </h3>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                Export SHA-256 integrity-verified database snapshots or restore from a prior backup. Every restore creates an automatic pre-restore safety snapshot before applying changes.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                disabled={backupBusy}
                onClick={() => void handleDownloadBackup()}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#485EA9] px-3.5 py-2 text-xs font-bold text-white hover:bg-[#3b4e8f] cursor-pointer"
              >
                <Download className="w-4 h-4" />
                {backupBusy ? 'Processing...' : 'Download JSON Backup'}
              </button>
              <label className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3.5 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">
                <Upload className="w-4 h-4 text-[#3A99CF]" />
                Restore Verified Backup
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={handleRestoreBackupFile}
                  className="hidden"
                />
              </label>
            </div>
          </div>
          {backupMsg && (
            <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">
              {backupMsg}
            </div>
          )}
          {backupErr && (
            <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-800">
              {backupErr}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
