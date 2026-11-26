import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography, Shadows } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { FadeInView, PulseDot } from '../../src/components/ui/Motion';
import { useAuth } from '../../src/contexts/auth-context';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';
import { fetchIoTMonitorData, IoTMonitorExtended } from '../../src/services/iot.service';
import { useRealtimeSync } from '../../src/services/realtime.service';
import { IoTAccessEvent } from '../../src/types';

type DateFilter = 'all' | 'today' | '7d';

export default function IoTScreen() {
  const { activeStore } = useAuth();
  const { isConnected: socketConnected } = useRealtimeSync();
  const [dateFilter, setDateFilter] = useState<DateFilter>('today');
  const [selectedEvent, setSelectedEvent] = useState<IoTAccessEvent | null>(null);

  const {
    data: iotData,
    isLoading,
    refetch,
  } = useQuery<IoTMonitorExtended>({
    queryKey: ['iot-monitor', activeStore?.id],
    queryFn: () => fetchIoTMonitorData(activeStore?.id),
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const formatDateTime = (isoStr?: string | null) => {
    if (!isoStr) return 'Chưa có tín hiệu';
    try {
      const d = new Date(isoStr);
      return (
        d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
        ' · ' +
        d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
      );
    } catch {
      return isoStr;
    }
  };

  const formatTimeOnly = (isoStr?: string | null) => {
    if (!isoStr) return '--:--';
    try {
      return new Date(isoStr).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } catch {
      return '--:--';
    }
  };

  // Filter RFID events by selected date range
  const filteredEvents = useMemo(() => {
    if (!iotData?.events) return [];
    const now = Date.now();
    const startOfToday = new Date().setHours(0, 0, 0, 0);
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    return iotData.events.filter((ev) => {
      const t = new Date(ev.occurredAt).getTime();
      if (dateFilter === 'today') return t >= startOfToday;
      if (dateFilter === '7d') return t >= sevenDaysAgo;
      return true;
    });
  }, [iotData?.events, dateFilter]);

  const isCameraOnline = !!iotData?.cameraStatus?.online;
  const onlineTotal = iotData?.onlineCount || 0;
  const totalDevices = iotData?.totalCount || 0;

  return (
    <View style={styles.container}>
      <Header
        title="Giám sát IoT Kho hàng"
        subtitle={
          iotData?.warehouseName
            ? `Kho: ${iotData.warehouseName}`
            : activeStore
            ? `Chi nhánh ${activeStore.name}`
            : 'Hệ thống thiết bị kho'
        }
      />

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
        {/* Error banner if network/server issue */}
        {iotData?.hasError && (
          <FadeInView delay={0}>
            <View style={styles.errorBanner}>
              <Ionicons name="cloud-offline-outline" size={20} color={Colors.danger} />
              <View style={{ flex: 1 }}>
                <Text style={styles.errorTitle}>Lỗi kết nối trạm IoT kho</Text>
                <Text style={styles.errorMsg}>
                  {iotData.errorMessage || 'Không thể đồng bộ dữ liệu phần cứng. Đang thử lại định kỳ.'}
                </Text>
              </View>
              <Button
                title="Thử lại"
                size="sm"
                variant="outline"
                onPress={() => refetch()}
                style={styles.retryBtn}
              />
            </View>
          </FadeInView>
        )}

        {/* Top IoT Telemetry Overview Banner (Compact Solid Brand Card) */}
        <View style={[styles.telemetryBanner, { backgroundColor: Colors.primary }]}>
          <View style={styles.telemetryTop}>
            <View style={styles.telemetryLivePill}>
              <PulseDot color={onlineTotal > 0 ? '#34d399' : '#f87171'} size={6} active={onlineTotal > 0} />
              <Text style={styles.telemetryLiveText}>
                {iotData?.mode === 'REAL_IOT' ? 'THIẾT BỊ THỰC TẾ' : 'CHẾ ĐỘ MÔ PHỎNG'}
              </Text>
            </View>
            <Text style={styles.telemetryRefresh}>
              {iotData?.updatedAt ? `Cập nhật ${formatTimeOnly(iotData.updatedAt)}` : 'Đang đồng bộ...'}
            </Text>
          </View>

          {/* 4 Telemetry Metrics */}
          <View style={styles.telemetryStatsRow}>
            <View style={styles.telemetryStat}>
              <Text style={styles.telemetryStatVal}>
                {iotData?.hasError ? '—' : `${onlineTotal}/${totalDevices}`}
              </Text>
              <Text style={styles.telemetryStatLabel}>Online</Text>
            </View>
            <View style={styles.telemetryDivider} />
            <View style={styles.telemetryStat}>
              <Text style={[styles.telemetryStatVal, { color: '#a7f3d0' }]}>
                {iotData?.hasError ? '—' : iotData?.grantedCount ?? 0}
              </Text>
              <Text style={styles.telemetryStatLabel}>Hợp lệ</Text>
            </View>
            <View style={styles.telemetryDivider} />
            <View style={styles.telemetryStat}>
              <Text
                style={[
                  styles.telemetryStatVal,
                  (iotData?.deniedCount || 0) > 0 ? { color: '#fca5a5' } : undefined,
                ]}
              >
                {iotData?.hasError ? '—' : iotData?.deniedCount ?? 0}
              </Text>
              <Text style={styles.telemetryStatLabel}>Từ chối</Text>
            </View>
            <View style={styles.telemetryDivider} />
            <View style={styles.telemetryStat}>
              <Text
                style={[
                  styles.telemetryStatVal,
                  (iotData?.alerts?.length || 0) > 0 ? { color: '#fed7aa' } : undefined,
                ]}
              >
                {iotData?.hasError ? '—' : iotData?.alerts?.length ?? 0}
              </Text>
              <Text style={styles.telemetryStatLabel}>Cảnh báo</Text>
            </View>
          </View>

          <Text style={styles.telemetryFooter}>
            {socketConnected
              ? 'Socket.IO đã kết nối · Đồng bộ dự phòng mỗi 10s'
              : 'Đang dùng chế độ polling định kỳ mỗi 10s (chưa có Socket)'}
          </Text>
        </View>

        {/* Hardware Devices Status Section */}
        <FadeInView delay={80}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="hardware-chip-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Thiết bị phần cứng tại kho</Text>
            </View>
            <Text style={styles.sectionSubtitle}>
              {totalDevices > 0 ? `${totalDevices} trạm được kết nối` : 'Chưa có trạm'}
            </Text>
          </View>

          {isLoading ? (
            <View style={{ gap: 10 }}>
              <Skeleton height={88} borderRadius={Radius.card} />
              <Skeleton height={88} borderRadius={Radius.card} />
            </View>
          ) : (
            <View style={styles.devicesGrid}>
              {/* Device 1: ESP32-CAM */}
              <Card style={styles.deviceCard}>
                <View style={styles.deviceCardTop}>
                  <View style={[styles.deviceIconCircle, isCameraOnline && styles.deviceIconOnline]}>
                    <Ionicons
                      name="videocam"
                      size={20}
                      color={isCameraOnline ? Colors.primary : Colors.muted}
                    />
                  </View>
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.deviceName}>ESP32-CAM Inbound Gate</Text>
                    <Text style={styles.deviceCode}>Trạm quét QR kiện hàng cổng nhập kho</Text>
                  </View>
                  <View style={styles.statusIndicator}>
                    <PulseDot color={isCameraOnline ? Colors.success : Colors.danger} size={6} active={isCameraOnline} />
                    <Badge
                      label={isCameraOnline ? 'ONLINE' : 'OFFLINE'}
                      variant={isCameraOnline ? 'success' : 'danger'}
                      size="sm"
                    />
                  </View>
                </View>
                <View style={styles.deviceMetaRow}>
                  <View style={styles.deviceMetaItem}>
                    <Text style={styles.deviceMetaLabel}>Địa chỉ IP:</Text>
                    <Text style={styles.deviceMetaVal}>
                      {iotData?.cameraStatus?.cameraIp || 'Chưa nhận diện'}
                    </Text>
                  </View>
                  <View style={styles.deviceMetaItem}>
                    <Text style={styles.deviceMetaLabel}>Kết nối gần nhất:</Text>
                    <Text style={styles.deviceMetaVal}>
                      {formatDateTime(iotData?.cameraStatus?.lastSeenAt)}
                    </Text>
                  </View>
                </View>
              </Card>

              {/* Device 2: ESP32 + RC522 RFID Readers */}
              {iotData?.devices && iotData.devices.length > 0 ? (
                iotData.devices.map((dev) => (
                  <Card key={dev.id} style={styles.deviceCard}>
                    <View style={styles.deviceCardTop}>
                      <View style={[styles.deviceIconCircle, dev.online && styles.deviceIconOnline]}>
                        <Ionicons
                          name="id-card"
                          size={20}
                          color={dev.online ? Colors.primary : Colors.muted}
                        />
                      </View>
                      <View style={{ flex: 1, marginLeft: 12 }}>
                        <Text style={styles.deviceName}>{dev.name}</Text>
                        <Text style={styles.deviceCode}>Mã phần cứng: {dev.code}</Text>
                      </View>
                      <View style={styles.statusIndicator}>
                        <PulseDot color={dev.online ? Colors.success : Colors.danger} size={6} active={dev.online} />
                        <Badge
                          label={dev.online ? 'ONLINE' : 'OFFLINE'}
                          variant={dev.online ? 'success' : 'danger'}
                          size="sm"
                        />
                      </View>
                    </View>
                    <View style={styles.deviceMetaRow}>
                      <View style={styles.deviceMetaItem}>
                        <Text style={styles.deviceMetaLabel}>Trạng thái kích hoạt:</Text>
                        <Text style={[styles.deviceMetaVal, { color: dev.active ? Colors.primary : Colors.muted }]}>
                          {dev.active ? 'Đang hoạt động' : 'Tạm vô hiệu'}
                        </Text>
                      </View>
                      <View style={styles.deviceMetaItem}>
                        <Text style={styles.deviceMetaLabel}>Tín hiệu gần nhất:</Text>
                        <Text style={styles.deviceMetaVal}>
                          {formatDateTime(dev.lastSeenAt)}
                        </Text>
                      </View>
                    </View>
                  </Card>
                ))
              ) : (
                <Card style={styles.deviceCard}>
                  <View style={styles.deviceCardTop}>
                    <View style={styles.deviceIconCircle}>
                      <Ionicons name="id-card-outline" size={20} color={Colors.muted} />
                    </View>
                    <View style={{ flex: 1, marginLeft: 12 }}>
                      <Text style={styles.deviceName}>Trạm RFID RC522 Cửa kho</Text>
                      <Text style={styles.deviceCode}>Chưa đăng ký thiết bị tại kho này</Text>
                    </View>
                    <Badge label="CHƯA ĐĂNG KÝ" variant="neutral" size="sm" />
                  </View>
                  <Text style={styles.unregisteredNote}>
                    Quản trị viên có thể gán mã thiết bị RFID cho kho này trên Web Admin.
                  </Text>
                </Card>
              )}
            </View>
          )}
        </FadeInView>

        {/* Security Alerts (Truy cập trái phép hoặc phát hiện cửa mở sai quy trình) */}
        {iotData?.alerts && iotData.alerts.length > 0 && (
          <FadeInView delay={120} style={styles.alertSection}>
            <View style={styles.alertSectionHeader}>
              <Ionicons name="shield-outline" size={18} color={Colors.danger} />
              <Text style={styles.alertSectionTitle}>Cảnh báo an ninh cửa kho</Text>
              <Badge label={`${iotData.alerts.length} cảnh báo`} variant="danger" size="sm" />
            </View>

            {iotData.alerts.map((al) => (
              <Card key={al.id} style={styles.securityAlertCard}>
                <View style={styles.securityAlertTop}>
                  <Badge label={al.alertType} variant="danger" size="sm" />
                  <Text style={styles.securityAlertTime}>{formatDateTime(al.createdAt)}</Text>
                </View>
                <Text style={styles.securityAlertMsg}>{al.message}</Text>
              </Card>
            ))}
          </FadeInView>
        )}

        {/* Door Status from Sensor Data */}
        {iotData?.doors && iotData.doors.length > 0 && (
          <FadeInView delay={160} style={styles.doorsSection}>
            <View style={styles.sectionHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Ionicons name="lock-closed-outline" size={18} color={Colors.primary} />
                <Text style={styles.sectionTitle}>Trạng thái Cửa kho (Cảm biến)</Text>
              </View>
            </View>
            <View style={styles.doorsList}>
              {iotData.doors.map((door) => (
                <View key={door.id} style={styles.doorItem}>
                  <View style={styles.doorIconBox}>
                    <Ionicons name="lock-closed" size={18} color={Colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.doorName}>{door.name}</Text>
                    <Text style={styles.doorCode}>Thiết bị gán: {door.device?.code || door.code}</Text>
                  </View>
                  <Badge label="ĐANG GIÁM SÁT AN NINH" variant="success" size="sm" />
                </View>
              ))}
            </View>
          </FadeInView>
        )}

        {/* Timeline Access Logs with Date Filters */}
        <FadeInView delay={200}>
          <View style={styles.sectionHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="time-outline" size={18} color={Colors.primary} />
              <Text style={styles.sectionTitle}>Nhật ký hoạt động (Timeline)</Text>
            </View>
          </View>

          {/* Filter Pills */}
          <View style={styles.filterRow}>
            {(
              [
                { id: 'today', label: 'Hôm nay' },
                { id: '7d', label: '7 ngày qua' },
                { id: 'all', label: 'Tất cả' },
              ] as const
            ).map((f) => {
              const active = dateFilter === f.id;
              return (
                <TouchableOpacity
                  key={f.id}
                  style={[styles.filterChip, active && styles.filterChipActive]}
                  onPress={() => setDateFilter(f.id)}
                >
                  <Text style={[styles.filterChipText, active && styles.filterChipTextActive]}>
                    {f.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {isLoading ? (
            <View style={{ gap: 8, marginTop: 10 }}>
              <Skeleton height={68} borderRadius={Radius.card} />
              <Skeleton height={68} borderRadius={Radius.card} />
              <Skeleton height={68} borderRadius={Radius.card} />
            </View>
          ) : filteredEvents.length > 0 ? (
            <View style={styles.timelineContainer}>
              <View style={styles.timelineAxis} />
              {filteredEvents.map((ev, index) => {
                const isGranted = ev.granted !== false;
                const initials = ev.employee?.name
                  ? ev.employee.name.split(' ').slice(-1)[0].slice(0, 2).toUpperCase()
                  : '??';
                return (
                  <View key={ev.id || index} style={styles.timelineItem}>
                    {/* Node Circle */}
                    <View
                      style={[
                        styles.timelineNode,
                        {
                          backgroundColor: isGranted ? Colors.success : Colors.danger,
                          borderColor: isGranted ? Colors.successBg : Colors.dangerBg,
                        },
                      ]}
                    >
                      <Ionicons
                        name={isGranted ? 'checkmark' : 'close'}
                        size={12}
                        color="#ffffff"
                      />
                    </View>

                    {/* Timeline Event Content Card */}
                    <TouchableOpacity
                      activeOpacity={0.75}
                      style={styles.timelineCard}
                      onPress={() => setSelectedEvent(ev)}
                    >
                      <View style={styles.timelineTopRow}>
                        <View style={styles.timelineUserGroup}>
                          <View
                            style={[
                              styles.timelineAvatar,
                              { backgroundColor: isGranted ? Colors.successBg : Colors.dangerBg },
                            ]}
                          >
                            <Text
                              style={[
                                styles.timelineAvatarText,
                                { color: isGranted ? Colors.success : Colors.danger },
                              ]}
                            >
                              {initials}
                            </Text>
                          </View>
                          <View style={{ flex: 1, minWidth: 0 }}>
                            <Text style={styles.timelinePersonName} numberOfLines={1}>
                              {ev.employee?.name || 'Thẻ không xác định'}
                            </Text>
                            <Text style={styles.timelineDoorName} numberOfLines={1}>
                              {ev.door?.name || 'Cửa kho'} · {ev.eventType}
                            </Text>
                          </View>
                        </View>
                        <Badge
                          label={isGranted ? 'HỢP LỆ' : 'TỪ CHỐI'}
                          variant={isGranted ? 'success' : 'danger'}
                          size="sm"
                        />
                      </View>
                      <View style={styles.timelineBottomRow}>
                        <Ionicons name="time-outline" size={12} color={Colors.muted} />
                        <Text style={styles.timelineTimestamp}>
                          {formatDateTime(ev.occurredAt)}
                        </Text>
                      </View>
                    </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ) : (
            <EmptyState
              icon="calendar-outline"
              title="Không có lượt quẹt thẻ"
              description={
                dateFilter === 'today'
                  ? 'Hôm nay chưa ghi nhận lượt quét thẻ RFID nào tại cửa kho này.'
                  : 'Chưa có dữ liệu quẹt thẻ trong khoảng thời gian đã chọn.'
              }
            />
          )}
        </FadeInView>
      </ScrollView>

      {/* Event Detail Bottom Sheet */}
      <BottomSheet
        visible={!!selectedEvent}
        onClose={() => setSelectedEvent(null)}
        title="Chi tiết sự kiện cửa kho"
        subtitle={selectedEvent ? formatDateTime(selectedEvent.occurredAt) : undefined}
      >
        {selectedEvent ? (
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ fontSize: Typography.sizes.sm, color: Colors.muted }}>Trạng thái</Text>
              <Badge
                label={selectedEvent.granted !== false ? 'HỢP LỆ' : 'BỊ TỪ CHỐI'}
                variant={selectedEvent.granted !== false ? 'success' : 'danger'}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontSize: Typography.sizes.sm, color: Colors.muted }}>Nhân sự</Text>
              <Text style={{ fontSize: Typography.sizes.body, fontWeight: Typography.weights.semibold, color: Colors.text, flexShrink: 1, textAlign: 'right' }}>
                {selectedEvent.employee?.name || 'Thẻ không xác định'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontSize: Typography.sizes.sm, color: Colors.muted }}>Cửa kho</Text>
              <Text style={{ fontSize: Typography.sizes.body, fontWeight: Typography.weights.semibold, color: Colors.text, flexShrink: 1, textAlign: 'right' }}>
                {selectedEvent.door?.name || 'Cửa kho chính'}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontSize: Typography.sizes.sm, color: Colors.muted }}>Loại sự kiện</Text>
              <Text style={{ fontSize: Typography.sizes.body, color: Colors.textSecondary }}>
                {selectedEvent.eventType}
              </Text>
            </View>
            {selectedEvent.detail ? (
              <View style={{ padding: 10, borderRadius: Radius.control, backgroundColor: Colors.surfaceSoft }}>
                <Text style={{ fontSize: Typography.sizes.sm, color: Colors.textSecondary }}>
                  {selectedEvent.detail}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
      </BottomSheet>
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
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.dangerBorder,
    marginBottom: 14,
  },
  errorTitle: {
    fontSize: Typography.sizes.caption,
    fontWeight: Typography.weights.bold,
    color: Colors.danger,
  },
  errorMsg: {
    fontSize: 11,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  retryBtn: {
    borderColor: Colors.dangerBorder,
  },
  telemetryBanner: {
    borderRadius: 20,
    padding: 16,
    marginBottom: 16,
    ...Shadows.cardHover,
  },
  telemetryTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 14,
  },
  telemetryLivePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255,255,255,0.14)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: Radius.pill,
  },
  telemetryLiveText: {
    fontSize: 10,
    fontWeight: Typography.weights.bold,
    color: '#e6fffa',
    letterSpacing: 0.5,
  },
  telemetryRefresh: {
    fontSize: 11,
    color: '#b2ebe4',
  },
  telemetryStatsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderRadius: 14,
    paddingVertical: 12,
  },
  telemetryStat: {
    flex: 1,
    alignItems: 'center',
  },
  telemetryStatVal: {
    fontSize: 17,
    fontWeight: Typography.weights.bold,
    color: '#ffffff',
  },
  telemetryStatLabel: {
    fontSize: 10,
    color: '#ccf3ee',
    marginTop: 2,
  },
  telemetryDivider: {
    width: 1,
    height: 24,
    backgroundColor: 'rgba(255,255,255,0.2)',
  },
  telemetryFooter: {
    fontSize: 10,
    color: '#99e2d8',
    textAlign: 'center',
    marginTop: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
    marginTop: 6,
  },
  sectionTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  sectionSubtitle: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
  },
  devicesGrid: {
    gap: 10,
    marginBottom: 16,
  },
  deviceCard: {
    padding: 14,
    backgroundColor: '#ffffff',
  },
  deviceCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  deviceIconCircle: {
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: Colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  deviceIconOnline: {
    backgroundColor: Colors.primarySoft,
    borderColor: '#99e2d8',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deviceName: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  deviceCode: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    marginTop: 2,
  },
  deviceMetaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSoft,
    gap: 8,
  },
  deviceMetaItem: {
    flex: 1,
  },
  deviceMetaLabel: {
    fontSize: 10,
    color: Colors.muted,
  },
  deviceMetaVal: {
    fontSize: 11,
    fontWeight: Typography.weights.semibold,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  unregisteredNote: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 8,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSoft,
    fontStyle: 'italic',
  },
  alertSection: {
    marginBottom: 16,
  },
  alertSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  alertSectionTitle: {
    flex: 1,
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.danger,
  },
  securityAlertCard: {
    padding: 12,
    borderLeftWidth: 3.5,
    borderLeftColor: Colors.danger,
    marginBottom: 8,
  },
  securityAlertTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  securityAlertTime: {
    fontSize: 10,
    color: Colors.muted,
  },
  securityAlertMsg: {
    fontSize: Typography.sizes.caption,
    color: Colors.text,
    lineHeight: 18,
  },
  doorsSection: {
    marginBottom: 16,
  },
  doorsList: {
    gap: 8,
  },
  doorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    borderRadius: Radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
    ...Shadows.card,
  },
  doorIconBox: {
    width: 36,
    height: 36,
    borderRadius: Radius.control,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doorName: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.semibold,
    color: Colors.text,
  },
  doorCode: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 12,
  },
  filterChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: Typography.weights.semibold,
    color: Colors.textSecondary,
  },
  filterChipTextActive: {
    color: '#ffffff',
  },
  timelineContainer: {
    position: 'relative',
    paddingLeft: 18,
    marginTop: 4,
  },
  timelineAxis: {
    position: 'absolute',
    left: 7,
    top: 12,
    bottom: 12,
    width: 2,
    backgroundColor: Colors.border,
  },
  timelineItem: {
    position: 'relative',
    marginBottom: 12,
  },
  timelineNode: {
    position: 'absolute',
    left: -18,
    top: 14,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  timelineCard: {
    backgroundColor: '#ffffff',
    borderRadius: Radius.card,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    ...Shadows.card,
  },
  timelineTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  timelineUserGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
  },
  timelineAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timelineAvatarText: {
    fontSize: 11,
    fontWeight: Typography.weights.bold,
  },
  timelinePersonName: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.semibold,
    color: Colors.text,
  },
  timelineDoorName: {
    fontSize: 11,
    color: Colors.muted,
    marginTop: 1,
  },
  timelineBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSoft,
  },
  timelineTimestamp: {
    fontSize: 10,
    color: Colors.muted,
  },
});
