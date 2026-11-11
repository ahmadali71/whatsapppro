import React, { useEffect, useState } from 'react';
import {
  ShieldCheck,
  Users,
  MessageSquare,
  Flag,
  Server,
  HardDrive,
  Search,
  Ban,
  RotateCcw,
  Trash2,
  CheckCircle2,
  X,
  Lock,
  Activity,
  FileText,
  Sliders,
} from 'lucide-react';
import { UserRole } from '@whatsapp-pro/shared-types';
import {
  adminApi,
  AdminAuditLog,
  AdminHealthStatus,
  AdminReportItem,
  AdminStats,
  AdminUserItem,
} from '@/services/api.services';
import { useAuthStore } from '@/stores/authStore';
import { Avatar } from '@/components/common/Avatar';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { toast } from '@/stores/toastStore';

type AdminTab = 'overview' | 'users' | 'reports' | 'config' | 'audit';

function fmtBytes(bytes = 0): string {
  if (!bytes) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  return `${(mb / 1024).toFixed(2)} GB`;
}

export const AdminDashboardPage: React.FC = () => {
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<AdminTab>('overview');

  // Overview
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [health, setHealth] = useState<AdminHealthStatus | null>(null);
  const [storageInfo, setStorageInfo] = useState<{ totalBytes: number; breakdown?: Record<string, number> } | null>(null);
  const [loadingStats, setLoadingStats] = useState(true);

  // Users
  const [users, setUsers] = useState<AdminUserItem[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [userStatusFilter, setUserStatusFilter] = useState('all');
  const [selectedUserMeta, setSelectedUserMeta] = useState<AdminUserItem | null>(null);
  const [suspendTarget, setSuspendTarget] = useState<AdminUserItem | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AdminUserItem | null>(null);

  // Reports
  const [reports, setReports] = useState<AdminReportItem[]>([]);
  const [reportFilter, setReportFilter] = useState<string>('PENDING');
  const [selectedReport, setSelectedReport] = useState<AdminReportItem | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');

  // System Config
  const [configKey, setConfigKey] = useState('app_settings');
  const [maxUploadMb, setMaxUploadMb] = useState(100);
  const [maxGroupMembers, setMaxGroupMembers] = useState(1024);
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);
  const [auditActionFilter, setAuditActionFilter] = useState('');

  const loadOverview = async () => {
    setLoadingStats(true);
    try {
      const [s, h, st] = await Promise.all([
        adminApi.getStats(),
        adminApi.getHealth(),
        adminApi.getStorage(),
      ]);
      setStats(s);
      setHealth(h);
      setStorageInfo(st);
    } catch {
      toast.error('Failed to load admin metrics');
    } finally {
      setLoadingStats(false);
    }
  };

  const loadUsers = async () => {
    try {
      const res = await adminApi.getUsers({
        search: userSearch || undefined,
        status: userStatusFilter === 'all' ? undefined : userStatusFilter,
        limit: 50,
      });
      setUsers(res.users);
    } catch {
      toast.error('Failed to load users');
    }
  };

  const loadReports = async () => {
    try {
      const res = await adminApi.getReports({
        status: reportFilter === 'ALL' ? undefined : reportFilter,
        limit: 50,
      });
      setReports(res.reports);
    } catch {
      toast.error('Failed to load reports');
    }
  };

  const loadAuditLogs = async () => {
    try {
      const res = await adminApi.getAuditLogs({
        action: auditActionFilter || undefined,
        limit: 50,
      });
      setAuditLogs(res.logs);
    } catch {
      toast.error('Failed to load audit logs');
    }
  };

  useEffect(() => {
    if (user?.role !== UserRole.ADMIN) return;
    void loadOverview();
  }, [user?.role]);

  useEffect(() => {
    if (user?.role !== UserRole.ADMIN) return;
    if (activeTab === 'users') void loadUsers();
    if (activeTab === 'reports') void loadReports();
    if (activeTab === 'audit') void loadAuditLogs();
  }, [activeTab, userStatusFilter, reportFilter, user?.role]);

  if (user?.role !== UserRole.ADMIN) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-[#f0f2f5] dark:bg-[#0b141a]">
        <ShieldCheck className="w-16 h-16 text-red-500 mb-4" />
        <h1 className="text-2xl font-bold mb-2">403 · Admin Access Required</h1>
        <p className="text-sm text-[#667781] dark:text-[#8696a0] max-w-md">
          This portal is restricted to verified WhatsApp Pro administrators.
        </p>
      </div>
    );
  }

  const handleSuspendUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!suspendTarget || !suspendReason.trim()) return;
    try {
      await adminApi.suspendUser(suspendTarget.id, suspendReason.trim());
      setSuspendTarget(null);
      setSuspendReason('');
      await loadUsers();
      toast.success('User suspended');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to suspend user');
    }
  };

  const handleRestoreUser = async (userId: string) => {
    try {
      await adminApi.restoreUser(userId);
      await loadUsers();
      toast.success('User restored');
    } catch {
      toast.error('Failed to restore user');
    }
  };

  const handleDeleteUser = async () => {
    if (!deleteTarget) return;
    try {
      await adminApi.deleteUser(deleteTarget.id);
      setDeleteTarget(null);
      await loadUsers();
      toast.success('User deleted');
    } catch {
      toast.error('Failed to delete user');
    }
  };

  const handleReviewReport = async (status: 'REVIEWED' | 'RESOLVED' | 'DISMISSED') => {
    if (!selectedReport) return;
    try {
      await adminApi.updateReportStatus(selectedReport.id, status, reviewNotes.trim() || undefined);
      setSelectedReport(null);
      setReviewNotes('');
      await loadReports();
      toast.success(`Report marked ${status}`);
    } catch {
      toast.error('Failed to update report');
    }
  };

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await adminApi.updateConfig(configKey, {
        maxMediaUploadMb: maxUploadMb,
        maxGroupMembers,
        registrationEnabled,
        maintenanceMode,
      });
      toast.success('System configuration saved');
    } catch {
      toast.error('Failed to save config');
    }
  };

  const regSeries = stats?.registrationSeries || [
    { date: 'Mon', count: 14 },
    { date: 'Tue', count: 22 },
    { date: 'Wed', count: 18 },
    { date: 'Thu', count: 29 },
    { date: 'Fri', count: 35 },
    { date: 'Sat', count: 27 },
    { date: 'Sun', count: 31 },
  ];
  const maxSeriesVal = Math.max(1, ...regSeries.map((r) => r.count));

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden bg-[#f0f2f5] dark:bg-[#0b141a]">
      {/* Admin Top Header */}
      <header className="h-14 px-6 bg-white dark:bg-[#202c33] border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-6 h-6 text-[#00A884]" />
          <h1 className="text-lg font-bold">WhatsApp Pro Admin Console</h1>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {(
            [
              { id: 'overview', label: 'Overview', icon: Activity },
              { id: 'users', label: 'Users', icon: Users },
              { id: 'reports', label: 'Reports', icon: Flag },
              { id: 'config', label: 'System Config', icon: Sliders },
              { id: 'audit', label: 'Audit Logs', icon: FileText },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition ${
                  activeTab === t.id
                    ? 'bg-[#00A884] text-white'
                    : 'text-[#667781] dark:text-[#aebac1] hover:bg-gray-100 dark:hover:bg-[#2a3942]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Privacy Notice Banner */}
          <div className="px-4 py-2.5 rounded-xl bg-[#00A884]/10 border border-[#00A884]/25 text-xs flex items-center gap-2 text-[#075E54] dark:text-[#25D366]">
            <Lock className="w-4 h-4 shrink-0" />
            <span>
              Zero-Knowledge Privacy Enforcement: Admin tools inspect aggregate metadata and abuse reports only — plaintext private messages are never accessible.
            </span>
          </div>

          {/* OVERVIEW TAB */}
          {activeTab === 'overview' && (
            <>
              {loadingStats ? (
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="h-28 rounded-2xl bg-white dark:bg-[#202c33] animate-pulse" />
                  ))}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                    {[
                      { label: 'Total Users', value: stats?.totalUsers ?? 0, sub: `+${stats?.newRegistrationsToday ?? 0} today`, icon: Users },
                      { label: 'Active Users', value: stats?.activeUsers ?? 0, sub: `${stats?.activeConversations ?? 0} active chats`, icon: Activity },
                      { label: 'Groups & Reports', value: `${stats?.totalGroups ?? 0} / ${stats?.pendingReports ?? 0}`, sub: 'Groups / Pending reports', icon: MessageSquare },
                      { label: 'Storage Used', value: fmtBytes(storageInfo?.totalBytes ?? stats?.storageUsedBytes), sub: `${stats?.messagesToday ?? 0} msgs today`, icon: HardDrive },
                    ].map((card) => {
                      const Icon = card.icon;
                      return (
                        <div
                          key={card.label}
                          className="bg-white dark:bg-[#202c33] rounded-2xl p-5 border border-gray-200/70 dark:border-[#2a3942] shadow-sm"
                        >
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs font-medium text-[#667781] dark:text-[#8696a0]">
                              {card.label}
                            </span>
                            <Icon className="w-4 h-4 text-[#00A884]" />
                          </div>
                          <p className="text-2xl font-bold">{card.value}</p>
                          <p className="text-[11px] text-[#667781] mt-1">{card.sub}</p>
                        </div>
                      );
                    })}
                  </div>

                  {/* Charts + Health */}
                  <div className="grid lg:grid-cols-3 gap-5">
                    <div className="lg:col-span-2 bg-white dark:bg-[#202c33] rounded-2xl p-6 border border-gray-200/70 dark:border-[#2a3942] shadow-sm">
                      <h3 className="font-semibold text-sm mb-4">Weekly Registration Activity</h3>
                      <div className="h-44 flex items-end gap-3 pt-4">
                        {regSeries.map((pt) => {
                          const hPct = Math.round((pt.count / maxSeriesVal) * 100);
                          return (
                            <div key={pt.date} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end">
                              <span className="text-[11px] font-mono text-[#667781]">{pt.count}</span>
                              <div
                                className="w-full max-w-[42px] rounded-t-lg bg-gradient-to-t from-[#00A884] to-[#25D366] transition-all"
                                style={{ height: `${Math.max(10, hPct)}%` }}
                              />
                              <span className="text-[11px] text-[#667781]">{pt.date}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    <div className="bg-white dark:bg-[#202c33] rounded-2xl p-6 border border-gray-200/70 dark:border-[#2a3942] shadow-sm space-y-4">
                      <h3 className="font-semibold text-sm flex items-center gap-2">
                        <Server className="w-4 h-4 text-[#00A884]" /> Infrastructure Health
                      </h3>
                      {[
                        { name: 'PostgreSQL Database', info: health?.database },
                        { name: 'Redis Presence Cache', info: health?.redis },
                        { name: 'S3 Object Storage', info: health?.storage },
                      ].map((svc) => (
                        <div
                          key={svc.name}
                          className="flex items-center justify-between p-3 rounded-xl bg-gray-50 dark:bg-[#111b21]"
                        >
                          <div>
                            <p className="text-xs font-semibold">{svc.name}</p>
                            {svc.info && 'latencyMs' in svc.info && svc.info.latencyMs !== undefined && (
                              <p className="text-[10px] text-[#667781]">{svc.info.latencyMs} ms</p>
                            )}
                          </div>
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[11px] font-semibold uppercase ${
                              svc.info?.status === 'ok' || svc.info?.status === 'healthy' || svc.info?.status === 'connected'
                                ? 'bg-[#25D366]/15 text-[#25D366]'
                                : 'bg-amber-500/15 text-amber-500'
                            }`}
                          >
                            {svc.info?.status || 'ok'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </>
          )}

          {/* USERS TAB */}
          {activeTab === 'users' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl border border-gray-200/70 dark:border-[#2a3942] shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex flex-wrap items-center justify-between gap-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void loadUsers();
                  }}
                  className="flex items-center gap-2 flex-1 min-w-[240px]"
                >
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] flex-1 max-w-sm">
                    <Search className="w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      placeholder="Search name, username, phone..."
                      className="bg-transparent text-xs flex-1 focus:outline-none"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-xl bg-[#00A884] text-white text-xs font-semibold"
                  >
                    Search
                  </button>
                </form>

                <select
                  value={userStatusFilter}
                  onChange={(e) => setUserStatusFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs font-medium"
                >
                  <option value="all">All Users</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended / Banned</option>
                  <option value="admin">Admins</option>
                </select>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 dark:bg-[#111b21] text-[#667781] uppercase">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Joined</th>
                      <th className="px-4 py-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                    {users.map((u) => (
                      <tr key={u.id} className="hover:bg-gray-50/70 dark:hover:bg-[#182229]">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <Avatar src={u.avatarUrl} name={u.displayName} size="xs" />
                            <div>
                              <button
                                type="button"
                                onClick={() => setSelectedUserMeta(u)}
                                className="font-semibold hover:underline text-left"
                              >
                                {u.displayName}
                              </button>
                              {u.username && (
                                <p className="text-[11px] text-[#667781]">@{u.username}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3 font-mono">{u.phoneNumber}</td>
                        <td className="px-4 py-3">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                              u.role === UserRole.ADMIN
                                ? 'bg-amber-500/15 text-amber-500'
                                : 'bg-gray-100 dark:bg-[#2a3942]'
                            }`}
                          >
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {u.isBanned ? (
                            <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 text-[10px] font-semibold">
                              Suspended
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full bg-[#25D366]/15 text-[#25D366] text-[10px] font-semibold">
                              Active
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#667781]">
                          {new Date(u.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          {u.isBanned ? (
                            <button
                              type="button"
                              onClick={() => void handleRestoreUser(u.id)}
                              className="text-[#00A884] font-semibold hover:underline inline-flex items-center gap-1"
                            >
                              <RotateCcw className="w-3.5 h-3.5" /> Restore
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setSuspendTarget(u)}
                              className="text-amber-500 font-semibold hover:underline inline-flex items-center gap-1"
                            >
                              <Ban className="w-3.5 h-3.5" /> Suspend
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            className="text-red-500 hover:underline inline-flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* REPORTS TAB */}
          {activeTab === 'reports' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl border border-gray-200/70 dark:border-[#2a3942] shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between">
                <h2 className="font-semibold text-sm">Abuse Reports Queue</h2>
                <select
                  value={reportFilter}
                  onChange={(e) => setReportFilter(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs font-medium"
                >
                  <option value="PENDING">Pending</option>
                  <option value="REVIEWED">Reviewed</option>
                  <option value="RESOLVED">Resolved</option>
                  <option value="DISMISSED">Dismissed</option>
                  <option value="ALL">All Reports</option>
                </select>
              </div>

              <div className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                {reports.length === 0 ? (
                  <p className="text-center text-xs text-[#667781] py-10">
                    No reports matching filter.
                  </p>
                ) : (
                  reports.map((rep) => (
                    <div
                      key={rep.id}
                      className="p-4 flex items-center justify-between gap-4 hover:bg-gray-50 dark:hover:bg-[#182229]"
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded-full bg-red-500/15 text-red-500 text-[10px] font-bold">
                            {rep.reason}
                          </span>
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 dark:bg-[#2a3942] text-[10px] font-semibold">
                            {rep.status}
                          </span>
                          <span className="text-[11px] text-[#667781]">
                            {new Date(rep.createdAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-xs">
                          Reported User:{' '}
                          <span className="font-semibold">
                            {rep.reportedUser?.displayName || rep.reportedUserId}
                          </span>{' '}
                          · Reporter: {rep.reporter?.displayName || rep.reporterId}
                        </p>
                        {rep.description && (
                          <p className="text-xs text-[#667781] truncate">{rep.description}</p>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setSelectedReport(rep)}
                        className="px-3 py-1.5 rounded-xl bg-[#00A884] text-white text-xs font-semibold shrink-0"
                      >
                        Review Metadata
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* SYSTEM CONFIG TAB */}
          {activeTab === 'config' && (
            <form
              onSubmit={handleSaveConfig}
              className="bg-white dark:bg-[#202c33] rounded-2xl p-6 border border-gray-200/70 dark:border-[#2a3942] shadow-sm space-y-4 max-w-xl"
            >
              <h2 className="font-semibold text-base">System Configuration</h2>
              <div>
                <label className="block text-xs text-[#667781] mb-1">Config Key</label>
                <input
                  type="text"
                  value={configKey}
                  onChange={(e) => setConfigKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm font-mono"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-[#667781] mb-1">Max Media Upload (MB)</label>
                  <input
                    type="number"
                    value={maxUploadMb}
                    onChange={(e) => setMaxUploadMb(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs text-[#667781] mb-1">Max Group Members</label>
                  <input
                    type="number"
                    value={maxGroupMembers}
                    onChange={(e) => setMaxGroupMembers(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm"
                  />
                </div>
              </div>
              <label className="flex items-center justify-between text-sm cursor-pointer">
                <span>Allow New User Registrations</span>
                <input
                  type="checkbox"
                  checked={registrationEnabled}
                  onChange={(e) => setRegistrationEnabled(e.target.checked)}
                  className="accent-[#00A884]"
                />
              </label>
              <label className="flex items-center justify-between text-sm cursor-pointer">
                <span>Maintenance Mode</span>
                <input
                  type="checkbox"
                  checked={maintenanceMode}
                  onChange={(e) => setMaintenanceMode(e.target.checked)}
                  className="accent-[#00A884]"
                />
              </label>
              <button
                type="submit"
                className="px-5 py-2.5 rounded-xl bg-[#00A884] text-white text-sm font-semibold flex items-center gap-2"
              >
                <CheckCircle2 className="w-4 h-4" /> Save Configuration
              </button>
            </form>
          )}

          {/* AUDIT LOGS TAB */}
          {activeTab === 'audit' && (
            <div className="bg-white dark:bg-[#202c33] rounded-2xl border border-gray-200/70 dark:border-[#2a3942] shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 dark:border-[#2a3942] flex items-center justify-between gap-3">
                <h2 className="font-semibold text-sm">Admin Audit Logs</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={auditActionFilter}
                    onChange={(e) => setAuditActionFilter(e.target.value)}
                    placeholder="Filter by action..."
                    className="px-3 py-1.5 rounded-xl bg-gray-100 dark:bg-[#111b21] text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => void loadAuditLogs()}
                    className="px-3 py-1.5 rounded-xl bg-[#00A884] text-white text-xs font-semibold"
                  >
                    Filter
                  </button>
                </div>
              </div>
              <div className="divide-y divide-gray-100 dark:divide-[#2a3942]">
                {auditLogs.length === 0 ? (
                  <p className="text-center text-xs text-[#667781] py-10">No audit logs found.</p>
                ) : (
                  auditLogs.map((log) => (
                    <div key={log.id} className="p-3.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono font-semibold text-[#00A884]">{log.action}</span>
                        <span className="mx-2 text-[#667781]">·</span>
                        <span>
                          {log.entityType} ({log.entityId || 'N/A'})
                        </span>
                        <p className="text-[11px] text-[#667781]">
                          Actor: {log.actor?.displayName || log.actorId} · IP: {log.ipAddress || 'N/A'}
                        </p>
                      </div>
                      <span className="text-[11px] text-[#667781]">
                        {new Date(log.createdAt).toLocaleString()}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* User Metadata Modal */}
      {selectedUserMeta && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-base">User Account Metadata</h3>
              <button type="button" onClick={() => setSelectedUserMeta(null)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="space-y-2 text-xs">
              <p><strong>ID:</strong> <span className="font-mono">{selectedUserMeta.id}</span></p>
              <p><strong>Display Name:</strong> {selectedUserMeta.displayName}</p>
              <p><strong>Phone:</strong> {selectedUserMeta.phoneNumber}</p>
              <p><strong>Role:</strong> {selectedUserMeta.role}</p>
              <p><strong>Verified:</strong> {selectedUserMeta.isVerified ? 'Yes' : 'No'}</p>
              <p><strong>2FA Enabled:</strong> {selectedUserMeta.twoFactorEnabled ? 'Yes' : 'No'}</p>
              <p><strong>Banned:</strong> {selectedUserMeta.isBanned ? 'Yes' : 'No'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Suspend User Modal */}
      {suspendTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <form
            onSubmit={handleSuspendUser}
            className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942]"
          >
            <h3 className="font-semibold text-base mb-2">Suspend {suspendTarget.displayName}</h3>
            <textarea
              rows={3}
              value={suspendReason}
              onChange={(e) => setSuspendReason(e.target.value)}
              placeholder="Reason for suspension..."
              className="w-full p-3 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-sm mb-4"
              required
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setSuspendTarget(null)}
                className="px-4 py-2 rounded-lg text-sm"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg text-sm bg-amber-600 text-white font-semibold"
              >
                Suspend Account
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Report Detail Moderation Modal */}
      {selectedReport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-[#202c33] rounded-2xl max-w-md w-full p-6 shadow-xl border border-gray-200 dark:border-[#2a3942] space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-base">Report Metadata Review</h3>
              <button type="button" onClick={() => setSelectedReport(null)}>
                <X className="w-5 h-5 text-gray-400" />
              </button>
            </div>
            <div className="p-3 rounded-xl bg-gray-50 dark:bg-[#111b21] text-xs space-y-1.5">
              <p><strong>Report ID:</strong> <span className="font-mono">{selectedReport.id}</span></p>
              <p><strong>Reason:</strong> {selectedReport.reason}</p>
              <p><strong>Reported User ID:</strong> <span className="font-mono">{selectedReport.reportedUserId}</span></p>
              {selectedReport.reportedMessageId && (
                <p><strong>Flagged Message ID:</strong> <span className="font-mono">{selectedReport.reportedMessageId}</span></p>
              )}
              <p><strong>Description:</strong> {selectedReport.description || 'None provided'}</p>
            </div>
            <textarea
              rows={2}
              value={reviewNotes}
              onChange={(e) => setReviewNotes(e.target.value)}
              placeholder="Moderator notes (optional)..."
              className="w-full p-2.5 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => void handleReviewReport('DISMISSED')}
                className="px-3 py-2 rounded-lg text-xs bg-gray-200 dark:bg-[#2a3942] font-semibold"
              >
                Dismiss
              </button>
              <button
                type="button"
                onClick={() => void handleReviewReport('REVIEWED')}
                className="px-3 py-2 rounded-lg text-xs bg-blue-600 text-white font-semibold"
              >
                Mark Reviewed
              </button>
              <button
                type="button"
                onClick={() => void handleReviewReport('RESOLVED')}
                className="px-3 py-2 rounded-lg text-xs bg-[#00A884] text-white font-semibold"
              >
                Resolve
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        open={Boolean(deleteTarget)}
        title={`Delete ${deleteTarget?.displayName}?`}
        description="This will soft-delete the user account and revoke active sessions."
        confirmLabel="Delete User"
        danger
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => void handleDeleteUser()}
      />
    </div>
  );
};
