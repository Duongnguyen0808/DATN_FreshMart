const baseUrl = (process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000/api/v1').replace(/\/$/, '');
type ApiResponse<T> = { success: boolean; message: string; data: T; code?: string };

export async function apiGet<T>(path: string): Promise<T> {
  const response = await fetch(`${baseUrl}/${path.replace(/^\//, '')}`, {
    cache: 'no-store', signal: AbortSignal.timeout(10000),
  });
  const body = await response.json() as ApiResponse<T>;
  if (!response.ok || !body.success) throw new Error(body.message || 'Không thể kết nối hệ thống');
  return body.data;
}
