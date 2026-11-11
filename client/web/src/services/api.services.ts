import {
  Call,
  Community,
  Group,
  GroupInvite,
  GroupMember,
  MemberRole,
  PrivacyVisibility,
  Status,
  StatusContentType,
  StatusView,
  User,
} from '@whatsapp-pro/shared-types';
import { api, unwrapData } from '@/lib/api';

export interface MediaUploadResult {
  url: string;
  fileUrl?: string;
  key?: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  duration?: number;
}

export const mediaApi = {
  async uploadFile(
    file: File | Blob,
    folder = 'chat-media',
    onProgress?: (pct: number) => void,
    fileName?: string,
  ): Promise<MediaUploadResult> {
    const formData = new FormData();
    if (file instanceof File) {
      formData.append('file', file);
    } else {
      formData.append('file', file, fileName || `upload-${Date.now()}.bin`);
    }
    formData.append('folder', folder);

    const res = await api.post('/media/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (evt) => {
        if (evt.total && onProgress) {
          onProgress(Math.round((evt.loaded / evt.total) * 100));
        }
      },
    });
    const data = unwrapData<MediaUploadResult>(res.data);
    return {
      ...data,
      url: data.url || data.fileUrl || '',
    };
  },
};

export interface StatusFeedGroup {
  user: User;
  statuses: Status[];
  hasUnviewed?: boolean;
}

export const statusesApi = {
  async getContactsStatuses(): Promise<Status[]> {
    const res = await api.get('/statuses');
    const data = unwrapData<
      | Status[]
      | StatusFeedGroup[]
      | { statuses?: Array<Status | StatusFeedGroup>; items?: Array<Status | StatusFeedGroup> }
    >(res.data);

    const rawList: Array<Status | StatusFeedGroup> = Array.isArray(data)
      ? data
      : data?.statuses || data?.items || [];

    const flattened: Status[] = [];
    for (const item of rawList) {
      if (item && typeof item === 'object' && 'statuses' in item && Array.isArray(item.statuses)) {
        for (const st of item.statuses) {
          flattened.push({ ...st, user: st.user || item.user });
        }
      } else if (item && 'id' in item) {
        flattened.push(item as Status);
      }
    }
    return flattened;
  },

  async getMyStatuses(): Promise<Status[]> {
    const res = await api.get('/statuses/mine');
    const data = unwrapData<Status[] | { statuses?: Status[]; items?: Status[] }>(res.data);
    if (Array.isArray(data)) return data;
    return data?.statuses || data?.items || [];
  },

  async createStatus(payload: {
    contentType: StatusContentType;
    textContent?: string;
    contentUrl?: string;
    caption?: string;
    backgroundColor?: string;
    fontStyle?: string;
    privacy?: PrivacyVisibility | 'NONE';
  }): Promise<Status> {
    const mappedPrivacy =
      payload.privacy === PrivacyVisibility.NOBODY ? 'NONE' : payload.privacy;
    const res = await api.post('/statuses', {
      ...payload,
      ...(mappedPrivacy !== undefined ? { privacy: mappedPrivacy } : {}),
    });
    return unwrapData<Status>(res.data);
  },

  async deleteStatus(statusId: string): Promise<void> {
    await api.delete(`/statuses/${statusId}`);
  },

  async markViewed(statusId: string): Promise<void> {
    await api.post(`/statuses/${statusId}/views`);
  },

  async getViewers(statusId: string): Promise<StatusView[]> {
    const res = await api.get(`/statuses/${statusId}/viewers`);
    const data = unwrapData<StatusView[]>(res.data);
    return Array.isArray(data) ? data : [];
  },

  async reactToStatus(statusId: string, emoji: string): Promise<void> {
    await api.post(`/statuses/${statusId}/reactions`, { emoji });
  },

  async replyToStatus(statusId: string, message: string): Promise<void> {
    await api.post(`/statuses/${statusId}/reply`, { message });
  },
};

