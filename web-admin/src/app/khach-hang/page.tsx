'use client';
import { downloadExcel } from '../../lib/excel-export';

import { useEffect, useState } from 'react';
import { Protected, useAuth } from '../../components/auth-provider';
import { ActionButton, ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { StatusBadge } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import * as api from '../../lib/customers-api';

type ActiveFilter = 'all' | 'true' | 'false';
const empty: api.CustomerList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, active: 0, inactive: 0 } };
const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const date = (value: string | null) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(new Date(value)) : 'Chưa mua hàng';

function CustomersPage() {
  const { user } = useAuth();
  const { showToast, confirmAction } = useToast();
  const canManage = !!user && (user.permissions.includes('customers.manage') || user.permissions.includes('*'));
  const [result, setResult] = useState(empty);
  const [q, setQ] = useState('');
  const [active, setActive] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<'create' | 'edit' | null>(null);
  const [selected, setSelected] = useState<api.Customer | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true); setError('');
    try { setResult(await api.getCustomers({ q: q.trim() || undefined, active, page })); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [q, active, page]);
  useEffect(() => setPage(1), [q, active]);

  const tabs: TabItem<ActiveFilter>[] = [
    { value: 'all', label: 'Tất cả khách hàng', count: result.summary.total, tone: 'blue' },
    { value: 'true', label: 'Đang hoạt động', count: result.summary.active, tone: 'green' },
    { value: 'false', label: 'Đã ngừng', count: result.summary.inactive, tone: 'red' },
  ];
  const open = (mode: 'create' | 'edit', customer: api.Customer | null = null) => { setSelected(customer); setError(''); setModal(mode); };
  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError('');
    const data = new FormData(event.currentTarget);
    const payload: api.CustomerInput = { name: String(data.get('name')), phone: String(data.get('phone')), email: String(data.get('email')).trim() || null, address: String(data.get('address')).trim() || null, note: String(data.get('note')).trim() || null };
    try {
      if (selected) await api.updateCustomer(selected.id, payload); else await api.createCustomer(payload);
      setModal(null); showToast(selected ? 'Đã cập nhật khách hàng.' : 'Đã thêm khách hàng.'); await load();
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setSaving(false); }
  };
  const changeStatus = async (customer: api.Customer) => {
    const next = !customer.active;
    if (!await confirmAction(next ? `Mở lại hồ sơ “${customer.name}”?` : `Ngừng hồ sơ “${customer.name}”?`)) return;
    try { await api.setCustomerStatus(customer.id, next); showToast(next ? 'Đã mở lại hồ sơ khách hàng.' : 'Đã ngừng hồ sơ khách hàng.'); await load(); }
    catch (reason) { setError(errorMessage(reason)); }
  };
  const exportExcel = () => {
    const rows = [['DANH SÁCH KHÁCH HÀNG'], [], ['Mã KH', 'Họ tên', 'Số điện thoại', 'Email', 'Số đơn', 'Tổng chi tiêu', 'Lần mua gần nhất', 'Trạng thái'], ...result.items.map((item) => [item.code, item.name, item.phone, item.email ?? '', String(item.orderCount), String(item.totalSpent), item.lastPurchaseAt ? date(item.lastPurchaseAt) : '', item.active ? 'Hoạt động' : 'Đã ngừng'])];
    const csv = '\uFEFF' + rows.map((row) => row.map((value) => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    void downloadExcel(csv, `khach-hang-trang-${page}.xls`); showToast(result.pagination.total > result.items.length ? 'Đã xuất khách hàng của trang hiện tại.' : 'Đã xuất danh sách khách hàng.');
  };

  return <div className="suite-page customer-page">
    <header className="suite-heading"><div><div className="breadcrumb">Bán hàng <span>›</span> Khách hàng</div><h1>Quản lý khách hàng</h1><p>Hồ sơ liên hệ và lịch sử mua hàng phục vụ bán hàng tại quầy.</p></div><div><button className="outline-button" onClick={exportExcel} disabled={loading || !result.items.length}><Icon name="download" />Xuất Excel</button>{canManage && <button className="primary-button" onClick={() => open('create')}>＋ Thêm khách hàng</button>}</div></header>
    <MetricGrid className="suite-kpis" label="Chỉ số khách hàng"><MetricCard tone="blue" label="TỔNG KHÁCH HÀNG" icon={<Icon name="users" />} value={result.summary.total} caption="Hồ sơ đã lưu trong hệ thống" /><MetricCard tone="green" label="ĐANG HOẠT ĐỘNG" icon={<Icon name="check" />} value={result.summary.active} caption="Có thể chọn khi tạo hóa đơn" /><MetricCard tone="red" label="ĐÃ NGỪNG" icon={<Icon name="close" />} value={result.summary.inactive} caption="Được giữ lại để truy vết lịch sử" /><MetricCard tone="violet" label="KẾT QUẢ ĐANG LỌC" icon={<Icon name="search" />} value={result.pagination.total} caption="Theo từ khóa và trạng thái hiện tại" /></MetricGrid>
    <section className="suite-panel panel">
      <TabBar items={tabs} value={active} onChange={setActive} label="Lọc trạng thái khách hàng" />
      <div className="suite-filters"><label><Icon name="search" /><input value={q} onChange={(event) => setQ(event.target.value)} placeholder="Tìm mã, họ tên, số điện thoại hoặc email…" /></label><button onClick={() => { setQ(''); setActive('all'); }}>Xóa lọc</button></div>
      {error && !modal && <div className="ui-error" role="alert">{error} <button onClick={load}>Thử lại</button></div>}
      <div className="table-scroll"><table><thead><tr><th>Mã khách hàng</th><th>Khách hàng & liên hệ</th><th className="numeric">Tổng đơn</th><th className="numeric">Chi tiêu lũy kế</th><th>Đơn gần nhất</th><th>Ghi chú</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{loading ? <tr><td colSpan={8}>Đang tải khách hàng…</td></tr> : result.items.length ? result.items.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td><strong>{item.name}</strong><small>{item.phone}{item.email ? ` · ${item.email}` : ''}</small></td><td className="numeric">{item.orderCount}</td><td className="numeric"><strong>{money(item.totalSpent)}</strong></td><td>{date(item.lastPurchaseAt)}</td><td className="customer-note-cell">{item.note ?? '—'}</td><td><StatusBadge tone={item.active ? 'green' : 'neutral'}>{item.active ? 'Hoạt động' : 'Đã ngừng'}</StatusBadge></td><td><div className="row-actions"><ActionLink tone="view" href={`/khach-hang/${item.id}`}>Xem</ActionLink>{canManage && <><ActionButton tone="edit" onClick={() => open('edit', item)}>Sửa</ActionButton><ActionButton tone={item.active ? 'danger' : 'approve'} onClick={() => changeStatus(item)}>{item.active ? 'Ngừng' : 'Mở lại'}</ActionButton></>}</div></td></tr>) : <tr><td colSpan={8}>Không có khách hàng phù hợp.</td></tr>}</tbody></table></div>
      <TablePagination page={result.pagination.page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="khách hàng" onChange={setPage} />
    </section>
    {modal && <div className="ui-modal" onMouseDown={(event) => { if (event.target === event.currentTarget) setModal(null); }}><form className="ui-modal-card customer-form-modal" onSubmit={save}><header><h2>{modal === 'create' ? 'Thêm khách hàng' : 'Cập nhật khách hàng'}</h2><button type="button" onClick={() => setModal(null)}>×</button></header>{error && <div className="ui-error" role="alert">{error}</div>}<div className="form-grid"><label className="full">Họ và tên<input name="name" required minLength={2} maxLength={120} defaultValue={selected?.name} /></label><label>Số điện thoại<input name="phone" required minLength={8} maxLength={20} pattern="[0-9+ .()\-]+" defaultValue={selected?.phone} /></label><label>Email<input name="email" type="email" maxLength={254} defaultValue={selected?.email ?? ''} /></label><label className="full">Địa chỉ nhận hàng<input name="address" maxLength={300} defaultValue={selected?.address ?? ''} /></label><label className="full">Ghi chú<textarea name="note" rows={4} maxLength={500} defaultValue={selected?.note ?? ''} /></label></div><footer><button type="button" className="outline-button" onClick={() => setModal(null)}>Đóng</button><button className="primary-button" disabled={saving}>{saving ? 'Đang lưu…' : 'Lưu khách hàng'}</button></footer></form></div>}
  </div>;
}

export default function Page() { return <Protected permission="customers.read"><CustomersPage /></Protected>; }
