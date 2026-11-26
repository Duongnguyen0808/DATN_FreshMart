import React, { createContext, useCallback, useContext, useState, ReactNode } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Pressable,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography } from '../../constants/theme';

export type DialogVariant = 'success' | 'error' | 'warning' | 'info';

export interface DialogOptions {
  variant?: DialogVariant;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  onConfirm?: () => void | Promise<void>;
  onDismiss?: () => void;
}

interface AppDialogContextType {
  show: (options: DialogOptions) => void;
  success: (title: string, message: string, onConfirm?: () => void) => void;
  error: (title: string, message: string, onConfirm?: () => void) => void;
  warning: (title: string, message: string, onConfirm?: () => void) => void;
  confirm: (options: Omit<DialogOptions, 'cancelText'> & { cancelText?: string }) => void;
}

const AppDialogContext = createContext<AppDialogContextType | undefined>(undefined);

const VARIANT_META: Record<
  DialogVariant,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; btnBg: string }
> = {
  success: {
    icon: 'checkmark-circle',
    color: Colors.primary,
    bg: '#e6f7f5',
    btnBg: Colors.primary,
  },
  error: {
    icon: 'close-circle',
    color: Colors.danger,
    bg: '#fef2f2',
    btnBg: Colors.danger,
  },
  warning: {
    icon: 'alert-circle',
    color: Colors.warning,
    bg: '#fffbeb',
    btnBg: '#d97706',
  },
  info: {
    icon: 'information-circle',
    color: Colors.primary,
    bg: '#e6f7f5',
    btnBg: Colors.primary,
  },
};

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const [dialog, setDialog] = useState<DialogOptions | null>(null);

  const show = useCallback((options: DialogOptions) => {
    setDialog(options);
  }, []);

  const success = useCallback((title: string, message: string, onConfirm?: () => void) => {
    setDialog({ variant: 'success', title, message, confirmText: 'Đóng', onConfirm });
  }, []);

  const error = useCallback((title: string, message: string, onConfirm?: () => void) => {
    setDialog({ variant: 'error', title, message, confirmText: 'Đã hiểu', onConfirm });
  }, []);

  const warning = useCallback((title: string, message: string, onConfirm?: () => void) => {
    setDialog({ variant: 'warning', title, message, confirmText: 'Đã hiểu', onConfirm });
  }, []);

  const confirm = useCallback(
    (options: Omit<DialogOptions, 'cancelText'> & { cancelText?: string }) => {
      setDialog({
        variant: options.destructive ? 'error' : options.variant || 'warning',
        cancelText: options.cancelText || 'Hủy',
        confirmText: options.confirmText || 'Xác nhận',
        ...options,
      });
    },
    []
  );

  const handleClose = () => {
    const dismissFn = dialog?.onDismiss;
    setDialog(null);
    if (dismissFn) dismissFn();
  };

  const handleConfirm = () => {
    const fn = dialog?.onConfirm;
    setDialog(null);
    if (fn) {
      void Promise.resolve(fn());
    }
  };

  const meta = VARIANT_META[dialog?.variant || 'info'];
  const confirmBg = dialog?.destructive ? Colors.danger : meta.btnBg;

  return (
    <AppDialogContext.Provider value={{ show, success, error, warning, confirm }}>
      {children}
      <Modal
        visible={!!dialog}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={handleClose}
      >
        <Pressable style={styles.backdrop} onPress={handleClose}>
          <Pressable style={styles.card} onPress={(e) => e.stopPropagation()}>
            <View style={[styles.iconRing, { backgroundColor: meta.bg }]}>
              <Ionicons name={meta.icon} size={34} color={meta.color} />
            </View>

            <Text style={styles.title}>{dialog?.title}</Text>
            <Text style={styles.message}>{dialog?.message}</Text>

            <View style={styles.actions}>
              {dialog?.cancelText ? (
                <TouchableOpacity
                  style={[styles.btn, styles.cancelBtn]}
                  activeOpacity={0.78}
                  onPress={handleClose}
                >
                  <Text style={styles.cancelText}>{dialog.cancelText}</Text>
                </TouchableOpacity>
              ) : null}

              <TouchableOpacity
                style={[styles.btn, { backgroundColor: confirmBg }]}
                activeOpacity={0.82}
                onPress={handleConfirm}
              >
                <Text style={styles.confirmText}>{dialog?.confirmText || 'Đồng ý'}</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </AppDialogContext.Provider>
  );
}

export function useAppDialog(): AppDialogContextType {
  const ctx = useContext(AppDialogContext);
  if (!ctx) {
    throw new Error('useAppDialog must be used inside AppDialogProvider');
  }
  return ctx;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 41, 40, 0.48)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#ffffff',
    borderRadius: 24,
    paddingHorizontal: 22,
    paddingTop: 24,
    paddingBottom: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#dcebe7',
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 20px 50px rgba(15, 41, 40, 0.22)' } as any)
      : {
          shadowColor: '#0f2928',
          shadowOffset: { width: 0, height: 12 },
          shadowOpacity: 0.18,
          shadowRadius: 24,
          elevation: 10,
        }),
  },
  iconRing: {
    width: 62,
    height: 62,
    borderRadius: 31,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 14,
  },
  title: {
    fontSize: 17,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  message: {
    fontSize: Typography.sizes.body,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
    width: '100%',
  },
  btn: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtn: {
    backgroundColor: '#f1f5f4',
    borderWidth: 1,
    borderColor: '#d7e6e2',
  },
  cancelText: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.semibold,
    color: Colors.textSecondary,
  },
  confirmText: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.bold,
    color: '#ffffff',
  },
});
