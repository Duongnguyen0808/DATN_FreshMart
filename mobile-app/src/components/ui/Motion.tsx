import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  StyleProp,
  ViewStyle,
  View,
  StyleSheet,
  AccessibilityInfo,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { getCachedPreferences } from '../../services/preferences.service';

let reduceMotionCached = false;
AccessibilityInfo.isReduceMotionEnabled()
  .then((enabled) => {
    reduceMotionCached = enabled;
  })
  .catch(() => {});

export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(reduceMotionCached);
  useEffect(() => {
    let mounted = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .then((val) => {
        reduceMotionCached = val;
        if (mounted) setReduced(val);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (val) => {
      reduceMotionCached = val;
      if (mounted) setReduced(val);
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

interface FadeInViewProps {
  children: React.ReactNode;
  delay?: number;
  duration?: number;
  offsetY?: number;
  style?: StyleProp<ViewStyle>;
}

/**
 * Fade-in tinh tế chuẩn iOS, tự động tắt chuyển động khi bật Reduce Motion
 */
export function FadeInView({
  children,
  delay = 0,
  duration = 260,
  offsetY = 8,
  style,
}: FadeInViewProps) {
  const reduceMotion = useReduceMotion();
  const opacity = useRef(new Animated.Value(reduceMotion ? 1 : 0)).current;
  const translateY = useRef(new Animated.Value(reduceMotion ? 0 : offsetY)).current;

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      translateY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.timing(opacity, {
        toValue: 1,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(translateY, {
        toValue: 0,
        duration,
        delay,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start();
  }, [delay, duration, opacity, translateY, reduceMotion]);

  return (
    <Animated.View style={[{ opacity, transform: [{ translateY }] }, style]}>
      {children}
    </Animated.View>
  );
}

interface PulseDotProps {
  color: string;
  size?: number;
  active?: boolean;
}

export function PulseDot({ color, size = 8, active = true }: PulseDotProps) {
  const reduceMotion = useReduceMotion();
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!active || reduceMotion) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: 1800,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      })
    );
    loop.start();
    return () => loop.stop();
  }, [active, pulse, reduceMotion]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] });
  const opacity = pulse.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.55, 0.12, 0] });

  return (
    <View style={[styles.pulseWrap, { width: size * 2.2, height: size * 2.2 }]}>
      {active && !reduceMotion && (
        <Animated.View
          style={[
            styles.pulseRing,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: color,
              opacity,
              transform: [{ scale }],
            },
          ]}
        />
      )}
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        }}
      />
    </View>
  );
}

interface ScalePressableProps {
  children: React.ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  style?: StyleProp<ViewStyle>;
  scaleTo?: number;
  haptic?: boolean;
  disabled?: boolean;
}

/**
 * Press feedback chuẩn iOS (scale 0.98 + spring tự nhiên + haptic tôn trọng Settings)
 */
export function ScalePressable({
  children,
  onPress,
  onLongPress,
  style,
  scaleTo = 0.98,
  haptic = true,
  disabled = false,
}: ScalePressableProps) {
  const reduceMotion = useReduceMotion();
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    if (disabled || reduceMotion) return;
    Animated.spring(scale, {
      toValue: scaleTo,
      useNativeDriver: true,
      speed: 35,
      bounciness: 4,
    }).start();
  };

  const handlePressOut = () => {
    if (disabled || reduceMotion) return;
    Animated.spring(scale, {
      toValue: 1,
      useNativeDriver: true,
      speed: 24,
      bounciness: 6,
    }).start();
  };

  const handlePress = () => {
    if (disabled) return;
    if (haptic && getCachedPreferences().hapticsEnabled) {
      Haptics.selectionAsync().catch(() => {});
    }
    onPress?.();
  };

  const handleLongPress = () => {
    if (disabled || !onLongPress) return;
    if (haptic && getCachedPreferences().hapticsEnabled) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    }
    onLongPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      onLongPress={onLongPress ? handleLongPress : undefined}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      disabled={disabled}
      style={({ pressed }) => [disabled && { opacity: 0.5 }, reduceMotion && pressed && { opacity: 0.75 }]}
    >
      <Animated.View style={[style, { transform: [{ scale }] }]}>{children}</Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pulseWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
  },
});
