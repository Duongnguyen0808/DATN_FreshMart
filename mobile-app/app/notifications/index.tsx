import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { useQuery } from '@tanstack/react-query';
import { fetchFefoRiskAlerts, fetchShortageAlerts } from '../../src/services/alerts.service';
import { fetchIoTMonitorData } from '../../src/services/iot.service';
import { useAuth } from '../../src/contexts/auth-context';
import { FefoRiskAlert, ShortageAlert } from '../../src/types';

export default function NotificationsScreen() {
  const router = useRouter();
  const { activeStore } = useAuth();

  const { data: fefo = [] } = useQuery({
    queryKey: ['fefo-alerts', activeStore?.id],
    queryFn: () => fetchFefoRiskAlerts(activeStore?.id),
  });

  const { data: shortages = [] } = useQuery({
    queryKey: ['shortage-alerts', activeStore?.id],
    queryFn: () => fetchShortageAlerts(activeStore?.id),
  });

  const { data: iotData } = useQuery({
    queryKey: ['iot-monitor', activeStore?.id],
    queryFn: () => fetchIoTMonitorData(),
  });

  const notifications = [
    ...fefo.slice(0, 5).map((item: FefoRiskAlert) => ({
      id: `notif-fefo-${item.id}`,
      type: 'fefo' as const,
      title: `Lô hàng cận hạn: ${item.productName}`,
      message: `Lô ${item.lotNumber} còn ${item.daysRemaining} ngày là hết hạn. Số lượng tồn: ${item.quantity} ${item.unit}.`,
      badge: item.daysRemaining <= 7 ? 'Khẩn cấp' : 'Cảnh báo',
      badgeVariant: item.daysRemaining <= 7 ? ('danger' as const) : ('warning' as const),
      route: '/(tabs)/alerts',
      icon: 'time-outline' as const,
    })),
    ...shortages.slice(0, 5).map((item: ShortageAlert) => ({
      id: `notif-shortage-${item.skuId}`,
      type: 'shortage' as const,
      title: `Nguy cơ thiếu hàng: ${item.productName}`,
      message: `Tồn kho hiện tại (${item.currentStock}) thấp hơn ngưỡng an toàn (${item.safetyStock}). Dự báo AI bán ${item.forecastedDemand}.`,
      badge: 'Dự báo AI',
      badgeVariant: 'danger' as const,
      route: '/(tabs)/alerts',
      icon: 'trending-down-outline' as const,
    })),
    ...(iotData?.alerts || []).slice(0, 5).map((al) => ({
      id: `notif-iot-${al.id}`,
      type: 'iot' as const,
      title: `An ninh cửa kho: ${al.alertType}`,
      message: al.message,
      badge: 'IoT',
      badgeVariant: 'danger' as const,
      route: '/(tabs)/iot',
      icon: 'shield-outline' as const,
    })),
  ];

  return (
    <View style={styles.container}>
      <Header title="Trung tâm Thông báo" subtitle="Cảnh báo & Sự kiện" showBack />

      <ScrollView contentContainerStyle={styles.content}>
        {notifications.length > 0 ? (
          notifications.map((n) => (
            <Card
              key={n.id}
              style={styles.notifCard}
              onPress={() => router.push(n.route as any)}
            >
              <View style={styles.notifRow}>
                <View
                  style={[
                    styles.iconBox,
                    n.type === 'fefo'
                      ? { backgroundColor: Colors.warningBg }
                      : n.type === 'shortage'
                      ? { backgroundColor: Colors.dangerBg }
                      : { backgroundColor: Colors.infoBg },
                  ]}
                >
                  <Ionicons
                    name={n.icon}
                    size={20}
                    color={
                      n.type === 'fefo'
                        ? Colors.warning
                        : n.type === 'shortage'
                        ? Colors.danger
                        : Colors.info
                    }
                  />
                </View>
                <View style={styles.notifInfo}>
                  <View style={styles.notifTop}>
                    <Text style={styles.notifTitle} numberOfLines={1}>
                      {n.title}
                    </Text>
                    <Badge label={n.badge} variant={n.badgeVariant} size="sm" />
                  </View>
                  <Text style={styles.notifMessage}>{n.message}</Text>
                </View>
              </View>
            </Card>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={48} color={Colors.muted} />
            <Text style={styles.emptyTitle}>Không có thông báo mới</Text>
            <Text style={styles.emptySubtitle}>
              Các cảnh báo hàng cận hạn, thiếu hàng và an ninh IoT sẽ hiển thị ở đây.
            </Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: 16,
    paddingBottom: 40,
  },
  notifCard: {
    padding: 14,
    marginBottom: 10,
  },
  notifRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconBox: {
    width: 38,
    height: 38,
    borderRadius: Radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  notifInfo: {
    flex: 1,
  },
  notifTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
    gap: 8,
  },
  notifTitle: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    flex: 1,
  },
  notifMessage: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  emptyTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginTop: 14,
  },
  emptySubtitle: {
    fontSize: Typography.sizes.body,
    color: Colors.muted,
    textAlign: 'center',
    marginTop: 6,
    paddingHorizontal: 24,
  },
});