export const groupsApi = {
  async createGroup(payload: {
    name: string;
    description?: string;
    avatarUrl?: string;
    memberIds: string[];
  }): Promise<Group & { conversationId?: string }> {
    const res = await api.post('/groups', payload);
    return unwrapData<Group & { conversationId?: string }>(res.data);
  },

  async getGroup(groupId: string): Promise<Group> {
    const res = await api.get(`/groups/${groupId}`);
    return unwrapData<Group>(res.data);
  },

  async updateGroup(
    groupId: string,
    payload: {
      name?: string;
      description?: string;
      avatarUrl?: string;
      onlyAdminsCanMessage?: boolean;
      onlyAdminsCanEditInfo?: boolean;
    },
  ): Promise<Group> {
    const res = await api.patch(`/groups/${groupId}`, payload);
    return unwrapData<Group>(res.data);
  },

  async deleteGroup(groupId: string): Promise<void> {
    await api.delete(`/groups/${groupId}`);
  },

  async getMembers(groupId: string): Promise<GroupMember[]> {
    const res = await api.get(`/groups/${groupId}/members`);
    const data = unwrapData<GroupMember[]>(res.data);
    return Array.isArray(data) ? data : [];
  },

  async addMembers(groupId: string, userIds: string[]): Promise<void> {
    await api.post(`/groups/${groupId}/members`, { userIds });
  },

  async removeMember(groupId: string, userId: string): Promise<void> {
    await api.delete(`/groups/${groupId}/members/${userId}`);
  },

  async updateMemberRole(groupId: string, userId: string, role: MemberRole): Promise<void> {
    await api.patch(`/groups/${groupId}/members/${userId}/role`, { role });
  },

  async generateInviteLink(groupId: string): Promise<GroupInvite & { url?: string }> {
    const res = await api.post(`/groups/${groupId}/invite-link`);
    return unwrapData<GroupInvite & { url?: string }>(res.data);
  },

  async revokeInviteLink(groupId: string): Promise<void> {
    await api.delete(`/groups/${groupId}/invite-link`);
  },

  async joinViaInviteCode(inviteCode: string): Promise<{ group: Group; conversationId?: string }> {
    const res = await api.post(`/groups/join/${inviteCode}`);
    return unwrapData<{ group: Group; conversationId?: string }>(res.data);
  },

  async getGroupMedia(groupId: string): Promise<Array<{ id: string; fileUrl: string; fileType: string; fileName?: string; createdAt: string }>> {
    const res = await api.get(`/groups/${groupId}/media`);
    const data = unwrapData<Array<{ id: string; fileUrl: string; fileType: string; fileName?: string; createdAt: string }>>(res.data);
    return Array.isArray(data) ? data : [];
  },
};

export interface CommunityWithGroups extends Community {
  groups?: Group[];
  members?: Array<{ id: string; userId: string; role: MemberRole; user?: User }>;
}

export const communitiesApi = {
  async listCommunities(): Promise<CommunityWithGroups[]> {
    const res = await api.get('/communities');
    const data = unwrapData<CommunityWithGroups[]>(res.data);
    return Array.isArray(data) ? data : [];
  },

  async createCommunity(payload: {
    name: string;
    description?: string;
    avatarUrl?: string;
  }): Promise<CommunityWithGroups> {
    const res = await api.post('/communities', payload);
    return unwrapData<CommunityWithGroups>(res.data);
  },

  async getCommunity(id: string): Promise<CommunityWithGroups> {
    const res = await api.get(`/communities/${id}`);
    return unwrapData<CommunityWithGroups>(res.data);
  },

  async updateCommunity(id: string, payload: { name?: string; description?: string; avatarUrl?: string }): Promise<CommunityWithGroups> {
    const res = await api.patch(`/communities/${id}`, payload);
    return unwrapData<CommunityWithGroups>(res.data);
  },

  async deleteCommunity(id: string): Promise<void> {
    await api.delete(`/communities/${id}`);
  },

  async addMembers(id: string, userIds: string[]): Promise<void> {
    await api.post(`/communities/${id}/members`, { userIds });
  },

  async removeMember(id: string, userId: string): Promise<void> {
    await api.delete(`/communities/${id}/members/${userId}`);
  },

  async addGroup(communityId: string, groupId: string): Promise<void> {
    await api.post(`/communities/${communityId}/groups`, { groupId });
  },

  async removeGroup(communityId: string, groupId: string): Promise<void> {
    await api.delete(`/communities/${communityId}/groups/${groupId}`);
  },
};

