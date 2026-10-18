'use client';
import { Fragment, useEffect, useState } from 'react';
import Link from 'next/link';
import { Icon } from '../../components/ui/icon';
import { useAuth } from '../../components/auth-provider';
import { ProductImagePicker } from '../../components/products/product-image-picker';
import { CurrencyInput } from '../../components/ui/currency-input';
import { ActionButton, ActionLink } from '../../components/ui/action-button';
import { StatusBadge } from '../../components/ui/status-badge';
import { TabBar, type TabTone } from '../../components/ui/tab-bar';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import * as productsApi from '../../lib/products-api';
import { downloadExcel } from '../../lib/excel-export';

const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';
type Modal = 'create' | 'edit' | null;
type DetailTab = 'info' | 'description' | 'ledger' | 'stock';
const knownCategoryTones: Record<string, number> = { DO_UONG_SUA: 0, GIA_VI_THUC_PHAM: 1, BANH_KEO_DO_KHO: 2, TRA_CA_PHE: 3 };
const categoryTone = (code: string) => `category-tone-${knownCategoryTones[code] ?? [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 6}`;
const tabTones: TabTone[] = ['blue', 'green', 'amber', 'violet', 'red', 'cyan'];
const categoryTabTone = (code: string) => tabTones[knownCategoryTones[code] ?? [...code].reduce((sum, char) => sum + char.charCodeAt(0), 0) % tabTones.length];
const fileToDataUrl = async (file: File) => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d')?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.78);
};

const UNIT_OPTIONS = ['Hộp', 'Gói', 'Chai', 'Cái', 'Lon', 'Túi', 'Lốc', 'Thùng', 'Kg', 'Gram', 'Lít', 'ml', 'Bộ', 'Quyển'];

