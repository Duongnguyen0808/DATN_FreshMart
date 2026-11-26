import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  RefreshControl,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography, Shadows } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Skeleton } from '../../src/components/ui/Skeleton';
import { EmptyState } from '../../src/components/ui/EmptyState';
import { ProductThumbnail } from '../../src/components/ui/ProductThumbnail';
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { useAuth } from '../../src/contexts/auth-context';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';
import {
  fetchFefoRiskAlertsResult,
  fetchShortageAlertsResult,
  quarantineInventoryLot,
} from '../../src/services/alerts.service';
import { canCreateStocktake } from '../../src/utils/rbac';
import { triggerScanSuccessFeedback, triggerErrorFeedback } from '../../src/services/audio.service';
import { FefoRiskAlert, ShortageAlert } from '../../src/types';

type FilterType = 'all' | 'fefo' | 'shortage';
type SeverityFilter = 'ALL' | 'CRITICAL';

const RISK_LEVEL_VI: Record<string, string> = {
  EXPIRED: 'Đã hết hạn',
  CRITICAL: 'Nguy cấp',
  HIGH: 'Mức cao',
  MEDIUM: 'Trung bình',
  LOW: 'Thấp',
  WARNING: 'Cảnh báo',
};

function formatRiskLevelVi(level?: string | null): string {
  if (!level) return 'Cảnh báo';
  return RISK_LEVEL_VI[level.toUpperCase()] || level;
}