export interface AuthSessionItem {
  id: string;
  deviceId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  expiresAt: string;
  createdAt: string;
}

export const privacyApi = {
  async setDisappearingMessages(
    conversationId: string,
    timeoutSeconds: number | null,
  ): Promise<void> {
    let timeout: '24h' | '7d' | '90d' | 'off' = 'off';
    if (timeoutSeconds === 86400) timeout = '24h';
    else if (timeoutSeconds === 604800) timeout = '7d';
    else if (timeoutSeconds === 7776000) timeout = '90d';
    else if (timeoutSeconds && timeoutSeconds > 0) timeout = '24h';

    await api.post(`/privacy/disappearing-messages/${conversationId}`, {
      timeout,
    });
  },

  async getSessions(): Promise<AuthSessionItem[]> {
    const res = await api.get('/privacy/sessions');
    const data = unwrapData<AuthSessionItem[]>(res.data);
    return Array.isArray(data) ? data : [];
  },

  async revokeSession(sessionId: string): Promise<void> {
    await api.delete(`/privacy/sessions/${sessionId}`);
  },

  async revokeAllOtherSessions(): Promise<void> {
    await api.delete('/privacy/sessions');
  },
};

export interface StorageConversationUsage {
  conversationId: string;
  name?: string;
  totalBytes: number;
  mediaCount: number;
}

export const settingsApi = {
  async getNotifications(): Promise<Array<{ conversationId: string; isMuted: boolean; mutedUntil?: string | null }>> {
    const res = await api.get('/settings/notifications');
    const data = unwrapData<Array<{ conversationId: string; isMuted: boolean; mutedUntil?: string | null }>>(res.data);
    return Array.isArray(data) ? data : [];
  },

  async updateConversationNotifications(
    conversationId: string,
    payload: { isMuted?: boolean; muted?: boolean; mutedUntil?: string | null },
  ): Promise<void> {
    await api.patch(`/settings/notifications/${conversationId}`, {
      isMuted: payload.isMuted ?? payload.muted,
      mutedUntil: payload.mutedUntil,
    });
  },

  async getStorageUsage(): Promise<{ totalBytes: number; conversations: StorageConversationUsage[] }> {
    const res = await api.get('/settings/storage');
    return unwrapData<{ totalBytes: number; conversations: StorageConversationUsage[] }>(res.data);
  },

  async clearConversationMedia(conversationId: string): Promise<void> {
    await api.delete(`/settings/storage/${conversationId}`);
  },

  async triggerBackup(): Promise<{ backupId?: string; timestamp: string }> {
    const res = await api.post('/settings/backup');
    return unwrapData<{ backupId?: string; timestamp: string }>(res.data);
  },
};

export const reportsApi = {
  async submitReport(payload: {
    reportedUserId: string;
    reason: string;
    description?: string;
    messageId?: string;
  }): Promise<void> {
    await api.post('/reports', payload);
  },
};

export const callsApi = {
  async getHistory(): Promise<Call[]> {
    const res = await api.get('/calls/history');
    const data = unwrapData<Call[] | { items?: Call[]; calls?: Call[] }>(res.data);
    if (Array.isArray(data)) return data;
    return data?.items || data?.calls || [];
  },
};

// Admin Dashboard API (Strictly metadata — never accesses private plaintext messages)
export interface AdminStats {
  totalUsers: number;
  activeUsers: number;
  newRegistrationsToday: number;
  activeConversations: number;
  totalGroups: number;
  pendingReports: number;
  messagesToday: number;
  storageUsedBytes: number;
  registrationSeries?: Array<{ date: string; count: number }>;
  messageVolumeSeries?: Array<{ date: string; count: number }>;
}

export interface AdminUserItem extends User {
  _count?: {
    sentMessages?: number;
    conversationMembers?: number;
  };
}

