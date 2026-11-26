import React, { useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Animated,
  PanResponder,
  KeyboardAvoidingView,
  Platform,
  Dimensions,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Radius, Typography } from '../../constants/theme';
import { useReduceMotion } from './Motion';

const SCREEN_HEIGHT = Dimensions.get('window').height;

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  dismissable?: boolean;
  maxHeightRatio?: number;
}

/**
 * Native iOS Bottom Sheet thống nhất toàn app:
 * - Spring slide-up, drag handle kéo xuống để đóng, backdrop mờ nhẹ
 * - Hỗ trợ ScrollView, KeyboardAvoidingView, Safe Area và Reduce Motion
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  children,
  footer,
  dismissable = true,
  maxHeightRatio = 0.84,
}: BottomSheetProps) {
  const insets = useSafeAreaInsets();
  const reduceMotion = useReduceMotion();
  const translateY = useRef(new Animated.Value(300)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      if (reduceMotion) {
        translateY.setValue(0);
        backdropOpacity.setValue(1);
      } else {
        translateY.setValue(260);
        backdropOpacity.setValue(0);
        Animated.parallel([
          Animated.timing(backdropOpacity, {
            toValue: 1,
            duration: 220,
            useNativeDriver: true,
          }),
          Animated.spring(translateY, {
            toValue: 0,
            damping: 22,
            stiffness: 220,
            useNativeDriver: true,
          }),
        ]).start();
      }
    }
  }, [visible, reduceMotion, translateY, backdropOpacity]);

  const animateClose = () => {
    if (!dismissable) return;
    if (reduceMotion) {
      onClose();
      return;
    }
    Animated.parallel([
      Animated.timing(backdropOpacity, {
        toValue: 0,
        duration: 180,
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 320,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start(() => onClose());
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => dismissable && gesture.dy > 8,
      onPanResponderMove: (_, gesture) => {
        if (gesture.dy > 0) translateY.setValue(gesture.dy);
      },
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dy > 85 || gesture.vy > 0.8) {
          animateClose();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            damping: 20,
            stiffness: 240,
            useNativeDriver: true,
          }).start();
        }
      },
    })
  ).current;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={animateClose}
      statusBarTranslucent
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.root}
      >
        <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={animateClose} />
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            {
              maxHeight: SCREEN_HEIGHT * maxHeightRatio,
              paddingBottom: Math.max(insets.bottom, 16),
              transform: [{ translateY }],
            },
          ]}
        >
          {/* Drag Handle */}
          <View {...panResponder.panHandlers} style={styles.handleZone}>
            <View style={styles.handle} />
          </View>

          {/* Header */}
          {(title || dismissable) && (
            <View style={styles.header}>
              <View style={styles.headerTitleWrap}>
                {title ? (
                  <Text style={styles.title} numberOfLines={2}>
                    {title}
                  </Text>
                ) : null}
                {subtitle ? (
                  <Text style={styles.subtitle} numberOfLines={2}>
                    {subtitle}
                  </Text>
                ) : null}
              </View>
              {dismissable && (
                <TouchableOpacity
                  onPress={animateClose}
                  style={styles.closeBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Đóng"
                  hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                >
                  <Ionicons name="close" size={20} color={Colors.muted} />
                </TouchableOpacity>
              )}
            </View>
          )}

          {/* Scrollable Body */}
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            {children}
          </ScrollView>

          {/* Optional Sticky Footer */}
          {footer ? <View style={styles.footer}>{footer}</View> : null}
        </Animated.View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  backdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: Colors.backdrop,
  },
  sheet: {
    backgroundColor: Colors.surface,
    borderTopLeftRadius: Radius.sheet,
    borderTopRightRadius: Radius.sheet,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
  handleZone: {
    alignItems: 'center',
    paddingTop: 10,
    paddingBottom: 6,
  },
  handle: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    gap: 10,
  },
  headerTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
  },
  subtitle: {
    fontSize: Typography.sizes.sm,
    color: Colors.muted,
    marginTop: 2,
  },
  closeBtn: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: Colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flexGrow: 0,
  },
  bodyContent: {
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: Colors.border,
  },
});