function CompactDropdown({ label, value, placeholder, options, onChange }: { label: string; value: string; placeholder: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find(option => option.value === value)?.label;
  return <div className="compact-select" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button type="button" className="compact-select-trigger" role="combobox" aria-label={label} aria-expanded={open} aria-haspopup="listbox" onClick={() => setOpen(current => !current)}>
      <span className={selected ? '' : 'placeholder'}>{selected ?? placeholder}</span><Icon name="chevron" size={15}/>
    </button>
    {open && <div className="compact-select-menu" role="listbox" aria-label={label}>{options.map(option => <button type="button" role="option" aria-selected={value === option.value} className={value === option.value ? 'selected' : ''} key={option.value} onClick={() => { onChange(option.value); setOpen(false); }}>{option.label}</button>)}</div>}
  </div>;
}

function ProductDetails({ product, loading, tab, setTab, canManage, onEdit, onClose }: { product: productsApi.Product; loading: boolean; tab: DetailTab; setTab: (value: DetailTab) => void; canManage: boolean; onEdit: () => void; onClose: () => void }) {
  const tabs: readonly [DetailTab, string][] = [['info','Thông tin'],['description','Mô tả, ghi chú'],['ledger','Thẻ kho'],['stock','Tồn kho']];
  return <section className="product-inline-detail">
    <nav aria-label="Thông tin sản phẩm">{tabs.map(([value,label]) => <button type="button" key={value} aria-current={tab===value?'page':undefined} onClick={()=>setTab(value)}>{label}</button>)}</nav>
    {loading ? <p className="muted">Đang tải thông tin…</p> : <>
      <div className="product-view-summary">{product.imageUrl ? <img src={product.imageUrl} alt={product.name}/> : <div className="product-thumb">{product.name.slice(0,1)}</div>}<div><h3>{product.name}</h3><p>Nhóm hàng: {product.category.name}</p><StatusBadge tone={product.active?'green':'red'}>{product.active?'Đang kinh doanh':'Ngừng kinh doanh'}</StatusBadge></div></div>
      {tab==='info' && <div className="product-detail-fields">{[['Mã sản phẩm',product.code],['Mã vạch',product.skus[0]?.barcode||'Chưa có'],['Giá vốn',money(product.skus[0]?.costPrice??0)],['Giá bán',money(product.skus[0]?.sellingPrice??0)],['Đơn vị',product.unit],['Danh mục',product.category.name]].map(([label,value])=><div key={label}><small>{label}</small><strong>{value}</strong></div>)}</div>}
      {tab==='description' && <div className="product-detail-note"><strong>Mô tả, ghi chú</strong><p>Sản phẩm chưa có mô tả hoặc ghi chú.</p><button type="button" className="outline-button" onClick={onEdit}>Bổ sung trong form sửa</button></div>}
      {tab==='ledger' && <div className="product-detail-note"><strong>Thẻ kho · {product.unit}</strong><p>{product.baseUnit&&product.unitsPerUnit>1?`1 ${product.unit} = ${product.unitsPerUnit} ${product.baseUnit}`:'Sản phẩm không thiết lập quy đổi đơn vị.'}</p><Link className="outline-button" href={`/lich-su-ton-kho?productId=${product.id}`}>Xem lịch sử thẻ kho</Link></div>}
      {tab==='stock' && <div className="product-detail-note"><strong>Tồn kho theo chi nhánh</strong><p>Mở màn tồn kho để xem số lượng khả dụng và đang chuyển theo từng kho.</p><Link className="outline-button" href={`/ton-kho?q=${encodeURIComponent(product.code)}`}>Xem tồn kho</Link></div>}
    </>}
    <footer><button className="outline-button" type="button" onClick={onClose}>Đóng</button>{canManage&&<button className="primary-button" type="button" onClick={onEdit}>Chỉnh sửa</button>}</footer>
  </section>;
}

function ProductUnitFields({ product }: { product: productsApi.Product | null }) {
  const hasConversion = !!product?.baseUnit && product.unitsPerUnit > 1;
  const [baseUnit, setBaseUnit] = useState(product ? (hasConversion ? product.baseUnit! : product.unit) : '');
  const [hasPackage, setHasPackage] = useState(hasConversion);
  const [packageUnit, setPackageUnit] = useState(hasConversion ? product!.unit : '');
  const [factor, setFactor] = useState(hasConversion ? String(product!.unitsPerUnit) : '');
  const [customBase, setCustomBase] = useState(baseUnit && !UNIT_OPTIONS.includes(baseUnit) ? baseUnit : '');
  const [customPackage, setCustomPackage] = useState(packageUnit && !UNIT_OPTIONS.includes(packageUnit) ? packageUnit : '');
  const [baseCustomMode, setBaseCustomMode] = useState(!!(baseUnit && !UNIT_OPTIONS.includes(baseUnit)));
  const [packageCustomMode, setPackageCustomMode] = useState(!!(packageUnit && !UNIT_OPTIONS.includes(packageUnit)));
  const resolvedBase = customBase || baseUnit;
  const resolvedPackage = customPackage || packageUnit;
  const baseChoice = baseCustomMode ? '__custom' : baseUnit;
  const packageChoice = packageCustomMode ? '__custom' : packageUnit;
  return <>
    <label>Đơn vị nhỏ nhất<CompactDropdown label="Đơn vị nhỏ nhất" value={baseChoice} placeholder="Chọn đơn vị" options={[...UNIT_OPTIONS.map(unit => ({ value: unit, label: unit })), { value: '__custom', label: 'Khác…' }]} onChange={value => { const custom = value === '__custom'; setBaseCustomMode(custom); setCustomBase(''); setBaseUnit(custom ? '' : value); }}/>{baseCustomMode && <input aria-label="Nhập đơn vị nhỏ nhất" value={customBase} onChange={event => setCustomBase(event.target.value)} placeholder="Nhập đơn vị" maxLength={30} required/>}<small>Đơn vị nhỏ nhất để đếm tồn và bán lẻ, như hộp, gói, chai hoặc cái. Không quy đổi thì chọn đơn vị dùng trực tiếp.</small></label>
    <div className="full unit-conversion-toggle"><label><input type="checkbox" checked={hasPackage} onChange={event => setHasPackage(event.target.checked)}/> Sản phẩm có quy cách đóng gói cần quy đổi</label><small>Chỉ bật khi nhập theo thùng/lốc nhưng quản lý hoặc bán theo đơn vị nhỏ hơn.</small></div>
    {hasPackage && <div className="full unit-conversion-fields"><label>Đơn vị đóng gói<CompactDropdown label="Đơn vị đóng gói" value={packageChoice} placeholder="Chọn đơn vị đóng gói" options={[...UNIT_OPTIONS.map(unit => ({ value: unit, label: unit })), { value: '__custom', label: 'Khác…' }]} onChange={value => { const custom = value === '__custom'; setPackageCustomMode(custom); setCustomPackage(''); setPackageUnit(custom ? '' : value); }}/>{packageCustomMode && <input aria-label="Nhập đơn vị đóng gói" value={customPackage} onChange={event => setCustomPackage(event.target.value)} placeholder="Nhập đơn vị" maxLength={30} required/>}</label><label>Số {resolvedBase || 'đơn vị nhỏ'} trong 1 {resolvedPackage || 'đơn vị đóng gói'}<input type="number" min="2" max="100000" step="1" value={factor} onChange={event => setFactor(event.target.value)} required/></label><p className="unit-conversion-summary">{resolvedBase && resolvedPackage && factor ? `1 ${resolvedPackage} = ${factor} ${resolvedBase}` : 'Nhập số lượng để xem quy đổi, ví dụ: 1 Thùng = 24 Hộp.'}</p></div>}
    <input type="hidden" name="unit" value={hasPackage ? resolvedPackage : resolvedBase}/><input type="hidden" name="baseUnit" value={hasPackage ? resolvedBase : ''}/><input type="hidden" name="unitsPerUnit" value={hasPackage ? factor : '1'}/>
  </>;
}

export default function Products() {
  const { showToast, confirmAction } = useToast();
  const { user } = useAuth();
  const canManage = !!user && (user.permissions.includes('products.manage') || user.permissions.includes('*'));
  const canManageCategories = !!user && (user.permissions.includes('categories.manage') || user.permissions.includes('*'));
  const [result, setResult] = useState<productsApi.ProductList>({ items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, active: 0, inactive: 0 } });
  const [categories, setCategories] = useState<productsApi.Category[]>([]);
  const [query, setQuery] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState<'all' | 'true' | 'false'>('all');
  const [stockStatus, setStockStatus] = useState<'all' | 'IN_STOCK' | 'OUT_OF_STOCK'>('all');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<Modal>(null);
  const [selected, setSelected] = useState<productsApi.Product | null>(null);
  const [nextCode, setNextCode] = useState('');
  const [viewing, setViewing] = useState<productsApi.Product | null>(null);
  const [viewLoading, setViewLoading] = useState(false);
  const [detailTab, setDetailTab] = useState<DetailTab>('info');
  const [exportOpen, setExportOpen] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [checkingFields, setCheckingFields] = useState<Record<string, boolean>>({});
  const [categoryModal, setCategoryModal] = useState(false);
  const [editingCategory, setEditingCategory] = useState<productsApi.Category | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const notify = (message: string) => showToast(message);
  const load = async () => {
    setLoading(true); setError('');
    try { setResult(await productsApi.getProducts({ q: query.trim() || undefined, active: status, stockStatus, categoryId: categoryId || undefined, page, pageSize: 20 })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };

  const loadCategories = async () => {
    try { setCategories(await productsApi.getCategories('all')); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  useEffect(() => { loadCategories(); }, []);
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [query, categoryId, status, stockStatus, page]);
  useEffect(() => { setPage(1); }, [query, categoryId, status, stockStatus]);

  const open = (type: Exclude<Modal, null>, product: productsApi.Product | null = null) => {
    setSelected(product); setError(''); setFieldErrors({}); setModal(type);
    if (type === 'create') {
      setNextCode('');
      productsApi.getNextProductCode().then(setNextCode).catch(reason => setError(errorMessage(reason)));
    }
  };
  const checkField = async (field: 'code' | 'barcode', value: string) => {
    const normalized = value.trim().toUpperCase();
    if (!normalized) { setFieldErrors(old => ({ ...old, [field]: '' })); return; }
    setCheckingFields(old => ({ ...old, [field]: true }));
    try {
      const result = await productsApi.checkProductAvailability({ [field]: normalized, ...(field === 'code' && !selected ? { sku: normalized } : {}), ...(selected ? { excludeProductId: selected.id, excludeSkuId: selected.skus[0]?.id } : {}) });
      const available = field === 'code' ? result.codeAvailable && (selected || result.skuAvailable) : result.barcodeAvailable;
      setFieldErrors(old => ({ ...old, [field]: available ? '' : field === 'code' ? 'Mã này đã được sử dụng. Hãy chọn mã sản phẩm khác.' : 'Barcode này đã được gán cho sản phẩm khác.' }));
    } catch (reason) { setFieldErrors(old => ({ ...old, [field]: errorMessage(reason) })); }
    finally { setCheckingFields(old => ({ ...old, [field]: false })); }
  };
  const showProduct = async (product: productsApi.Product) => {
    if (viewing?.id === product.id) { setViewing(null); return; }
    setViewing(product); setDetailTab('info'); setViewLoading(true);
    try { setViewing(await productsApi.getProduct(product.id)); }
    catch (reason) { setViewing(null); setError(errorMessage(reason)); }
    finally { setViewLoading(false); }
  };
  const exportProducts = async () => {
    const columns = [
      ['Mã sản phẩm', (p: productsApi.Product) => p.code], ['Tên sản phẩm', (p: productsApi.Product) => p.name],
      ['Danh mục', (p: productsApi.Product) => p.category.name], ['Đơn vị', (p: productsApi.Product) => p.unit],
      ['Giá vốn', (p: productsApi.Product) => p.skus[0]?.costPrice ?? 0], ['Giá bán', (p: productsApi.Product) => p.skus[0]?.sellingPrice ?? 0],
      ['Barcode', (p: productsApi.Product) => p.skus[0]?.barcode ?? ''], ['Trạng thái', (p: productsApi.Product) => p.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'],
    ] as const;
    const selectedColumns = Array.from(document.querySelectorAll<HTMLInputElement>('[data-export-field]:checked')).map(input => Number(input.value));
    const quote = (value: unknown) => `"${String(value).replaceAll('"', '""')}"`;
    const firstPage = await productsApi.getProducts({ q: query.trim() || undefined, active: status, categoryId: categoryId || undefined, page: 1, pageSize: 100 });
    const allProducts = [...firstPage.items];
    for (let nextPage = 2; nextPage <= firstPage.pagination.totalPages; nextPage += 1) {
      const next = await productsApi.getProducts({ q: query.trim() || undefined, active: status, categoryId: categoryId || undefined, page: nextPage, pageSize: 100 });
      allProducts.push(...next.items);
    }
    const rows = [selectedColumns.map(index => columns[index]![0]), ...allProducts.map(product => selectedColumns.map(index => columns[index]![1](product)))];
    const csv = '\uFEFF' + [['DANH SÁCH SẢN PHẨM'], ['Số lượng', String(allProducts.length)], [], ...rows].map(row => row.map(quote).join(',')).join('\r\n');
    downloadExcel(csv, 'danh-sach-san-pham.xls'); setExportOpen(false);
  };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError('');
    try {
      const data = new FormData(event.currentTarget);
      const form = event.currentTarget;
      const skuCode = selected?.skus[0]?.code;
      const availability = await productsApi.checkProductAvailability({ ...(skuCode ? { sku: skuCode } : {}), barcode: String(data.get('barcode')).trim(), ...(selected ? { excludeProductId: selected.id, excludeSkuId: selected.skus[0]?.id } : {}) });
      const nextErrors = { barcode: availability.barcodeAvailable ? '' : 'Barcode này đã được gán cho sản phẩm khác.' };
      setFieldErrors(nextErrors);
      const firstInvalid = (Object.keys(nextErrors) as Array<keyof typeof nextErrors>).find(key => nextErrors[key]);
      if (firstInvalid) { form.querySelector<HTMLInputElement>(`[name="${firstInvalid}"]`)?.focus(); throw new Error('Vui lòng sửa các ô được đánh dấu trước khi lưu.'); }
      const image = data.get('image') as File | null;
      if (image?.size && image.size > 5 * 1024 * 1024) throw new Error('Ảnh sản phẩm không được vượt quá 5 MB.');
      const imageDataUrl = image?.size ? await fileToDataUrl(image) : undefined;
      const common = {
        name: String(data.get('name')), unit: String(data.get('unit')), baseUnit: String(data.get('baseUnit') || '') || null, unitsPerUnit: Number(data.get('unitsPerUnit') || 1), categoryId: String(data.get('categoryId')),
        ...(imageDataUrl ? { imageDataUrl } : {}),
        sku: { barcode: String(data.get('barcode')), sellingPrice: Number(data.get('sellingPrice')), costPrice: Number(data.get('costPrice')) },
      };
      let savedCode: string | undefined;
      if (selected) await productsApi.updateProduct(selected.id, { ...common, removeImage: data.get('removeImage') === 'true', sku: { ...common.sku, code: selected.skus[0]!.code, id: selected.skus[0]!.id } });
      else savedCode = (await productsApi.createProduct(common)).code;
      setModal(null); notify(selected ? 'Đã cập nhật sản phẩm và ảnh.' : `Đã thêm sản phẩm. Mã sản phẩm: ${savedCode}.`); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };

  const changeStatus = async (product: productsApi.Product) => {
    const next = !product.active;
    const sku = product.skus[0];
    if (!await confirmAction(next ? `Bạn muốn mở lại sản phẩm “${product.name}” để tiếp tục bán?` : `Sản phẩm “${product.name}” sẽ không còn xuất hiện để bán tại POS. Bạn có thể mở lại sau.`, {
      title: next ? 'Xác nhận mở kinh doanh' : 'Xác nhận ngừng kinh doanh',
      imageUrl: product.imageUrl,
      imageFallback: product.name.slice(0, 1).toLocaleUpperCase('vi'),
      details: [`Mã sản phẩm: ${product.code}`, `Danh mục: ${product.category.name}`, `Đơn vị: ${product.unit}`, `Giá bán: ${money(sku?.sellingPrice ?? 0)}`, `Trạng thái hiện tại: ${product.active ? 'Đang kinh doanh' : 'Đã ngừng'}`],
    })) return;
    try { await productsApi.setProductStatus(product.id, next); notify(next ? 'Đã mở lại kinh doanh.' : 'Đã ngừng kinh doanh.'); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
  };

  const saveCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError('');
    const form = event.currentTarget;
    try {
      const data = new FormData(form);
      const name = String(data.get('name'));
      const description = String(data.get('description')).trim() || null;
      if (editingCategory) await productsApi.updateCategory(editingCategory.id, { name, description });
      else await productsApi.createCategory({ code: String(data.get('code')).toUpperCase(), name, description });
      showToast(editingCategory ? 'Đã cập nhật danh mục.' : 'Đã thêm danh mục.');
      setEditingCategory(null);
      form.reset();
      await loadCategories();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };

  const changeCategoryStatus = async (category: productsApi.Category) => {
    const next = !category.active;
    if (!await confirmAction(next ? `Mở lại danh mục “${category.name}”?` : `Ngừng danh mục “${category.name}”?`)) return;
    setError('');
    try {
      await productsApi.setCategoryStatus(category.id, next);
      showToast(next ? 'Đã mở lại danh mục.' : 'Đã ngừng danh mục.');
      if (categoryId === category.id && !next) setCategoryId('');
      if (editingCategory?.id === category.id) setEditingCategory(null);
      await loadCategories();
    } catch (reason) { setError(errorMessage(reason)); }
  };

  return <div className="suite-page products-page">
    <header className="suite-heading">
      <div><div className="breadcrumb">Hàng hóa <span>›</span> Sản phẩm</div><h1>Danh sách hàng hóa</h1></div>
      {(canManage || canManageCategories) && <div className="product-heading-actions"><button className="outline-button" onClick={() => setExportOpen(true)}>Xuất file</button>{canManageCategories && <button className="outline-button" onClick={() => { setError(''); setEditingCategory(null); setCategoryModal(true); }}>Quản lý danh mục</button>}{canManage && <button className="primary-button" onClick={() => open('create')}>＋ Tạo mới</button>}</div>}
    </header>
    <section className="suite-panel panel">
      <aside className="products-filter-panel">
        <div><div className="product-filter-heading"><strong>Nhóm hàng</strong><button type="button" onClick={() => { setError(''); setEditingCategory(null); setCategoryModal(true); }}>Tạo mới</button></div><select aria-label="Lọc theo nhóm hàng" value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">Chọn nhóm hàng</option>{categories.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
        <div><strong>Tồn kho</strong><p>Trạng thái số lượng</p><select aria-label="Lọc còn hàng hoặc hết hàng" value={stockStatus} onChange={event => setStockStatus(event.target.value as typeof stockStatus)}><option value="all">Tất cả</option><option value="IN_STOCK">Còn hàng</option><option value="OUT_OF_STOCK">Hết hàng</option></select></div>
        <div><strong>Trạng thái hàng hóa</strong><div className="product-filter-pills">{([['all','Tất cả'],['true','Đang bán'],['false','Ngừng bán']] as const).map(([value,label])=><button type="button" key={value} aria-pressed={status===value} onClick={()=>setStatus(value)}>{label}</button>)}</div></div>
      </aside>
      <TabBar className="products-category-tabs" value={categoryId || 'all'} onChange={value => setCategoryId(value === 'all' ? '' : value)} label="Lọc sản phẩm theo danh mục" items={[{ value: 'all', label: 'Tất cả sản phẩm', tone: 'blue' }, ...categories.filter(item => item.active).map(item => ({ value: item.id, label: item.name, tone: categoryTabTone(item.code) }))]}/>
      <div className="suite-filters"><label><Icon name="search"/><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Tìm mã sản phẩm, barcode hoặc tên..."/></label><select value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="all">Tất cả trạng thái</option><option value="true">Đang kinh doanh</option><option value="false">Ngừng kinh doanh</option></select><button onClick={() => { setQuery(''); setCategoryId(''); setStatus('all'); setStockStatus('all'); }}>Xóa lọc</button></div>
      {error && !modal && <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>}
      <div className="table-scroll"><table><thead><tr><th>Mã sản phẩm</th><th>Barcode</th><th>Tên sản phẩm</th><th>Danh mục</th><th>ĐVT</th><th className="numeric">Tồn kho</th><th className="numeric">Giá vốn</th><th className="numeric">Giá bán</th><th className="numeric">Margin</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
        {loading ? <tr><td colSpan={11}>Đang tải dữ liệu sản phẩm…</td></tr> : result.items.length === 0 ? <tr><td colSpan={11}>Không có sản phẩm phù hợp.</td></tr> : result.items.map(product => {
          const sku = product.skus[0];
          const margin = sku?.sellingPrice ? (sku.sellingPrice - sku.costPrice) / sku.sellingPrice * 100 : 0;
          return <Fragment key={product.id}><tr className={`product-row-clickable ${viewing?.id===product.id?'product-row-selected':''}`} role="button" tabIndex={0} onClick={() => showProduct(product)} onKeyDown={event => { if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); showProduct(product); } }} title="Bấm để xem chi tiết sản phẩm">
            <td><code>{product.code}</code></td><td>{sku?.barcode ?? '—'}</td>
            <td><div className="product-name-cell"><div className="product-thumb">{product.imageUrl ? <img src={product.imageUrl} alt=""/> : <span>{product.name.charAt(0)}</span>}</div><strong>{product.name}</strong></div></td>
            <td><span className={`suite-chip category-chip ${categoryTone(product.category.code)}`}>{product.category.name}</span></td><td><strong>{product.unit}</strong>{product.baseUnit && product.unitsPerUnit > 1 && <small>1 {product.unit} = {product.unitsPerUnit} {product.baseUnit}</small>}</td><td className="numeric"><strong>{product.availableStock ?? 0}</strong><small>{(product.availableStock ?? 0) > 0 ? 'Còn hàng' : 'Hết hàng'}</small></td>
            <td className="numeric">{money(sku?.costPrice ?? 0)}</td><td className="numeric"><strong>{money(sku?.sellingPrice ?? 0)}</strong></td><td className="numeric"><strong className="positive">{margin.toFixed(1)}%</strong></td>
            <td><StatusBadge tone={product.active ? 'green' : 'red'}>{product.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</StatusBadge></td>
            <td onClick={event => event.stopPropagation()}><div className="row-actions">{canManage && <><ActionButton tone="edit" onClick={() => open('edit', product)}>Sửa</ActionButton><ActionButton tone={product.active ? 'danger' : 'approve'} onClick={() => changeStatus(product)}>{product.active ? 'Ngừng' : 'Mở lại'}</ActionButton></>}</div></td>
          </tr>{viewing?.id===product.id&&<tr className="product-detail-row"><td colSpan={11}><ProductDetails product={viewing} loading={viewLoading} tab={detailTab} setTab={setDetailTab} canManage={canManage} onEdit={()=>open('edit',viewing)} onClose={()=>setViewing(null)}/></td></tr>}</Fragment>;
        })}
      </tbody></table></div>
      <footer><span>Hiển thị <b>{result.items.length}</b> trên {result.pagination.total} sản phẩm</span><div className="suite-pagination"><button disabled={page <= 1} onClick={() => setPage(value => value - 1)}>‹ Trước</button><span>Trang {page}/{result.pagination.totalPages}</span><button disabled={page >= result.pagination.totalPages} onClick={() => setPage(value => value + 1)}>Sau ›</button></div></footer>
    </section>
    {modal && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget) setModal(null); }}><form className="ui-modal-card product-form" onSubmit={save} key={`${modal}-${selected?.id ?? 'new'}`}>
      <header><h2>{modal === 'create' ? 'Thêm sản phẩm' : 'Cập nhật sản phẩm'}</h2><button type="button" onClick={() => setModal(null)}>×</button></header>
      {error && <div className="ui-error" role="alert">{error}</div>}
      <div className="form-grid">
        <div className="product-auto-code"><span>Mã sản phẩm · tự tăng</span><strong aria-live="polite">{(selected?.code ?? nextCode) || 'Đang lấy mã...'}</strong></div>
        <label className="full">Tên sản phẩm<input name="name" required maxLength={150} defaultValue={selected?.name}/></label>
        <label>Barcode<input name="barcode" required pattern="[0-9]{8,14}" defaultValue={selected?.skus[0]?.barcode} onBlur={event => checkField('barcode', event.target.value)} aria-invalid={!!fieldErrors.barcode}/>{checkingFields.barcode && <small>Đang kiểm tra mã…</small>}{fieldErrors.barcode && <small className="field-error" role="alert">{fieldErrors.barcode}</small>}<small>Mã vạch để máy quét tìm nhanh sản phẩm tại POS.</small></label>
        <label>Danh mục<select name="categoryId" required defaultValue={selected?.categoryId ?? ''}><option value="" disabled>Chọn danh mục</option>{categories.filter(item => item.active).map(item => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <ProductUnitFields product={selected}/>
        <label>Giá vốn<CurrencyInput name="costPrice" min={0} required defaultValue={selected?.skus[0]?.costPrice}/></label>
        <label>Giá bán<CurrencyInput name="sellingPrice" min={0} required defaultValue={selected?.skus[0]?.sellingPrice}/></label>
        <div className="full"><ProductImagePicker currentUrl={selected?.imageUrl}/></div>
      </div>
      <footer><button type="button" className="outline-button" onClick={() => setModal(null)}>Đóng</button><button className="primary-button" disabled={saving}>{saving ? 'Đang tối ưu ảnh và lưu…' : 'Lưu sản phẩm'}</button></footer>
    </form></div>}
    {exportOpen && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget) setExportOpen(false); }}><section className="ui-modal-card product-export-modal"><header><div><h2>Tùy chọn cột hiển thị</h2><p>Chọn các thông tin cần xuất cho danh sách sản phẩm hiện tại.</p></div><button type="button" aria-label="Đóng" onClick={() => setExportOpen(false)}>×</button></header><div className="product-export-fields">{['Mã sản phẩm', 'Tên sản phẩm', 'Danh mục', 'Đơn vị', 'Giá vốn', 'Giá bán', 'Barcode', 'Trạng thái'].map((label, index) => <label key={label}><input type="checkbox" data-export-field value={index} defaultChecked/> {label}</label>)}</div><footer><button className="outline-button" type="button" onClick={() => setExportOpen(false)}>Bỏ qua</button><button className="primary-button" type="button" onClick={exportProducts}>Xuất Excel</button></footer></section></div>}
    {categoryModal && <div className="ui-modal" onMouseDown={event => { if (event.target === event.currentTarget) setCategoryModal(false); }}><div className="ui-modal-card category-manager-modal">
      <header><div><h2>Quản lý danh mục sản phẩm</h2><p>Tạo, cập nhật và ngừng danh mục không còn sử dụng.</p></div><button type="button" onClick={() => setCategoryModal(false)}>×</button></header>
      {error && <div className="ui-error" role="alert">{error}</div>}
      <div className="category-manager-grid">
        <form onSubmit={saveCategory} key={editingCategory?.id ?? 'new'}>
          <h3>{editingCategory ? 'Cập nhật danh mục' : 'Thêm danh mục'}</h3>
          <label>Tên danh mục<input name="name" required maxLength={100} defaultValue={editingCategory?.name} placeholder="Đồ uống" /></label>
          <label>Mô tả<textarea name="description" maxLength={500} rows={4} defaultValue={editingCategory?.description ?? ''} placeholder="Mô tả ngắn về nhóm sản phẩm" /></label>
          <div className="category-form-actions">{editingCategory && <button type="button" className="outline-button" onClick={() => setEditingCategory(null)}>Tạo mới</button>}<button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : editingCategory ? 'Lưu thay đổi' : 'Thêm danh mục'}</button></div>
        </form>
         <div className="category-manager-list"><table><thead><tr><th>Danh mục</th><th className="numeric">Sản phẩm</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{categories.length ? categories.map(category => <tr key={category.id}><td><strong>{category.name}</strong><small>{category.code}{category.description ? ` · ${category.description}` : ''}</small></td><td className="numeric">{category._count.products}</td><td><StatusBadge tone={category.active ? 'green' : 'red'}>{category.active ? 'Hoạt động' : 'Đã ngừng'}</StatusBadge></td><td><div className="row-actions"><ActionButton tone="edit" onClick={() => { setError(''); setEditingCategory(category); }}>Sửa</ActionButton><ActionButton tone={category.active ? 'danger' : 'approve'} onClick={() => changeCategoryStatus(category)}>{category.active ? 'Ngừng' : 'Mở lại'}</ActionButton></div></td></tr>) : <tr><td colSpan={4}>Chưa có danh mục.</td></tr>}</tbody></table></div>
      </div>
      <footer><button className="outline-button" type="button" onClick={() => setCategoryModal(false)}>Đóng</button></footer>
    </div></div>}
  </div>;
}
