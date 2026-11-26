import React from 'react';
import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Colors, Radius, Typography } from '../../constants/theme';

interface BadgeProps {
  label: string;
  variant?: 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';
  size?: 'sm' | 'md';
  style?: ViewStyle;
}

export function Badge({ label, variant = 'neutral', size = 'sm', style }: BadgeProps) {
  const getStyles = () => {
    switch (variant) {
      case 'success':
        return { bg: Colors.successBg, border: Colors.successBorder, text: Colors.success };
      case 'warning':
        return { bg: Colors.warningBg, border: Colors.warningBorder, text: Colors.warning };
      case 'danger':
        return { bg: Colors.dangerBg, border: Colors.dangerBorder, text: Colors.danger };
      case 'info':
        return { bg: Colors.infoBg, border: Colors.infoBorder, text: Colors.info };
      case 'primary':
        return { bg: Colors.primarySoft, border: Colors.borderSoft, text: Colors.primary };
      default:
        return { bg: '#f1f5f9', border: '#e2e8f0', text: '#475569' };
    }
  };

  const { bg, border, text } = getStyles();
  const isSm = size === 'sm';

  return (
    <View
      style={[
        styles.base,
        {
          backgroundColor: bg,
          borderColor: border,
          paddingVertical: isSm ? 2 : 4,
          paddingHorizontal: isSm ? 6 : 10,
        },
        style,
      ]}
    >
      <Text
        style={[
          styles.text,
          {
            color: text,
            fontSize: isSm ? Typography.sizes.caption : Typography.sizes.sm,
          },
        ]}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.badge,
    borderWidth: 1,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
  },
  text: {
    fontWeight: Typography.weights.bold,
  },
});
