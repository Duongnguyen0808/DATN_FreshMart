import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography } from '../../constants/theme';
import { useAuth } from '../../contexts/auth-context';

interface HeaderProps {
  title: string;
  subtitle?: string;
  showBack?: boolean;
  rightAction?: React.ReactNode;
}

export function Header({ title, subtitle, showBack = false, rightAction }: HeaderProps) {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { activeStore } = useAuth();

  return (
    <View style={[styles.container, { paddingTop: insets.top + 8 }]}>
      <View style={styles.content}>
        {/* Left Slot */}
        <View style={styles.sideSlot}>
          {showBack ? (
            <TouchableOpacity
              onPress={() => router.back()}
              style={styles.iconButton}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
            >
              <Ionicons name="chevron-back" size={22} color={Colors.text} />
            </TouchableOpacity>
          ) : null}
        </View>

        {/* Center Title & Subtitle */}
        <View style={styles.titleContainer}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle || activeStore ? (
            <View style={styles.subtitleRow}>
              <Ionicons name="storefront-outline" size={11} color={Colors.muted} />
              <Text style={styles.subtitle} numberOfLines={1}>
                {subtitle || activeStore?.name || 'Toàn hệ thống'}
              </Text>
            </View>
          ) : null}
        </View>

        {/* Right Slot */}
        <View style={[styles.sideSlot, { alignItems: 'flex-end' }]}>
          {rightAction || (
            <TouchableOpacity
              onPress={() => router.push('/notifications' as any)}
              style={styles.iconButton}
            >
              <Ionicons name="notifications-outline" size={20} color={Colors.text} />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#ffffff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.border,
    paddingBottom: 10,
    paddingHorizontal: 14,
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sideSlot: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  titleContainer: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  title: {
    fontSize: Typography.sizes.lg,
    fontWeight: Typography.weights.bold,
    color: Colors.text,
    textAlign: 'center',
  },
  subtitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
    gap: 4,
  },
  subtitle: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    textAlign: 'center',
  },
  iconButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: Colors.surfaceSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
