import React, { useState, useRef, useEffect } from 'react';
import { useLocalSearchParams } from 'expo-router';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Modal,
  Image,
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
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { useAuth } from '../../src/contexts/auth-context';
import { useManualRefresh } from '../../src/hooks/useManualRefresh';
import {
  fetchIncidentReports,
  submitIncidentReport,
} from '../../src/services/mobile-ops.service';
import { triggerScanSuccessFeedback, triggerErrorFeedback } from '../../src/services/audio.service';

type IncidentType = 'DAMAGED' | 'EXPIRED' | 'STOCK_MISMATCH' | 'IOT_DEVICE';

const INCIDENT_TYPES: Array<{ value: IncidentType; label: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { value: 'DAMAGED', label: 'Hàng hư hỏng', icon: 'cube-outline' },
  { value: 'EXPIRED', label: 'Hàng hết hạn', icon: 'time-outline' },
  { value: 'STOCK_MISMATCH', label: 'Lệch tồn kho', icon: 'swap-vertical-outline' },
  { value: 'IOT_DEVICE', label: 'Sự cố IoT', icon: 'hardware-chip-outline' },
];

const INCIDENT_TYPE_VI: Record<string, string> = {
  DAMAGED: 'Hàng hư hỏng',
  DAMAGED_GOODS: 'Hàng hư hỏng',
  EXPIRED: 'Hàng hết hạn',
  STOCK_MISMATCH: 'Lệch tồn kho',
  IOT_DEVICE: 'Sự cố IoT',
  DEVICE_MALFUNCTION: 'Sự cố thiết bị IoT',
};

function getIncidentStatusMeta(status: string): {
  label: string;
  shortLabel: string;
  variant: 'danger' | 'info' | 'success';
} {
  if (status === 'RESOLVED') {
    return { label: 'Đã xử lý xong', shortLabel: 'Đã xử lý', variant: 'success' };
  }
  if (status === 'IN_PROGRESS') {
    return { label: 'Đã tiếp nhận · Đang xử lý', shortLabel: 'Đang xử lý', variant: 'info' };
  }
  return { label: 'Mới gửi · Chờ tiếp nhận', shortLabel: 'Mới gửi', variant: 'danger' };
}