export default function AlertsScreen() {
  const { user, activeStore } = useAuth();
  const dialog = useAppDialog();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<FilterType>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('ALL');
  const [selectedFefo, setSelectedFefo] = useState<FefoRiskAlert | null>(null);
  const [selectedShortage, setSelectedShortage] = useState<ShortageAlert | null>(null);
  const [quarantining, setQuarantining] = useState(false);

  const handleQuarantineLot = (lot: FefoRiskAlert) => {
    const lotId = lot.lotId || lot.id;
    // Đóng BottomSheet trước rồi mới mở AppDialog (tránh iOS chặn 2 Modal chồng nhau)
    setSelectedFefo(null);
    setTimeout(() => {
      if (!lotId || lotId.startsWith('fefo-')) {
        dialog.warning('Không thể cách ly', 'Lô này chưa có mã định danh hợp lệ trên hệ thống.');
        return;
      }
      dialog.confirm({
        title: 'Đưa lô vào khu cách ly?',
        message: `Lô ${lot.lotNumber} (${lot.productName} · ${lot.quantity} ${lot.unit}) sẽ bị chặn xuất bán tự động tại quầy POS và đồng bộ lên Web Admin.`,
        confirmText: 'Cách ly ngay',
        destructive: true,
        onConfirm: async () => {
          setQuarantining(true);
          try {
            await quarantineInventoryLot(
              lotId,
              `Cách ly trực tiếp từ Mobile Ops (${lot.daysRemaining <= 0 ? 'Đã hết hạn' : `Còn ${lot.daysRemaining} ngày`})`
            );
            await triggerScanSuccessFeedback();
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['fefo-alerts-v2'] }),
              queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] }),
            ]);
            dialog.success(
              'Đã đưa vào khu cách ly',
              `Lô ${lot.lotNumber} đã bị chặn bán tại POS và cập nhật sang trang Lô và hạn sử dụng trên Web Admin.`
            );
          } catch (err: any) {
            await triggerErrorFeedback();
            dialog.error('Cách ly thất bại', err?.message || 'Không thể đưa lô vào khu cách ly.');
          } finally {
            setQuarantining(false);
          }
        },
      });
    }, 260);
  };

  const {
    data: fefoRes,
    isLoading: loadingFefo,
    refetch: refetchFefo,
  } = useQuery({
    queryKey: ['fefo-alerts-v2', activeStore?.id],
    queryFn: () => fetchFefoRiskAlertsResult(activeStore?.id),
  });

  const {
    data: shortageRes,
    isLoading: loadingShortage,
    refetch: refetchShortage,
  } = useQuery({
    queryKey: ['shortage-alerts-v2', activeStore?.id],
    queryFn: () => fetchShortageAlertsResult(activeStore?.id),
  });

  const fefoAlerts = fefoRes?.items ?? [];
  const shortageAlerts = shortageRes?.items ?? [];

  const filteredFefo =
    severityFilter === 'CRITICAL'
      ? fefoAlerts.filter((i) => i.riskLevel === 'CRITICAL' || i.daysRemaining <= 7)
      : fefoAlerts;

  const filteredShortage =
    severityFilter === 'CRITICAL'
      ? shortageAlerts.filter((i) => i.riskLevel === 'CRITICAL' || i.currentStock <= 0)
      : shortageAlerts;

  const criticalCount =
    fefoAlerts.filter((i) => i.riskLevel === 'CRITICAL' || i.daysRemaining <= 7).length +
    shortageAlerts.filter((i) => i.riskLevel === 'CRITICAL' || i.currentStock <= 0).length;
  const totalCount = fefoAlerts.length + shortageAlerts.length;
  const warningCount = Math.max(0, totalCount - criticalCount);

  const isLoading = loadingFefo || loadingShortage;
  const hasAnyError = !!(fefoRes?.hasError || shortageRes?.hasError);
  const updatedAt = fefoRes?.updatedAt || shortageRes?.updatedAt;

  const { refreshing, onRefresh: handleRefresh } = useManualRefresh(() =>
    Promise.all([refetchFefo(), refetchShortage()])
  );

  const formatTime = (iso?: string) => {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <View style={styles.container}>
      <Header
        title="Cảnh báo tồn và hạn dùng"
        subtitle={
          activeStore
            ? `${activeStore.name} · Cập nhật ${formatTime(updatedAt)}`
            : `Cập nhật ${formatTime(updatedAt)}`
        }
      />

      {/* Severity Summary Strip */}
      <View style={styles.summaryStrip}>
        <View style={styles.summaryBox}>
          <Text style={styles.summaryNum}>{hasAnyError ? '—' : totalCount}</Text>
          <Text style={styles.summaryLabel}>Tổng cảnh báo</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryBox}>
          <Text style={[styles.summaryNum, { color: Colors.danger }]}>
            {hasAnyError ? '—' : criticalCount}
          </Text>
          <Text style={styles.summaryLabel}>Mức nguy cấp</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryBox}>
          <Text style={[styles.summaryNum, { color: Colors.warning }]}>
            {hasAnyError ? '—' : warningCount}
          </Text>
          <Text style={styles.summaryLabel}>Cần theo dõi</Text>
        </View>
      </View>

      {/* Filters Row */}
      <View style={styles.filterBar}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          <TouchableOpacity
            style={[styles.filterPill, filter === 'all' ? styles.filterPillActive : undefined]}
            onPress={() => setFilter('all')}
          >
            <Text style={[styles.filterPillText, filter === 'all' ? styles.filterPillTextActive : undefined]}>
              Tất cả ({totalCount})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filter === 'fefo' ? styles.filterPillActive : undefined]}
            onPress={() => setFilter('fefo')}
          >
            <Text style={[styles.filterPillText, filter === 'fefo' ? styles.filterPillTextActive : undefined]}>
              Hạn dùng ({fefoAlerts.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.filterPill, filter === 'shortage' ? styles.filterPillActive : undefined]}
            onPress={() => setFilter('shortage')}
          >
            <Text style={[styles.filterPillText, filter === 'shortage' ? styles.filterPillTextActive : undefined]}>
              Thiếu hàng AI ({shortageAlerts.length})
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.filterPill,
              severityFilter === 'CRITICAL' ? styles.filterPillDanger : undefined,
            ]}
            onPress={() =>
              setSeverityFilter((prev) => (prev === 'ALL' ? 'CRITICAL' : 'ALL'))
            }
          >
            <Text
              style={[
                styles.filterPillText,
                severityFilter === 'CRITICAL' ? styles.filterPillTextActive : undefined,
              ]}
            >
              Chỉ nguy cấp
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      <ScrollView
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Explicit Error State */}
        {hasAnyError && (
          <Card style={styles.errorBanner}>
            <Ionicons name="cloud-offline-outline" size={20} color={Colors.danger} />
            <View style={{ flex: 1 }}>
              <Text style={styles.errorTitle}>Không thể tải đầy đủ dữ liệu cảnh báo</Text>
              <Text style={styles.errorDesc}>
                {fefoRes?.errorMessage || shortageRes?.errorMessage || 'Vui lòng kiểm tra kết nối máy chủ và kéo xuống để thử lại.'}
              </Text>
            </View>
          </Card>
        )}

        {isLoading ? (
          <View style={{ gap: 10 }}>
            <Skeleton height={106} borderRadius={Radius.card} />
            <Skeleton height={106} borderRadius={Radius.card} />
            <Skeleton height={106} borderRadius={Radius.card} />
          </View>
        ) : (
          <>
            {/* FEFO Alerts */}
            {(filter === 'all' || filter === 'fefo') && filteredFefo.length > 0 && (
              <View style={styles.groupSection}>
                <View style={styles.groupHeader}>
                  <Ionicons name="time" size={17} color={Colors.warning} />
                  <Text style={styles.groupTitle}>Lô hàng cận hạn và hết hạn</Text>
                </View>

                {filteredFefo.map((item) => {
                  const isCritical = item.daysRemaining <= 7;
                  return (
                    <Card
                      key={item.id}
                      style={[styles.alertCard, isCritical ? styles.alertCardCritical : undefined]}
                      onPress={() => setSelectedFefo(item)}
                    >
                      <View style={styles.cardTopRow}>
                        <Badge
                          label={item.daysRemaining <= 0 ? 'ĐÃ HẾT HẠN' : `CÒN ${item.daysRemaining} NGÀY`}
                          variant={isCritical ? 'danger' : 'warning'}
                          size="sm"
                        />
                        <Text style={styles.lotNumberText}>Lô: {item.lotNumber}</Text>
                      </View>

                      <View style={styles.cardProductRow}>
                        <ProductThumbnail
                          imageUrl={item.imageUrl}
                          productCode={item.skuCode}
                          name={item.productName}
                          size="md"
                        />
                        <View style={styles.cardProductInfo}>
                          <Text style={styles.productName} numberOfLines={2}>
                            {item.productName}
                          </Text>
                          <Text style={styles.barcodeText}>
                            Mã: {item.skuCode} {item.barcode ? `· ${item.barcode}` : ''}
                          </Text>
                          <Text style={styles.lotQuantityText}>
                            Tồn lô: <Text style={{ fontWeight: 'bold' }}>{item.quantity}</Text> {item.unit}
                          </Text>
                        </View>
                      </View>

                      <View style={styles.cardBottomRow}>
                        <View style={styles.actionSuggestion}>
                          <Ionicons name="sparkles" size={12} color={Colors.primary} />
                          <Text style={styles.actionSuggestionText}>
                            {item.discountPercent
                              ? `Đề xuất giảm ${item.discountPercent}%`
                              : 'Ưu tiên xuất bán lô cận hạn'}
                          </Text>
                        </View>
                        <View style={styles.viewDetailRow}>
                          <Text style={styles.viewDetailText}>Chi tiết</Text>
                          <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}

            {/* AI Shortage Alerts (Không tự bịa % xác suất) */}
            {(filter === 'all' || filter === 'shortage') && filteredShortage.length > 0 && (
              <View style={styles.groupSection}>
                <View style={styles.groupHeader}>
                  <Ionicons name="trending-down" size={17} color={Colors.danger} />
                  <Text style={styles.groupTitle}>Nguy cơ thiếu hàng (Dự báo AI)</Text>
                </View>

                {filteredShortage.map((item) => (
                  <Card
                    key={item.skuId}
                    style={styles.alertCard}
                    onPress={() => setSelectedShortage(item)}
                  >
                    <View style={styles.cardTopRow}>
                      <Badge
                        label={item.riskLevel === 'CRITICAL' ? 'NGUY CẤP' : 'CẢNH BÁO THIẾU'}
                        variant={item.riskLevel === 'CRITICAL' ? 'danger' : 'warning'}
                        size="sm"
                      />
                      {item.stockoutRiskPercent >= 0 ? (
                        <Text style={styles.riskPercentText}>
                          Mức rủi ro: {item.stockoutRiskPercent}%
                        </Text>
                      ) : (
                        <Text style={styles.lotNumberText}>
                          Thiếu dự kiến: {item.shortageUnits} sp
                        </Text>
                      )}
                    </View>

                    <View style={styles.cardProductRow}>
                      <ProductThumbnail
                        imageUrl={item.imageUrl}
                        productCode={item.skuCode}
                        name={item.productName}
                        size="md"
                      />
                      <View style={styles.cardProductInfo}>
                        <Text style={styles.productName} numberOfLines={2}>
                          {item.productName}
                        </Text>
                        <Text style={styles.barcodeText}>Mã: {item.skuCode}</Text>
                      </View>
                    </View>

                    <View style={styles.shortageMetricsRow}>
                      <View style={styles.shortageMetricCol}>
                        <Text style={styles.shortageMetricLabel}>Tồn hiện tại</Text>
                        <Text style={styles.shortageMetricVal}>{item.currentStock}</Text>
                      </View>
                      <View style={styles.shortageMetricDivider} />
                      <View style={styles.shortageMetricCol}>
                        <Text style={styles.shortageMetricLabel}>An toàn</Text>
                        <Text style={styles.shortageMetricVal}>{item.safetyStock}</Text>
                      </View>
                      <View style={styles.shortageMetricDivider} />
                      <View style={styles.shortageMetricCol}>
                        <Text style={styles.shortageMetricLabel}>Dự báo AI</Text>
                        <Text style={[styles.shortageMetricVal, { color: Colors.primary }]}>
                          {item.forecastedDemand}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.cardBottomRow}>
                      <Text style={styles.recommendPurchaseText}>
                        Đề xuất nhập thêm: +{item.recommendedPurchaseQty} sp
                      </Text>
                      <View style={styles.viewDetailRow}>
                        <Text style={styles.viewDetailText}>Chi tiết</Text>
                        <Ionicons name="chevron-forward" size={14} color={Colors.muted} />
                      </View>
                    </View>
                  </Card>
                ))}
              </View>
            )}

            {/* Empty State — Không kết luận tồn kho an toàn tuyệt đối khi thiếu dữ liệu */}
            {!hasAnyError && filteredFefo.length === 0 && filteredShortage.length === 0 && (
              <EmptyState
                icon="information-circle-outline"
                title="Chưa có cảnh báo phù hợp bộ lọc"
                description="Hiện tại máy chủ chưa trả về cảnh báo hạn sử dụng hoặc dự báo thiếu hàng nào cho bộ lọc này. Nếu chưa chạy mô hình dự báo AI trên Web Admin, danh sách sẽ để trống."
                actionTitle="Tải lại dữ liệu"
                onAction={handleRefresh}
              />
            )}
          </>
        )}
      </ScrollView>

      {/* Bottom Sheet Chi tiết FEFO */}
      <BottomSheet
        visible={!!selectedFefo}
        onClose={() => setSelectedFefo(null)}
        title={selectedFefo?.productName || 'Chi tiết lô FEFO'}
        subtitle={
          selectedFefo
            ? `Lô: ${selectedFefo.lotNumber} · ${
                selectedFefo.daysRemaining <= 0
                  ? 'Đã hết hạn'
                  : `Còn ${selectedFefo.daysRemaining} ngày`
              }`
            : undefined
        }
      >
        {selectedFefo ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <ProductThumbnail
                imageUrl={selectedFefo.imageUrl}
                productCode={selectedFefo.skuCode}
                name={selectedFefo.productName}
                size="lg"
              />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Badge
                  label={
                    selectedFefo.daysRemaining <= 0
                      ? 'ĐÃ HẾT HẠN'
                      : `CÒN ${selectedFefo.daysRemaining} NGÀY`
                  }
                  variant={selectedFefo.daysRemaining <= 7 ? 'danger' : 'warning'}
                />
                <Text style={styles.barcodeText}>Mã SKU: {selectedFefo.skuCode}</Text>
              </View>
            </View>

            <View style={styles.modalDetailGrid}>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Mã Lô</Text>
                <Text style={styles.modalDetailValue}>{selectedFefo.lotNumber}</Text>
              </View>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Số lượng tồn</Text>
                <Text style={styles.modalDetailValue}>
                  {selectedFefo.quantity} {selectedFefo.unit}
                </Text>
              </View>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Hạn sử dụng</Text>
                <Text style={styles.modalDetailValue}>
                  {selectedFefo.expiresAt
                    ? new Date(selectedFefo.expiresAt).toLocaleDateString('vi-VN')
                    : 'Chưa cập nhật'}
                </Text>
              </View>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Mức độ</Text>
                <Text
                  style={[
                    styles.modalDetailValue,
                    {
                      color:
                        ['CRITICAL', 'EXPIRED'].includes(String(selectedFefo.riskLevel || '').toUpperCase())
                          ? Colors.danger
                          : Colors.warning,
                    },
                  ]}
                >
                  {formatRiskLevelVi(selectedFefo.riskLevel)}
                </Text>
              </View>
            </View>

            <View style={styles.recommendStrategyBox}>
              <View style={styles.recommendStrategyHeader}>
                <Ionicons name="bulb-outline" size={18} color={Colors.primary} />
                <Text style={styles.recommendStrategyTitle}>Đề xuất xử lý từ hệ thống</Text>
              </View>
              <Text style={styles.recommendStrategyDesc}>
                {selectedFefo.discountPercent
                  ? `Áp dụng mức giảm giá đề xuất ${selectedFefo.discountPercent}% tại quầy POS để giải phóng ${selectedFefo.quantity} ${selectedFefo.unit} trước hạn sử dụng.`
                  : `Ưu tiên sắp xếp lô ${selectedFefo.lotNumber} ra phía trước quầy kệ (hết hạn trước, xuất trước).`}
              </Text>
            </View>

            {canCreateStocktake(user) && !!(selectedFefo.lotId || selectedFefo.id) ? (
              <View style={{ marginTop: 14 }}>
                <Button
                  title="Đưa lô vào khu cách ly (Chặn bán POS)"
                  variant="danger"
                  loading={quarantining}
                  icon={<Ionicons name="shield-outline" size={17} color="#ffffff" />}
                  onPress={() => handleQuarantineLot(selectedFefo)}
                />
              </View>
            ) : null}
          </>
        ) : null}
      </BottomSheet>

      {/* Bottom Sheet Chi tiết Thiếu Hàng AI */}
      <BottomSheet
        visible={!!selectedShortage}
        onClose={() => setSelectedShortage(null)}
        title={selectedShortage?.productName || 'Chi tiết dự báo AI'}
        subtitle={selectedShortage ? `Mã SKU: ${selectedShortage.skuCode} · Kỳ dự báo 7 ngày` : undefined}
      >
        {selectedShortage ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 }}>
              <ProductThumbnail
                imageUrl={selectedShortage.imageUrl}
                productCode={selectedShortage.skuCode}
                name={selectedShortage.productName}
                size="lg"
              />
              <View style={{ flex: 1, minWidth: 0, gap: 4 }}>
                <Badge label="DỰ BÁO NHU CẦU AI" variant="danger" />
                <Text style={styles.barcodeText}>Nguồn: Mô hình Gradient Boosting</Text>
              </View>
            </View>

            <View style={styles.modalDetailGrid}>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Tồn khả dụng</Text>
                <Text style={styles.modalDetailValue}>{selectedShortage.currentStock}</Text>
              </View>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Ngưỡng an toàn</Text>
                <Text style={styles.modalDetailValue}>{selectedShortage.safetyStock}</Text>
              </View>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Dự báo bán ra</Text>
                <Text style={[styles.modalDetailValue, { color: Colors.primary }]}>
                  {selectedShortage.forecastedDemand}
                </Text>
              </View>
              <View style={styles.modalDetailItem}>
                <Text style={styles.modalDetailLabel}>Thiếu dự kiến</Text>
                <Text style={[styles.modalDetailValue, { color: Colors.danger }]}>
                  -{selectedShortage.shortageUnits}
                </Text>
              </View>
            </View>

            <View style={styles.recommendStrategyBox}>
              <View style={styles.recommendStrategyHeader}>
                <Ionicons name="cart-outline" size={18} color={Colors.primary} />
                <Text style={styles.recommendStrategyTitle}>Đề xuất nhập bổ sung</Text>
              </View>
              <Text style={styles.recommendStrategyDesc}>
                Đề xuất tạo Đề nghị mua hàng thêm {selectedShortage.recommendedPurchaseQty} sản phẩm trên Web Admin để duy trì tồn an toàn.
              </Text>
            </View>
          </>
        ) : null}
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  summaryStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#ffffff',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  summaryBox: { flex: 1, alignItems: 'center' },
  summaryNum: { fontSize: 17, fontWeight: Typography.weights.bold, color: Colors.text },
  summaryLabel: { fontSize: 10, color: Colors.muted, marginTop: 1 },
  summaryDivider: { width: 1, height: 22, backgroundColor: Colors.border },
  filterBar: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  filterPill: {
    paddingVertical: 6,
    paddingHorizontal: 11,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  filterPillActive: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  filterPillDanger: { backgroundColor: Colors.danger, borderColor: Colors.danger },
  filterPillText: { fontSize: Typography.sizes.caption, color: Colors.textSecondary, fontWeight: Typography.weights.medium },
  filterPillTextActive: { color: '#ffffff', fontWeight: Typography.weights.bold },
  listContent: { padding: 14, paddingBottom: 40 },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    backgroundColor: Colors.dangerBg,
    borderColor: Colors.dangerBorder,
    marginBottom: 12,
  },
  errorTitle: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.bold, color: Colors.danger },
  errorDesc: { fontSize: Typography.sizes.caption, color: Colors.danger, marginTop: 2 },
  groupSection: { marginBottom: 16 },
  groupHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  groupTitle: { fontSize: 15, fontWeight: Typography.weights.bold, color: Colors.text },
  alertCard: { padding: 13, marginBottom: 10 },
  alertCardCritical: { borderLeftWidth: 3.5, borderLeftColor: Colors.danger },
  cardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  lotNumberText: { fontSize: Typography.sizes.caption, color: Colors.muted, fontWeight: Typography.weights.medium },
  cardProductRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 3 },
  cardProductInfo: { flex: 1 },
  productName: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.bold, color: Colors.text, lineHeight: 19 },
  barcodeText: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 2 },
  lotQuantityText: { fontSize: Typography.sizes.caption, color: Colors.textSecondary, marginTop: 2 },
  cardBottomRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 9,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: Colors.borderSoft,
  },
  actionSuggestion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: Radius.sm,
  },
  actionSuggestionText: { fontSize: Typography.sizes.caption, color: Colors.primaryDark, fontWeight: Typography.weights.semibold },
  viewDetailRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  viewDetailText: { fontSize: Typography.sizes.caption, color: Colors.muted },
  riskPercentText: { fontSize: Typography.sizes.caption, color: Colors.danger, fontWeight: Typography.weights.semibold },
  shortageMetricsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.control,
    paddingVertical: 8,
    marginTop: 8,
  },
  shortageMetricCol: { alignItems: 'center' },
  shortageMetricLabel: { fontSize: 10, color: Colors.muted },
  shortageMetricVal: { fontSize: 15, fontWeight: Typography.weights.bold, color: Colors.text, marginTop: 1 },
  shortageMetricDivider: { width: 1, height: 20, backgroundColor: Colors.border },
  recommendPurchaseText: { fontSize: Typography.sizes.caption, color: Colors.primaryDark, fontWeight: Typography.weights.semibold },
  modalBackdrop: { flex: 1, backgroundColor: Colors.backdrop, justifyContent: 'flex-end' },
  modalCard: { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 20, paddingBottom: 34, ...Shadows.cardHover },
  modalHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  modalProductTitle: { fontSize: Typography.sizes.md, fontWeight: Typography.weights.bold, color: Colors.text, marginTop: 4 },
  modalDetailGrid: { flexDirection: 'row', flexWrap: 'wrap', backgroundColor: Colors.surfaceSoft, borderRadius: Radius.control, padding: 12, gap: 12 },
  modalDetailItem: { width: '45%' },
  modalDetailLabel: { fontSize: Typography.sizes.caption, color: Colors.muted },
  modalDetailValue: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.bold, color: Colors.text, marginTop: 2 },
  recommendStrategyBox: { backgroundColor: Colors.primarySoft, borderRadius: Radius.control, borderWidth: 1, borderColor: Colors.borderSoft, padding: 14, marginTop: 14 },
  recommendStrategyHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  recommendStrategyTitle: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.bold, color: Colors.primaryDark },
  recommendStrategyDesc: { fontSize: Typography.sizes.sm, color: Colors.textSecondary, lineHeight: 19 },
});
