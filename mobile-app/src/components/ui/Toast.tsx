import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Animated,
  TouchableOpacity,
  AccessibilityInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography, Shadows } from '../../constants/theme';
import { useReduceMotion } from './Motion';

export type ToastVariant = 'success' | 'warning' | 'error' | 'info';

interface ToastPayload {
  message: string;
  title?: string;
  variant?: ToastVariant;
  duration?: number;
}

interface ToastContextType {
  showToast: (payload: ToastPayload) => void;
  hideToast: () => void;
}

const ToastContext = createContext<ToastContextType>({
  showToast: () => {},
  hideToast: () => {},
});

const VARIANT_CONFIG: Record<
  ToastVariant,
  { icon: keyof typeof Ionicons.glyphMap; color: string; bg: string; border: string }
> = {
  success: {
    icon: 'checkmark-circle',
    color: Colors.success,
    bg: Colors.successBg,
    border: Colors.successBorder,
  },
  warning: {
    icon: 'warning',
    color: Colors.warning,
    bg: Colors.warningBg,
    border: Colors.warningBorder,
  },
  error: {
    icon: 'alert-circle',
    color: Colors.danger,
    bg: Colors.dangerBg,
    border: Colors.dangerBorder,
  },
  info: {
    icon: 'information-circle',
    color: Colors.primary,
    bg: Colors.primarySoft,
    border: Colors.infoBorder,
  },
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const [toast, setToast] = useState<ToastPayload | null>(null);
  const translateY = useRef(new Animated.Value(-90)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (reduceMotion) {
      setToast(null);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 180, useNativeDriver: true }),
      Animated.timing(translateY, { toValue: -70, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
  }, [opacity, translateY, reduceMotion]);

  const showToast = useCallback(
    (payload: ToastPayload) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      setToast(payload);
      AccessibilityInfo.announceForAccessibility(
        payload.title ? `${payload.title}. ${payload.message}` : payload.message
      );

      if (reduceMotion) {
        opacity.setValue(1);
        translateY.setValue(0);
      } else {
        translateY.setValue(-70);
        opacity.setValue(0);
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1, duration: 220, useNativeDriver: true }),
          Animated.spring(translateY, {
            toValue: 0,
            damping: 20,
            stiffness: 220,
            useNativeDriver: true,
          }),
        ]).start();
      }

      timerRef.current = setTimeout(() => {
        hideToast();
      }, payload.duration ?? 2800);
    },
    [hideToast, opacity, translateY, reduceMotion]
  );

  const cfg = VARIANT_CONFIG[toast?.variant ?? 'info'];

  return (
    <ToastContext.Provider value={{ showToast, hideToast }}>
      {children}
      {toast ? (
        <Animated.View
          pointerEvents="box-none"
          style={[
            styles.wrapper,
            {
              top: insets.top + 8,
              opacity,
              transform: [{ translateY }],
            },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={hideToast}
            style={[
              styles.banner,
              { backgroundColor: Colors.surface, borderColor: cfg.border },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: cfg.bg }]}>
              <Ionicons name={cfg.icon} size={18} color={cfg.color} />
            </View>
            <View style={styles.textWrap}>
              {toast.title ? <Text style={styles.title}>{toast.title}</Text> : null}
              <Text style={styles.message}>{toast.message}</Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      ) : null}
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 14,
    right: 14,
    zIndex: 9999,
  },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: Radius.card,
    borderWidth: 1,
    ...Shadows.cardHover,
  },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: Typography.sizes.sm,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  message: {
    fontSize: Typography.sizes.sm,
    color: Colors.textSecondary,
    lineHeight: 18,
  },
});
