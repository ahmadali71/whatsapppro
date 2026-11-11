import React, { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { UserRole } from '@whatsapp-pro/shared-types';
import { useAuthStore } from '@/stores/authStore';
import { useThemeStore } from '@/stores/themeStore';
import { ToastContainer } from '@/components/common/ToastContainer';
import { AppShell } from '@/components/layout/AppShell';
import { AuthPage } from '@/pages/auth/AuthPage';
import { ChatsPage } from '@/pages/chat/ChatsPage';
import { StatusPage } from '@/pages/status/StatusPage';
import { CommunitiesPage } from '@/pages/communities/CommunitiesPage';
import { JoinInvitePage } from '@/pages/groups/JoinInvitePage';
import { CallsPage } from '@/pages/calls/CallsPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { AdminDashboardPage } from '@/pages/admin/AdminDashboardPage';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isAuthenticated, isInitialized } = useAuthStore();

  if (!isInitialized) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#f0f2f5] dark:bg-[#111b21]">
        <div className="w-14 h-14 rounded-2xl bg-[#25D366] flex items-center justify-center text-white font-bold text-2xl shadow-lg animate-pulse mb-4">
          W
        </div>
        <p className="text-sm text-[#667781] dark:text-[#8696a0]">Connecting to WhatsApp Pro...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return <AppShell>{children}</AppShell>;
};

const AdminRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuthStore();
  if (user?.role !== UserRole.ADMIN) {
    return (
      <ProtectedRoute>
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">403 · Forbidden</h1>
          <p className="text-sm text-[#667781] dark:text-[#8696a0]">
            Administrator privileges are required to access this route.
          </p>
        </div>
      </ProtectedRoute>
    );
  }
  return <ProtectedRoute>{children}</ProtectedRoute>;
};

export function App() {
  const { initializeAuth } = useAuthStore();
  const { applyThemeToDom } = useThemeStore();

  useEffect(() => {
    applyThemeToDom();
    void initializeAuth();

    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const handleChange = () => applyThemeToDom();
    mq?.addEventListener?.('change', handleChange);
    return () => mq?.removeEventListener?.('change', handleChange);
  }, [initializeAuth, applyThemeToDom]);

  return (
    <>
      <ToastContainer />
      <Routes>
        {/* Auth & Onboarding Routes */}
        <Route path="/auth" element={<AuthPage initialStep="welcome" />} />
        <Route path="/login" element={<AuthPage initialStep="phone" />} />
        <Route path="/verify" element={<AuthPage initialStep="otp" />} />
        <Route path="/onboarding" element={<AuthPage initialStep="profile" />} />

        {/* Main Workspace Routes */}
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <ChatsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats"
          element={
            <ProtectedRoute>
              <ChatsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/chats/:conversationId"
          element={
            <ProtectedRoute>
              <ChatsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/starred"
          element={
            <ProtectedRoute>
              <ChatsPage showStarredOnly />
            </ProtectedRoute>
          }
        />
        <Route
          path="/archived"
          element={
            <ProtectedRoute>
              <ChatsPage initialFilter="archived" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/status"
          element={
            <ProtectedRoute>
              <StatusPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/communities"
          element={
            <ProtectedRoute>
              <CommunitiesPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/calls"
          element={
            <ProtectedRoute>
              <CallsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute>
              <SettingsPage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/privacy"
          element={
            <ProtectedRoute>
              <SettingsPage initialTab="privacy" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings/profile"
          element={
            <ProtectedRoute>
              <SettingsPage initialTab="account" />
            </ProtectedRoute>
          }
        />
        <Route
          path="/join/:inviteCode"
          element={
            <ProtectedRoute>
              <JoinInvitePage />
            </ProtectedRoute>
          }
        />
        <Route
          path="/invite/:inviteCode"
          element={
            <ProtectedRoute>
              <JoinInvitePage />
            </ProtectedRoute>
          }
        />

        {/* Secure Admin Dashboard */}
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminDashboardPage />
            </AdminRoute>
          }
        />

        {/* Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default App;
