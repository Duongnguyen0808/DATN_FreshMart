import { apiClient } from './api';
import { DashboardSummary } from '../types';
import { fetchIoTMonitorData } from './iot.service';
import { fetchFefoRiskAlertsResult, fetchShortageAlertsResult } from './alerts.service';
import {
  DailyChecklistResponse,
  fetchDailyChecklist,
  fetchPersonalActivities,
  PersonalActivityRecord,
} from './mobile-ops.service';

export type RevenueStatus = 'ok' | 'error' | 'no_permission' | 'no_store';

export interface DashboardSummaryV2 extends DashboardSummary {
  updatedAt: string;
  revenueStatus: RevenueStatus;
  revenueError: boolean;
  revenueErrorMessage?: string;
  alertsError: boolean;
  iotError: boolean;
  checklist: DailyChecklistResponse | null;
  checklistError: boolean;
  recentActivities: PersonalActivityRecord[];
}

export async function fetchDashboardSummary(
  storeId?: string,
  canViewRevenue = false
): Promise<DashboardSummaryV2> {
  const updatedAt = new Date().toISOString();
  const queryParam = storeId ? `?period=7&storeId=${encodeURIComponent(storeId)}` : '?period=7';

  const [dashboardRes, shortagesRes, fefoRes, iotRes, checklistRes, activitiesRes] =
    await Promise.allSettled([
      canViewRevenue && storeId ? apiClient<any>(`/dashboard${queryParam}`) : Promise.resolve(null),
      fetchShortageAlertsResult(storeId),
      fetchFefoRiskAlertsResult(storeId),
      fetchIoTMonitorData(storeId),
      storeId ? fetchDailyChecklist(storeId) : Promise.resolve(null),
      fetchPersonalActivities('7d'),
    ]);

  let todayRevenue = 0;
  let todayInvoices = 0;
  let revenueStatus: RevenueStatus = 'ok';
  let revenueError = false;
  let revenueErrorMessage: string | undefined;

  if (!canViewRevenue) {
    revenueStatus = 'no_permission';
  } else if (!storeId) {
    revenueStatus = 'no_store';
  } else if (dashboardRes.status === 'fulfilled' && dashboardRes.value) {
    const val = dashboardRes.value;
    todayRevenue = Number(val.summary?.revenue ?? val.revenue ?? val.todayRevenue ?? 0);
    todayInvoices = Number(val.summary?.invoiceCount ?? val.invoices ?? val.todayInvoices ?? 0);
    revenueStatus = 'ok';
  } else if (dashboardRes.status === 'rejected') {
    revenueStatus = 'error';
    revenueError = true;
    revenueErrorMessage = dashboardRes.reason?.message || 'Không thể tải dữ liệu doanh thu.';
  }

  let shortageAlertCount = 0;
  let fefoAlertCount = 0;
  let alertsError = false;

  if (shortagesRes.status === 'fulfilled') {
    shortageAlertCount = shortagesRes.value.items.length;
    if (shortagesRes.value.hasError) alertsError = true;
  } else {
    alertsError = true;
  }

  if (fefoRes.status === 'fulfilled') {
    fefoAlertCount = fefoRes.value.items.length;
    if (fefoRes.value.hasError) alertsError = true;
  } else {
    alertsError = true;
  }

  let iotOnlineCount = 0;
  let iotTotalCount = 0;
  let iotError = false;
  if (iotRes.status === 'fulfilled') {
    iotOnlineCount = iotRes.value.onlineCount;
    iotTotalCount = iotRes.value.totalCount;
    iotError = iotRes.value.hasError;
  } else {
    iotError = true;
  }

  const checklist = checklistRes.status === 'fulfilled' ? checklistRes.value : null;
  const checklistError = checklistRes.status === 'rejected';
  const recentActivities =
    activitiesRes.status === 'fulfilled' ? activitiesRes.value.slice(0, 5) : [];

  const pendingTasks: DashboardSummary['pendingTasks'] = [];

  if (!alertsError && fefoAlertCount > 0) {
    pendingTasks.push({
      id: 'task-fefo',
      title: 'Kiểm tra lô hàng cận hạn',
      subtitle: `${fefoAlertCount} lô cần ưu tiên xử lý`,
      badge: `${fefoAlertCount} lô`,
      type: 'fefo',
      targetTab: 'alerts',
    });
  }

  if (!alertsError && shortageAlertCount > 0) {
    pendingTasks.push({
      id: 'task-shortage',
      title: 'Cảnh báo thiếu hàng AI',
      subtitle: `${shortageAlertCount} SKU dưới ngưỡng an toàn`,
      badge: `${shortageAlertCount} SKU`,
      type: 'shortage',
      targetTab: 'alerts',
    });
  }

  if (!iotError && iotTotalCount > 0 && iotOnlineCount < iotTotalCount) {
    pendingTasks.push({
      id: 'task-iot-offline',
      title: 'Thiết bị IoT ngoại tuyến',
      subtitle: `${iotTotalCount - iotOnlineCount}/${iotTotalCount} thiết bị mất kết nối`,
      badge: 'IoT',
      type: 'iot',
      targetTab: 'iot',
    });
  }

  return {
    todayRevenue,
    todayInvoices,
    fefoAlertCount,
    shortageAlertCount,
    iotOnlineCount,
    iotTotalCount,
    pendingTasks,
    updatedAt,
    revenueStatus,
    revenueError,
    revenueErrorMessage,
    alertsError,
    iotError,
    checklist,
    checklistError,
    recentActivities,
  };
}
