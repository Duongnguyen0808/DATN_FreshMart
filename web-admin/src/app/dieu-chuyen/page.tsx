'use client';
import { TableState } from '../../components/ui/table-state';
import { useEffect, useState } from 'react';
import { useAuth } from '../../components/auth-provider';
import { ActionButton, ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { FilterToolbar, PageHeader, PanelCard } from '../../components/ui/page-kit';
import { StatusBadge, type StatusTone } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getWarehouses, type Warehouse } from '../../lib/organization-api';
import { getProducts, type Product } from '../../lib/products-api';
import * as transfers from '../../lib/transfers-api';

type Filter = 'all' | 'READY' | 'IN_TRANSIT' | 'COMPLETED' | 'CANCELLED';
type Line = { key: string; skuId: string; quantity: number };
const empty: transfers.TransferList = { items: [], pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 }, summary: { total: 0, pending: 0, approved: 0, inTransit: 0, completed: 0, rejected: 0, cancelled: 0 } };
const labels: Record<transfers.TransferStatus, string> = { READY: 'Chờ xuất kho', IN_TRANSIT: 'Đang vận chuyển', COMPLETED: 'Hoàn tất', REJECTED: 'Đã hủy', CANCELLED: 'Đã hủy' };
const tones: Record<transfers.TransferStatus, StatusTone> = { READY: 'blue', IN_TRANSIT: 'violet', COMPLETED: 'green', REJECTED: 'neutral', CANCELLED: 'neutral' };
const tabs: TabItem<Filter>[] = [
  { value: 'all', label: 'Tất cả', tone: 'blue' },
  { value: 'READY', label: 'Chờ xuất kho', tone: 'amber' },
  { value: 'IN_TRANSIT', label: 'Đang vận chuyển', tone: 'violet' },
  { value: 'COMPLETED', label: 'Hoàn tất', tone: 'green' },
  { value: 'CANCELLED', label: 'Đã hủy', tone: 'red' },
];
const dateTime = (value: string) => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

