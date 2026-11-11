import React, { useEffect, useRef } from 'react';
import { ActivityIndicator, AppState, AppStateStatus, View } from 'react-native';
import {
  DarkTheme,
  DefaultTheme,
  NavigationContainer,
  NavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { CallType } from '@whatsapp-pro/shared-types';

import { RootStackParamList, MainTabParamList } from './src/types/mobile.types';
import { ThemeProvider, useTheme } from './src/theme/colors';
import { useAuthStore } from './src/stores/authStore';
import { useChatStore } from './src/stores/chatStore';
import { useCallStore } from './src/stores/callStore';
import notificationsService from './src/services/notifications';
import socketService from './src/services/socket';

import { WelcomeScreen } from './src/screens/auth/WelcomeScreen';
import { PhoneRegisterScreen } from './src/screens/auth/PhoneRegisterScreen';
import { OtpVerifyScreen } from './src/screens/auth/OtpVerifyScreen';
import { ProfileSetupScreen } from './src/screens/auth/ProfileSetupScreen';
import { TwoFactorPinScreen } from './src/screens/auth/TwoFactorPinScreen';
import { BiometricLockOverlay } from './src/screens/auth/BiometricLockOverlay';

import { ChatsListScreen } from './src/screens/chats/ChatsListScreen';
import { ChatRoomScreen } from './src/screens/chats/ChatRoomScreen';
import { UpdatesScreen } from './src/screens/updates/UpdatesScreen';
import { StatusViewerScreen } from './src/screens/updates/StatusViewerScreen';
import { CommunitiesScreen } from './src/screens/communities/CommunitiesScreen';
import { GroupInfoScreen } from './src/screens/communities/GroupInfoScreen';
import { CallsScreen } from './src/screens/calls/CallsScreen';
import { ActiveCallScreen } from './src/screens/calls/ActiveCallScreen';
import { IncomingCallScreen } from './src/screens/calls/IncomingCallScreen';

import { SettingsScreen } from './src/screens/settings/SettingsScreen';
import { AccountSettingsScreen } from './src/screens/settings/AccountSettingsScreen';
import { PrivacySettingsScreen } from './src/screens/settings/PrivacySettingsScreen';
import { ChatSettingsScreen } from './src/screens/settings/ChatSettingsScreen';
import { NotificationSettingsScreen } from './src/screens/settings/NotificationSettingsScreen';
import { StorageSettingsScreen } from './src/screens/settings/StorageSettingsScreen';
import { LinkedDevicesScreen } from './src/screens/settings/LinkedDevicesScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();
const Tab = createBottomTabNavigator<MainTabParamList>();

function MainTabs() {
  const theme = useTheme();
  const totalUnread = useChatStore((s) =>
    s.conversations.reduce((acc, c) => acc + (c.isArchived ? 0 : c.unreadCount || 0), 0),
  );

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: theme.headerBg },
        headerTintColor: theme.headerText,
        headerTitleStyle: { fontWeight: '700' },
        tabBarStyle: {
          backgroundColor: theme.tabBarBg,
          borderTopColor: theme.border,
        },
        tabBarActiveTintColor: theme.primary,
        tabBarInactiveTintColor: theme.tabBarInactive,
        tabBarIcon: ({ color, size, focused }) => {
          let iconName: keyof typeof Ionicons.glyphMap = 'chatbubbles';
          if (route.name === 'Chats') iconName = focused ? 'chatbubbles' : 'chatbubbles-outline';
          else if (route.name === 'Updates') iconName = focused ? 'radio-button-on' : 'radio-button-off';
          else if (route.name === 'Communities') iconName = focused ? 'people' : 'people-outline';
          else if (route.name === 'Calls') iconName = focused ? 'call' : 'call-outline';
          else if (route.name === 'Settings') iconName = focused ? 'settings' : 'settings-outline';
          return <Ionicons name={iconName} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen
        name="Chats"
        component={ChatsListScreen}
        options={{
          title: 'WhatsApp Pro',
          tabBarLabel: 'Chats',
          tabBarBadge: totalUnread > 0 ? (totalUnread > 99 ? '99+' : totalUnread) : undefined,
        }}
      />
      <Tab.Screen name="Updates" component={UpdatesScreen} options={{ title: 'Updates' }} />
      <Tab.Screen
        name="Communities"
        component={CommunitiesScreen}
        options={{ title: 'Communities' }}
      />
      <Tab.Screen name="Calls" component={CallsScreen} options={{ title: 'Calls' }} />
      <Tab.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
    </Tab.Navigator>
  );
}

