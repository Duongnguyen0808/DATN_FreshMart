import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Colors, Radius, Typography, Shadows } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { useAuth } from '../../src/contexts/auth-context';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';
import {
  fetchDailyChecklist,
  toggleDailyChecklistItem,
  DailyChecklistItem,
} from '../../src/services/mobile-ops.service';
import { getCachedPreferences } from '../../src/services/preferences.service';

const CATEGORY_META: Record<string, { label: string; color: string; bg: string }> = {
  FEFO: { label: 'Hạn sử dụng', color: Colors.warning, bg: Colors.warningBg },
  SHELF: { label: 'Kệ hàng', color: Colors.primary, bg: Colors.primarySoft },
  STOCK: { label: 'Tồn kho', color: Colors.info, bg: Colors.infoBg },
  IOT: { label: 'An ninh IoT', color: '#7c3aed', bg: '#f5f3ff' },
};

export default function DailyChecklistScreen() {
  const { activeStore } = useAuth();
  const dialog = useAppDialog();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingAll, setSavingAll] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['daily-checklist', activeStore?.id],
    queryFn: () => fetchDailyChecklist(activeStore?.id),
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      toggleDailyChecklistItem(id, completed),
    onMutate: ({ id }) => setBusyId(id),
    onSuccess: () => {
      if (getCachedPreferences().hapticsEnabled) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      queryClient.invalidateQueries({ queryKey: ['daily-checklist'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      queryClient.invalidateQueries({ queryKey: ['personal-activities'] });
    },
    onError: (err: any) => {
      dialog.error('Không thể cập nhật', err?.message || 'Vui lòng thử lại.');
    },
    onSettled: () => setBusyId(null),
  });

  const handleSaveChecklist = async () => {
    setSavingAll(true);
    try {
      const fresh = await refetch();
      const s = fresh.data?.summary || data?.summary;
      await queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
      await queryClient.invalidateQueries({ queryKey: ['personal-activities'] });
      if (getCachedPreferences().hapticsEnabled) {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      }
      dialog.success(
        'Đã lưu checklist ngày',
        s
          ? `Đã đồng bộ tiến độ ${s.completed}/${s.total} đầu việc (${s.percent}%) lên hệ thống Web Admin.`
          : 'Đã đồng bộ checklist vận hành lên hệ thống Web Admin.'
      );
    } catch (err: any) {
      dialog.error('Lỗi đồng bộ', err?.message || 'Không thể lưu checklist, vui lòng thử lại.');
    } finally {
      setSavingAll(false);
    }
  };

  const handleToggle = (item: DailyChecklistItem) => {
    if (busyId) return;
    toggleMutation.mutate({ id: item.id, completed: !item.completed });
  };

  const percent = data?.summary.percent ?? 0;

  return (
    <View style={styles.container}>
      <Header
        title="Checklist vận hành ngày"
        subtitle={activeStore ? `${activeStore.name} · ${data?.dateKey || 'Hôm nay'}` : 'Hôm nay'}
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Progress Summary Card */}
        <Card style={styles.progressCard}>
          <View style={styles.progressTop}>
            <View>
              <Text style={styles.progressTitle}>Tiến độ vận hành hôm nay</Text>
              <Text style={styles.progressSub}>
                Hoàn thành {data?.summary.completed ?? 0}/{data?.summary.total ?? 0} đầu việc
              </Text>
            </View>
            <View style={styles.percentPill}>
              <Text style={styles.percentText}>{percent}%</Text>
            </View>
          </View>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${percent}%` }]} />
          </View>
        </Card>

        {isLoading ? (
          <View style={{ gap: 10 }}>
            <Skeleton height={86} borderRadius={Radius.card} />
            <Skeleton height={86} borderRadius={Radius.card} />
            <Skeleton height={86} borderRadius={Radius.card} />
          </View>
        ) : isError ? (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={24} color={Colors.danger} />
            <Text style={styles.errorText}>
              {(error as Error)?.message || 'Không thể tải danh sách công việc.'}
            </Text>
          </Card>
        ) : (
          (data?.items || []).map((item) => {
            const meta = CATEGORY_META[item.category] || {
              label: item.category,
              color: Colors.primary,
              bg: Colors.primarySoft,
            };
            const isBusy = busyId === item.id;
            return (
              <TouchableOpacity
                key={item.id}
                activeOpacity={0.8}
                disabled={isBusy}
                onPress={() => handleToggle(item)}
              >
                <Card style={[styles.taskCard, item.completed ? styles.taskCardDone : undefined]}>
                  <View style={styles.taskRow}>
                    <View
                      style={[
                        styles.checkbox,
                        item.completed ? styles.checkboxChecked : undefined,
                      ]}
                    >
                      {item.completed && <Ionicons name="checkmark" size={16} color="#ffffff" />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <View style={styles.taskHeaderRow}>
                        <View style={[styles.catBadge, { backgroundColor: meta.bg }]}>
                          <Text style={[styles.catBadgeText, { color: meta.color }]}>
                            {meta.label}
                          </Text>
                        </View>
                        {item.completed && (
                          <Badge label="Hoàn thành" variant="success" size="sm" />
                        )}
                      </View>
                      <Text
                        style={[
                          styles.taskTitle,
                          item.completed ? styles.taskTitleDone : undefined,
                        ]}
                      >
                        {item.title}
                      </Text>
                      {item.description ? (
                        <Text style={styles.taskDesc}>{item.description}</Text>
                      ) : null}
                      {item.completed && item.completedByName ? (
                        <View style={styles.completedMeta}>
                          <Ionicons name="person-circle-outline" size={13} color={Colors.success} />
                          <Text style={styles.completedMetaText}>
                            {item.completedByName} ·{' '}
                            {item.completedAt
                              ? new Date(item.completedAt).toLocaleTimeString('vi-VN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : ''}
                          </Text>
                        </View>
                      ) : null}
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Sticky Bottom Save Button */}
      <View style={styles.bottomBar}>
        <Button
          title={
            data?.summary
              ? `Lưu checklist (${data.summary.completed}/${data.summary.total})`
              : 'Lưu checklist ngày'
          }
          loading={savingAll}
          disabled={isLoading || !!busyId}
          onPress={handleSaveChecklist}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 24 },
  bottomBar: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 22,
    backgroundColor: '#ffffff',
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  progressCard: { padding: 16, marginBottom: 14 },
  progressTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  progressTitle: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  progressSub: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    marginTop: 2,
  },
  percentPill: {
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: Radius.pill,
  },
  percentText: {
    fontSize: 15,
    fontWeight: Typography.weights.bold,
    color: Colors.primaryDark,
  },
  progressTrack: {
    height: 8,
    backgroundColor: Colors.border,
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    backgroundColor: Colors.primary,
    borderRadius: 4,
  },
  taskCard: { padding: 14, marginBottom: 10 },
  taskCardDone: {
    backgroundColor: '#f8fcfb',
    borderColor: Colors.borderSoft,
  },
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  checkbox: {
    width: 24,
    height: 24,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: Colors.borderFocus,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    backgroundColor: '#ffffff',
  },
  checkboxChecked: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  taskHeaderRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  catBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  catBadgeText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
  },
  taskTitle: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  taskTitleDone: {
    textDecorationLine: 'line-through',
    color: Colors.muted,
  },
  taskDesc: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    marginTop: 3,
    lineHeight: 17,
  },
  completedMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 6,
  },
  completedMetaText: {
    fontSize: 11,
    color: Colors.success,
    fontWeight: Typography.weights.medium,
  },
  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.dangerBorder,
  },
  errorText: {
    flex: 1,
    fontSize: Typography.sizes.sm,
    color: Colors.danger,
  },
});
