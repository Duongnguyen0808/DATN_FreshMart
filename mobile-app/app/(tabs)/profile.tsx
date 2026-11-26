import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography } from '../../src/constants/theme';
import { Header } from '../../src/components/ui/Header';
import { Card } from '../../src/components/ui/Card';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { BottomSheet } from '../../src/components/ui/BottomSheet';
import { StorePickerSheet } from '../../src/components/ui/StorePickerSheet';
import { useToast } from '../../src/components/ui/Toast';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { useAuth } from '../../src/contexts/auth-context';
import { getApiBaseUrl, setApiBaseUrl, DEFAULT_API_URL } from '../../src/services/api';
import {
  loadUserPreferences,
  saveUserPreferences,
  UserPreferences,
} from '../../src/services/preferences.service';
import { getRoleDisplayName } from '../../src/utils/rbac';
import { Store } from '../../src/types';

export default function ProfileScreen() {
  const router = useRouter();
  const { showToast } = useToast();
  const dialog = useAppDialog();
  const { user, activeStore, switchStore, logout } = useAuth();

  const [showStoreModal, setShowStoreModal] = useState(false);
  const [showDevModal, setShowDevModal] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());

  const [prefs, setPrefs] = useState<UserPreferences>({
    soundEnabled: true,
    hapticsEnabled: true,
    notificationsEnabled: true,
  });

  useEffect(() => {
    loadUserPreferences().then(setPrefs);
  }, []);

  const updatePref = async (patch: Partial<UserPreferences>) => {
    setPrefs((prev) => ({ ...prev, ...patch }));
    await saveUserPreferences(patch);
  };

  const handleSelectStore = async (store: Store) => {
    await switchStore(store);
    setShowStoreModal(false);
    showToast({ variant: 'success', title: 'Đã đổi chi nhánh', message: store.name });
  };

  const handleSaveServerUrl = async () => {
    try {
      await setApiBaseUrl(serverUrl);
      setShowDevModal(false);
      showToast({ variant: 'success', title: 'Đã lưu cấu hình API', message: serverUrl });
    } catch {
      showToast({ variant: 'error', message: 'Không thể lưu địa chỉ máy chủ.' });
    }
  };

  const handleLogout = () => {
    dialog.confirm({
      title: 'Đăng xuất',
      message: 'Bạn có chắc chắn muốn đăng xuất khỏi FreshMart Ops?',
      confirmText: 'Đăng xuất',
      cancelText: 'Hủy',
      destructive: true,
      onConfirm: () => void logout(),
    });
  };

  const canShowDevSettings = __DEV__ || !!user?.globalAccess;

  return (
    <View style={styles.container}>
      <Header title="Cá nhân" subtitle="Tài khoản & Cài đặt" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Account Summary */}
        <Card style={styles.profileCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>
              {user?.name ? user.name.trim().slice(0, 2).toUpperCase() : 'NV'}
            </Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user?.name || 'Nhân viên'}</Text>
            <Text style={styles.profileEmail}>{user?.email}</Text>
            <Text style={styles.profileRole}>{getRoleDisplayName(user)}</Text>
          </View>
        </Card>

        {/* Branch Switcher */}
        <Text style={styles.sectionLabel}>CHI NHÁNH LÀM VIỆC</Text>
        <Card style={styles.listCard} onPress={() => setShowStoreModal(true)}>
          <View style={styles.row}>
            <Ionicons name="storefront-outline" size={18} color={Colors.primary} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{activeStore?.name || 'Chưa chọn chi nhánh'}</Text>
              {activeStore?.address ? (
                <Text style={styles.rowSub} numberOfLines={1}>
                  {activeStore.address}
                </Text>
              ) : null}
            </View>
            <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
          </View>
        </Card>

        {/* Personal History & Logs (Compact) */}
        <Text style={styles.sectionLabel}>LỊCH SỬ CÁ NHÂN</Text>
        <Card style={styles.listCard}>
          <TouchableOpacity style={styles.row} onPress={() => router.push('/ops/activity')}>
            <Ionicons name="time-outline" size={18} color={Colors.textSecondary} />
            <Text style={[styles.rowTitle, { flex: 1 }]}>Nhật ký hoạt động của tôi</Text>
            <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
          </TouchableOpacity>
        </Card>

        {/* App Settings */}
        <Text style={styles.sectionLabel}>CÀI ĐẶT</Text>
        <Card style={styles.listCard}>
          <View style={styles.row}>
            <Ionicons name="notifications-outline" size={18} color={Colors.textSecondary} />
            <Text style={[styles.rowTitle, { flex: 1 }]}>Thông báo cảnh báo</Text>
            <Switch
              value={prefs.notificationsEnabled}
              onValueChange={(v) => updatePref({ notificationsEnabled: v })}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Ionicons name="volume-medium-outline" size={18} color={Colors.textSecondary} />
            <Text style={[styles.rowTitle, { flex: 1 }]}>Âm thanh quét mã</Text>
            <Switch
              value={prefs.soundEnabled}
              onValueChange={(v) => updatePref({ soundEnabled: v })}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
          <View style={styles.divider} />
          <View style={styles.row}>
            <Ionicons name="phone-portrait-outline" size={18} color={Colors.textSecondary} />
            <Text style={[styles.rowTitle, { flex: 1 }]}>Rung phản hồi (Haptic)</Text>
            <Switch
              value={prefs.hapticsEnabled}
              onValueChange={(v) => updatePref({ hapticsEnabled: v })}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor="#FFFFFF"
            />
          </View>
        </Card>

        {/* Developer Settings (Only __DEV__ or globalAccess) */}
        {canShowDevSettings && (
          <>
            <Text style={styles.sectionLabel}>DEVELOPER SETTINGS</Text>
            <Card style={styles.listCard}>
              <TouchableOpacity
                style={styles.row}
                onPress={() => {
                  setServerUrl(getApiBaseUrl());
                  setShowDevModal(true);
                }}
              >
                <Ionicons name="server-outline" size={18} color={Colors.muted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>Máy chủ Backend API</Text>
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {getApiBaseUrl()}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={Colors.textLight} />
              </TouchableOpacity>
            </Card>
          </>
        )}

        {/* App Version */}
        <Text style={styles.versionText}>FreshMart Ops · Phiên bản 2.0.0</Text>

        {/* Logout */}
        <Button
          title="Đăng xuất"
          variant="outline"
          onPress={handleLogout}
          textStyle={{ color: Colors.danger }}
          style={styles.logoutBtn}
        />
      </ScrollView>

      {/* Shared Switch Store Bottom Sheet */}
      <StorePickerSheet
        visible={showStoreModal}
        onClose={() => setShowStoreModal(false)}
        stores={user?.stores || []}
        activeStoreId={activeStore?.id}
        onSelect={handleSelectStore}
      />

      {/* Developer API Bottom Sheet */}
      <BottomSheet
        visible={showDevModal}
        onClose={() => setShowDevModal(false)}
        title="Cấu hình Backend API"
        subtitle="Chỉ dành cho môi trường phát triển hoặc quản trị"
      >
        <Input
          label="API Base URL"
          value={serverUrl}
          onChangeText={setServerUrl}
          placeholder={DEFAULT_API_URL}
          autoCapitalize="none"
          autoCorrect={false}
        />
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Button
            title="Mặc định"
            variant="outline"
            size="sm"
            onPress={async () => {
              setServerUrl(DEFAULT_API_URL);
              await setApiBaseUrl(DEFAULT_API_URL);
              setShowDevModal(false);
              showToast({ variant: 'info', message: 'Đã khôi phục API mặc định.' });
            }}
            style={{ flex: 1 }}
          />
          <Button title="Lưu" size="sm" onPress={handleSaveServerUrl} style={{ flex: 1 }} />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 14, paddingBottom: 36 },
  profileCard: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 15, fontWeight: Typography.weights.bold, color: Colors.primaryDark },
  profileName: { fontSize: Typography.sizes.title, fontWeight: Typography.weights.semibold, color: Colors.text },
  profileEmail: { fontSize: Typography.sizes.sm, color: Colors.muted, marginTop: 1 },
  profileRole: { fontSize: Typography.sizes.caption, color: Colors.primary, fontWeight: Typography.weights.medium, marginTop: 2 },
  sectionLabel: {
    fontSize: 11,
    fontWeight: Typography.weights.semibold,
    color: Colors.muted,
    letterSpacing: 0.4,
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 4,
  },
  listCard: { paddingVertical: 2, paddingHorizontal: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
  rowTitle: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.medium, color: Colors.text },
  rowSub: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 1 },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: Colors.border, marginLeft: 28 },
  versionText: {
    fontSize: 11,
    color: Colors.textLight,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 12,
  },
  logoutBtn: { borderColor: Colors.dangerBorder },
  modalBackdrop: { flex: 1, backgroundColor: Colors.backdrop, justifyContent: 'flex-end' },
  modalBackdropCenter: { flex: 1, backgroundColor: Colors.backdrop, justifyContent: 'center', padding: 20 },
  modalSheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: 16,
    paddingBottom: 32,
  },
  modalBox: { backgroundColor: Colors.surface, borderRadius: Radius.lg, padding: 16 },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  modalTitle: { fontSize: Typography.sizes.title, fontWeight: Typography.weights.bold, color: Colors.text },
  storeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: Radius.control,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderSoft,
  },
  storeRowSelected: { backgroundColor: Colors.primaryWash },
  storeName: { fontSize: Typography.sizes.body, fontWeight: Typography.weights.semibold, color: Colors.text },
  storeAddr: { fontSize: Typography.sizes.caption, color: Colors.muted, marginTop: 2 },
  emptyModalText: { textAlign: 'center', color: Colors.muted, padding: 20 },
});
