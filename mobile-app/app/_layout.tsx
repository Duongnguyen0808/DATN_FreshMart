import React, { useEffect } from 'react';
import { Stack, useRouter, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { AuthProvider, useAuth } from '../src/contexts/auth-context';
import { loadUserPreferences } from '../src/services/preferences.service';
import { ensureNotificationPermissions } from '../src/services/notification.service';
import { useRealtimeSync } from '../src/services/realtime.service';
import { ToastProvider } from '../src/components/ui/Toast';
import { AppDialogProvider } from '../src/components/ui/AppDialog';
import { ActivityIndicator, Platform, View } from 'react-native';
import { Colors } from '../src/constants/theme';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 60,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  },
});

function RootNavigation() {
  const { isAuthenticated, isLoading } = useAuth();
  const segments = useSegments();
  const router = useRouter();

  // Active realtime socket sync throughout the app
  useRealtimeSync();

  useEffect(() => {
    void loadUserPreferences();
    void ensureNotificationPermissions();

    if (Platform.OS === 'web') return;

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const targetRoute = response.notification.request.content.data?.route;
      if (typeof targetRoute === 'string' && targetRoute.startsWith('/')) {
        router.push(targetRoute as any);
      }
    });
    return () => sub.remove();
  }, [router]);

  useEffect(() => {
    if (isLoading) return;

    const inAuthGroup = segments[0] === '(auth)';

    if (!isAuthenticated && !inAuthGroup) {
      router.replace('/(auth)/login');
    } else if (isAuthenticated && inAuthGroup) {
      router.replace('/(tabs)');
    }
  }, [isAuthenticated, isLoading, segments, router]);

  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: Colors.background }}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="(auth)" options={{ headerShown: false }} />
      <Stack.Screen name="ops/checklist" options={{ headerShown: false }} />
      <Stack.Screen name="ops/quick-stocktake" options={{ headerShown: false }} />
      <Stack.Screen name="ops/incident" options={{ headerShown: false }} />
      <Stack.Screen name="ops/activity" options={{ headerShown: false }} />
      <Stack.Screen
        name="notifications/index"
        options={{
          headerShown: false,
          presentation: 'modal',
        }}
      />
    </Stack>
  );
}

export default function RootLayout() {
  const appTree = (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <ToastProvider>
            <AppDialogProvider>
              <StatusBar style="dark" />
              <RootNavigation />
            </AppDialogProvider>
          </ToastProvider>
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );

  if (Platform.OS === 'web') {
    return (
      <View
        style={{
          flex: 1,
          backgroundColor: '#e2ece9',
          alignItems: 'center',
          justifyContent: 'center',
          paddingVertical: 16,
        }}
      >
        <View
          style={{
            flex: 1,
            width: '100%',
            maxWidth: 430,
            maxHeight: 880,
            backgroundColor: Colors.background,
            borderRadius: 32,
            overflow: 'hidden',
            borderWidth: 6,
            borderColor: '#0f2928',
            boxShadow: '0 24px 60px rgba(15, 41, 40, 0.22)' as any,
          }}
        >
          {appTree}
        </View>
      </View>
    );
  }

  return appTree;
}
