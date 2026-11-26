import React from 'react';
import { Tabs } from 'expo-router';
import { View, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors, Typography, Shadows } from '../../src/constants/theme';

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: Colors.primary,
        tabBarInactiveTintColor: Colors.muted,
        tabBarStyle: {
          backgroundColor: '#ffffff',
          borderTopWidth: 1,
          borderTopColor: Colors.border,
          height: Platform.OS === 'ios' ? 88 : 64,
          paddingTop: 8,
          paddingBottom: Platform.OS === 'ios' ? 28 : 10,
        },
        tabBarLabelStyle: {
          fontSize: Typography.sizes.caption,
          fontWeight: Typography.weights.medium,
        },
      }}
    >
      {/* 01. Trang chủ */}
      <Tabs.Screen
        name="index"
        options={{
          title: 'Trang chủ',
          tabBarIcon: ({ color, focused }: any) => (
            <Ionicons name={focused ? 'home' : 'home-outline'} size={22} color={color} />
          ),
        }}
      />

      {/* 02. Cảnh báo */}
      <Tabs.Screen
        name="alerts"
        options={{
          title: 'Cảnh báo',
          tabBarIcon: ({ color, focused }: any) => (
            <Ionicons
              name={focused ? 'alert-circle' : 'alert-circle-outline'}
              size={23}
              color={color}
            />
          ),
        }}
      />

      {/* 03. Quét mã (Center floating primary button) */}
      <Tabs.Screen
        name="scan"
        options={{
          title: 'Quét mã',
          tabBarLabel: 'Quét mã',
          tabBarIcon: () => (
            <View style={styles.centerButton}>
              <Ionicons name="barcode-outline" size={26} color="#ffffff" />
            </View>
          ),
          tabBarLabelStyle: {
            fontSize: Typography.sizes.caption,
            fontWeight: Typography.weights.bold,
            color: Colors.primary,
            marginTop: 4,
          },
        }}
      />

      {/* 04. Giám sát IoT */}
      <Tabs.Screen
        name="iot"
        options={{
          title: 'IoT',
          tabBarIcon: ({ color, focused }: any) => (
            <Ionicons
              name={focused ? 'hardware-chip' : 'hardware-chip-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />

      {/* 05. Cá nhân */}
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Cá nhân',
          tabBarIcon: ({ color, focused }: any) => (
            <Ionicons
              name={focused ? 'person' : 'person-outline'}
              size={22}
              color={color}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  centerButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -22,
    ...Shadows.button,
    borderWidth: 3,
    borderColor: '#ffffff',
  },
});
