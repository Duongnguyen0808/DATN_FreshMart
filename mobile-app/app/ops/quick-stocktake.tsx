import React, { useState, useRef, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography, Shadows } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Badge } from '../../src/components/ui/Badge';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { ProductThumbnail } from '../../src/components/ui/ProductThumbnail';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { useAuth } from '../../src/contexts/auth-context';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';
import { lookupProductByBarcode } from '../../src/services/product.service';
import {
  fetchQuickStocktakes,
  submitQuickStocktake,
} from '../../src/services/mobile-ops.service';
import { triggerScanSuccessFeedback, triggerErrorFeedback } from '../../src/services/audio.service';
import { ProductStockDetail } from '../../src/types';

export default function QuickStocktakeScreen() {
  const { barcode: initialBarcode } = useLocalSearchParams<{ barcode?: string }>();
  const { activeStore } = useAuth();
  const dialog = useAppDialog();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();

  const [scannerOpen, setScannerOpen] = useState(false);
  const [barcodeInput, setBarcodeInput] = useState(initialBarcode || '');
  const [lookingUp, setLookingUp] = useState(false);
  const [foundProduct, setFoundProduct] = useState<ProductStockDetail | null>(null);
  const [actualQty, setActualQty] = useState('');
  const [note, setNote] = useState('');
  const scanLock = useRef(false);
  const didAutoLookup = useRef(false);

  useEffect(() => {
    if (initialBarcode && !didAutoLookup.current) {
      didAutoLookup.current = true;
      void handleLookup(String(initialBarcode));
    }
  }, [initialBarcode]);

  const { data: reports = [], refetch } = useQuery({
    queryKey: ['quick-stocktakes', activeStore?.id],
    queryFn: () => fetchQuickStocktakes({ storeId: activeStore?.id }),
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const submitMutation = useMutation({
    mutationFn: submitQuickStocktake,
    onSuccess: (created) => {
      triggerScanSuccessFeedback();
      dialog.success(
        'Đã gửi kiểm đếm',
        `Phiếu ${created.code} đã được gửi tới Quản lý xác nhận. Tồn kho hệ thống chưa bị thay đổi.`
      );
      setFoundProduct(null);
      setBarcodeInput('');
      setActualQty('');
      setNote('');
      queryClient.invalidateQueries({ queryKey: ['quick-stocktakes'] });
      queryClient.invalidateQueries({ queryKey: ['personal-activities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err: any) => {
      triggerErrorFeedback();
      dialog.error('Gửi thất bại', err?.message || 'Không thể gửi phiếu kiểm đếm.');
    },
  });

  const handleLookup = async (code: string) => {
    const clean = code.trim();
    if (!clean) return;
    setLookingUp(true);
    try {
      const res = await lookupProductByBarcode(clean, activeStore?.id);
      setFoundProduct(res);
      setBarcodeInput(clean);
      setActualQty(String(res.totalOnHand));
      await triggerScanSuccessFeedback();
    } catch (err: any) {
      await triggerErrorFeedback();
      dialog.error('Không tìm thấy mã', err?.message || `Không tìm thấy sản phẩm với mã "${clean}".`);
    } finally {
      setLookingUp(false);
    }
  };

  const handleOpenScanner = async () => {
    if (!permission?.granted) {
      const req = await requestPermission();
      if (!req.granted) {
        dialog.warning('Cần quyền Camera', 'Vui lòng cấp quyền Camera để quét mã vạch kiểm đếm.');
        return;
      }
    }
    scanLock.current = false;
    setScannerOpen(true);
  };

  const handleBarcodeScanned = ({ data }: { data: string }) => {
    if (scanLock.current || !data) return;
    const clean = data.trim();
    if (/^https?:\/\//i.test(clean) || clean.length > 40) return;
    scanLock.current = true;
    setScannerOpen(false);
    void handleLookup(clean);
  };

  const handleSubmit = () => {
    if (!foundProduct) return;
    const parsed = Number(actualQty);
    if (!Number.isInteger(parsed) || parsed < 0) {
      dialog.warning('Số lượng không hợp lệ', 'Vui lòng nhập số nguyên lớn hơn hoặc bằng 0.');
      return;
    }
    submitMutation.mutate({
      storeId: activeStore?.id,
      barcode: foundProduct.sku.barcode,
      actualQuantity: parsed,
      note: note.trim() || null,
    });
  };

  const systemQty = foundProduct?.totalOnHand ?? 0;
  const parsedActual = actualQty.trim() === '' ? null : Number(actualQty);
  const diff =
    parsedActual !== null && !Number.isNaN(parsedActual) ? parsedActual - systemQty : null;

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        title="Kiểm đếm nhanh"
        subtitle={activeStore ? `Chi nhánh ${activeStore.name}` : 'Gửi quản lý xác nhận'}
        showBack
      />

      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={Colors.primary}
          />
        }
      >
        {/* Notice */}
        <View style={styles.noticeBox}>
          <Ionicons name="information-circle-outline" size={18} color={Colors.primaryDark} />
          <Text style={styles.noticeText}>
            Phiếu kiểm đếm nhanh sẽ được gửi lên Quản lý duyệt trên Web Admin, không tự động làm thay đổi tồn kho.
          </Text>
        </View>

        {/* Barcode Search / Scan Card */}
        <Card style={styles.card}>
          <Text style={styles.cardTitle}>1. Quét hoặc nhập mã sản phẩm</Text>
          <View style={styles.searchRow}>
            <View style={{ flex: 1 }}>
              <Input
                placeholder="Nhập mã vạch Barcode..."
                value={barcodeInput}
                onChangeText={setBarcodeInput}
                containerStyle={{ marginBottom: 0 }}
                leftIcon="barcode-outline"
              />
            </View>
            <TouchableOpacity style={styles.camButton} onPress={handleOpenScanner}>
              <Ionicons name="camera" size={22} color="#ffffff" />
            </TouchableOpacity>
          </View>
          <Button
            title="Tra cứu tồn hệ thống"
            variant="secondary"
            size="sm"
            loading={lookingUp}
            onPress={() => handleLookup(barcodeInput)}
            style={{ marginTop: 10 }}
          />
        </Card>

        {/* Count Form when product found */}
        {foundProduct && (
          <Card style={styles.card}>
            <Text style={styles.cardTitle}>2. Nhập số lượng thực đếm</Text>
            <View style={styles.productRow}>
              <ProductThumbnail
                imageUrl={foundProduct.sku.product.imageUrl}
                productCode={foundProduct.sku.product.code}
                name={foundProduct.sku.product.name}
                size="md"
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.productName}>{foundProduct.sku.product.name}</Text>
                <Text style={styles.productMeta}>
                  {foundProduct.sku.code} · {foundProduct.sku.barcode}
                </Text>
                <Text style={styles.systemStockText}>
                  Tồn hệ thống: <Text style={{ fontWeight: 'bold' }}>{systemQty}</Text>{' '}
                  {foundProduct.sku.product.unit}
                </Text>
              </View>
            </View>

            <Input
              label="Số lượng đếm thực tế"
              value={actualQty}
              onChangeText={setActualQty}
              keyboardType="number-pad"
              placeholder="Nhập số lượng thực tế..."
            />

            {diff !== null && (
              <View
                style={[
                  styles.diffBanner,
                  diff === 0
                    ? { backgroundColor: Colors.successBg, borderColor: Colors.successBorder }
                    : diff < 0
                    ? { backgroundColor: Colors.dangerBg, borderColor: Colors.dangerBorder }
                    : { backgroundColor: Colors.warningBg, borderColor: Colors.warningBorder },
                ]}
              >
                <Text
                  style={[
                    styles.diffText,
                    { color: diff === 0 ? Colors.success : diff < 0 ? Colors.danger : Colors.warning },
                  ]}
                >
                  Chênh lệch: {diff > 0 ? `+${diff}` : diff} {foundProduct.sku.product.unit} (
                  {diff === 0 ? 'Khớp tồn hệ thống' : diff < 0 ? 'Thiếu hụt' : 'Thừa hàng'})
                </Text>
              </View>
            )}

            <Input
              label="Ghi chú kiểm đếm (tùy chọn)"
              value={note}
              onChangeText={setNote}
              placeholder="Ví dụ: Đếm lại kệ nước giải khát tầng 2..."
            />

            <Button
              title="Gửi quản lý xác nhận"
              loading={submitMutation.isPending}
              onPress={handleSubmit}
            />
          </Card>
        )}

        {/* Submitted History */}
        <Text style={styles.sectionTitle}>Phiếu kiểm đếm gần đây ({reports.length})</Text>
        {reports.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>Chưa có phiếu kiểm đếm nhanh nào được gửi.</Text>
          </Card>
        ) : (
          reports.slice(0, 15).map((r) => (
            <Card key={r.id} style={styles.historyCard}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
                <ProductThumbnail
                  productCode={r.skuCode}
                  name={r.productName}
                  size="md"
                />
                <View style={{ flex: 1 }}>
                  <View style={styles.historyTop}>
                    <Text style={styles.historyCode} numberOfLines={1}>{r.code}</Text>
                    <Badge
                      label={
                        r.status === 'PENDING'
                          ? 'Chờ duyệt'
                          : r.status === 'APPROVED'
                          ? 'Đã xác nhận'
                          : 'Từ chối'
                      }
                      variant={
                        r.status === 'APPROVED'
                          ? 'success'
                          : r.status === 'REJECTED'
                          ? 'danger'
                          : 'warning'
                      }
                      size="sm"
                    />
                  </View>
                  <Text style={styles.historyProduct}>{r.productName}</Text>
                  <Text style={styles.historyStats}>
                    Hệ thống: {r.systemQuantity} · Thực tế: {r.actualQuantity} · Lệch:{' '}
                    <Text
                      style={{
                        fontWeight: 'bold',
                        color: r.difference < 0 ? Colors.danger : r.difference > 0 ? Colors.warning : Colors.success,
                      }}
                    >
                      {r.difference > 0 ? `+${r.difference}` : r.difference}
                    </Text>
                  </Text>
                  {r.note ? <Text style={styles.historyNote}>Ghi chú: {r.note}</Text> : null}
                  <Text style={styles.historyTime}>
                    {r.reportedByName} · {new Date(r.createdAt).toLocaleString('vi-VN')}
                  </Text>
                </View>
              </View>
            </Card>
          ))
        )}
      </ScrollView>

      {/* Camera Scanner Modal */}
      <Modal visible={scannerOpen} animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{
              barcodeTypes: ['ean13', 'ean8', 'code128', 'code39', 'qr', 'upc_a', 'upc_e'],
            }}
            onBarcodeScanned={handleBarcodeScanned}
          />
          <View style={styles.scannerCloseWrap}>
            <Button
              title="Đóng Camera"
              variant="secondary"
              onPress={() => setScannerOpen(false)}
            />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  noticeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    borderRadius: Radius.control,
    padding: 12,
    marginBottom: 14,
  },
  noticeText: {
    flex: 1,
    fontSize: Typography.sizes.caption,
    color: Colors.primaryDark,
    lineHeight: 17,
  },
  card: { padding: 16, marginBottom: 14 },
  cardTitle: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginBottom: 12,
  },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  camButton: {
    width: 48,
    height: 48,
    borderRadius: Radius.control,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    ...Shadows.button,
  },
  productRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: Colors.surfaceSoft,
    padding: 10,
    borderRadius: Radius.control,
    marginBottom: 14,
  },
  productName: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.bold, color: Colors.text },
  productMeta: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 2 },
  systemStockText: { fontSize: Typography.sizes.caption, color: Colors.primaryDark, marginTop: 4 },
  diffBanner: {
    padding: 10,
    borderRadius: Radius.control,
    borderWidth: 1,
    marginBottom: 14,
  },
  diffText: { fontSize: Typography.sizes.sm, fontWeight: Typography.weights.bold },
  sectionTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginTop: 6,
    marginBottom: 10,
  },
  emptyCard: { padding: 20, alignItems: 'center' },
  emptyText: { fontSize: Typography.sizes.sm, color: Colors.muted },
  historyCard: { padding: 14, marginBottom: 10 },
  historyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyCode: { fontSize: Typography.sizes.caption, fontWeight: Typography.weights.bold, color: Colors.primary },
  historyProduct: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.bold, color: Colors.text },
  historyStats: { fontSize: Typography.sizes.caption, color: Colors.textSecondary, marginTop: 4 },
  historyNote: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 3 },
  historyTime: { fontSize: 10, color: Colors.muted, marginTop: 6 },
  scannerCloseWrap: {
    position: 'absolute',
    bottom: 40,
    left: 24,
    right: 24,
  },
});
