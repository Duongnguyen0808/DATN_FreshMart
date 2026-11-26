import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Animated,
  Easing,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography, Shadows } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { ProductThumbnail } from '../../src/components/ui/ProductThumbnail';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { triggerScanSuccessFeedback, triggerErrorFeedback } from '../../src/services/audio.service';
import { lookupProductByBarcode } from '../../src/services/product.service';
import { logBarcodeScanActivity } from '../../src/services/mobile-ops.service';
import { canCreateStocktake, canReportIncident } from '../../src/utils/rbac';
import { ProductStockDetail } from '../../src/types';
import { useAuth } from '../../src/contexts/auth-context';

export default function ScanScreen() {
  const router = useRouter();
  const dialog = useAppDialog();
  const { user, activeStore } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();
  const [torch, setTorch] = useState(false);
  const [scannedData, setScannedData] = useState<string | null>(null);
  const [productDetail, setProductDetail] = useState<ProductStockDetail | null>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);

  // Manual code input modal
  const [manualModal, setManualModal] = useState(false);
  const [manualCode, setManualCode] = useState('');

  // Lock scanning to prevent duplicate triggers
  const isScanningLocked = useRef(false);

  // Animated Laser Line
  const laserAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(laserAnim, {
          toValue: 1,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(laserAnim, {
          toValue: 0,
          duration: 2200,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [laserAnim]);

  const handleBarcodeScanned = async ({ data }: { data: string }) => {
    if (isScanningLocked.current || !data) return;

    const cleaned = data.trim();
    // Bỏ qua các mã QR dẫn link website bên ngoài in cạnh mã vạch trên bao bì
    // để camera bắt chính xác mã vạch EAN-13 / EAN-8 / UPC / Code128 của sản phẩm
    if (/^https?:\/\//i.test(cleaned) || cleaned.length > 40) {
      return;
    }

    // Lock immediate repeats
    isScanningLocked.current = true;
    setScannedData(cleaned);
    await performLookup(cleaned);
  };

  const performLookup = async (code: string) => {
    setLoadingLookup(true);
    try {
      const detail = await lookupProductByBarcode(code, activeStore?.id);
      setProductDetail(detail);
      await triggerScanSuccessFeedback();
      void logBarcodeScanActivity({
        storeId: activeStore?.id,
        barcode: detail.sku.barcode || code,
        productName: detail.sku.product.name,
        availableQty: detail.totalAvailable || 0,
      });
    } catch (err: any) {
      await triggerErrorFeedback();
      const rawMsg = String(err?.message || '');
      const friendlyMsg =
        /invalid input/i.test(rawMsg)
          ? `Mã "${code}" không đúng định dạng mã vạch (cần 8–14 chữ số).`
          : rawMsg || `Không tìm thấy sản phẩm với mã "${code}" trên hệ thống.`;
      dialog.show({
        variant: 'error',
        title: 'Không tìm thấy sản phẩm',
        message: friendlyMsg,
        confirmText: 'Thử lại',
        onConfirm: handleDismissResult,
        onDismiss: handleDismissResult,
      });
    } finally {
      setLoadingLookup(false);
    }
  };

  const handleDismissResult = () => {
    setProductDetail(null);
    setScannedData(null);
    // Cooldown 800ms before enabling camera scan again
    setTimeout(() => {
      isScanningLocked.current = false;
    }, 800);
  };

  const handleManualSubmit = async () => {
    if (!manualCode.trim()) return;
    setManualModal(false);
    const code = manualCode.trim();
    setManualCode('');
    isScanningLocked.current = true;
    setScannedData(code);
    await performLookup(code);
  };

  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(val);
  };

  if (!permission) {
    return (
      <View style={styles.permissionContainer}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <View style={styles.permissionIconCircle}>
          <Ionicons name="camera-outline" size={48} color={Colors.primary} />
        </View>
        <Text style={styles.permissionTitle}>Cần cấp quyền Camera</Text>
        <Text style={styles.permissionDesc}>
          Để sử dụng tính năng quét mã vạch sản phẩm và mã QR lô hàng, FreshMart cần quyền truy cập máy ảnh iPhone của bạn.
        </Text>
        <Button
          title="Cho phép truy cập Camera"
          onPress={requestPermission}
          style={{ width: '80%', marginTop: 12 }}
        />
      </View>
    );
  }

  const laserTranslateY = laserAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [10, 230],
  });

  return (
    <View style={styles.container}>
      <Header
        title="Quét Barcode / QR"
        subtitle={activeStore ? `Chi nhánh ${activeStore.name}` : 'Toàn hệ thống'}
        rightAction={
          <TouchableOpacity
            style={styles.headerIconButton}
            onPress={() => setManualModal(true)}
          >
            <Ionicons name="keypad-outline" size={20} color={Colors.text} />
          </TouchableOpacity>
        }
      />

      {/* Camera Live View */}
      <View style={styles.cameraWrapper}>
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          enableTorch={torch}
          barcodeScannerSettings={{
            barcodeTypes: [
              'ean13',
              'ean8',
              'upc_a',
              'upc_e',
              'code128',
              'code39',
              'qr',
            ],
          }}
          onBarcodeScanned={isScanningLocked.current ? undefined : handleBarcodeScanned}
        />

        {/* Reticle Scanner Overlay with Animated Laser */}
        <View style={styles.overlayLayer}>
          <View style={styles.unfocusedTop} />
          <View style={styles.middleRow}>
            <View style={styles.unfocusedSide} />
            <View style={styles.scanTargetBox}>
              {/* 4 Corner Markers */}
              <View style={[styles.cornerMarker, styles.cornerTL]} />
              <View style={[styles.cornerMarker, styles.cornerTR]} />
              <View style={[styles.cornerMarker, styles.cornerBL]} />
              <View style={[styles.cornerMarker, styles.cornerBR]} />

              {/* Animated Laser beam */}
              <Animated.View
                style={[
                  styles.animatedLaser,
                  {
                    transform: [{ translateY: laserTranslateY }],
                  },
                ]}
              >
                <View style={styles.laserCore} />
                <View style={styles.laserGlow} />
              </Animated.View>
            </View>
            <View style={styles.unfocusedSide} />
          </View>
          <View style={styles.unfocusedBottom}>
            <View style={styles.hintPill}>
              <Ionicons name="scan-outline" size={14} color="#ffffff" />
              <Text style={styles.guideInstructionText}>
                Căn chỉnh mã vạch / QR vào giữa khung quét
              </Text>
            </View>

            {/* Camera Floating Controls */}
            <View style={styles.controlsRow}>
              {/* Flashlight toggle */}
              <TouchableOpacity
                style={[styles.floatingActionBtn, torch ? styles.floatingActionBtnActive : undefined]}
                onPress={() => setTorch(!torch)}
              >
                <Ionicons
                  name={torch ? 'flash' : 'flash-outline'}
                  size={22}
                  color={torch ? '#ffffff' : Colors.text}
                />
              </TouchableOpacity>

              {/* Manual code input */}
              <TouchableOpacity
                style={styles.floatingActionBtn}
                onPress={() => setManualModal(true)}
              >
                <Ionicons name="create-outline" size={22} color={Colors.text} />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Lookup Loading Modal */}
      {loadingLookup && (
        <View style={styles.loadingBackdrop}>
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.loadingBoxText}>Đang tra cứu: {scannedData}...</Text>
          </View>
        </View>
      )}

      {/* Scanned Result Sheet Modal */}
      <Modal visible={!!productDetail} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.resultSheet}>
            <View style={styles.sheetHandle} />

            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetProductCode}>{productDetail?.sku?.code}</Text>
                <Text style={styles.sheetProductName}>{productDetail?.sku?.product?.name}</Text>
              </View>
              <TouchableOpacity onPress={handleDismissResult} style={styles.closeBtn}>
                <Ionicons name="close" size={24} color={Colors.muted} />
              </TouchableOpacity>
            </View>

            <ScrollView contentContainerStyle={styles.sheetBody}>
              {/* Product Info Bar with Real Image */}
              <View style={styles.productBanner}>
                <ProductThumbnail
                  imageUrl={productDetail?.sku?.product?.imageUrl}
                  productCode={productDetail?.sku?.product?.code}
                  name={productDetail?.sku?.product?.name}
                  categoryName={productDetail?.sku?.product?.category?.name}
                  size="lg"
                />
                <View style={styles.productBannerDetails}>
                  <Text style={styles.productPrice}>
                    {formatCurrency(productDetail?.sku?.sellingPrice || 0)}
                  </Text>
                  <Text style={styles.productBarcode}>
                    Barcode: {productDetail?.sku?.barcode}
                  </Text>
                  <Text style={styles.productCategory}>
                    {productDetail?.sku?.product?.category?.name || 'Bán lẻ'} · ĐVT: {productDetail?.sku?.product?.unit || 'sp'}
                  </Text>
                </View>
              </View>

              {/* Stock KPI Summary */}
              <View style={styles.stockSummaryRow}>
                <View style={styles.stockSummaryBox}>
                  <Text style={styles.stockSummaryLabel}>Tồn khả dụng</Text>
                  <Text style={[styles.stockSummaryVal, { color: Colors.primary }]}>
                    {productDetail?.totalAvailable || 0}
                  </Text>
                </View>
                <View style={styles.stockSummaryDivider} />
                <View style={styles.stockSummaryBox}>
                  <Text style={styles.stockSummaryLabel}>Tổng tồn kho</Text>
                  <Text style={styles.stockSummaryVal}>
                    {productDetail?.totalOnHand || 0}
                  </Text>
                </View>
              </View>

              {/* Lots & Expiry (FEFO) List */}
              <View style={styles.lotsSection}>
                <Text style={styles.lotsSectionTitle}>
                  Thông tin Lô và Hạn sử dụng
                </Text>

                {productDetail?.lots && productDetail.lots.length > 0 ? (
                  (productDetail.lots.some((l) => l.quantity > 0)
                    ? productDetail.lots.filter((l) => l.quantity > 0)
                    : productDetail.lots
                  ).map((lot) => {
                    const hasExpiry = lot.daysRemaining !== null && lot.daysRemaining !== undefined;
                    const isNearExp = (hasExpiry && (lot.daysRemaining as number) <= 15) || lot.expired;
                    const badgeLabel = lot.expired
                      ? 'Hết hạn'
                      : !hasExpiry
                      ? 'Không giới hạn HSD'
                      : `Còn ${lot.daysRemaining} ngày`;
                    return (
                      <View key={lot.id} style={styles.lotItemCard}>
                        <View style={styles.lotItemTop}>
                          <Text style={styles.lotItemNumber}>Lô: {lot.lotNumber || 'Mặc định'}</Text>
                          <Badge
                            label={badgeLabel}
                            variant={lot.expired ? 'danger' : isNearExp ? 'warning' : 'success'}
                            size="sm"
                          />
                        </View>
                        <View style={styles.lotItemBottom}>
                          <Text style={styles.lotItemQty}>
                            Số lượng: <Text style={{ fontWeight: 'bold' }}>{lot.quantity}</Text> {productDetail.sku.product.unit}
                          </Text>
                          <Text style={styles.lotItemExp}>
                            HSD: {lot.expiresAt ? new Date(lot.expiresAt).toLocaleDateString('vi-VN') : 'Không có'}
                          </Text>
                        </View>
                        <Text style={styles.lotItemZone}>
                          {lot.warehouseName ? `${lot.warehouseName} · ` : ''}Vị trí: {lot.zone}
                        </Text>
                      </View>
                    );
                  })
                ) : (
                  <View style={styles.noLotsBox}>
                    <Text style={styles.noLotsText}>Chưa có ghi nhận lô hạn dùng cụ thể cho mặt hàng này.</Text>
                  </View>
                )}
              </View>
            </ScrollView>

            <View style={styles.sheetFooter}>
              <View style={{ flexDirection: 'row', gap: 8, marginBottom: 8 }}>
                {canCreateStocktake(user) && (
                  <Button
                    title="Kiểm đếm"
                    variant="outline"
                    size="sm"
                    icon={<Ionicons name="clipboard-outline" size={16} color={Colors.primary} />}
                    onPress={() => {
                      const barcode = productDetail?.sku?.barcode || scannedData || '';
                      handleDismissResult();
                      router.push({ pathname: '/ops/quick-stocktake', params: { barcode } } as any);
                    }}
                    style={{ flex: 1 }}
                  />
                )}
                {canReportIncident(user) && (
                  <Button
                    title="Báo sự cố"
                    variant="outline"
                    size="sm"
                    icon={<Ionicons name="alert-circle-outline" size={16} color={Colors.warning} />}
                    onPress={() => {
                      const code = productDetail?.sku?.code || productDetail?.sku?.barcode || '';
                      const name = productDetail?.sku?.product?.name || '';
                      handleDismissResult();
                      router.push({ pathname: '/ops/incident', params: { code, name } } as any);
                    }}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
              <Button
                title="Quét mã tiếp theo"
                onPress={handleDismissResult}
                size="md"
              />
            </View>
          </View>
        </View>
      </Modal>

      {/* Manual Input Code Modal */}
      <Modal visible={manualModal} transparent animationType="slide">
        <View style={styles.modalBackdrop}>
          <View style={styles.manualCard}>
            <View style={styles.manualHeader}>
              <Text style={styles.manualTitle}>Nhập mã thủ công</Text>
              <TouchableOpacity onPress={() => setManualModal(false)}>
                <Ionicons name="close" size={24} color={Colors.muted} />
              </TouchableOpacity>
            </View>
            <Text style={styles.manualDesc}>
              Nhập mã vạch Barcode (EAN-13, SKU code) in trên bao bì sản phẩm:
            </Text>
            <TextInput
              style={styles.manualInput}
              value={manualCode}
              onChangeText={setManualCode}
              placeholder="vd: 8935001700123"
              keyboardType="number-pad"
              autoFocus
            />
            <View style={styles.manualActions}>
              <Button
                title="Hủy"
                variant="outline"
                size="sm"
                onPress={() => setManualModal(false)}
                style={{ flex: 1, marginRight: 8 }}
              />
              <Button
                title="Tra cứu"
                size="sm"
                onPress={handleManualSubmit}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  permissionContainer: {
    flex: 1,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  permissionIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  permissionTitle: {
    fontSize: Typography.sizes.xl,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 10,
  },
  permissionDesc: {
    fontSize: Typography.sizes.body,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
  },
  headerIconButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: Colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  cameraWrapper: {
    flex: 1,
    position: 'relative',
  },
  overlayLayer: {
    ...StyleSheet.absoluteFill,
  },
  unfocusedTop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  middleRow: {
    flexDirection: 'row',
    height: 250,
  },
  unfocusedSide: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
  },
  scanTargetBox: {
    width: 250,
    height: 250,
    position: 'relative',
    borderRadius: 16,
    overflow: 'hidden',
  },
  cornerMarker: {
    position: 'absolute',
    width: 28,
    height: 28,
    borderColor: Colors.primaryLight,
  },
  cornerTL: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 12 },
  cornerTR: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 12 },
  cornerBL: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 12 },
  cornerBR: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 12 },
  animatedLaser: {
    position: 'absolute',
    left: 8,
    right: 8,
    height: 12,
    justifyContent: 'center',
  },
  laserCore: {
    height: 2.5,
    backgroundColor: '#2dd4bf',
    borderRadius: 2,
    shadowColor: '#14b8a6',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 5,
  },
  laserGlow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 8,
    backgroundColor: 'rgba(45, 212, 191, 0.25)',
    borderRadius: 4,
  },
  unfocusedBottom: {
    flex: 1.5,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    paddingTop: 20,
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 41, 40, 0.8)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: Radius.pill,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  guideInstructionText: {
    color: '#ffffff',
    fontSize: Typography.sizes.caption,
    fontWeight: Typography.weights.medium,
  },
  controlsRow: {
    flexDirection: 'row',
    gap: 24,
    marginTop: 24,
  },
  floatingActionBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff',
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.button,
  },
  floatingActionBtnActive: {
    backgroundColor: Colors.primary,
  },
  loadingBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingBox: {
    backgroundColor: '#ffffff',
    padding: 24,
    borderRadius: Radius.card,
    alignItems: 'center',
    gap: 12,
  },
  loadingBoxText: {
    fontSize: Typography.sizes.body,
    color: Colors.text,
    fontWeight: Typography.weights.medium,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.backdrop,
    justifyContent: 'flex-end',
  },
  resultSheet: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '85%',
    paddingBottom: 24,
    ...Shadows.cardHover,
  },
  sheetHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#d1d5db',
    alignSelf: 'center',
    marginTop: 10,
    marginBottom: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: 20,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  sheetProductCode: {
    fontSize: Typography.sizes.caption,
    color: Colors.primary,
    fontWeight: Typography.weights.bold,
  },
  sheetProductName: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginTop: 2,
  },
  closeBtn: {
    padding: 4,
  },
  sheetBody: {
    padding: 20,
  },
  productBanner: {
    flexDirection: 'row',
    gap: 14,
    backgroundColor: Colors.surfaceSoft,
    padding: 12,
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    alignItems: 'center',
  },
  productBannerDetails: {
    flex: 1,
  },
  productPrice: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.primary,
  },
  productBarcode: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    marginTop: 2,
  },
  productCategory: {
    fontSize: Typography.sizes.caption,
    color: Colors.textSecondary,
    marginTop: 2,
  },
  stockSummaryRow: {
    flexDirection: 'row',
    backgroundColor: '#ffffff',
    borderRadius: Radius.card,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingVertical: 14,
    marginVertical: 14,
    ...Shadows.card,
  },
  stockSummaryBox: {
    flex: 1,
    alignItems: 'center',
  },
  stockSummaryLabel: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
  },
  stockSummaryVal: {
    fontSize: 22,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginTop: 2,
  },
  stockSummaryDivider: {
    width: 1,
    backgroundColor: Colors.border,
  },
  lotsSection: {
    marginTop: 4,
  },
  lotsSectionTitle: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginBottom: 8,
  },
  lotItemCard: {
    backgroundColor: '#ffffff',
    borderRadius: Radius.control,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 12,
    marginBottom: 8,
  },
  lotItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  lotItemNumber: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  lotItemBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  lotItemQty: {
    fontSize: Typography.sizes.caption,
    color: Colors.textSecondary,
  },
  lotItemExp: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
  },
  lotItemZone: {
    fontSize: 10,
    color: Colors.muted,
    marginTop: 4,
  },
  noLotsBox: {
    padding: 16,
    backgroundColor: Colors.surfaceSoft,
    borderRadius: Radius.control,
    alignItems: 'center',
  },
  noLotsText: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
  },
  sheetFooter: {
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  errorCard: {
    backgroundColor: '#ffffff',
    borderRadius: Radius.card,
    padding: 24,
    marginHorizontal: 24,
    alignItems: 'center',
    alignSelf: 'center',
    width: '85%',
  },
  errorIconWrap: {
    marginBottom: 10,
  },
  errorTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginBottom: 6,
  },
  errorDesc: {
    fontSize: Typography.sizes.body,
    color: Colors.muted,
    textAlign: 'center',
    lineHeight: 20,
  },
  manualCard: {
    backgroundColor: '#ffffff',
    borderRadius: Radius.card,
    padding: 20,
    marginHorizontal: 20,
    marginBottom: 40,
  },
  manualHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  manualTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  manualDesc: {
    fontSize: Typography.sizes.body,
    color: Colors.muted,
    marginBottom: 14,
    lineHeight: 20,
  },
  manualInput: {
    height: 48,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: Radius.control,
    paddingHorizontal: 12,
    fontSize: Typography.sizes.body,
    color: Colors.text,
    backgroundColor: Colors.surfaceSoft,
    marginBottom: 16,
  },
  manualActions: {
    flexDirection: 'row',
  },
});
