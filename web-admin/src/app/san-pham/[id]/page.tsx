'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { errorMessage } from '../../../lib/auth-api';
import * as productsApi from '../../../lib/products-api';
import { useAuth } from '../../../components/auth-provider';
import { ActionButton } from '../../../components/ui/action-button';
import { CurrencyInput } from '../../../components/ui/currency-input';
import { MetricCard, MetricGrid } from '../../../components/ui/metric-card';
import { StatusBadge } from '../../../components/ui/status-badge';
import { useToast } from '../../../components/ui/toast-provider';
import { ProductAiAdvice } from '../../../components/products/product-ai-advice';

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`;
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function ProductDetail() {
  const { showToast, confirmAction } = useToast();
  const { user } = useAuth();
  const canManage = !!user && (user.permissions.includes('products.manage') || user.permissions.includes('*'));
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [product, setProduct] = useState<productsApi.Product | null>(null);
  const [selectedSkuId, setSelectedSkuId] = useState('');
  const [skuModal, setSkuModal] = useState<'create' | 'edit' | null>(null);
  const [editingSku, setEditingSku] = useState<productsApi.Sku | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const sku = product?.skus.find((item) => item.id === selectedSkuId) ?? product?.skus[0];
  const margin = useMemo(() => sku?.sellingPrice ? (sku.sellingPrice - sku.costPrice) / sku.sellingPrice * 100 : 0, [sku]);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const value = await productsApi.getProduct(id);
      setProduct(value);
      setSelectedSkuId((current) => value.skus.some((item) => item.id === current) ? current : value.skus[0]?.id ?? '');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, [id]);

  const changeProductStatus = async () => {
    if (!product || !await confirmAction(product.active ? `Ngừng kinh doanh “${product.name}”?` : `Mở lại kinh doanh “${product.name}”?`)) return;
    try {
      const nextActive = !product.active;
      await productsApi.setProductStatus(product.id, nextActive);
      await load();
      showToast(nextActive ? 'Đã mở lại kinh doanh sản phẩm.' : 'Đã ngừng kinh doanh sản phẩm.');
    } catch (reason) { setError(errorMessage(reason)); }
  };

  const openSkuModal = (mode: 'create' | 'edit', value: productsApi.Sku | null = null) => {
    setEditingSku(value);
    setError('');
    setSkuModal(mode);
  };
  const saveSku = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      const data = new FormData(event.currentTarget);
      const payload: productsApi.SkuInput = {
        code: String(data.get('code')).toUpperCase(),
        barcode: String(data.get('barcode')),
        sellingPrice: Number(data.get('sellingPrice')),
        costPrice: Number(data.get('costPrice')),
      };
      const value = editingSku
        ? await productsApi.updateSku(id, editingSku.id, payload)
        : await productsApi.createSku(id, payload);
      setProduct(value);
      const saved = editingSku ? value.skus.find((item) => item.id === editingSku.id) : value.skus.find((item) => item.code === payload.code);
      if (saved) setSelectedSkuId(saved.id);
      setSkuModal(null);
      showToast(editingSku ? 'Đã cập nhật sản phẩm và ghi lịch sử giá.' : 'Đã thêm sản phẩm và tạo tồn ban đầu tại các kho.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };
  const changeSkuStatus = async (value: productsApi.Sku) => {
    const next = !value.active;
    if (!await confirmAction(next ? `Mở lại sản phẩm “${value.code}”?` : `Ngừng sản phẩm “${value.code}”?`)) return;
    try {
      setProduct(await productsApi.setSkuStatus(id, value.id, next));
      showToast(next ? 'Đã mở lại sản phẩm.' : 'Đã ngừng sản phẩm.');
    } catch (reason) { setError(errorMessage(reason)); }
  };

  if (loading) return <div className="detail-screen"><p role="status">Đang tải chi tiết sản phẩm…</p></div>;
  if (!product) return <div className="detail-screen"><Link href="/san-pham">← Quy cách và barcode</Link><div className="ui-error" role="alert">{error || 'Không tìm thấy sản phẩm.'}</div></div>;

  return <div className="detail-screen product-detail-page">
    <div className="detail-back"><Link href="/san-pham">← Quay lại danh sách sản phẩm</Link></div>
    <header className="detail-heading">
      <div className="product-detail-title">
        <div className="product-detail-image">{product.imageUrl ? <img src={product.imageUrl} alt={product.name} /> : <span>{product.name.charAt(0)}</span>}</div>
        <div><div className="breadcrumb">Hàng hóa › Sản phẩm › {product.code}</div><h1>{product.name}</h1><p>{product.code} · {product.category.name}</p></div>
      </div>
      <div><StatusBadge tone={product.active ? 'green' : 'neutral'}>{product.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</StatusBadge><button className="outline-button" onClick={() => router.push('/san-pham')}>Quay lại danh sách</button>{canManage && <button className={product.active ? 'danger-button' : 'success-button'} onClick={changeProductStatus}>{product.active ? 'Ngừng kinh doanh' : 'Mở lại kinh doanh'}</button>}</div>
    </header>
    {error && !skuModal && <div className="ui-error" role="alert">{error}</div>}

    <MetricGrid className="detail-kpis" label="Chỉ số sản phẩm đang chọn">
      <MetricCard tone="blue" label="GIÁ NIÊM YẾT" value={money(sku?.sellingPrice ?? 0)} caption={product.code} />
      <MetricCard tone="amber" label="GIÁ VỐN" value={money(sku?.costPrice ?? 0)} caption="Giá vốn hiện tại" />
      <MetricCard tone="green" label="BIÊN LỢI NHUẬN" value={`${margin.toFixed(1)}%`} caption="Tính từ giá hiện tại" />
      <MetricCard tone="violet" label="SỐ quy cách" value={product.skus.length} caption={`${product.skus.filter((item) => item.active).length} quy cách đang kinh doanh`} />
    </MetricGrid>

    {sku && <ProductAiAdvice product={product} sku={sku} />}

    <section className="detail-grid">
      <article className="detail-info panel"><h2>Thông tin chung</h2><dl><div><dt>Mã sản phẩm</dt><dd>{product.code}</dd></div><div><dt>Danh mục</dt><dd>{product.category.name}</dd></div><div><dt>Đơn vị tính</dt><dd>{product.unit}</dd></div><div><dt>Tổng quy cách</dt><dd>{product.skus.length}</dd></div><div><dt>Quy cách đang kinh doanh</dt><dd>{product.skus.filter((item) => item.active).length}</dd></div><div><dt>Cập nhật lúc</dt><dd>{dateTime(product.updatedAt)}</dd></div></dl></article>
      <article className="detail-timeline panel"><h2>Hoạt động gần đây</h2><ol><li><strong>Cập nhật master data</strong><span>{dateTime(product.updatedAt)}</span></li><li><strong>Tạo sản phẩm</strong><span>{dateTime(product.createdAt)}</span></li></ol></article>
    </section>

    <section className="detail-table panel sku-management">
      <header><div><h2>Quy cách và barcode</h2><p>Mỗi quy cách có barcode, giá và trạng thái riêng.</p></div>{canManage && <button className="primary-button" onClick={() => openSkuModal('create')}>＋ Thêm quy cách</button>}</header>
      <div className="table-scroll"><table><thead><tr><th>Barcode</th><th className="numeric">Giá vốn</th><th className="numeric">Giá bán</th><th className="numeric">Margin</th><th>Trạng thái</th><th>Cập nhật</th><th>Thao tác</th></tr></thead><tbody>{product.skus.length ? product.skus.map((item) => {
        const itemMargin = item.sellingPrice ? (item.sellingPrice - item.costPrice) / item.sellingPrice * 100 : 0;
        return <tr key={item.id} className={item.id === sku?.id ? 'selected-sku-row' : undefined}><td>{item.barcode}</td><td className="numeric">{money(item.costPrice)}</td><td className="numeric"><strong>{money(item.sellingPrice)}</strong></td><td className="numeric positive">{itemMargin.toFixed(1)}%</td><td><StatusBadge tone={item.active ? 'green' : 'neutral'}>{item.active ? 'Hoạt động' : 'Đã ngừng'}</StatusBadge></td><td>{dateTime(item.updatedAt ?? product.updatedAt)}</td><td><div className="row-actions"><ActionButton tone="view" onClick={() => setSelectedSkuId(item.id)}>Lịch sử giá</ActionButton>{canManage && <><ActionButton tone="edit" onClick={() => openSkuModal('edit', item)}>Sửa</ActionButton><ActionButton tone={item.active ? 'danger' : 'approve'} onClick={() => changeSkuStatus(item)}>{item.active ? 'Ngừng' : 'Mở lại'}</ActionButton></>}</div></td></tr>;
      }) : <tr><td colSpan={7}>Sản phẩm chưa có barcode.</td></tr>}</tbody></table></div>
    </section>

    <section className="detail-table panel">
      <header><div><h2>Lịch sử giá sản phẩm</h2><p>Lịch sử được ghi tự động khi giá bán hoặc giá vốn thay đổi.</p></div></header>
      <div className="table-scroll"><table><thead><tr><th>Thời điểm</th><th className="numeric">Giá bán</th><th className="numeric">Giá vốn</th><th className="numeric">Margin</th><th>Người cập nhật</th></tr></thead><tbody>{sku?.priceHistory?.length ? sku.priceHistory.map((item) => <tr key={item.id}><td>{dateTime(item.effectiveAt)}</td><td className="numeric"><strong>{money(item.sellingPrice)}</strong></td><td className="numeric">{money(item.costPrice)}</td><td className="numeric">{item.sellingPrice ? ((item.sellingPrice - item.costPrice) / item.sellingPrice * 100).toFixed(1) : '0.0'}%</td><td>{item.changedBy?.name ?? 'Hệ thống'}</td></tr>) : <tr><td colSpan={5}>Chưa có lịch sử giá cho sản phẩm này.</td></tr>}</tbody></table></div>
    </section>

    {skuModal && <div className="ui-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setSkuModal(null); }}><form className="ui-modal-card sku-form-modal" onSubmit={saveSku}>
      <header><h2>{skuModal === 'create' ? 'Thêm quy cách mới' : 'Chỉnh sửa quy cách'}</h2><button type="button" onClick={() => setSkuModal(null)}>×</button></header>
      {error && <div className="ui-error" role="alert">{error}</div>}
      <div className="form-grid">
        <input type="hidden" name="code" value={editingSku?.code ?? `${product.code}_${product.skus.length + 1}`} />
        <label>Barcode<input name="barcode" required pattern="[0-9]{8,14}" defaultValue={editingSku?.barcode} placeholder="8934567891201" /></label>
        <label>Giá vốn<CurrencyInput name="costPrice" min={0} max={999999999999} required defaultValue={editingSku?.costPrice} /></label>
        <label>Giá bán<CurrencyInput name="sellingPrice" min={0} max={999999999999} required defaultValue={editingSku?.sellingPrice} /></label>
      </div>
      <p className="form-note">Giá bán phải lớn hơn hoặc bằng giá vốn. Khi giá thay đổi, hệ thống tự lưu lịch sử cùng người thực hiện.</p>
      <footer><button type="button" className="outline-button" onClick={() => setSkuModal(null)}>Đóng</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : skuModal === 'create' ? 'Thêm quy cách' : 'Lưu thay đổi'}</button></footer>
    </form></div>}
  </div>;
}
