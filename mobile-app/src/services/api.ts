import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { getStorageItem, setStorageItem, deleteStorageItem } from '../utils/storage';

/**
 * Tự động nhận diện IP LAN hiện tại của laptop đang chạy Expo Metro.
 * Khi đổi Wi-Fi ở nhà, ở trường hay phát 4G Hotspot, app tự động trỏ đúng về
 * http://<IP_MỚI_CỦA_LAPTOP>:4000/api/v1 mà không cần nhập tay.
 * Khi xem trên trình duyệt web (PC), tự động dùng http://localhost:4000/api/v1.
 */
function detectExpoHostBackendUrl(): string | null {
  if (Platform.OS === 'web') {
    return 'http://localhost:4000/api/v1';
  }
  try {
    const hostUri =
      Constants.expoConfig?.hostUri ||
      (Constants.manifest2 as any)?.extra?.expoGo?.debuggerHost ||
      (Constants.manifest as any)?.debuggerHost;
    if (typeof hostUri === 'string' && hostUri.length > 0) {
      const host = hostUri.split(':')[0];
      if (host && host !== 'localhost' && host !== '127.0.0.1') {
        return `http://${host}:4000/api/v1`;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

export const CLOUD_API_URL = 'https://freshmart-iot.store/api/v1';
export const DEFAULT_API_URL = CLOUD_API_URL;

const TOKEN_KEY = 'freshmart_access_token';
const REFRESH_TOKEN_KEY = 'freshmart_refresh_token';
const USER_KEY = 'freshmart_user_data';
const BASE_URL_KEY = 'freshmart_api_base_url';
const ACTIVE_STORE_KEY = 'freshmart_active_store_id';

let currentBaseUrl = DEFAULT_API_URL;
let onUnauthorizedCallback: (() => void) | null = null;

export function setUnauthorizedHandler(callback: () => void) {
  onUnauthorizedCallback = callback;
}

export async function initApiConfig(): Promise<string> {
  try {
    const saved = await getStorageItem(BASE_URL_KEY);
    const isStaleLocalLan =
      !saved ||
      /^http:\/\/(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.|26\.)/.test(saved);

    if (isStaleLocalLan) {
      currentBaseUrl = CLOUD_API_URL;
      await setStorageItem(BASE_URL_KEY, CLOUD_API_URL);
    } else {
      currentBaseUrl = saved;
    }
  } catch (err) {
    console.warn('Could not read saved API base URL', err);
  }
  return currentBaseUrl;
}

export async function setApiBaseUrl(url: string): Promise<void> {
  const cleaned = url.trim().replace(/\/+$/, '');
  currentBaseUrl = cleaned;
  await setStorageItem(BASE_URL_KEY, cleaned);
}

export function getApiBaseUrl(): string {
  return currentBaseUrl;
}

export async function getStoredTokens(): Promise<{ accessToken: string | null; refreshToken: string | null }> {
  try {
    const [accessToken, refreshToken] = await Promise.all([
      getStorageItem(TOKEN_KEY),
      getStorageItem(REFRESH_TOKEN_KEY),
    ]);
    return { accessToken, refreshToken };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
}

export async function saveAuthTokens(accessToken: string, refreshToken: string): Promise<void> {
  await Promise.all([
    setStorageItem(TOKEN_KEY, accessToken),
    setStorageItem(REFRESH_TOKEN_KEY, refreshToken),
  ]);
}

export async function clearAuthTokens(): Promise<void> {
  await Promise.all([
    deleteStorageItem(TOKEN_KEY),
    deleteStorageItem(REFRESH_TOKEN_KEY),
    deleteStorageItem(USER_KEY),
  ]);
}

export async function saveActiveStoreId(storeId: string): Promise<void> {
  await setStorageItem(ACTIVE_STORE_KEY, storeId);
}

export async function getActiveStoreId(): Promise<string | null> {
  return await getStorageItem(ACTIVE_STORE_KEY);
}

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

async function refreshAccessToken(): Promise<string | null> {
  try {
    const refreshToken = await getStorageItem(REFRESH_TOKEN_KEY);
    if (!refreshToken) return null;

    const response = await fetch(`${currentBaseUrl}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client: 'mobile', refreshToken }),
    });

    if (!response.ok) {
      await clearAuthTokens();
      if (onUnauthorizedCallback) onUnauthorizedCallback();
      return null;
    }

    const json = await response.json();
    if (json.success && json.data?.accessToken) {
      await saveAuthTokens(json.data.accessToken, json.data.refreshToken || refreshToken);
      return json.data.accessToken;
    }
    return null;
  } catch {
    return null;
  }
}

export async function apiClient<T>(
  endpoint: string,
  options: RequestInit = {},
  isRetry = false
): Promise<T> {
  const { accessToken } = await getStoredTokens();
  const activeStoreId = await getActiveStoreId();

  const url = endpoint.startsWith('http')
    ? endpoint
    : `${currentBaseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  // Include active store scope header if available
  if (activeStoreId && !headers['X-Store-Id']) {
    headers['X-Store-Id'] = activeStoreId;
  }

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    // Handle 401 Unauthenticated with automatic token refresh
    if (response.status === 401 && !isRetry) {
      const newToken = await refreshAccessToken();
      if (newToken) {
        return apiClient<T>(endpoint, options, true);
      }
      throw new ApiError('Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.', 401, 'UNAUTHENTICATED');
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMsg = data?.message || `Yêu cầu thất bại (${response.status})`;
      throw new ApiError(errorMsg, response.status, data?.code);
    }

    // Backend format is { success: boolean, message: string, data: T }
    return data?.data !== undefined ? (data.data as T) : (data as T);
  } catch (error: any) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.message || 'Không thể kết nối đến máy chủ.', 0, 'NETWORK_ERROR');
  }
}
