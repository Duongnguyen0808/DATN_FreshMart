export type Store = { id: string; code: string; name: string; active: boolean };
export type User = { id: string; email: string; name: string; active: boolean; globalAccess: boolean; roles: { id: string; code: string; name: string }[]; permissions: string[]; stores: Store[] };
export type Role = { id: string; code: string; name: string; system: boolean; permissions: { permissionCode: string }[]; _count: { users: number } };
export type Permission = { code: string; name: string };

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const base = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
let accessToken: string | null = null;
export const getAccessToken = () => accessToken;
let refreshing: Promise<User> | null = null;

async function request<T>(path: string, method: string, body?: unknown, token = accessToken, timeoutMs = 10000): Promise<T> {
  const response = await fetch(`${base}/${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    signal: AbortSignal.timeout(timeoutMs),
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok || !result.success) throw new ApiError(response.status, result.message ?? 'Yêu cầu không thành công.');
  return result.data as T;
}

export async function login(email: string, password: string) {
  const data = await request<{ accessToken: string; user: User }>('auth/login', 'POST', { email, password, client: 'web' }, null);
  accessToken = data.accessToken;
  return data.user;
}

export function refreshSession(): Promise<User> {
  if (!refreshing) {
    const refresh = async () => {
      const data = await request<{ accessToken: string; user: User }>('auth/refresh', 'POST', { client: 'web' }, null);
      accessToken = data.accessToken;
      return data.user;
    };
    const locked = typeof navigator !== 'undefined' && navigator.locks ? navigator.locks.request('smart-store-refresh', refresh) : refresh();
    refreshing = locked.finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api<T>(path: string, method = 'GET', body?: unknown, timeoutMs = 10000): Promise<T> {
  try {
    return await request<T>(path, method, body, accessToken, timeoutMs);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    try {
      await refreshSession();
    } catch (refreshError) {
      if (refreshError instanceof ApiError && refreshError.status === 401) {
        accessToken = null;
        window.dispatchEvent(new Event('session-expired'));
      }
      throw refreshError;
    }
    return request<T>(path, method, body, accessToken, timeoutMs);
  }
}

export async function logout() {
  await api('auth/logout', 'POST', {});
  accessToken = null;
}

export function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
    return 'Kết nối tới máy chủ hoặc dịch vụ lưu ảnh quá chậm. Vui lòng thử lại.';
  }
  return 'Không kết nối được máy chủ. Vui lòng thử lại.';
}