export interface AdminReportItem {
  id: string;
  reporterId: string;
  reportedUserId: string;
  reportedMessageId?: string | null;
  reason: string;
  description?: string | null;
  status: 'PENDING' | 'REVIEWED' | 'RESOLVED' | 'DISMISSED';
  reviewedBy?: string | null;
  reviewedAt?: string | null;
  createdAt: string;
  reporter?: Partial<User>;
  reportedUser?: Partial<User>;
}

export interface AdminAuditLog {
  id: string;
  actorId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown> | null;
  ipAddress?: string | null;
  createdAt: string;
  actor?: Partial<User>;
}

export interface AdminHealthStatus {
  status: 'healthy' | 'degraded' | 'down';
  database: { status: string; latencyMs?: number };
  redis: { status: string; latencyMs?: number };
  storage: { status: string; bucket?: string };
  uptimeSeconds?: number;
}

export const adminApi = {
  async getStats(): Promise<AdminStats> {
    const res = await api.get('/admin/stats');
    return unwrapData<AdminStats>(res.data);
  },

  async getHealth(): Promise<AdminHealthStatus> {
    const res = await api.get('/admin/health');
    return unwrapData<AdminHealthStatus>(res.data);
  },

  async getStorage(): Promise<{ totalBytes: number; breakdown?: Record<string, number> }> {
    const res = await api.get('/admin/storage');
    return unwrapData<{ totalBytes: number; breakdown?: Record<string, number> }>(res.data);
  },

  async getUsers(params: { search?: string; status?: string; page?: number; limit?: number }): Promise<{
    users: AdminUserItem[];
    total: number;
  }> {
    const query: Record<string, unknown> = {
      search: params.search || undefined,
      page: params.page || 1,
      limit: params.limit || 20,
    };
    if (params.status === 'active') {
      query.isActive = true;
      query.isBanned = false;
    } else if (params.status === 'suspended') {
      query.isBanned = true;
    } else if (params.status === 'admin') {
      query.role = 'ADMIN';
    }
    const res = await api.get('/admin/users', { params: query });
    const data = unwrapData<AdminUserItem[] | { items?: AdminUserItem[]; users?: AdminUserItem[]; total?: number }>(res.data);
    if (Array.isArray(data)) return { users: data, total: data.length };
    const users = data.users || data.items || [];
    return { users, total: data.total ?? users.length };
  },

  async suspendUser(userId: string, reason: string): Promise<void> {
    await api.post(`/admin/users/${userId}/suspend`, { reason });
  },

  async restoreUser(userId: string): Promise<void> {
    await api.post(`/admin/users/${userId}/restore`);
  },

  async deleteUser(userId: string): Promise<void> {
    await api.delete(`/admin/users/${userId}`);
  },

  async getReports(params: { status?: string; page?: number; limit?: number }): Promise<{
    reports: AdminReportItem[];
    total: number;
  }> {
    const res = await api.get('/admin/reports', { params });
    const data = unwrapData<AdminReportItem[] | { items?: AdminReportItem[]; reports?: AdminReportItem[]; total?: number }>(res.data);
    if (Array.isArray(data)) return { reports: data, total: data.length };
    const reports = data.reports || data.items || [];
    return { reports, total: data.total ?? reports.length };
  },

  async updateReportStatus(
    reportId: string,
    status: 'REVIEWED' | 'RESOLVED' | 'DISMISSED',
    notes?: string,
  ): Promise<void> {
    await api.patch(`/admin/reports/${reportId}`, { status, notes });
  },

  async getAuditLogs(params: { action?: string; entityType?: string; page?: number; limit?: number }): Promise<{
    logs: AdminAuditLog[];
    total: number;
  }> {
    const res = await api.get('/admin/audit-logs', { params });
    const data = unwrapData<AdminAuditLog[] | { items?: AdminAuditLog[]; logs?: AdminAuditLog[]; total?: number }>(res.data);
    if (Array.isArray(data)) return { logs: data, total: data.length };
    const logs = data.logs || data.items || [];
    return { logs, total: data.total ?? logs.length };
  },

  async updateConfig(key: string, value: Record<string, unknown>): Promise<void> {
    await api.post('/admin/config', { key, value });
  },
};
