import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { fetchPersonalActivities } from '../../src/services/mobile-ops.service';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';

type RangeKey = 'today' | '7d' | '30d' | 'all';

const RANGES: Array<{ value: RangeKey; label: string }> = [
  { value: 'today', label: 'Hôm nay' },
  { value: '7d', label: '7 ngày' },
  { value: '30d', label: '30 ngày' },
  { value: 'all', label: 'Tất cả' },
];

const ACTIVITY_META: Record<
  string,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; label: string }
> = {
  BARCODE_SCAN: { icon: 'barcode-outline', color: Colors.primary, bg: Colors.primarySoft, label: 'Quét mã' },
  RFID_SCAN: { icon: 'id-card-outline', color: Colors.info, bg: Colors.infoBg, label: 'RFID kho' },
  CHECKLIST_DONE: { icon: 'checkbox-outline', color: Colors.success, bg: Colors.successBg, label: 'Checklist' },
  STOCKTAKE_SUBMIT: { icon: 'clipboard-outline', color: Colors.warning, bg: Colors.warningBg, label: 'Kiểm đếm' },
  INCIDENT_REPORT: { icon: 'warning-outline', color: Colors.danger, bg: Colors.dangerBg, label: 'Sự cố' },
};

export default function PersonalActivityScreen() {
  const [range, setRange] = useState<RangeKey>('7d');

  const { data = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['personal-activities', range],
    queryFn: () => fetchPersonalActivities(range),
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  return (
    <View style={styles.container}>
      <Header title="Nhật ký hoạt động cá nhân" subtitle="Quét mã · RFID · Checklist · Sự cố" showBack />

      <View style={styles.filterBar}>
        {RANGES.map((r) => {
          const active = range === r.value;
          return (
            <TouchableOpacity
              key={r.value}
              style={[styles.filterPill, active ? styles.filterPillActive : undefined]}
              onPress={() => setRange(r.value)}
            >
              <Text style={[styles.filterText, active ? styles.filterTextActive : undefined]}>
                {r.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

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
        {isLoading ? (
          <View style={{ gap: 10 }}>
            <Skeleton height={72} borderRadius={Radius.card} />
            <Skeleton height={72} borderRadius={Radius.card} />
            <Skeleton height={72} borderRadius={Radius.card} />
          </View>
        ) : isError ? (
          <Card style={styles.errorCard}>
            <Ionicons name="alert-circle-outline" size={22} color={Colors.danger} />
            <Text style={styles.errorText}>
              {(error as Error)?.message || 'Không thể tải nhật ký hoạt động.'}
            </Text>
          </Card>
        ) : data.length === 0 ? (
          <EmptyState
            icon="time-outline"
            title="Chưa có hoạt động nào"
            description="Lịch sử quét mã sản phẩm, quẹt thẻ RFID, checklist và báo cáo sự cố của bạn sẽ xuất hiện tại đây."
          />
        ) : (
          data.map((item) => {
            const meta = ACTIVITY_META[item.activityType] || {
              icon: 'ellipse-outline',
              color: Colors.primary,
              bg: Colors.primarySoft,
              label: item.activityType,
            };
            return (
              <Card key={item.id} style={styles.itemCard}>
                <View style={styles.itemRow}>
                  <View style={[styles.iconBox, { backgroundColor: meta.bg }]}>
                    <Ionicons name={meta.icon} size={18} color={meta.color} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={styles.itemTop}>
                      <Text style={styles.itemTitle} numberOfLines={1}>
                        {item.title}
                      </Text>
                      <Badge label={meta.label} variant="neutral" size="sm" />
                    </View>
                    {item.detail ? <Text style={styles.itemDetail}>{item.detail}</Text> : null}
                    <Text style={styles.itemTime}>
                      {new Date(item.createdAt).toLocaleString('vi-VN')}
                    </Text>
                  </View>
                </View>
              </Card>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  filterBar: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: 8,
  },
  filterPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterText: { fontSize: Typography.sizes.caption, color: Colors.textSecondary, fontWeight: Typography.weights.medium },
  filterTextActive: { color: '#ffffff', fontWeight: Typography.weights.bold },
  content: { padding: 16, paddingBottom: 40 },
  itemCard: { padding: 13, marginBottom: 9 },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  iconBox: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  itemTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  itemTitle: { flex: 1, fontSize: Typography.sizes.body, fontWeight: Typography.weights.semibold, color: Colors.text },
  itemDetail: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 3 },
  itemTime: { fontSize: 10, color: Colors.muted, marginTop: 4 },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder },
  errorText: { flex: 1, fontSize: Typography.sizes.sm, color: Colors.danger },
});