function RootNavigator() {
  const theme = useTheme();
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>(null);
  const { isAuthenticated, isBootstrapping, needsProfileSetup, bootstrap, lockIfEnabled } =
    useAuthStore();
  const bindChatListeners = useChatStore((s) => s.bindSocketListeners);
  const bindCallListeners = useCallStore((s) => s.bindSocketListeners);
  const setIncomingCall = useCallStore((s) => s.setIncomingCall);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const unbindChat = bindChatListeners();
    const unbindCall = bindCallListeners();
    const unbindNotifs = notificationsService.setupListeners((data) => {
      if (data.callId) {
        setIncomingCall({
          callId: data.callId,
          callerId: '',
          callerName: data.callerName || 'Incoming Call',
          conversationId: data.conversationId,
          callType: data.callType || CallType.AUDIO,
        });
      }
    });

    return () => {
      unbindChat();
      unbindCall();
      unbindNotifs();
    };
  }, [isAuthenticated, bindChatListeners, bindCallListeners, setIncomingCall]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      if (nextState === 'background') {
        lockIfEnabled();
      } else if (nextState === 'active' && isAuthenticated) {
        socketService.connect().catch(() => {});
        const chatState = useChatStore.getState();
        chatState.fetchConversations(true, true).catch(() => {});
        if (chatState.activeConversationId) {
          chatState.fetchMessages(chatState.activeConversationId, false, true).catch(() => {});
        }
      }
    });
    return () => sub.remove();
  }, [isAuthenticated, lockIfEnabled]);

  if (isBootstrapping) {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: theme.background,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <ActivityIndicator size="large" color={theme.primary} />
      </View>
    );
  }

  const navTheme = theme.isDark
    ? {
        ...DarkTheme,
        colors: {
          ...DarkTheme.colors,
          background: theme.background,
          card: theme.headerBg,
          text: theme.text,
          border: theme.border,
          primary: theme.primary,
        },
      }
    : {
        ...DefaultTheme,
        colors: {
          ...DefaultTheme.colors,
          background: theme.background,
          card: theme.headerBg,
          text: theme.text,
          border: theme.border,
          primary: theme.primary,
        },
      };

  return (
    <>
      <StatusBar style={theme.isDark ? 'light' : 'light'} />
      <NavigationContainer
        ref={navigationRef}
        theme={navTheme}
        onReady={() => notificationsService.setNavigationRef(navigationRef.current)}
      >
        <Stack.Navigator
          screenOptions={{
            headerStyle: { backgroundColor: theme.headerBg },
            headerTintColor: theme.headerText,
          }}
        >
          {!isAuthenticated ? (
            <>
              <Stack.Screen name="Welcome" component={WelcomeScreen} options={{ headerShown: false }} />
              <Stack.Screen
                name="PhoneRegister"
                component={PhoneRegisterScreen}
                options={{ title: 'Verify Phone' }}
              />
              <Stack.Screen
                name="OtpVerify"
                component={OtpVerifyScreen}
                options={{ title: 'Enter Code' }}
              />
              <Stack.Screen
                name="TwoFactorPin"
                component={TwoFactorPinScreen}
                options={{ title: 'Two-Step Verification' }}
              />
              <Stack.Screen
                name="ProfileSetup"
                component={ProfileSetupScreen}
                options={{ title: 'Profile Info' }}
              />
            </>
          ) : needsProfileSetup ? (
            <Stack.Screen
              name="ProfileSetup"
              component={ProfileSetupScreen}
              initialParams={{ isOnboarding: true }}
              options={{ title: 'Profile Setup', headerBackVisible: false }}
            />
          ) : (
            <>
              <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
              <Stack.Screen name="ChatRoom" component={ChatRoomScreen} options={{ title: 'Chat' }} />
              <Stack.Screen
                name="ActiveCall"
                component={ActiveCallScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="GroupInfo"
                component={GroupInfoScreen}
                options={{ title: 'Group Info' }}
              />
              <Stack.Screen
                name="StatusViewer"
                component={StatusViewerScreen}
                options={{ headerShown: false }}
              />
              <Stack.Screen
                name="ProfileSetup"
                component={ProfileSetupScreen}
                options={{ title: 'Edit Profile' }}
              />
              <Stack.Screen
                name="TwoFactorPin"
                component={TwoFactorPinScreen}
                options={{ title: 'Two-Step Verification' }}
              />
              <Stack.Screen
                name="AccountSettings"
                component={AccountSettingsScreen}
                options={{ title: 'Account' }}
              />
              <Stack.Screen
                name="PrivacySettings"
                component={PrivacySettingsScreen}
                options={{ title: 'Privacy' }}
              />
              <Stack.Screen
                name="ChatSettings"
                component={ChatSettingsScreen}
                options={{ title: 'Chats' }}
              />
              <Stack.Screen
                name="NotificationSettings"
                component={NotificationSettingsScreen}
                options={{ title: 'Notifications' }}
              />
              <Stack.Screen
                name="StorageSettings"
                component={StorageSettingsScreen}
                options={{ title: 'Storage and Data' }}
              />
              <Stack.Screen
                name="LinkedDevices"
                component={LinkedDevicesScreen}
                options={{ title: 'Linked Devices' }}
              />
            </>
          )}
        </Stack.Navigator>
      </NavigationContainer>

      <IncomingCallScreen
        onAccepted={(params) => {
          if (navigationRef.current?.isReady()) {
            navigationRef.current.navigate('ActiveCall', {
              callId: params.callId,
              conversationId: params.conversationId ?? undefined,
              callType: params.callType,
              peerName: params.peerName,
              peerAvatar: params.peerAvatar,
              isCaller: false,
            });
          }
        }}
      />
      <BiometricLockOverlay />
    </>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <RootNavigator />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
