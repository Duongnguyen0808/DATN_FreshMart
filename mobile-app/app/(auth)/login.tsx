import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  TouchableOpacity,
  Modal,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors, Radius, Typography } from '../../src/constants/theme';
import { Button } from '../../src/components/ui/Button';
import { Input } from '../../src/components/ui/Input';
import { useAppDialog } from '../../src/components/ui/AppDialog';
import { useAuth } from '../../src/contexts/auth-context';
import { getApiBaseUrl, setApiBaseUrl, DEFAULT_API_URL } from '../../src/services/api';

const LOGO_IMG = require('../../assets/logo.png');

export default function LoginScreen() {
  const { login } = useAuth();
  const dialog = useAppDialog();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Dev-only server URL settings modal
  const [showServerModal, setShowServerModal] = useState(false);
  const [serverUrl, setServerUrl] = useState(getApiBaseUrl());

  const handleLogin = async () => {
    const trimmedEmail = email.trim();
    let hasErr = false;

    if (!trimmedEmail) {
      setEmailError('Vui lòng nhập địa chỉ email.');
      hasErr = true;
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailError('Định dạng email không hợp lệ (VD: nhanvien@freshmart.vn).');
      hasErr = true;
    } else {
      setEmailError('');
    }

    if (!password) {
      setPasswordError('Vui lòng nhập mật khẩu.');
      hasErr = true;
    } else if (password.length < 6) {
      setPasswordError('Mật khẩu phải có ít nhất 6 ký tự.');
      hasErr = true;
    } else {
      setPasswordError('');
    }

    if (hasErr) {
      const msg = !trimmedEmail && !password
        ? 'Vui lòng nhập đầy đủ email và mật khẩu để đăng nhập.'
        : !trimmedEmail
        ? 'Bạn chưa nhập địa chỉ email.'
        : !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
        ? 'Địa chỉ email chưa đúng định dạng.'
        : !password
        ? 'Bạn chưa nhập mật khẩu.'
        : 'Mật khẩu quá ngắn (cần tối thiểu 6 ký tự).';
      setErrorMsg(msg);
      dialog.warning('Thông tin chưa hợp lệ', msg);
      return;
    }

    setErrorMsg('');
    setLoading(true);
    try {
      await login(trimmedEmail, password);
    } catch (err: any) {
      let friendly = err?.message || 'Đăng nhập không thành công. Kiểm tra lại thông tin.';
      if (err?.status === 401 || /invalid|unauthorized|sai|không đúng/i.test(friendly)) {
        friendly = 'Email hoặc mật khẩu không chính xác. Vui lòng kiểm tra lại.';
        setPasswordError('Mật khẩu hoặc email không đúng.');
      } else if (err?.status === 403) {
        friendly = 'Tài khoản đã bị khóa hoặc không có quyền truy cập.';
      } else if (err?.status === 0 || err?.code === 'NETWORK_ERROR') {
        friendly = `Không thể kết nối máy chủ (${getApiBaseUrl()}). Hãy kiểm tra Wi-Fi hoặc cấu hình máy chủ.`;
      }
      setErrorMsg(friendly);
      dialog.error('Đăng nhập thất bại', friendly);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveServerUrl = async (urlToSave?: string) => {
    const finalUrl = (urlToSave || serverUrl).trim();
    if (!finalUrl) return;
    try {
      await setApiBaseUrl(finalUrl);
      setServerUrl(finalUrl);
      setShowServerModal(false);
      dialog.success('Đã lưu cấu hình', `Máy chủ API: ${finalUrl}`);
    } catch {
      dialog.error('Lỗi lưu cấu hình', 'Không thể lưu địa chỉ máy chủ.');
    }
  };

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={[
            styles.scrollContent,
            { paddingTop: insets.top + 36, paddingBottom: insets.bottom + 24 },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Brand Header */}
          <View style={styles.brandBlock}>
            <View style={styles.logoWrap}>
              <Image source={LOGO_IMG} style={styles.brandLogo} resizeMode="contain" />
            </View>
            <Text style={styles.brandName}>FreshMart Ops</Text>
            <Text style={styles.brandSubtitle}>
              Đăng nhập bằng tài khoản nhân sự chi nhánh
            </Text>
          </View>

          {/* Clean iOS Form Card */}
          <View style={styles.formCard}>
            {errorMsg ? (
              <View style={styles.errorBanner}>
                <Ionicons name="alert-circle" size={16} color={Colors.danger} />
                <Text style={styles.errorText}>{errorMsg}</Text>
              </View>
            ) : null}

            <Input
              label="Email"
              placeholder="nhanvien@freshmart.vn"
              value={email}
              onChangeText={(text) => {
                setEmail(text);
                if (emailError) setEmailError('');
                if (errorMsg) setErrorMsg('');
              }}
              error={emailError}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              leftIcon="mail-outline"
            />

            <Input
              label="Mật khẩu"
              placeholder="Nhập mật khẩu"
              value={password}
              onChangeText={(text) => {
                setPassword(text);
                if (passwordError) setPasswordError('');
                if (errorMsg) setErrorMsg('');
              }}
              error={passwordError}
              secureTextEntry
              leftIcon="lock-closed-outline"
            />

            <Button
              title="Đăng nhập"
              onPress={handleLogin}
              loading={loading}
              size="lg"
              style={styles.submitBtn}
            />
          </View>

          {/* Discreet Dev Server Config Link (only in __DEV__) */}
          {__DEV__ && (
            <TouchableOpacity
              style={styles.devLink}
              onPress={() => {
                setServerUrl(getApiBaseUrl());
                setShowServerModal(true);
              }}
            >
              <Ionicons name="server-outline" size={13} color={Colors.muted} />
              <Text style={styles.devLinkText} numberOfLines={1}>
                API: {getApiBaseUrl().replace(/^https?:\/\//, '')}
              </Text>
            </TouchableOpacity>
          )}
        </ScrollView>

        {/* Dev Server Modal */}
        <Modal visible={showServerModal} transparent animationType="fade">
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Cấu hình API (Dev)</Text>
                <TouchableOpacity onPress={() => setShowServerModal(false)}>
                  <Ionicons name="close" size={22} color={Colors.muted} />
                </TouchableOpacity>
              </View>
              <Input
                label="URL Máy chủ Backend"
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder={DEFAULT_API_URL}
                autoCapitalize="none"
                autoCorrect={false}
              />
              <View style={styles.modalActions}>
                <Button
                  title="Mặc định"
                  variant="outline"
                  size="sm"
                  onPress={() => handleSaveServerUrl(DEFAULT_API_URL)}
                  style={{ flex: 1 }}
                />
                <Button
                  title="Lưu"
                  size="sm"
                  onPress={() => handleSaveServerUrl()}
                  style={{ flex: 1 }}
                />
              </View>
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  flex: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    flexGrow: 1,
    justifyContent: 'center',
  },
  brandBlock: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoWrap: {
    width: 56,
    height: 56,
    borderRadius: 14,
    backgroundColor: Colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  brandLogo: {
    width: 36,
    height: 36,
  },
  brandName: {
    fontSize: 22,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    letterSpacing: -0.3,
  },
  brandSubtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.muted,
    marginTop: 4,
    textAlign: 'center',
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.card,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: Colors.dangerBg,
    borderRadius: Radius.control,
    padding: 10,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.dangerBorder,
    marginBottom: 12,
  },
  errorText: {
    fontSize: Typography.sizes.sm,
    color: Colors.danger,
    flex: 1,
  },
  submitBtn: {
    marginTop: 6,
  },
  devLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    marginTop: 20,
    paddingVertical: 8,
  },
  devLinkText: {
    fontSize: 11,
    color: Colors.muted,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: Colors.backdrop,
    justifyContent: 'center',
    padding: 20,
  },
  modalCard: {
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: Typography.sizes.title,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
});