export default function IncidentReportScreen() {
  const { code: initialCode, name: initialName } = useLocalSearchParams<{ code?: string; name?: string }>();
  const { activeStore } = useAuth();
  const dialog = useAppDialog();
  const queryClient = useQueryClient();
  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<any>(null);

  const [type, setType] = useState<IncidentType>('DAMAGED');
  const [title, setTitle] = useState(initialName ? `Sự cố sản phẩm: ${initialName}` : '');
  const [relatedCode, setRelatedCode] = useState(initialCode || '');
  const [description, setDescription] = useState('');
  const [photoDataUrl, setPhotoDataUrl] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [selectedIncident, setSelectedIncident] = useState<
    Awaited<ReturnType<typeof fetchIncidentReports>>[number] | null
  >(null);

  useEffect(() => {
    if (initialCode) setRelatedCode(String(initialCode));
    if (initialName) setTitle(`Sự cố sản phẩm: ${initialName}`);
  }, [initialCode, initialName]);

  const { data: incidents = [], refetch } = useQuery({
    queryKey: ['incident-reports', activeStore?.id],
    queryFn: () => fetchIncidentReports({ storeId: activeStore?.id }),
  });

  const { refreshing, onRefresh } = useManualRefresh(refetch);

  const submitMutation = useMutation({
    mutationFn: submitIncidentReport,
    onSuccess: (created) => {
      triggerScanSuccessFeedback();
      dialog.success('Đã gửi báo cáo sự cố', `Mã sự cố ${created.code} đã được gửi lên Quản lý.`);
      setTitle('');
      setRelatedCode('');
      setDescription('');
      setPhotoDataUrl(null);
      queryClient.invalidateQueries({ queryKey: ['incident-reports'] });
      queryClient.invalidateQueries({ queryKey: ['personal-activities'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary'] });
    },
    onError: (err: any) => {
      triggerErrorFeedback();
      dialog.error('Gửi thất bại', err?.message || 'Không thể gửi báo cáo sự cố.');
    },
  });

  const handleOpenCamera = async () => {
    if (!permission?.granted) {
      const req = await requestPermission();
      if (!req.granted) {
        dialog.warning('Cần quyền Camera', 'Vui lòng cấp quyền Camera để chụp ảnh minh chứng sự cố.');
        return;
      }
    }
    setCameraOpen(true);
  };

  const handleCapture = async () => {
    if (!cameraRef.current || capturing) return;
    setCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true,
        quality: 0.4,
      });
      if (photo?.base64) {
        setPhotoDataUrl(`data:image/jpeg;base64,${photo.base64}`);
      }
      setCameraOpen(false);
    } catch {
      dialog.error('Lỗi chụp ảnh', 'Không thể chụp ảnh, vui lòng thử lại.');
    } finally {
      setCapturing(false);
    }
  };

  const handleSubmit = () => {
    if (title.trim().length < 3 || description.trim().length < 3) {
      dialog.warning('Thiếu thông tin', 'Vui lòng nhập tiêu đề và mô tả sự cố (tối thiểu 3 ký tự).');
      return;
    }
    submitMutation.mutate({
      storeId: activeStore?.id,
      type,
      title: title.trim(),
      description: description.trim(),
      relatedCode: relatedCode.trim() || null,
      imageUrl: photoDataUrl,
    });
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Header
        title="Báo cáo sự cố"
        subtitle={activeStore ? `Chi nhánh ${activeStore.name}` : 'Gửi quản lý xử lý'}
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
        <Card style={styles.formCard}>
          <Text style={styles.label}>Loại sự cố</Text>
          <View style={styles.typeGrid}>
            {INCIDENT_TYPES.map((item) => {
              const active = type === item.value;
              return (
                <TouchableOpacity
                  key={item.value}
                  style={[styles.typeChip, active ? styles.typeChipActive : undefined]}
                  onPress={() => setType(item.value)}
                >
                  <Ionicons
                    name={item.icon}
                    size={16}
                    color={active ? '#ffffff' : Colors.primaryDark}
                  />
                  <Text style={[styles.typeChipText, active ? styles.typeChipTextActive : undefined]}>
                    {item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          <Input
            label="Tiêu đề sự cố"
            placeholder="VD: Hộp sữa tươi bị móp nắp ở kệ A2"
            value={title}
            onChangeText={setTitle}
          />

          <Input
            label="Mã sản phẩm / Lô / Thiết bị liên quan (tùy chọn)"
            placeholder="VD: PRD-YM-041 hoặc ESP32-CAM"
            value={relatedCode}
            onChangeText={setRelatedCode}
          />

          <Input
            label="Mô tả chi tiết"
            placeholder="Mô tả tình trạng, số lượng ảnh hưởng và vị trí..."
            value={description}
            onChangeText={setDescription}
            multiline
            numberOfLines={4}
          />

          {/* Photo Capture Section */}
          <Text style={styles.label}>Ảnh chụp thực tế từ iPhone</Text>
          {photoDataUrl ? (
            <View style={styles.photoPreviewWrap}>
              <Image source={{ uri: photoDataUrl }} style={styles.photoPreview} resizeMode="cover" />
              <TouchableOpacity
                style={styles.removePhotoBtn}
                onPress={() => setPhotoDataUrl(null)}
              >
                <Ionicons name="close-circle" size={24} color={Colors.danger} />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity style={styles.cameraPickBox} onPress={handleOpenCamera}>
              <Ionicons name="camera-outline" size={26} color={Colors.primary} />
              <Text style={styles.cameraPickText}>Chụp ảnh minh chứng bằng Camera</Text>
            </TouchableOpacity>
          )}

          <Button
            title="Gửi báo cáo cho quản lý"
            loading={submitMutation.isPending}
            onPress={handleSubmit}
            style={{ marginTop: 14 }}
          />
        </Card>

        {/* My / Store Submitted Reports */}
        <Text style={styles.sectionTitle}>Báo cáo sự cố gần đây ({incidents.length})</Text>
        {incidents.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Text style={styles.emptyText}>Chưa có báo cáo sự cố nào được ghi nhận.</Text>
          </Card>
        ) : (
          incidents.slice(0, 15).map((inc) => {
            const st = getIncidentStatusMeta(inc.status);
            return (
              <TouchableOpacity
                key={inc.id}
                activeOpacity={0.78}
                onPress={() => setSelectedIncident(inc)}
              >
                <Card style={styles.historyCard}>
                  <View style={styles.historyTop}>
                    <Text style={styles.historyCode}>{inc.code}</Text>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Badge label={st.shortLabel} variant={st.variant} size="sm" />
                      <Ionicons name="chevron-forward" size={16} color={Colors.muted} />
                    </View>
                  </View>
                  <View style={styles.historyBodyRow}>
                    {inc.imageUrl ? (
                      <Image source={{ uri: inc.imageUrl }} style={styles.historyThumb} />
                    ) : null}
                    <View style={{ flex: 1 }}>
                      <Text style={styles.historyTitle} numberOfLines={1}>
                        {inc.title}
                      </Text>
                      <Text style={styles.historyTime} numberOfLines={1}>
                        {inc.reportedByName} · {new Date(inc.createdAt).toLocaleString('vi-VN')}
                      </Text>
                    </View>
                  </View>
                </Card>
              </TouchableOpacity>
            );
          })
        )}
      </ScrollView>

      {/* Incident Detail BottomSheet */}
      <BottomSheet
        visible={!!selectedIncident}
        onClose={() => setSelectedIncident(null)}
        title={selectedIncident ? `Chi tiết sự cố ${selectedIncident.code}` : 'Chi tiết sự cố'}
        subtitle={
          selectedIncident
            ? INCIDENT_TYPE_VI[selectedIncident.type] || selectedIncident.type
            : undefined
        }
      >
        {selectedIncident ? (
          <View style={{ gap: 12, paddingBottom: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ fontSize: 13, color: Colors.muted, fontWeight: '600' }}>Trạng thái xử lý</Text>
              <Badge
                label={getIncidentStatusMeta(selectedIncident.status).label}
                variant={getIncidentStatusMeta(selectedIncident.status).variant}
                size="sm"
              />
            </View>

            <View style={{ backgroundColor: '#f5fbf9', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: Colors.border, gap: 6 }}>
              <Text style={{ fontSize: 15, fontWeight: '700', color: Colors.text }}>
                {selectedIncident.title}
              </Text>
              <Text style={{ fontSize: 13, color: Colors.textSecondary, lineHeight: 19 }}>
                {selectedIncident.description}
              </Text>
            </View>

            {selectedIncident.imageUrl ? (
              <Image
                source={{ uri: selectedIncident.imageUrl }}
                style={{ width: '100%', height: 200, borderRadius: 14, backgroundColor: '#eef3f2' }}
                resizeMode="cover"
              />
            ) : null}

            <View style={{ gap: 6, paddingTop: 4 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: Colors.muted }}>Người báo cáo</Text>
                <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.text }}>
                  {selectedIncident.reportedByName}
                </Text>
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                <Text style={{ fontSize: 12, color: Colors.muted }}>Thời gian gửi</Text>
                <Text style={{ fontSize: 13, color: Colors.text }}>
                  {new Date(selectedIncident.createdAt).toLocaleString('vi-VN')}
                </Text>
              </View>
              {selectedIncident.relatedCode ? (
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ fontSize: 12, color: Colors.muted }}>Đối tượng liên quan</Text>
                  <Text style={{ fontSize: 13, fontWeight: '600', color: Colors.primaryDark }}>
                    {selectedIncident.relatedCode}
                  </Text>
                </View>
              ) : null}
            </View>

            {selectedIncident.resolutionNote ? (
              <View style={{ backgroundColor: '#e6f7f5', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#b7e4dc', gap: 4 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: Colors.primaryDark }}>
                  Phản hồi từ Quản lý
                </Text>
                <Text style={{ fontSize: 13, color: Colors.text, lineHeight: 19 }}>
                  {selectedIncident.resolutionNote}
                </Text>
              </View>
            ) : (
              <View style={{ backgroundColor: '#fffbeb', borderRadius: 12, padding: 11, borderWidth: 1, borderColor: '#fde68a' }}>
                <Text style={{ fontSize: 12.5, color: '#92400e' }}>
                  {selectedIncident.status === 'IN_PROGRESS'
                    ? 'Quản lý đã tiếp nhận và đang tiến hành xử lý sự cố này.'
                    : selectedIncident.status === 'RESOLVED'
                    ? 'Sự cố đã được Quản lý xác nhận hoàn tất.'
                    : 'Đang chờ Quản lý trên Web Admin tiếp nhận xử lý.'}
                </Text>
              </View>
            )}

            <Button title="Đóng" onPress={() => setSelectedIncident(null)} />
          </View>
        ) : null}
      </BottomSheet>

      {/* Camera Capture Modal */}
      <Modal visible={cameraOpen} animationType="slide">
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <CameraView ref={cameraRef} style={StyleSheet.absoluteFill} facing="back" />
          <View style={styles.cameraFooter}>
            <Button
              title="Hủy"
              variant="outline"
              onPress={() => setCameraOpen(false)}
              style={{ backgroundColor: '#ffffff', width: 90 }}
            />
            <TouchableOpacity
              style={styles.shutterButton}
              disabled={capturing}
              onPress={handleCapture}
            >
              <View style={styles.shutterInner} />
            </TouchableOpacity>
            <View style={{ width: 90 }} />
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 40 },
  formCard: { padding: 16, marginBottom: 16 },
  label: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.medium,
    color: Colors.text,
    marginBottom: 8,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  typeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: Radius.control,
    backgroundColor: Colors.surfaceSoft,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
  },
  typeChipActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  typeChipText: {
    fontSize: Typography.sizes.caption,
    fontWeight: Typography.weights.semibold,
    color: Colors.primaryDark,
  },
  typeChipTextActive: {
    color: '#ffffff',
  },
  cameraPickBox: {
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: Colors.borderFocus,
    borderRadius: Radius.control,
    backgroundColor: Colors.surfaceSoft,
    paddingVertical: 20,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  cameraPickText: {
    fontSize: Typography.sizes.caption,
    color: Colors.primaryDark,
    fontWeight: Typography.weights.semibold,
  },
  photoPreviewWrap: {
    position: 'relative',
    borderRadius: Radius.control,
    overflow: 'hidden',
    height: 160,
  },
  photoPreview: {
    width: '100%',
    height: '100%',
  },
  removePhotoBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: '#ffffff',
    borderRadius: 12,
  },
  sectionTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    marginBottom: 10,
  },
  emptyCard: { padding: 20, alignItems: 'center' },
  emptyText: { fontSize: Typography.sizes.sm, color: Colors.muted },
  historyCard: { padding: 14, marginBottom: 10 },
  historyTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  historyCode: { fontSize: Typography.sizes.caption, fontWeight: Typography.weights.bold, color: Colors.primary },
  historyBodyRow: { flexDirection: 'row', gap: 10 },
  historyThumb: {
    width: 60,
    height: 60,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surfaceSoft,
  },
  historyTitle: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.bold, color: Colors.text },
  historyDesc: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 2 },
  resolutionText: { fontSize: Typography.sizes.caption, color: Colors.success, marginTop: 4, fontWeight: Typography.weights.semibold },
  historyTime: { fontSize: 10, color: Colors.muted, marginTop: 6 },
  cameraFooter: {
    position: 'absolute',
    bottom: 42,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  shutterButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgba(255,255,255,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: '#ffffff',
  },
  shutterInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: '#ffffff',
  },
});
