'use client';
import { useEffect, useState } from 'react';
import { categoryTheme } from '../../lib/category-theme';
import type { Product } from '../../lib/products-api';
import { Icon } from '../ui/icon';
import { ProductImage } from '../ui/product-image';
import { StatusBadge } from '../ui/status-badge';

export function CategoryBadge({ category }: { category: { id?: string; code?: string; name: string } }) {
  const theme = categoryTheme(category);
  return <span className="category-badge" data-category-tone={theme.tone} style={theme.style}><Icon name={theme.icon} size={14}/>{category.name}</span>;
}

export function ProductGallery({ items, onOpen }: { items: Product[]; onOpen: (product: Product) => void }) {
  return <div className="product-gallery">{items.map(product => <button type="button" className="gallery-product" style={categoryTheme(product.category).style} key={product.id} onClick={() => onOpen(product)} aria-label={`Xem ${product.name}`}>
    <div className="gallery-product-photo"><ProductImage src={product.imageUrl} name={product.name} size="md"/><StatusBadge tone={product.active ? 'green' : 'neutral'}>{product.active ? 'Đang bán' : 'Đã ngừng'}</StatusBadge></div>
    <div className="gallery-product-copy"><CategoryBadge category={product.category}/><small>{product.code}</small><strong>{product.name}</strong><div><b>{new Intl.NumberFormat('vi-VN').format(product.skus[0]?.sellingPrice ?? 0)} đ</b><span>{product.availableStock ?? 0} {product.unit}</span></div></div>
  </button>)}</div>;
}

export function ProductImagePicker({ currentUrl }: { currentUrl?: string | null }) {
  const [preview, setPreview] = useState(currentUrl || '');
  const [picked, setPicked] = useState(false);

  useEffect(() => { setPreview(currentUrl || ''); setPicked(false); }, [currentUrl]);
  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);

  return <section className="product-image-picker" aria-label="Ảnh sản phẩm">
    <div className="product-image-preview">
      {preview ? <img src={preview} alt="Ảnh xem trước của sản phẩm"/> : <span>Chưa có ảnh</span>}
    </div>
    <div>
      <label className="image-upload-button">Chọn ảnh
        <input name="image" type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={event => {
          const file = event.target.files?.[0];
          if (!file) { setPreview(currentUrl || ''); setPicked(false); return; }
          setPreview(URL.createObjectURL(file));
          setPicked(true);
        }}/>
      </label>
      <p>JPG, PNG, WEBP hoặc AVIF · tối đa 5 MB. Ảnh được tự thu nhỏ và nén khi lưu.</p>
      {currentUrl && !picked && <label className="remove-image"><input name="removeImage" type="checkbox" value="true" onChange={event => setPreview(event.target.checked ? '' : currentUrl)}/> Xóa ảnh hiện tại</label>}
    </div>
  </section>;
}
