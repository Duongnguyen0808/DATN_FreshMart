'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TableState } from '../../components/ui/table-state';
import { ActionButton, ActionLink } from '../../components/ui/action-button';
import { Icon } from '../../components/ui/icon';
import { MetricCard, MetricGrid } from '../../components/ui/metric-card';
import { FilterToolbar, PageHeader, PanelCard } from '../../components/ui/page-kit';
import { StatusBadge, type StatusTone } from '../../components/ui/status-badge';
import { TabBar, type TabItem } from '../../components/ui/tab-bar';
import { TablePagination } from '../../components/ui/table-pagination';
import { useToast } from '../../components/ui/toast-provider';
import { errorMessage } from '../../lib/auth-api';
import { getStores, type Store } from '../../lib/organization-api';
import { getPurchaseRequests, type PurchaseRequest, type PurchaseRequestList, type PurchaseRequestStatus } from '../../lib/purchase-requests-api';
import { PurchaseRequestDetailDialog } from '../../components/purchase-requests/purchase-request-detail-dialog';

type StatusFilter = 'all' | PurchaseRequestStatus;

const emptyResult: PurchaseRequestList = {
  items: [],
  pagination: { page: 1, pageSize: 20, total: 0, totalPages: 1 },
  summary: { total: 0, pending: 0, approved: 0, rejected: 0, converted: 0 }
};

const statusLabels: Record<PurchaseRequestStatus, string> = {
  READY: 'Sẵn sàng lập đơn',
  CONVERTED_TO_PO: 'Đã tạo đơn mua',
  REJECTED: 'Từ chối'
};

const statusTones: Record<PurchaseRequestStatus, StatusTone> = {
  READY: 'green',
  CONVERTED_TO_PO: 'blue',
  REJECTED: 'neutral'
};

const tabs: TabItem<StatusFilter>[] = [
  { value: 'all', label: 'Tất cả', tone: 'blue' },
  { value: 'READY', label: 'Sẵn sàng lập đơn', tone: 'green' },
  { value: 'CONVERTED_TO_PO', label: 'Đã tạo đơn mua', tone: 'cyan' },
  { value: 'REJECTED', label: 'Từ chối', tone: 'amber' }
];

