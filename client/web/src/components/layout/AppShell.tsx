import React, { useEffect, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  CircleDot,
  Users,
  Phone,
  Settings,
  ShieldCheck,
  Star,
  Archive,
  Sun,
  Moon,
  WifiOff,
  Lock,
} from 'lucide-react';
import { ThemePreference, UserRole } from '@whatsapp-pro/shared-types';
import { useAuthStore } from '@/stores/authStore';
import { useChatStore } from '@/stores/chatStore';
import { useCallStore } from '@/stores/callStore';
import { useThemeStore } from '@/stores/themeStore';
import { socketManager } from '@/lib/socket';
import { Avatar } from '@/components/common/Avatar';
import { CallOverlay } from '@/components/calls/CallOverlay';
import { toast } from '@/stores/toastStore';

interface AppShellProps {
  children: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, requires2FA, is2FAVerified, verify2FA, isLoading } = useAuthStore();
  const { conversations, initSocketListeners } = useChatStore();
  const { initCallSocketListeners } = useCallStore();
  const { resolvedTheme, setTheme } = useThemeStore();

  const [socketConnected, setSocketConnected] = useState(socketManager.isConnected);
  const [httpFallback, setHttpFallback] = useState(socketManager.isHttpFallback);
  const [pinInput, setPinInput] = useState('');

  useEffect(() => {
    const unsubConn = socketManager.onConnectionChange(setSocketConnected);
    const unsubFallback = socketManager.onFallbackChange(setHttpFallback);
    const unsubChat = initSocketListeners();
    const unsubCall = initCallSocketListeners();
    return () => {
      unsubConn();
      unsubFallback();
      unsubChat();
      unsubCall();
    };
  }, [initSocketListeners, initCallSocketListeners]);

  const totalUnread = conversations.reduce((sum, c) => sum + (c.unreadCount || 0), 0);

  const navItems = [
    { to: '/', label: 'Chats', icon: MessageSquare, badge: totalUnread },
    { to: '/status', label: 'Updates', icon: CircleDot },
    { to: '/communities', label: 'Communities', icon: Users },
    { to: '/calls', label: 'Calls', icon: Phone },
  ];

  const isAdmin = user?.role === UserRole.ADMIN;

  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.length !== 6) {
      toast.error('Please enter your 6-digit 2FA PIN');
      return;
    }
    try {
      await verify2FA(pinInput);
      setPinInput('');
      toast.success('Two-step verification unlocked');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Invalid PIN');
    }
  };

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col md:flex-row bg-[#f0f2f5] dark:bg-[#111b21] text-[#111b21] dark:text-[#e9edef]">
      {/* Desktop Left Navigation Rail */}
      <aside className="hidden md:flex flex-col items-center justify-between w-16 py-4 bg-[#f0f2f5] dark:bg-[#202c33] border-r border-gray-200 dark:border-[#2a3942] shrink-0">
        <div className="flex flex-col items-center gap-3 w-full">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="w-10 h-10 rounded-xl bg-[#00A884] text-white font-bold flex items-center justify-center shadow-sm mb-2"
            title="WhatsApp Pro"
          >
            W
          </button>

          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === '/'
                ? location.pathname === '/' || location.pathname.startsWith('/chats')
                : location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                title={item.label}
                className={`relative w-11 h-11 rounded-xl flex items-center justify-center transition ${
                  active
                    ? 'bg-[#00A884]/15 text-[#00A884]'
                    : 'text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/70 dark:hover:bg-[#2a3942]'
                }`}
              >
                <Icon className="w-5 h-5" />
                {item.badge && item.badge > 0 ? (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#25D366] text-white text-[10px] font-bold flex items-center justify-center">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}

          <div className="w-8 h-px bg-gray-200 dark:bg-[#2a3942] my-1" />

          <NavLink
            to="/starred"
            title="Starred Messages"
            className={({ isActive }) =>
              `w-11 h-11 rounded-xl flex items-center justify-center transition ${
                isActive
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/70 dark:hover:bg-[#2a3942]'
              }`
            }
          >
            <Star className="w-5 h-5" />
          </NavLink>

          <NavLink
            to="/archived"
            title="Archived Chats"
            className={({ isActive }) =>
              `w-11 h-11 rounded-xl flex items-center justify-center transition ${
                isActive
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/70 dark:hover:bg-[#2a3942]'
              }`
            }
          >
            <Archive className="w-5 h-5" />
          </NavLink>

          {isAdmin && (
            <NavLink
              to="/admin"
              title="Admin Dashboard"
              className={({ isActive }) =>
                `w-11 h-11 rounded-xl flex items-center justify-center transition ${
                  isActive
                    ? 'bg-amber-500/20 text-amber-500'
                    : 'text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/70 dark:hover:bg-[#2a3942]'
                }`
              }
            >
              <ShieldCheck className="w-5 h-5" />
            </NavLink>
          )}
        </div>

        <div className="flex flex-col items-center gap-3">
          {!socketConnected && (
            <div
              title={
                httpFallback
                  ? 'HTTP sync active (live WebSocket unavailable)'
                  : 'Reconnecting to real-time server...'
              }
              className={
                httpFallback
                  ? 'text-[#667781] dark:text-[#8696a0]'
                  : 'text-amber-500 animate-pulse'
              }
            >
              <WifiOff className="w-4 h-4" />
            </div>
          )}

          <button
            type="button"
            onClick={() =>
              setTheme(resolvedTheme === 'dark' ? ThemePreference.LIGHT : ThemePreference.DARK)
            }
            title="Toggle Light / Dark Mode"
            className="w-11 h-11 rounded-xl flex items-center justify-center text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/70 dark:hover:bg-[#2a3942]"
          >
            {resolvedTheme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
          </button>

          <NavLink
            to="/settings"
            title="Settings"
            className={({ isActive }) =>
              `w-11 h-11 rounded-xl flex items-center justify-center transition ${
                isActive
                  ? 'bg-[#00A884]/15 text-[#00A884]'
                  : 'text-[#54656f] dark:text-[#aebac1] hover:bg-gray-200/70 dark:hover:bg-[#2a3942]'
              }`
            }
          >
            <Settings className="w-5 h-5" />
          </NavLink>

          <button
            type="button"
            onClick={() => navigate('/settings')}
            title={user?.displayName || 'Profile'}
            className="rounded-full ring-2 ring-transparent hover:ring-[#00A884] transition"
          >
            <Avatar src={user?.avatarUrl} name={user?.displayName} size="sm" isOnline={socketConnected} />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 min-w-0 min-h-0 flex flex-col overflow-hidden">{children}</main>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden flex items-center justify-around bg-white dark:bg-[#202c33] border-t border-gray-200 dark:border-[#2a3942] py-1.5 px-2 shrink-0 z-30">
        {[
          ...navItems,
          { to: '/settings', label: 'Settings', icon: Settings, badge: 0 },
        ].map((item) => {
          const Icon = item.icon;
          const active =
            item.to === '/'
              ? location.pathname === '/' || location.pathname.startsWith('/chats')
              : location.pathname.startsWith(item.to);
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-1 rounded-lg text-[11px] font-medium ${
                active ? 'text-[#00A884]' : 'text-[#667781] dark:text-[#8696a0]'
              }`}
            >
              <Icon className="w-5 h-5" />
              <span>{item.label}</span>
              {item.badge && item.badge > 0 ? (
                <span className="absolute top-0 right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-[#25D366] text-white text-[9px] font-bold flex items-center justify-center">
                  {item.badge > 99 ? '99+' : item.badge}
                </span>
              ) : null}
            </NavLink>
          );
        })}
      </nav>

      {/* 2FA PIN Challenge Modal */}
      {requires2FA && !is2FAVerified && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <form
            onSubmit={handleVerify2FA}
            className="bg-white dark:bg-[#202c33] rounded-2xl shadow-2xl p-6 max-w-sm w-full border border-gray-200 dark:border-[#2a3942]"
          >
            <div className="w-12 h-12 rounded-full bg-[#00A884]/15 text-[#00A884] flex items-center justify-center mx-auto mb-4">
              <Lock className="w-6 h-6" />
            </div>
            <h3 className="text-lg font-semibold text-center mb-1">Two-Step Verification</h3>
            <p className="text-xs text-center text-[#667781] dark:text-[#8696a0] mb-5">
              Enter your 6-digit two-step verification PIN to unlock WhatsApp Pro.
            </p>
            <input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value.replace(/\D/g, ''))}
              placeholder="••••••"
              className="w-full text-center tracking-[0.5em] text-2xl font-mono py-3 rounded-xl border border-gray-300 dark:border-[#2a3942] bg-gray-50 dark:bg-[#111b21] focus:outline-none focus:ring-2 focus:ring-[#00A884] mb-4"
              autoFocus
            />
            <button
              type="submit"
              disabled={isLoading || pinInput.length !== 6}
              className="w-full py-2.5 rounded-xl bg-[#00A884] hover:bg-[#008f6f] text-white font-medium text-sm disabled:opacity-50"
            >
              {isLoading ? 'Verifying...' : 'Unlock'}
            </button>
          </form>
        </div>
      )}

      {/* Global Call Overlay */}
      <CallOverlay />
    </div>
  );
};
