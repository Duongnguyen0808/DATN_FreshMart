import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ProductImage } from '../ui/product-image';
import { Icon } from '../ui/icon';
import type { Inventory } from '../../lib/inventory-api';
import { categoryTheme } from '../../lib/category-theme';
import { CategoryBadge } from '../products/category-badge';

export function PosQuantity({ name, value, max, onChange }: { name: string; value: number; max: number; onChange: (value: number) => void }) {
  return <div className="pos-quantity">
    <button type="button" aria-label={`Giảm số lượng ${name}`} disabled={value <= 1} onClick={() => onChange(value - 1)}>−</button>
    <input aria-label={`Số lượng ${name}`} type="number" min={1} max={max} step={1} value={value} onChange={event => onChange(Number(event.target.value))}/>
    <button type="button" aria-label={`Tăng số lượng ${name}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
  </div>;
}

export function PosCatalog({ rows, ready, loading, query, onQuery, onAdd, quantities }: {
  rows: Inventory[]; ready: boolean; loading: boolean; query: string;
  onQuery: (value: string) => void; onAdd: (stock: Inventory) => void; quantities: Record<string, number>;
}) {
  const [category, setCategory] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!ready) return;
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key !== 'F3' || event.altKey || event.ctrlKey || event.metaKey) return;
      event.preventDefault();
      searchRef.current?.focus();
      searchRef.current?.select();
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [ready]);
  const categories = [...new Map(rows.map(row => [row.sku.product.category.id, row.sku.product.category])).values()];
  const selectedCategory = categories.some(item => item.id === category) ? category : '';
  const shown = selectedCategory ? rows.filter(row => row.sku.product.category.id === selectedCategory) : rows;
  return <div className="pos-catalog">
    <header className="pos-catalog-heading"><h2>Hàng đang bán</h2><span>{ready ? `${shown.length} sản phẩm trong kho` : 'Chọn ca và kho để bắt đầu'}</span></header>
    <div className="pos-search"><Icon name="search" size={20}/><input ref={searchRef} aria-label="Tìm sản phẩm bán hàng" aria-keyshortcuts="F3" disabled={!ready} value={query} onChange={event => onQuery(event.target.value)} placeholder="Tìm tên sản phẩm hoặc quét mã vạch…"/>{query && <button type="button" aria-label="Xóa tìm kiếm" onClick={() => onQuery('')}>×</button>}<kbd aria-label="Phím tắt F3">F3</kbd></div>
    {ready && <div className="pos-categories" aria-label="Nhóm sản phẩm"><button type="button" className="category-filter" style={categoryTheme().style} aria-pressed={!selectedCategory} onClick={() => setCategory('')}><Icon name="grid" size={16}/>Tất cả <span>{rows.length}</span></button>{categories.map(item => <button type="button" className="category-filter" style={categoryTheme(item).style} aria-pressed={item.id === selectedCategory} key={item.id} onClick={() => setCategory(item.id)}><Icon name={categoryTheme(item).icon} size={16}/>{item.name}</button>)}</div>}
    {!ready ? <div className="pos-empty"><Icon name="store" size={40}/><h3>Bắt đầu phiên bán hàng</h3><p>Chọn ca làm việc và kho ở phía trên.<br/>Sản phẩm có trong kho sẽ xuất hiện tại đây.</p><Link href="/ca-lam-viec">Quản lý ca làm việc →</Link></div>
      : loading ? <div className="pos-product-grid" role="status" aria-label="Đang tải sản phẩm">{Array.from({ length: 8 }, (_, index) => <div className="pos-product-skeleton" key={index}/>)}</div>
      : !shown.length ? <div className="pos-empty"><Icon name="search" size={36}/><h3>{query ? 'Không tìm thấy sản phẩm' : 'Kho chưa có sản phẩm'}</h3><p>{query ? 'Thử tên khác hoặc kiểm tra lại mã vạch.' : 'Kiểm tra kho đã chọn hoặc nhập hàng trước khi bán.'}</p>{query && <button type="button" onClick={() => onQuery('')}>Xóa tìm kiếm</button>}</div>
      : <><div className="pos-product-grid">{shown.map(stock => {
        const quantity = quantities[stock.skuId] ?? 0;
        return <button type="button" className="pos-product" style={categoryTheme(stock.sku.product.category).style} key={stock.id} disabled={stock.available <= quantity} onClick={() => onAdd(stock)} aria-label={`Thêm ${stock.sku.product.name}`}>
          <div className="pos-product-image"><ProductImage src={stock.sku.product.imageUrl} name={stock.sku.product.name} size="md"/>{quantity > 0 && <span key={quantity} className="pos-added">{quantity} trong giỏ</span>}</div>
          <CategoryBadge category={stock.sku.product.category}/>
          <span className="pos-product-name">{stock.sku.product.name}</span><small>{stock.sku.product.unit} · {stock.available > 0 ? `Còn ${stock.available}` : 'Hết hàng'}</small>
          <div className="pos-product-bottom"><strong>{new Intl.NumberFormat('vi-VN').format(stock.sku.sellingPrice)}<small>đ</small></strong><span aria-hidden="true">+</span></div>
        </button>;
      })}</div><p className="pos-catalog-foot">Đang hiển thị {shown.length} sản phẩm · Bấm vào sản phẩm để thêm vào giỏ</p></>}
  </div>;
}
