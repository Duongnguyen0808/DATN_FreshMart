import React, { useState } from 'react';
import { View, Image, Text, StyleSheet, StyleProp, ViewStyle, ImageSourcePropType } from 'react-native';
import { Colors, Radius, Typography } from '../../constants/theme';
import { getApiBaseUrl } from '../../services/api';
import { Ionicons } from '@expo/vector-icons';

interface ProductThumbnailProps {
  imageUrl?: string | null;
  productCode?: string;
  name?: string;
  categoryName?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  style?: StyleProp<ViewStyle>;
}

// Toàn bộ kho ảnh sản phẩm PNG kế thừa từ Web Admin (tối ưu cho iOS Native, không lỗi .svg)
const LOCAL_PRODUCT_MAP: Record<string, ImageSourcePropType> = {
  'prd-cf-088': require('../../../assets/products/prd-cf-088.png'),
  'prd-ym-041': require('../../../assets/products/prd-ym-041.png'),
  'prd-dn-077': require('../../../assets/products/prd-dn-077.png'),
  'prd-lv-019': require('../../../assets/products/prd-lv-019.png'),
  'prd-ol-060': require('../../../assets/products/prd-ol-060.png'),
  'prd-te-077': require('../../../assets/products/prd-te-077.png'),
  'prd-test-001': require('../../../assets/products/prd-test-001.png'),
  'prd-test-002': require('../../../assets/products/prd-test-002.png'),
  'prd-demo-007': require('../../../assets/products/prd-demo-007.png'),
  'prd-demo-008': require('../../../assets/products/prd-demo-008.png'),
  'prd-demo-009': require('../../../assets/products/prd-demo-009.png'),
  'prd-demo-010': require('../../../assets/products/prd-demo-010.png'),
  'prd-demo-011': require('../../../assets/products/prd-demo-011.png'),
  'prd-demo-012': require('../../../assets/products/prd-demo-012.png'),
  'prd-demo-013': require('../../../assets/products/prd-demo-013.png'),
  'prd-demo-014': require('../../../assets/products/prd-demo-014.png'),
  'prd-demo-015': require('../../../assets/products/prd-demo-015.png'),
  'prd-demo-016': require('../../../assets/products/prd-demo-016.png'),
  'prd-demo-017': require('../../../assets/products/prd-demo-017.png'),
  'prd-demo-018': require('../../../assets/products/prd-demo-018.png'),
  'prd-demo-019': require('../../../assets/products/prd-demo-019.png'),
  'prd-demo-020': require('../../../assets/products/prd-demo-020.png'),
  'prd-demo-021': require('../../../assets/products/prd-demo-021.png'),
  'prd-demo-022': require('../../../assets/products/prd-demo-022.png'),
  'prd-demo-023': require('../../../assets/products/prd-demo-023.png'),
  'prd-demo-024': require('../../../assets/products/prd-demo-024.png'),
  'prd-demo-025': require('../../../assets/products/prd-demo-025.png'),
  'prd-demo-026': require('../../../assets/products/prd-demo-026.png'),
  'prd-demo-027': require('../../../assets/products/prd-demo-027.png'),
  'prd-demo-028': require('../../../assets/products/prd-demo-028.png'),
  'prd-demo-029': require('../../../assets/products/prd-demo-029.png'),
  'prd-demo-030': require('../../../assets/products/prd-demo-030.png'),
  'prd-demo-031': require('../../../assets/products/prd-demo-031.png'),
  'prd-demo-032': require('../../../assets/products/prd-demo-032.png'),
  'prd-demo-033': require('../../../assets/products/prd-demo-033.png'),
  'prd-demo-034': require('../../../assets/products/prd-demo-034.png'),
  'prd-demo-035': require('../../../assets/products/prd-demo-035.png'),
  'prd-demo-036': require('../../../assets/products/prd-demo-036.png'),
  'prd-demo-037': require('../../../assets/products/prd-demo-037.png'),
  'prd-demo-038': require('../../../assets/products/prd-demo-038.png'),
  'prd-demo-039': require('../../../assets/products/prd-demo-039.png'),
  'prd-demo-040': require('../../../assets/products/prd-demo-040.png'),
  'prd-demo-042': require('../../../assets/products/prd-demo-042.png'),
};

const FALLBACK_IMAGES = Object.values(LOCAL_PRODUCT_MAP);

export function resolveImageUrl(url?: string | null): string | null {
  if (!url) return null;
  if (url.toLowerCase().endsWith('.svg')) return null; // iOS Image không render SVG trực tiếp
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:')) {
    return url;
  }
  const base = getApiBaseUrl().replace('/api/v1', '');
  return `${base}${url.startsWith('/') ? '' : '/'}${url}`;
}

function findLocalAsset(imageUrl?: string | null, productCode?: string): ImageSourcePropType | null {
  if (productCode) {
    const key = productCode.toLowerCase().trim();
    if (LOCAL_PRODUCT_MAP[key]) return LOCAL_PRODUCT_MAP[key];
  }
  if (imageUrl) {
    const match = imageUrl.toLowerCase().match(/\/products\/([a-z0-9-]+)\.(png|svg|jpg|webp)/);
    if (match && match[1] && LOCAL_PRODUCT_MAP[match[1]]) {
      return LOCAL_PRODUCT_MAP[match[1]];
    }
  }
  return null;
}

export function ProductThumbnail({
  imageUrl,
  productCode,
  name = 'Sản phẩm',
  size = 'md',
  style,
}: ProductThumbnailProps) {
  const [loadError, setLoadError] = useState(false);

  const getDimension = () => {
    switch (size) {
      case 'sm':
        return 44;
      case 'lg':
        return 76;
      case 'xl':
        return 96;
      default:
        return 58;
    }
  };

  const dim = getDimension();
  const localImage = findLocalAsset(imageUrl, productCode);
  const remoteUrl = resolveImageUrl(imageUrl);

  if (localImage) {
    return (
      <View style={[styles.container, { width: dim, height: dim, borderRadius: Radius.md }, style]}>
        <Image
          source={localImage}
          style={{ width: dim - 6, height: dim - 6, borderRadius: Radius.sm }}
          resizeMode="cover"
        />
      </View>
    );
  }

  if (remoteUrl && !loadError) {
    return (
      <View style={[styles.container, { width: dim, height: dim, borderRadius: Radius.md }, style]}>
        <Image
          source={{ uri: remoteUrl }}
          style={{ width: dim - 6, height: dim - 6, borderRadius: Radius.sm }}
          resizeMode="cover"
          onError={() => setLoadError(true)}
        />
      </View>
    );
  }

  // Deterministic pleasant fallback from local product pack or soft pastel badge
  const initial = name.trim().slice(0, 1).toUpperCase() || 'P';
  return (
    <View
      style={[
        styles.fallbackContainer,
        {
          width: dim,
          height: dim,
          borderRadius: Radius.md,
        },
        style,
      ]}
    >
      <Ionicons name="cube-outline" size={dim * 0.42} color={Colors.primary} />
      <Text style={[styles.fallbackLetter, { fontSize: Math.max(10, dim * 0.2) }]}>{initial}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f8fbfa',
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fallbackContainer: {
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.borderSoft,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  fallbackLetter: {
    fontWeight: Typography.weights.bold,
    color: Colors.primaryDark,
  },
});
