import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
  Animated,
  Easing,
  Image,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Typography } from '../../src/constants/theme';
import { Card } from '../../src/components/ui/Card';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { FadeInView, PulseDot, ScalePressable } from '../../src/components/ui/Motion';
import { StorePickerSheet } from '../../src/components/ui/StorePickerSheet';
import { useToast } from '../../src/components/ui/Toast';
import { useAuth } from '../../src/contexts/auth-context';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';
import { fetchDashboardSummary, DashboardSummaryV2 } from '../../src/services/dashboard.service';
import { dispatchDeduplicatedAlertNotification } from '../../src/services/notification.service';
import {
  canViewRevenue as checkCanViewRevenue,
  canCreateStocktake,
  canReportIncident,
  canAccessIoT,
  getRoleDisplayName,
} from '../../src/utils/rbac';
import { Store } from '../../src/types';

const LOGO_IMAGE = require('../../assets/logo.png');

function getGreetingByHour(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Chào buổi sáng';
  if (hour < 18) return 'Chào buổi chiều';
  return 'Chào buổi tối';
}

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { showToast } = useToast();
  const { user, activeStore, switchStore } = useAuth();
  const [storeModalVisible, setStoreModalVisible] = useState(false);

  const canViewRev = checkCanViewRevenue(user);

  const {
    data: summary,
    isLoading,
    refetch,
  } = useQuery<DashboardSummaryV2>({
    queryKey: ['dashboard-summary', activeStore?.id, canViewRev],
    queryFn: () => fetchDashboardSummary(activeStore?.id, canViewRev),
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  // Animated progress bar width
  const progressAnim = useRef(new Animated.Value(0)).current;
  const checklistDone = summary?.checklist?.summary.completed ?? 0;
  const checklistTotal = summary?.checklist?.summary.total ?? 0;
  const checklistPercent = summary?.checklist?.summary.percent ?? 0;

  useEffect(() => {
    Animated.timing(progressAnim, {
      toValue: checklistPercent,
      duration: 500,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [checklistPercent, progressAnim]);

  useEffect(() => {
    if (!summary || summary.alertsError) return;
    if (summary.fefoAlertCount > 0) {
      void dispatchDeduplicatedAlertNotification({
        dedupeKey: `fefo-${activeStore?.id || 'all'}-${summary.fefoAlertCount}`,
        title: 'Cảnh báo hàng cận hạn (FEFO)',
        body: `Có ${summary.fefoAlertCount} lô hàng cận hạn cần kiểm tra ưu tiên.`,
        targetRoute: '/(tabs)/alerts',
      });
    }
    if (summary.shortageAlertCount > 0) {
      void dispatchDeduplicatedAlertNotification({
        dedupeKey: `shortage-${activeStore?.id || 'all'}-${summary.shortageAlertCount}`,
        title: 'Cảnh báo thiếu hàng AI',
        body: `${summary.shortageAlertCount} mặt hàng dưới ngưỡng tồn an toàn.`,
        targetRoute: '/(tabs)/alerts',
      });
    }
  }, [summary, activeStore?.id]);

  const formatCurrency = (val: number) => new Intl.NumberFormat('vi-VN').format(val) + ' ₫';

  const formatTime = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const totalAlerts =
    summary && !summary.alertsError ? summary.fefoAlertCount + summary.shortageAlertCount : 0;

  const firstName = user?.name ? user.name.trim().split(' ').slice(-1)[0] : 'bạn';

  const handleSelectStore = async (store: Store) => {
    await switchStore(store);
    setStoreModalVisible(false);
    showToast({
      variant: 'success',
      title: 'Đã chuyển chi nhánh',
      message: `${store.name} (${store.code})`,
    });
  };

  const quickActions = [
    {
      id: 'scan',
      label: 'Tra cứu',
      icon: 'barcode-outline' as const,
      color: '#0D7A73',
      bg: '#E6F5F3',
      onPress: () => router.push('/(tabs)/scan'),
      visible: true,
    },
    {
      id: 'stocktake',
      label: 'Kiểm đếm',
      icon: 'clipboard-outline' as const,
      color: '#4F46E5',
      bg: '#EEF2FF',
      onPress: () => router.push('/ops/quick-stocktake'),
      visible: canCreateStocktake(user),
    },
    {
      id: 'incident',
      label: 'Báo sự cố',
      icon: 'alert-circle-outline' as const,
      color: '#D97706',
      bg: '#FFF7ED',
      onPress: () => router.push('/ops/incident'),
      visible: canReportIncident(user),
    },
    {
      id: 'iot',
      label: 'Cửa kho',
      icon: 'hardware-chip-outline' as const,
      color: '#059669',
      bg: '#ECFDF5',
      onPress: () => router.push('/(tabs)/iot'),
      visible: canAccessIoT(user),
    },
  ].filter((a) => a.visible);

  const animatedWidth = progressAnim.interpolate({
    inputRange: [0, 100],
    outputRange: ['0%', '100%'],
  });

  return (
    <View style={styles.container}>
      {/* iOS Native Centered Top Bar */}
      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <View style={styles.logoBadge}>
          <Image source={LOGO_IMAGE} style={styles.brandLogo} resizeMode="contain" />
        </View>

        <View style={styles.topBarCenter}>
          <Text style={styles.greetingText} numberOfLines={1}>
            {getGreetingByHour()}, {firstName}
          </Text>
          <TouchableOpacity
            style={styles.storeRow}
            activeOpacity={0.7}
            onPress={() => {
              if (user?.stores && user.stores.length > 0) setStoreModalVisible(true);
            }}
          >
            <Ionicons name="location-outline" size={11} color={Colors.primary} />
            <Text style={styles.storeText} numberOfLines={1}>
              {activeStore ? activeStore.name : 'Chưa chọn chi nhánh'}
            </Text>
            {user?.stores && user.stores.length > 1 && (
              <Ionicons name="chevron-down" size={11} color={Colors.muted} />
            )}
          </TouchableOpacity>
        </View>

        <ScalePressable
          style={styles.bellBtn}
          onPress={() => router.push('/notifications' as any)}
        >
          <Ionicons name="notifications-outline" size={20} color={Colors.text} />
          {totalAlerts > 0 && <View style={styles.bellDot} />}
        </ScalePressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* 1. Compact Brand Summary Card (Đồng bộ màu FreshMart Turquoise với Web Admin) */}
        <FadeInView delay={0}>
          <View style={styles.summaryCard}>
            <View style={styles.summaryTopRow}>
              <View style={styles.liveRow}>
                <PulseDot color="#5EEAD4" size={6} active={!summary?.iotError} />
                <Text style={styles.summaryRoleText}>{getRoleDisplayName(user)}</Text>
              </View>
              <Text style={styles.summaryTimeText}>
                Cập nhật {formatTime(summary?.updatedAt)}
              </Text>
            </View>

            {canViewRev ? (
              isLoading ? (
                <Skeleton
                  width={150}
                  height={26}
                  style={{ backgroundColor: 'rgba(255,255,255,0.2)', marginVertical: 4 }}
                />
              ) : summary?.revenueStatus === 'no_store' ? (
                <Text style={styles.summarySubWarning}>Chưa chọn chi nhánh để xem doanh thu</Text>
              ) : summary?.revenueStatus === 'error' ? (
                <Text style={styles.summarySubWarning}>
                  Không thể tải doanh thu ({summary.revenueErrorMessage})
                </Text>
              ) : (
                <View style={styles.summaryMetricRow}>
                  <Text style={styles.summaryBigVal}>
                    {formatCurrency(summary?.todayRevenue || 0)}
                  </Text>
                  <Text style={styles.summarySubVal}>
                    {summary?.todayInvoices || 0} hóa đơn (7 ngày gần nhất)
                  </Text>
                </View>
              )
            ) : (
              <View style={styles.summaryMetricRow}>
                <Text style={styles.summaryBigVal}>
                  {checklistTotal > 0 ? `${checklistDone}/${checklistTotal} việc` : 'Ca vận hành'}
                </Text>
                <Text style={styles.summarySubVal}>
                  {checklistTotal > 0
                    ? `Hoàn thành ${checklistPercent}% checklist hôm nay`
                    : 'Chưa có checklist được tạo cho ca này'}
                </Text>
              </View>
            )}

            {/* Compact 3-Metric Strip */}
            <View style={styles.kpiStrip}>
              <View style={styles.kpiItem}>
                <Text style={styles.kpiVal}>
                  {summary?.alertsError ? '—' : summary?.fefoAlertCount ?? 0}
                </Text>
                <Text style={styles.kpiLabel}>FEFO cận hạn</Text>
              </View>
              <View style={styles.kpiDivider} />
              <View style={styles.kpiItem}>
                <Text style={styles.kpiVal}>
                  {summary?.alertsError ? '—' : summary?.shortageAlertCount ?? 0}
                </Text>
                <Text style={styles.kpiLabel}>AI thiếu hàng</Text>
              </View>
              <View style={styles.kpiDivider} />
              <View style={styles.kpiItem}>
                <Text style={styles.kpiVal}>
                  {summary?.iotError
                    ? '—'
                    : `${summary?.iotOnlineCount ?? 0}/${summary?.iotTotalCount ?? 0}`}
                </Text>
                <Text style={styles.kpiLabel}>IoT Online</Text>
              </View>
            </View>
          </View>
        </FadeInView>

        {/* 2. Quick Actions Full-Width Grid with Spring Animation */}
        <FadeInView delay={60}>
          <View style={styles.quickGrid}>
            {quickActions.map((act) => (
              <View key={act.id} style={{ flex: 1 }}>
                <ScalePressable style={styles.quickItem} onPress={act.onPress}>
                  <View style={[styles.quickIconBox, { backgroundColor: act.bg }]}>
                    <Ionicons name={act.icon} size={20} color={act.color} />
                  </View>
                  <Text style={styles.quickLabel} numberOfLines={1}>
                    {act.label}
                  </Text>
                </ScalePressable>
              </View>
            ))}
          </View>
        </FadeInView>

        {/* 3. Daily Checklist Progress with Animated Bar */}
        <FadeInView delay={120}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Checklist ca làm việc</Text>
            <TouchableOpacity onPress={() => router.push('/ops/checklist')}>
              <Text style={styles.sectionLink}>Mở danh sách</Text>
            </TouchableOpacity>
          </View>
          <ScalePressable onPress={() => router.push('/ops/checklist')}>
            <Card style={styles.checklistCard}>
              {summary?.checklistError ? (
                <Text style={styles.errorInline}>Không thể tải tiến độ checklist từ máy chủ.</Text>
              ) : checklistTotal > 0 ? (
                <>
                  <View style={styles.checklistRow}>
                    <Text style={styles.checklistCount}>
                      Đã xong {checklistDone}/{checklistTotal} công việc
                    </Text>
                    <Text style={styles.checklistPct}>{checklistPercent}%</Text>
                  </View>
                  <View style={styles.progressTrack}>
                    <Animated.View style={[styles.progressFill, { width: animatedWidth }]} />
                  </View>
                </>
              ) : (
                <Text style={styles.emptyInline}>
                  Chưa có danh sách công việc nào được thiết lập cho hôm nay.
                </Text>
              )}
            </Card>
          </ScalePressable>
        </FadeInView>

        {/* 4. Priority Alerts */}
        <FadeInView delay={180}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Cần xử lý ưu tiên</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/alerts')}>
              <Text style={styles.sectionLink}>Tất cả</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.listCard}>
            {summary?.alertsError ? (
              <Text style={styles.errorInline}>Lỗi đồng bộ cảnh báo. Kéo xuống để thử lại.</Text>
            ) : summary?.pendingTasks && summary.pendingTasks.length > 0 ? (
              summary.pendingTasks.map((task, idx) => (
                <React.Fragment key={task.id}>
                  {idx > 0 && <View style={styles.rowDivider} />}
                  <ScalePressable
                    style={styles.taskRow}
                    onPress={() =>
                      router.push(task.targetTab === 'iot' ? '/(tabs)/iot' : '/(tabs)/alerts')
                    }
                  >
                    <View
                      style={[
                        styles.taskDot,
                        {
                          backgroundColor:
                            task.type === 'fefo'
                              ? Colors.warning
                              : task.type === 'shortage'
                                ? Colors.danger
                                : Colors.info,
                        },
                      ]}
                    />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.taskTitle}>{task.title}</Text>
                      <Text style={styles.taskSub}>{task.subtitle}</Text>
                    </View>
                    <Text style={styles.taskBadge}>{task.badge}</Text>
                    <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
                  </ScalePressable>
                </React.Fragment>
              ))
            ) : (
              <Text style={styles.emptyInline}>Không có cảnh báo ưu tiên nào cần xử lý.</Text>
            )}
          </Card>
        </FadeInView>

        {/* 5. Recent Activity */}
        <FadeInView delay={240}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Hoạt động gần đây</Text>
            <TouchableOpacity onPress={() => router.push('/ops/activity')}>
              <Text style={styles.sectionLink}>Xem thêm</Text>
            </TouchableOpacity>
          </View>
          <Card style={styles.listCard}>
            {summary?.recentActivities && summary.recentActivities.length > 0 ? (
              summary.recentActivities.map((act, idx) => (
                <React.Fragment key={act.id}>
                  {idx > 0 && <View style={styles.rowDivider} />}
                  <View style={styles.activityRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.activityTitle} numberOfLines={1}>
                        {act.title}
                      </Text>
                      {act.detail ? (
                        <Text style={styles.activitySub} numberOfLines={1}>
                          {act.detail}
                        </Text>
                      ) : null}
                    </View>
                    <Text style={styles.activityTime}>{formatTime(act.createdAt)}</Text>
                  </View>
                </React.Fragment>
              ))
            ) : (
              <Text style={styles.emptyInline}>Chưa có hoạt động nào được ghi nhận.</Text>
            )}
          </Card>
        </FadeInView>
      </ScrollView>

      {/* Shared Store Selector Bottom Sheet */}
      <StorePickerSheet
        visible={storeModalVisible}
        onClose={() => setStoreModalVisible(false)}
        stores={user?.stores || []}
        activeStoreId={activeStore?.id}
        onSelect={handleSelectStore}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    paddingHorizontal: 14,
    paddingBottom: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
  },
  logoBadge: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#B8E5E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandLogo: { width: 26, height: 26 },
  topBarCenter: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  greetingText: {
    fontSize: Typography.sizes.md,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  storeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3, marginTop: 1 },
  storeText: { fontSize: Typography.sizes.caption, color: Colors.muted, maxWidth: 210 },
  bellBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  bellDot: {
    position: 'absolute',
    top: 7,
    right: 8,
    width: 7,
    height: 7,
    borderRadius: 3.5,
    backgroundColor: Colors.danger,
  },
  content: { padding: 14, paddingBottom: 32 },
  summaryCard: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.card,
    padding: 14,
    marginBottom: 12,
  },
  summaryTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryRoleText: {
    fontSize: 11,
    fontWeight: Typography.weights.semibold,
    color: 'rgba(255,255,255,0.9)',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  summaryTimeText: { fontSize: 11, color: 'rgba(255,255,255,0.72)' },
  summaryMetricRow: { marginBottom: 12 },
  summaryBigVal: { fontSize: 22, fontWeight: Typography.weights.bold, color: '#FFFFFF', letterSpacing: -0.4 },
  summarySubVal: { fontSize: 12, color: 'rgba(255,255,255,0.85)', marginTop: 2 },
  summarySubWarning: { fontSize: 12, color: '#FEF08A', marginVertical: 8 },
  kpiStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.14)',
    borderRadius: Radius.control,
    paddingVertical: 8,
  },
  kpiItem: { flex: 1, alignItems: 'center' },
  kpiVal: { fontSize: 15, fontWeight: Typography.weights.bold, color: '#FFFFFF' },
  kpiLabel: { fontSize: 10, color: 'rgba(255,255,255,0.82)', marginTop: 1 },
  kpiDivider: { width: StyleSheet.hairlineWidth, height: 22, backgroundColor: 'rgba(255,255,255,0.22)' },
  quickGrid: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  quickItem: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    paddingVertical: 10,
    alignItems: 'center',
    gap: 6,
  },
  quickIconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickLabel: { fontSize: 11, fontWeight: Typography.weights.semibold, color: Colors.text },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  sectionTitle: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.semibold, color: Colors.text },
  sectionLink: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, color: Colors.primary },
  checklistCard: { padding: 12 },
  checklistRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  checklistCount: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, color: Colors.text },
  checklistPct: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.bold, color: Colors.primary },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: Colors.borderSoft, overflow: 'hidden' },
  progressFill: { height: '100%', backgroundColor: Colors.primary, borderRadius: 3 },
  listCard: { paddingVertical: 4, paddingHorizontal: 12 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  taskDot: { width: 8, height: 8, borderRadius: 4 },
  taskTitle: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.semibold, color: Colors.text },
  taskSub: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  taskBadge: { fontSize: 11, fontWeight: Typography.weights.semibold, color: Colors.textSecondary },
  rowDivider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.borderSoft },
  activityRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9 },
  activityTitle: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.medium, color: Colors.text },
  activitySub: { fontSize: 11, color: Colors.muted, marginTop: 1 },
  activityTime: { fontSize: 11, color: Colors.textLight },
  emptyInline: { fontSize: Typography.sizes.sm, color: Colors.muted, paddingVertical: 8 },
  errorInline: { fontSize: Typography.sizes.sm, color: Colors.danger, paddingVertical: 8 },
  modalBackdrop: { flex: 1, backgroundColor: Colors.backdrop, justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 32,
  },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { fontSize: Typography.sizes.title, fontWeight: Typography.weights.bold, color: Colors.text },
  storeOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: Radius.control,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderSoft,
  },
  storeOptionSelected: { backgroundColor: Colors.primaryWash },
  storeOptionName: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.semibold, color: Colors.text },
  storeOptionAddr: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 2 },
});
