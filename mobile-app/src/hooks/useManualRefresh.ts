import { useCallback, useState } from 'react';

/**
 * Chỉ hiển thị vòng xoay RefreshControl khi người dùng chủ động vuốt xuống (pull-to-refresh).
 * Các lần tự động đồng bộ nền (refetchInterval, Socket.IO, focus) sẽ cập nhật âm thầm,
 * không tự kéo màn hình xuống gây khó chịu.
 */
export function useManualRefresh(refreshFn: () => Promise<unknown> | void) {
  const [refreshing, setRefreshing] = useState(false);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.resolve(refreshFn());
    } finally {
      setRefreshing(false);
    }
  }, [refreshFn]);

  return { refreshing, onRefresh };
}
