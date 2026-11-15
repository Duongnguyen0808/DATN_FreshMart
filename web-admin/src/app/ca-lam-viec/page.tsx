'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Protected, useAuth } from '../../components/auth-provider';
import { ActionButton } from '../../components/ui/action-button';
import { CurrencyInput, parseCurrency } from '../../components/ui/currency-input';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { FilterToolbar, PageHeader, PanelCard } from '../../components/ui/page-kit';
import { StatusBadge, type StatusTone } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { TableState } from '../../components/ui/table-state';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getStores, type Store } from '../../lib/organization-api';
import * as api from '../../lib/shifts-api';

type Filter = 'all' | api.ShiftStatus;
const emptyList: api.ShiftList = {
  items: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  summary: { total: 0, open: 0, pendingReview: 0, closed: 0 },
};

const statusLabels: Record<api.ShiftStatus, string> = {
  OPEN: 'Đang mở',
  PENDING_REVIEW: 'Chờ duyệt chênh lệch',
  CLOSED: 'Đã chốt ca',
};
const statusTones: Record<api.ShiftStatus, StatusTone> = {
  OPEN: 'green',
  PENDING_REVIEW: 'amber',
  CLOSED: 'neutral',
};
const tabs: TabItem<Filter>[] = [
  { value: 'all', label: 'Tất cả', tone: 'violet' },
  { value: 'OPEN', label: 'Đang mở', tone: 'green' },
  { value: 'PENDING_REVIEW', label: 'Chờ duyệt', tone: 'amber' },
  { value: 'CLOSED', label: 'Đã chốt', tone: 'blue' },
];
const DENOMINATIONS = [500000, 200000, 100000, 50000, 20000, 10000, 5000, 2000, 1000];
const money = (value: number | null) =>
  value === null ? '—' : `${new Intl.NumberFormat('vi-VN').format(Math.round(value))} đ`;
const dateTime = (value: string | null) =>
  value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

function ShiftManagementPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const canManage = Boolean(user?.permissions.includes('shifts.manage') || user?.permissions.includes('*'));
  const canApprove = Boolean(user?.permissions.includes('shifts.approve') || user?.permissions.includes('*'));

  const [stores, setStores] = useState<Pick<Store, 'id' | 'code' | 'name' | 'active'>[]>([]);
  const [status, setStatus] = useState<Filter>('all');
  const [storeId, setStoreId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<api.ShiftList>(emptyList);

  const [openModal, setOpenModal] = useState(false);
  const [openStoreId, setOpenStoreId] = useState('');
  const [staffOptions, setStaffOptions] = useState<api.ShiftStaff[]>([]);
  const [openCashierId, setOpenCashierId] = useState('');
  const [openPosCode, setOpenPosCode] = useState('POS-01');
  const [openName, setOpenName] = useState('Ca bán hàng');
  const [openingCash, setOpeningCash] = useState('1000000');

  const [closingShift, setClosingShift] = useState<api.Shift | null>(null);
  const [closingCashInput, setClosingCashInput] = useState('');
  const [cashExpensesInput, setCashExpensesInput] = useState('0');
  const [discrepancyReason, setDiscrepancyReason] = useState('');
  const [denomCounts, setDenomCounts] = useState<Record<number, number>>({});

  const [detailShift, setDetailShift] = useState<api.Shift | null>(null);
  const [managerNote, setManagerNote] = useState('');

  useEffect(() => {
    if (!user) return;
    if (!user.globalAccess) {
      const assigned = user.stores.filter(item => item.active);
      setStores(assigned);
      if (assigned[0]) setOpenStoreId(prev => prev || assigned[0]!.id);
      return;
    }
    getStores()
      .then(rows => {
        const active = rows.filter(item => item.active);
        setStores(active);
        if (active[0]) setOpenStoreId(prev => prev || active[0]!.id);
      })
      .catch(() => {});
  }, [user]);

  useEffect(() => {
    const requestedShiftId = new URLSearchParams(window.location.search).get('shift');
    if (!requestedShiftId) return;
    api.getShift(requestedShiftId)
      .then(shift => {
        setDetailShift(shift);
        setManagerNote('');
      })
      .catch(() => {});
  }, []);

  const load = async () => {
    setLoading(true);
    try {
      setResult(
        await api.getShifts({
          status,
          storeId: storeId || undefined,
          q: q.trim() || undefined,
          page,
        })
      );
      setError('');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPage(1);
  }, [status, storeId, q]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 180);
    return () => window.clearTimeout(timer);
  }, [status, storeId, q, page]);

  useEffect(() => {
    if (!openModal || !openStoreId) return;
    api.getShiftStaff(openStoreId)
      .then(rows => {
        setStaffOptions(rows);
        if (!canApprove && user) {
          setOpenCashierId(user.id);
        } else if (rows.length) {
          setOpenCashierId(current => (rows.some(row => row.id === current) ? current : rows[0]!.id));
        }
      })
      .catch(reason => showToast(errorMessage(reason), 'error'));
  }, [openModal, openStoreId, canApprove, user?.id]);

  const handleOpenShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!openStoreId || !openCashierId) {
      showToast('Chọn chi nhánh và thu ngân mở ca.', 'error');
      return;
    }
    setBusy(true);
    try {
      const created = await api.openShift({
        storeId: openStoreId,
        cashierId: openCashierId,
        posCode: openPosCode.trim().toUpperCase(),
        name: openName.trim(),
        openingCash: parseCurrency(openingCash),
      });
      showToast(`Đã mở ca ${created.code} tại ${created.store.name}.`);
      setOpenModal(false);
      await load();
    } catch (reason) {
      showToast(errorMessage(reason), 'error');
    } finally {
      setBusy(false);
    }
  };

  const openCloseModal = (shift: api.Shift) => {
    const expected = shift.openingCash + shift.cashRevenue;
    setClosingShift(shift);
    setClosingCashInput(String(expected));
    setCashExpensesInput('0');
    setDiscrepancyReason('');
    setDenomCounts({});
  };

  const applyDenominations = (nextCounts: Record<number, number>) => {
    setDenomCounts(nextCounts);
    const total = DENOMINATIONS.reduce((sum, value) => sum + value * (nextCounts[value] ?? 0), 0);
    if (total > 0) setClosingCashInput(String(total));
  };

  const handleCloseShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!closingShift) return;
    const cashExpenses = parseCurrency(cashExpensesInput);
    const closingCash = parseCurrency(closingCashInput);
    const expected = closingShift.openingCash + closingShift.cashRevenue - cashExpenses;
    const discrepancy = closingCash - expected;
    if (discrepancy !== 0 && !discrepancyReason.trim()) {
      showToast('Vui lòng nhập lý do chênh lệch tiền mặt trước khi chốt ca.', 'error');
      return;
    }
    setBusy(true);
    try {
      const denominations = DENOMINATIONS.filter(value => (denomCounts[value] ?? 0) > 0).map(value => ({
        value,
        count: denomCounts[value]!,
      }));
      const updated = await api.closeShift(closingShift.id, {
        closingCash,
        cashExpenses,
        discrepancyReason: discrepancy === 0 ? undefined : discrepancyReason.trim(),
        denominations,
      });
      setClosingShift(null);
      showToast(
        updated.status === 'PENDING_REVIEW'
          ? `Đã chốt ca ${updated.code} · chờ quản lý duyệt chênh lệch.`
          : `Đã chốt ca ${updated.code}.`
      );
      await load();
    } catch (reason) {
      showToast(errorMessage(reason), 'error');
    } finally {
      setBusy(false);
    }
  };

  const handleApproveShift = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!detailShift) return;
    setBusy(true);
    try {
      const updated = await api.approveShift(detailShift.id, managerNote.trim() || undefined);
      setDetailShift(updated);
      showToast(`Đã duyệt chốt ca ${updated.code}.`);
      await load();
    } catch (reason) {
      showToast(errorMessage(reason), 'error');
    } finally {
      setBusy(false);
    }
  };

  const tabCount = (value: Filter) =>
    value === 'all'
      ? result.summary.total
      : value === 'OPEN'
        ? result.summary.open
        : value === 'PENDING_REVIEW'
          ? result.summary.pendingReview
          : result.summary.closed;

  const expectedClosing = closingShift
    ? closingShift.openingCash + closingShift.cashRevenue - parseCurrency(cashExpensesInput)
    : 0;
  const closeDiscrepancy = closingShift ? parseCurrency(closingCashInput) - expectedClosing : 0;

  return (
    <div className="suite-page">
      <PageHeader
        breadcrumbs={['Bán hàng', 'Ca làm việc']}
        title="Quản lý ca làm việc"
        description="Mở ca thu ngân theo chi nhánh và quầy POS, đối chiếu tiền mặt cuối ca và phê duyệt chênh lệch."
        actions={
          <div className="row-actions">
            <Link className="outline-button" href="/hoa-don/tao">
              <Icon name="receipt" /> Bán hàng POS
            </Link>
            {canManage && (
              <ActionButton tone="approve" onClick={() => setOpenModal(true)}>
                <Icon name="add" /> Mở ca mới
              </ActionButton>
            )}
          </div>
        }
      />

      <MetricGrid className="suite-kpis" label="Tổng quan ca làm việc">
        <MetricCard tone="blue" label="TỔNG SỐ CA" value={result.summary.total} />
        <MetricCard tone="green" label="CA ĐANG MỞ" value={result.summary.open} />
        <MetricCard tone="amber" label="CHỜ DUYỆT CHÊNH LỆCH" value={result.summary.pendingReview} />
        <MetricCard tone="violet" label="ĐÃ CHỐT CA" value={result.summary.closed} />
      </MetricGrid>

      <PanelCard>
        <TabBar
          value={status}
          onChange={setStatus}
          items={tabs.map(item => ({ ...item, count: tabCount(item.value) }))}
        />
        <FilterToolbar
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder="Tìm mã ca, quầy POS, thu ngân hoặc chi nhánh…"
          onClear={() => {
            setQ('');
            setStatus('all');
            setStoreId('');
          }}
        >
          <select aria-label="Lọc theo chi nhánh" value={storeId} onChange={event => setStoreId(event.target.value)}>
            <option value="">Tất cả chi nhánh</option>
            {stores.map(store => (
              <option key={store.id} value={store.id}>
                {store.code} · {store.name}
              </option>
            ))}
          </select>
        </FilterToolbar>

        {error && (
          <div className="ui-error" role="alert">
            {error} <button type="button" onClick={() => void load()}>Thử lại</button>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã ca</th>
                <th>Quầy POS & Tên ca</th>
                <th>Chi nhánh</th>
                <th>Thu ngân</th>
                <th className="numeric">Đầu ca / Tiền mặt</th>
                <th className="numeric">Chuyển khoản</th>
                <th>Trạng thái</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <TableState message="Đang tải danh sách ca làm việc…" loading />
                  </td>
                </tr>
              ) : !result.items.length ? (
                <tr>
                  <td colSpan={8}>
                    <TableState message="Chưa có ca làm việc phù hợp." />
                  </td>
                </tr>
              ) : (
                result.items.map(shift => {
                  const canCloseThis =
                    shift.status === 'OPEN' && canManage && (canApprove || shift.cashierId === user?.id);
                  return (
                    <tr key={shift.id}>
                      <td>
                        <strong className="document-code">{shift.code}</strong>
                        <small>{dateTime(shift.openedAt)}</small>
                      </td>
                      <td>
                        <strong>{shift.posCode}</strong>
                        <small>{shift.name}</small>
                      </td>
                      <td>
                        <strong>{shift.store.name}</strong>
                        <small>{shift.store.code}</small>
                      </td>
                      <td>
                        <strong>{shift.cashier.name}</strong>
                        <small>{shift.cashier.email}</small>
                      </td>
                      <td className="numeric">
                        <strong>{money((shift.openingCash ?? 0) + (shift.cashRevenue ?? 0) - (shift.cashExpenses ?? 0))}</strong>
                        <small>Đầu ca: {money(shift.openingCash ?? 0)} · Thu: {money(shift.cashRevenue ?? 0)}</small>
                      </td>
                      <td className="numeric">
                        <strong>{money(shift.digitalRevenue ?? 0)}</strong>
                        {shift.cashDiscrepancy != null && shift.cashDiscrepancy !== 0 && (
                          <small className={shift.cashDiscrepancy < 0 ? 'negative' : 'positive'}>
                            Lệch: {shift.cashDiscrepancy > 0 ? '+' : ''}
                            {money(shift.cashDiscrepancy)}
                          </small>
                        )}
                      </td>
                      <td>
                        <StatusBadge tone={statusTones[shift.status]}>{statusLabels[shift.status]}</StatusBadge>
                      </td>
                      <td>
                        <div className="row-actions">
                          <ActionButton
                            tone="view"
                            onClick={() => {
                              setDetailShift(shift);
                              setManagerNote('');
                            }}
                          >
                            Chi tiết
                          </ActionButton>
                          {canCloseThis && (
                            <ActionButton tone="edit" onClick={() => openCloseModal(shift)}>
                              Chốt ca
                            </ActionButton>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={page}
          totalPages={result.pagination.totalPages}
          shown={result.items.length}
          total={result.pagination.total}
          noun="ca làm việc"
          onChange={setPage}
        />
      </PanelCard>

      {openModal && (
        <div
          className="ui-modal"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) setOpenModal(false);
          }}
        >
          <form className="ui-modal-card" onSubmit={handleOpenShift}>
            <header>
              <div>
                <h2>Mở ca làm việc mới</h2>
                <p>Mỗi thu ngân và mỗi quầy POS chỉ được mở một ca tại cùng thời điểm.</p>
              </div>
              <button type="button" aria-label="Đóng" disabled={busy} onClick={() => setOpenModal(false)}>
                ×
              </button>
            </header>
            <div className="form-grid record-form-grid">
              <label>
                Chi nhánh
                <select value={openStoreId} onChange={event => setOpenStoreId(event.target.value)} required>
                  <option value="">Chọn chi nhánh</option>
                  {stores.map(store => (
                    <option key={store.id} value={store.id}>
                      {store.code} · {store.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Thu ngân phụ trách
                <select
                  value={openCashierId}
                  onChange={event => setOpenCashierId(event.target.value)}
                  disabled={!canApprove}
                  required
                >
                  <option value="">Chọn nhân viên</option>
                  {staffOptions.map(staff => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} ({staff.email})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mã quầy POS
                <input
                  value={openPosCode}
                  onChange={event => setOpenPosCode(event.target.value)}
                  pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,29}"
                  placeholder="POS-01"
                  required
                />
              </label>
              <label>
                Tên ca
                <input value={openName} onChange={event => setOpenName(event.target.value)} maxLength={50} required />
              </label>
              <label className="full">
                Tiền mặt đầu ca (VND)
                <CurrencyInput min={0} value={openingCash} onChange={setOpeningCash} required />
              </label>
            </div>
            <footer>
              <ActionButton tone="more" disabled={busy} onClick={() => setOpenModal(false)}>
                Hủy
              </ActionButton>
              <ActionButton tone="approve" type="submit" disabled={busy}>
                {busy ? 'Đang mở ca…' : 'Xác nhận mở ca'}
              </ActionButton>
            </footer>
          </form>
        </div>
      )}

      {closingShift && (
        <div
          className="ui-modal"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) setClosingShift(null);
          }}
        >
          <form className="ui-modal-card" onSubmit={handleCloseShift}>
            <header>
              <div>
                <h2>Chốt ca {closingShift.code}</h2>
                <p>
                  {closingShift.store.name} · {closingShift.posCode} · Thu ngân: {closingShift.cashier.name}
                </p>
              </div>
              <button type="button" aria-label="Đóng" disabled={busy} onClick={() => setClosingShift(null)}>
                ×
              </button>
            </header>
            <dl className="record-summary">
              <div>
                <dt>Tiền đầu ca</dt>
                <dd>{money(closingShift.openingCash)}</dd>
              </div>
              <div>
                <dt>Doanh thu tiền mặt</dt>
                <dd>{money(closingShift.cashRevenue)}</dd>
              </div>
              <div>
                <dt>Tiền kỳ vọng trong két</dt>
                <dd>
                  <strong>{money(expectedClosing)}</strong>
                </dd>
              </div>
              <div>
                <dt>Chênh lệch</dt>
                <dd className={closeDiscrepancy === 0 ? 'positive' : 'negative'}>
                  <strong>
                    {closeDiscrepancy > 0 ? '+' : ''}
                    {money(closeDiscrepancy)}
                  </strong>
                </dd>
              </div>
            </dl>
            <div className="form-grid record-form-grid">
              <label>
                Chi tiền mặt trong ca
                <CurrencyInput min={0} value={cashExpensesInput} onChange={setCashExpensesInput} />
              </label>
              <label>
                Tiền thực kiểm cuối ca
                <CurrencyInput min={0} value={closingCashInput} onChange={setClosingCashInput} required />
              </label>
              <fieldset className="full">
                <legend>Kiểm đếm mệnh giá (tự cộng vào thực kiểm nếu nhập)</legend>
                <div className="form-grid">
                  {DENOMINATIONS.map(denom => (
                    <label key={denom}>
                      {new Intl.NumberFormat('vi-VN').format(denom)} đ
                      <input
                        type="number"
                        min={0}
                        max={100000}
                        step={1}
                        value={denomCounts[denom] ?? ''}
                        onChange={event => {
                          const next = { ...denomCounts, [denom]: Math.max(0, Number(event.target.value) || 0) };
                          applyDenominations(next);
                        }}
                      />
                    </label>
                  ))}
                </div>
              </fieldset>
              {closeDiscrepancy !== 0 && (
                <label className="full">
                  Lý do chênh lệch (bắt buộc)
                  <textarea
                    required
                    maxLength={500}
                    value={discrepancyReason}
                    onChange={event => setDiscrepancyReason(event.target.value)}
                    placeholder="Ghi rõ lý do thiếu hoặc thừa tiền mặt…"
                  />
                </label>
              )}
            </div>
            <footer>
              <ActionButton tone="more" disabled={busy} onClick={() => setClosingShift(null)}>
                Đóng
              </ActionButton>
              <ActionButton tone={closeDiscrepancy === 0 ? 'approve' : 'edit'} type="submit" disabled={busy}>
                {busy ? 'Đang chốt ca…' : closeDiscrepancy === 0 ? 'Chốt ca ngay' : 'Gửi duyệt chênh lệch'}
              </ActionButton>
            </footer>
          </form>
        </div>
      )}

      {detailShift && (
        <div
          className="ui-modal"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) setDetailShift(null);
          }}
        >
          <form className="ui-modal-card" onSubmit={handleApproveShift}>
            <header>
              <div>
                <h2>Chi tiết ca {detailShift.code}</h2>
                <p>
                  {detailShift.store.name} · {detailShift.posCode} · {detailShift.name}
                </p>
              </div>
              <button type="button" aria-label="Đóng" disabled={busy} onClick={() => setDetailShift(null)}>
                ×
              </button>
            </header>
            <dl>
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusBadge tone={statusTones[detailShift.status]}>{statusLabels[detailShift.status]}</StatusBadge>
                </dd>
              </div>
              <div>
                <dt>Thu ngân</dt>
                <dd>
                  {detailShift.cashier.name} ({detailShift.cashier.email})
                </dd>
              </div>
              <div>
                <dt>Mở ca / Chốt ca</dt>
                <dd>
                  {dateTime(detailShift.openedAt)} · {dateTime(detailShift.closedAt)}
                </dd>
              </div>
              <div>
                <dt>Đầu ca · Tiền mặt · Chi</dt>
                <dd>
                  {money(detailShift.openingCash)} · {money(detailShift.cashRevenue)} · {money(detailShift.cashExpenses)}
                </dd>
              </div>
              <div>
                <dt>Chuyển khoản / QR</dt>
                <dd>{money(detailShift.digitalRevenue)}</dd>
              </div>
              <div>
                <dt>Thực kiểm cuối ca · Chênh lệch</dt>
                <dd>
                  {money(detailShift.closingCash)} ·{' '}
                  {detailShift.cashDiscrepancy === null ? '—' : money(detailShift.cashDiscrepancy)}
                </dd>
              </div>
              {detailShift.discrepancyReason && (
                <div>
                  <dt>Lý do chênh lệch</dt>
                  <dd>{detailShift.discrepancyReason}</dd>
                </div>
              )}
              {detailShift.managerNote && (
                <div>
                  <dt>Ghi chú duyệt ca</dt>
                  <dd>{detailShift.managerNote}</dd>
                </div>
              )}
            </dl>
            {detailShift.status === 'PENDING_REVIEW' && canApprove && (
              <label>
                Ghi chú phê duyệt chênh lệch
                <textarea
                  maxLength={500}
                  value={managerNote}
                  onChange={event => setManagerNote(event.target.value)}
                  placeholder="Ghi chú xác nhận kiểm kê két thu ngân…"
                />
              </label>
            )}
            <footer>
              <ActionButton tone="more" disabled={busy} onClick={() => setDetailShift(null)}>
                Đóng
              </ActionButton>
              {detailShift.status === 'PENDING_REVIEW' && canApprove && (
                <ActionButton tone="approve" type="submit" disabled={busy}>
                  {busy ? 'Đang duyệt…' : 'Duyệt chốt ca'}
                </ActionButton>
              )}
            </footer>
          </form>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Protected permission="shifts.read">
      <ShiftManagementPage />
    </Protected>
  );
}