const formatDate = (iso: string) => {
  try {
    return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
};

export default function PurchaseRequestsPage() {
  const { showToast } = useToast();
  const [result, setResult] = useState<PurchaseRequestList>(emptyResult);
  const [stores, setStores] = useState<Store[]>([]);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    getStores()
      .then(rows => setStores(rows.filter(s => s.active)))
      .catch(reason => setError(errorMessage(reason)));
  }, []);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const data = await getPurchaseRequests({
        q: q.trim() || undefined,
        status: status === 'all' ? undefined : status,
        storeId: storeId || undefined,
        page
      });
      setResult(data);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(load, 250);
    return () => clearTimeout(timer);
  }, [q, status, storeId, page]);

  useEffect(() => {
    setPage(1);
  }, [q, status, storeId]);

  const tabCount = (val: StatusFilter) => {
    if (val === 'all') return result.summary.total;
    if (val === 'READY') return result.summary.approved || result.summary.pending;
    if (val === 'CONVERTED_TO_PO') return result.summary.converted;
    if (val === 'REJECTED') return result.summary.rejected;
    return 0;
  };

  return (
    <div className="suite-page purchase-requests-page">
      <PageHeader
        breadcrumbs={['Mua hàng', 'Đề nghị mua hàng']}
        title="Đề nghị mua hàng"
        description="Theo dõi danh sách phiếu đề xuất mua hàng tự động sinh từ AI hoặc cửa hàng đề xuất."
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <ActionLink tone="view" href="/du-bao-nhu-cau">
              Dự báo nhu cầu AI
            </ActionLink>
            <ActionLink tone="approve" href="/don-mua-hang">
              🛒 Lập đơn mua hàng
            </ActionLink>
          </div>
        }
      />

      <MetricGrid className="suite-kpis">
        <MetricCard tone="blue" label="TỔNG ĐỀ NGHỊ" value={result.summary.total} />
        <MetricCard tone="green" label="SẴN SÀNG LẬP ĐƠN" value={result.summary.approved || result.summary.pending} />
        <MetricCard tone="cyan" label="ĐÃ TẠO ĐƠN MUA" value={result.summary.converted} />
        <MetricCard tone="amber" label="TỪ CHỐI" value={result.summary.rejected} />
      </MetricGrid>

      <PanelCard>
        <TabBar
          value={status}
          onChange={setStatus}
          items={tabs.map(tab => ({ ...tab, count: tabCount(tab.value) }))}
        />
        <FilterToolbar
          searchValue={q}
          onSearchChange={setQ}
          searchPlaceholder="Tìm mã đề nghị, tên cửa hàng, lý do..."
          onClear={() => {
            setQ('');
            setStatus('all');
            setStoreId('');
          }}
        >
          <select
            aria-label="Chi nhánh"
            value={storeId}
            onChange={event => setStoreId(event.target.value)}
          >
            <option value="">Tất cả chi nhánh</option>
            {stores.map(s => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </FilterToolbar>

        {error && (
          <div className="ui-error" role="alert" style={{ margin: '12px 16px' }}>
            {error} <button onClick={load}>Thử lại</button>
          </div>
        )}

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Mã đề nghị</th>
                <th>Chi nhánh</th>
                <th>Người tạo / Nguồn</th>
                <th>Lý do đề xuất</th>
                <th className="numeric">Sản phẩm</th>
                <th>Trạng thái</th>
                <th>Thời gian</th>
                <th>Thao tác</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8}>
                    <TableState loading message="Đang tải danh sách đề nghị mua hàng..." />
                  </td>
                </tr>
              ) : result.items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <TableState message="Không có đề nghị mua hàng nào phù hợp bộ lọc." />
                  </td>
                </tr>
              ) : (
                result.items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <button
                        type="button"
                        onClick={() => setSelectedId(item.id)}
                        style={{
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          color: '#0d9488',
                          fontWeight: 700,
                          cursor: 'pointer',
                          textDecoration: 'underline'
                        }}
                      >
                        {item.code}
                      </button>
                    </td>
                    <td>
                      <strong>{item.store.name}</strong>
                      <small style={{ display: 'block', color: '#64748b' }}>{item.store.code}</small>
                    </td>
                    <td>
                      <strong>{item.createdBy.name}</strong>
                      <small style={{ display: 'block', color: '#64748b' }}>{item.createdBy.email}</small>
                    </td>
                    <td style={{ maxWidth: 300 }}>
                      <span title={item.reason} style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                        {item.reason}
                      </span>
                    </td>
                    <td className="numeric">
                      <strong>{item.items.length}</strong> mặt hàng
                      <small style={{ display: 'block', color: '#64748b' }}>
                        {item.totalApproved || item.totalRequested} đơn vị
                      </small>
                    </td>
                    <td>
                      <StatusBadge tone={statusTones[item.status]}>
                        {statusLabels[item.status] ?? item.status}
                      </StatusBadge>
                    </td>
                    <td>{formatDate(item.createdAt)}</td>
                    <td>
                      <div className="row-actions" style={{ display: 'flex', gap: 6 }}>
                        <ActionButton tone="view" onClick={() => setSelectedId(item.id)}>
                          Chi tiết
                        </ActionButton>
                        {item.status === 'READY' && (
                          <ActionLink tone="approve" href="/don-mua-hang">
                            Lập đơn mua
                          </ActionLink>
                        )}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          page={result.pagination.page}
          totalPages={result.pagination.totalPages}
          shown={result.items.length}
          total={result.pagination.total}
          noun="đề nghị"
          onChange={setPage}
        />
      </PanelCard>

      {selectedId && (
        <PurchaseRequestDetailDialog
          id={selectedId}
          onClose={() => setSelectedId(null)}
          onChanged={() => {
            setSelectedId(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
