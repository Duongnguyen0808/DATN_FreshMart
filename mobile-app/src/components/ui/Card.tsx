import React from 'react';
import { View, StyleSheet, StyleProp, ViewStyle, TouchableOpacity } from 'react-native';
import { Colors, Radius } from '../../constants/theme';

interface CardProps {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  variant?: 'elevated' | 'outlined' | 'soft';
}

export function Card({ children, style, onPress, variant = 'outlined' }: CardProps) {
  const getVariantStyle = () => {
    switch (variant) {
      case 'soft':
        return styles.soft;
      case 'elevated':
        return styles.elevated;
      default:
        return styles.outlined;
    }
  };

  if (onPress) {
    return (
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={onPress}
        style={[styles.base, getVariantStyle(), style]}
      >
        {children}
      </TouchableOpacity>
    );
  }

  return <View style={[styles.base, getVariantStyle(), style]}>{children}</View>;
}

const styles = StyleSheet.create({
  base: {
    borderRadius: Radius.card,
    padding: 12,
    marginBottom: 10,
  },
  elevated: {
    backgroundColor: Colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  outlined: {
    backgroundColor: Colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.border,
  },
  soft: {
    backgroundColor: Colors.surfaceSoft,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: Colors.borderSoft,
  },
});