export default function TransfersPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [result, setResult] = useState(empty);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<Filter>('all');
  const [warehouseId, setWarehouseId] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<Line[]>([{ key: 'first', skuId: '', quantity: 1 }]);
  const canCreate = Boolean(user?.permissions.includes('transfers.create') || user?.permissions.includes('*'));

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      setResult(await transfers.getTransfers({ q: query.trim() || undefined, status, warehouseId: warehouseId || undefined, page }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    Promise.all([getWarehouses(), getProducts({ active: 'true', pageSize: 100 })])
      .then(([w, p]) => {
        setWarehouses(w.filter(x => x.active && x.store.active));
        setProducts(p.items);
      })
      .catch(e => setError(errorMessage(e)));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [query, status, warehouseId, page]);

  useEffect(() => setPage(1), [query, status, warehouseId]);

  const skuOptions = products.flatMap(product => product.skus.filter(sku => sku.active).map(sku => ({ id: sku.id, label: `${product.name} (${product.unit})` })));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await transfers.createTransfer({
        sourceWarehouseId: source,
        destinationWarehouseId: destination,
        reason,
        items: lines.map(line => ({ skuId: line.skuId, quantity: Number(line.quantity) })),
      });
      setCreateOpen(false);
      setSource('');
      setDestination('');
      setReason('');
      setLines([{ key: 'first', skuId: '', quantity: 1 }]);
      showToast('Đã tạo phiếu điều chuyển. Có thể xuất kho ngay.');
      await load();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const quickDispatch = async (row: transfers.Transfer) => {
    setBusy(true);
    try {
      await transfers.dispatchTransfer(row.id, 'Xuất kho điều chuyển');
      showToast(`Đã xuất kho phiếu ${row.code}.`);
      await load();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const quickReceive = async (row: transfers.Transfer) => {
    setBusy(true);
    try {
      await transfers.receiveTransfer(row.id, {
        note: 'Nhận đủ theo số lượng xuất',
        items: row.items.map(item => ({
          skuId: item.skuId,
          quantity: item.dispatchedQuantity ?? item.approvedQuantity ?? item.requestedQuantity,
          discrepancyReason: null,
        })),
      });
      showToast(`Đã nhận hàng phiếu ${row.code} và cộng tồn kho đích.`);
      await load();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const canDispatchRow = (row: transfers.Transfer) =>
    row.status === 'READY' &&
    Boolean(user?.permissions.includes('transfers.dispatch') || user?.permissions.includes('*')) &&
    Boolean(user?.globalAccess || user?.stores.some(s => s.id === row.sourceWarehouse.store.id));

  const canReceiveRow = (row: transfers.Transfer) =>
    row.status === 'IN_TRANSIT' &&
    Boolean(user?.permissions.includes('transfers.receive') || user?.permissions.includes('*')) &&
    Boolean(user?.globalAccess || user?.stores.some(s => s.id === row.destinationWarehouse.store.id));

  return (
    <div className="suite-page transfer-page">
      <PageHeader
        breadcrumbs={['Hàng hóa', 'Điều chuyển']}
        title="Điều chuyển hàng giữa các chi nhánh"
        description="Quy trình tinh gọn 3 bước: Tạo phiếu → Xuất kho nguồn → Nhận tại kho đích."
        actions={
          canCreate && (
            <ActionButton tone="approve" onClick={() => setCreateOpen(true)}>
              <Icon name="add" /> Tạo phiếu điều chuyển
            </ActionButton>
          )
        }
      />

      <MetricGrid className="suite-kpis" label="Chỉ số điều chuyển">
        <MetricCard tone="blue" label="TỔNG PHIẾU" value={result.summary.total} />
        <MetricCard tone="amber" label="CHỜ XUẤT KHO" value={result.summary.approved} />
        <MetricCard tone="violet" label="ĐANG VẬN CHUYỂN" value={result.summary.inTransit} />
        <MetricCard tone="green" label="HOÀN TẤT" value={result.summary.completed} />
      </MetricGrid>

      <PanelCard>
        <TabBar
          value={status}
          onChange={setStatus}
          label="Lọc trạng thái"
          items={tabs.map(tab => ({
            ...tab,
            count:
              tab.value === 'all'
                ? result.summary.total
                : tab.value === 'READY'
                  ? result.summary.approved
                  : tab.value === 'IN_TRANSIT'
                    ? result.summary.inTransit
                    : tab.value === 'COMPLETED'
                      ? result.summary.completed
                      : result.summary.cancelled + result.summary.rejected,
          }))}
        />

        <FilterToolbar
          searchValue={query}
          onSearchChange={setQuery}
          searchPlaceholder="Tìm mã phiếu, kho hoặc lý do..."
          onClear={() => {
            setQuery('');
            setStatus('all');
            setWarehouseId('');
          }}
        >
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
            <option value="">Tất cả kho</option>
            {warehouses.map(w => (
              <option key={w.id} value={w.id}>
                {w.code} · {w.name}
              </option>
            ))}
          </select>
        </FilterToolbar>

        {error && (
          <div className="ui-error">
            {error} <button onClick={load}>Thử lại</button>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã phiếu</th>
                <th>Kho nguồn → Kho đích</th>
                <th>Lý do / Người tạo</th>
                <th className="numeric">Mặt hàng</th>
                <th className="numeric">Số lượng chuyển</th>
                <th className="numeric">Thực nhận</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <TableState message="Đang tải phiếu điều chuyển…" loading />
                  </td>
                </tr>
              ) : result.items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <TableState message="Chưa có phiếu điều chuyển phù hợp." />
                  </td>
                </tr>
              ) : (
                result.items.map(row => (
                  <tr key={row.id}>
                    <td>
                      <strong>{row.code}</strong>
                      <small>{dateTime(row.createdAt)}</small>
                    </td>
                    <td>
                      <strong>{row.sourceWarehouse.name} → {row.destinationWarehouse.name}</strong>
                      <small>{row.sourceWarehouse.store.name} → {row.destinationWarehouse.store.name}</small>
                    </td>
                    <td>
                      <strong>{row.reason}</strong>
                      <small>Tạo bởi {row.createdBy.name}</small>
                    </td>
                    <td className="numeric">{row.items.length}</td>
                    <td className="numeric">
                      <strong>{row.totalRequested}</strong>
                    </td>
                    <td className="numeric">{row.status === 'COMPLETED' ? <strong>{row.totalReceived}</strong> : '—'}</td>
                    <td>
                      <StatusBadge tone={tones[row.status]}>{labels[row.status]}</StatusBadge>
                      {row.status === 'COMPLETED' && row.mismatchCount > 0 && (
                        <StatusBadge tone="amber">Lệch số lượng</StatusBadge>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                        {canDispatchRow(row) && (
                          <ActionButton tone="approve" disabled={busy} onClick={() => void quickDispatch(row)}>
                            Xuất kho
                          </ActionButton>
                        )}
                        {canReceiveRow(row) && (
                          <ActionButton tone="approve" disabled={busy} onClick={() => void quickReceive(row)}>
                            Nhận đủ
                          </ActionButton>
                        )}
                        <ActionLink tone="view" href={`/dieu-chuyen/${row.id}`}>
                          Chi tiết
                        </ActionLink>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination page={page} totalPages={result.pagination.totalPages} shown={result.items.length} total={result.pagination.total} noun="phiếu" onChange={setPage} />
      </PanelCard>

      {createOpen && (
        <div className="ui-modal">
          <form className="ui-modal-card transfer-modal" onSubmit={submit}>
            <header>
              <div>
                <h2>Tạo phiếu điều chuyển</h2>
                <p>Chọn kho nguồn, kho đích và danh sách hàng cần chuyển.</p>
              </div>
              <button type="button" onClick={() => setCreateOpen(false)}>×</button>
            </header>
            <div className="form-grid record-form-grid">
              <h3 className="record-form-title">Hành trình điều chuyển</h3>
              <label>
                Kho nguồn
                <select required value={source} onChange={e => setSource(e.target.value)}>
                  <option value="">Chọn kho nguồn</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>
                      {w.store.name} · {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kho đích
                <select required value={destination} onChange={e => setDestination(e.target.value)}>
                  <option value="">Chọn kho đích</option>
                  {warehouses.filter(w => w.id !== source).map(w => (
                    <option key={w.id} value={w.id}>
                      {w.store.name} · {w.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="full">
                Lý do điều chuyển
                <input required minLength={3} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Ví dụ: Bổ sung hàng thiếu theo dự báo AI" />
              </label>
            </div>
            <fieldset>
              <legend>Danh sách sản phẩm</legend>
              <div className="transfer-lines">
                {lines.map((line, index) => (
                  <div key={line.key}>
                    <select required value={line.skuId} onChange={e => setLines(old => old.map((x, i) => (i === index ? { ...x, skuId: e.target.value } : x)))}>
                      <option value="">Chọn sản phẩm</option>
                      {skuOptions.filter(s => !lines.some((x, i) => i !== index && x.skuId === s.id)).map(s => (
                        <option key={s.id} value={s.id}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                    <input required type="number" min={1} value={line.quantity} onChange={e => setLines(old => old.map((x, i) => (i === index ? { ...x, quantity: Number(e.target.value) } : x)))} />
                    <ActionButton tone="danger" disabled={lines.length === 1} onClick={() => setLines(old => old.filter((_, i) => i !== index))}>
                      Xóa
                    </ActionButton>
                  </div>
                ))}
              </div>
              <ActionButton tone="more" onClick={() => setLines(old => [...old, { key: crypto.randomUUID(), skuId: '', quantity: 1 }])}>
                + Thêm sản phẩm
              </ActionButton>
            </fieldset>
            <footer>
              <ActionButton tone="more" onClick={() => setCreateOpen(false)}>
                Đóng
              </ActionButton>
              <ActionButton tone="approve" type="submit" disabled={busy}>
                {busy ? 'Đang lưu…' : 'Lưu phiếu'}
              </ActionButton>
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}
