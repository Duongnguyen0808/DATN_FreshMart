import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { getCachedPreferences } from './preferences.service';

if (Platform.OS !== 'web') {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: getCachedPreferences().soundEnabled,
      shouldSetBadge: false,
    }),
  });
}

const dispatchedKeys = new Set<string>();

export interface NotificationCapability {
  granted: boolean;
  environment: 'expo-go' | 'standalone-or-dev-build';
  note: string;
}

export async function ensureNotificationPermissions(): Promise<NotificationCapability> {
  if (Platform.OS === 'web') {
    return {
      granted: false,
      environment: 'expo-go',
      note: 'Đang xem chế độ Web Preview trên máy tính (thông báo cục bộ hoạt động trên iOS/Android).',
    };
  }
  const isExpoGo = Constants.appOwnership === 'expo';
  try {
    const existing = await Notifications.getPermissionsAsync();
    let finalStatus = existing.status;
    if (finalStatus !== 'granted') {
      const requested = await Notifications.requestPermissionsAsync();
      finalStatus = requested.status;
    }

    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('freshmart-ops', {
        name: 'Cảnh báo FreshMart Ops',
        importance: Notifications.AndroidImportance.HIGH,
      });
    }

    return {
      granted: finalStatus === 'granted',
      environment: isExpoGo ? 'expo-go' : 'standalone-or-dev-build',
      note: isExpoGo
        ? 'Đang chạy trên Expo Go: hỗ trợ thông báo cục bộ trong phiên (Local Notification). Remote APNs Push khi tắt app yêu cầu Development Build / TestFlight với tài khoản Apple Developer.'
        : 'Sẵn sàng đăng ký APNs Push Token cho iOS.',
    };
  } catch {
    return {
      granted: false,
      environment: isExpoGo ? 'expo-go' : 'standalone-or-dev-build',
      note: 'Không thể yêu cầu quyền thông báo trên thiết bị hiện tại.',
    };
  }
}

export async function dispatchDeduplicatedAlertNotification(params: {
  dedupeKey: string;
  title: string;
  body: string;
  targetRoute: string;
}): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  if (!getCachedPreferences().notificationsEnabled) return false;
  if (dispatchedKeys.has(params.dedupeKey)) return false;

  try {
    const perms = await Notifications.getPermissionsAsync();
    if (perms.status !== 'granted') return false;

    dispatchedKeys.add(params.dedupeKey);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: params.title,
        body: params.body,
        data: { route: params.targetRoute },
        sound: getCachedPreferences().soundEnabled,
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
