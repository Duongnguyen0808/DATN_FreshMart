import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from './BottomSheet';
import { Colors, Radius, Typography } from '../../constants/theme';
import { Store } from '../../types';

interface StorePickerSheetProps {
  visible: boolean;
  onClose: () => void;
  stores: Store[];
  activeStoreId?: string | null;
  onSelect: (store: Store) => void;
}

/**
 * Component dùng chung chọn chi nhánh cho cả Trang chủ và Cá nhân
 */
export function StorePickerSheet({
  visible,
  onClose,
  stores,
  activeStoreId,
  onSelect,
}: StorePickerSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Chọn chi nhánh làm việc"
      subtitle="Danh sách chi nhánh được cấp quyền"
    >
      {stores.length > 0 ? (
        stores.map((store) => {
          const selected = activeStoreId === store.id;
          return (
            <TouchableOpacity
              key={store.id}
              activeOpacity={0.7}
              style={[styles.row, selected && styles.rowSelected]}
              onPress={() => {
                onSelect(store);
                onClose();
              }}
            >
              <View style={[styles.iconBox, selected && styles.iconBoxSelected]}>
                <Ionicons
                  name="storefront-outline"
                  size={18}
                  color={selected ? '#FFFFFF' : Colors.primary}
                />
              </View>
              <View style={styles.textWrap}>
                <Text style={[styles.name, selected && styles.nameSelected]}>
                  {store.name} ({store.code})
                </Text>
                {store.address ? (
                  <Text style={styles.addr} numberOfLines={2}>
                    {store.address}
                  </Text>
                ) : null}
              </View>
              {selected && <Ionicons name="checkmark-circle" size={20} color={Colors.primary} />}
            </TouchableOpacity>
          );
        })
      ) : (
        <Text style={styles.emptyText}>Tài khoản chưa được phân công chi nhánh nào.</Text>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: Radius.control,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.borderSoft,
  },
  rowSelected: {
    backgroundColor: Colors.primaryWash,
  },
  iconBox: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBoxSelected: {
    backgroundColor: Colors.primary,
  },
  textWrap: {
    flex: 1,
    minWidth: 0,
  },
  name: {
    fontSize: Typography.sizes.body,
    fontWeight: Typography.weights.semibold,
    color: Colors.text,
  },
  nameSelected: {
    color: Colors.primaryDark,
  },
  addr: {
    fontSize: Typography.sizes.caption,
    color: Colors.muted,
    marginTop: 2,
  },
  emptyText: {
    textAlign: 'center',
    color: Colors.muted,
    paddingVertical: 20,
    fontSize: Typography.sizes.body,
  },
});
