'use client';
import { ProductIdentity } from '../../../components/ui/product-image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '../../../components/auth-provider';
import { ActionButton } from '../../../components/ui/action-button';
import { PageHeader } from '../../../components/ui/page-kit';
import { StatusBadge, type StatusTone } from '../../../components/ui/status-badge';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import * as api from '../../../lib/transfers-api';
import { TransferCancelDialog, TransferFulfillmentDialog } from '../../../components/transfers/transfer-fulfillment-dialog';

const labels: Record<api.TransferStatus, string> = {
  READY: 'Chờ xuất kho',
  IN_TRANSIT: 'Đang vận chuyển',
  COMPLETED: 'Hoàn tất',
  REJECTED: 'Đã hủy',
  CANCELLED: 'Đã hủy',
};
const tones: Record<api.TransferStatus, StatusTone> = {
  READY: 'blue',
  IN_TRANSIT: 'violet',
  COMPLETED: 'green',
  REJECTED: 'neutral',
  CANCELLED: 'neutral',
};
const dateTime = (v: string | null) =>
  v ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(v)) : '—';

export default function TransferDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [row, setRow] = useState<api.Transfer | null>(null);
  const [error, setError] = useState('');
  const [fulfillment, setFulfillment] = useState<'dispatch' | 'receive' | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const load = async () => {
    try {
      setError('');
      const value = await api.getTransfer(id);
      setRow(value);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    void load();
  }, [id]);

  if (error)
    return (
      <div className="ui-error">
        {error} <button onClick={load}>Thử lại</button>
      </div>
    );
  if (!row) return <p>Đang tải phiếu điều chuyển…</p>;

  const canDispatch =
    row.status === 'READY' &&
    Boolean(user?.permissions.includes('transfers.dispatch') || user?.permissions.includes('*')) &&
    Boolean(user?.globalAccess || user?.stores.some(store => store.id === row.sourceWarehouse.store.id));

  const canReceive =
    row.status === 'IN_TRANSIT' &&
    Boolean(user?.permissions.includes('transfers.receive') || user?.permissions.includes('*')) &&
    Boolean(user?.globalAccess || user?.stores.some(store => store.id === row.destinationWarehouse.store.id));

  const canCancel =
    row.status === 'READY' &&
    Boolean(
      user?.permissions.includes('transfers.approve') ||
        user?.permissions.includes('transfers.create') ||
        user?.permissions.includes('*')
    ) &&
    Boolean(
      user?.globalAccess ||
        (user?.stores.some(store => store.id === row.sourceWarehouse.store.id) &&
          user?.stores.some(store => store.id === row.destinationWarehouse.store.id))
    );

  return (
    <div className="suite-page transfer-detail-page">
      <div className="detail-back">
        <Link href="/dieu-chuyen">‹ Quay lại danh sách điều chuyển</Link>
      </div>

      <PageHeader
        variant="detail"
        breadcrumbs={['Hàng hóa', 'Điều chuyển', row.code]}
        title={row.code}
        description={`${row.sourceWarehouse.store.name} · ${row.sourceWarehouse.name} → ${row.destinationWarehouse.store.name} · ${row.destinationWarehouse.name}`}
        actions={
          <>
            <StatusBadge tone={tones[row.status]}>{labels[row.status]}</StatusBadge>
            {canDispatch && (
              <ActionButton tone="approve" onClick={() => setFulfillment('dispatch')}>
                Xuất kho
              </ActionButton>
            )}
            {canReceive && (
              <ActionButton tone="approve" onClick={() => setFulfillment('receive')}>
                Nhận hàng
              </ActionButton>
            )}
            {canCancel && (
              <ActionButton tone="danger" onClick={() => setCancelling(true)}>
                Hủy phiếu
              </ActionButton>
            )}
          </>
        }
      />

      <section className="detail-grid">
        <article>
          <h2>Thông tin phiếu</h2>
          <dl>
            <div>
              <dt>Người tạo</dt>
              <dd>
                {row.createdBy.name}
                <small>{row.createdBy.email}</small>
              </dd>
            </div>
            <div>
              <dt>Thời gian tạo</dt>
              <dd>{dateTime(row.createdAt)}</dd>
            </div>
            <div>
              <dt>Lý do điều chuyển</dt>
              <dd>{row.reason}</dd>
            </div>
            <div>
              <dt>Ghi chú xuất kho</dt>
              <dd>{row.dispatchNote ?? '—'}</dd>
            </div>
            <div>
              <dt>Ghi chú nhận hàng</dt>
              <dd>{row.receiptNote ?? '—'}</dd>
            </div>
            {(row.status === 'CANCELLED' || row.status === 'REJECTED') && (
              <>
                <div>
                  <dt>Người hủy</dt>
                  <dd>{row.cancelledBy?.name ?? '—'}</dd>
                </div>
                <div>
                  <dt>Thời gian hủy</dt>
                  <dd>{dateTime(row.cancelledAt)}</dd>
                </div>
                <div>
                  <dt>Lý do hủy</dt>
                  <dd>{row.cancelReason ?? row.decisionNote ?? '—'}</dd>
                </div>
              </>
            )}
          </dl>
        </article>

        <article className="detail-timeline">
          <h2>Tiến trình 3 bước</h2>
          <ol>
            <li>
              <strong>1. Tạo phiếu điều chuyển</strong>
              <span>{dateTime(row.createdAt)}</span>
            </li>
            <li>
              <strong>2. Xuất kho nguồn (trừ tồn nguồn)</strong>
              <span>{dateTime(row.dispatchedAt)}</span>
            </li>
            <li>
              <strong>3. Nhận tại kho đích (cộng tồn đích)</strong>
              <span>{dateTime(row.receivedAt)}</span>
            </li>
          </ol>
        </article>
      </section>

      <section className="detail-table">
        <header>
          <h2>Hàng hóa điều chuyển</h2>
          <p>Kho nguồn giảm tồn khi xuất kho; kho đích tăng tồn theo số lượng thực nhận.</p>
        </header>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Sản phẩm / Mã sản phẩm</th>
                <th>ĐVT</th>
                <th className="numeric">Số lượng chuyển</th>
                <th className="numeric">Đã xuất kho</th>
                <th className="numeric">Thực nhận</th>
                <th className="numeric">Chênh lệch</th>
                <th>Ghi chú chênh lệch</th>
              </tr>
            </thead>
            <tbody>
              {row.items.map(item => (
                <tr key={item.id}>
                  <td>
                    <ProductIdentity
                      name={item.sku.product.name}
                      code={item.sku.product.code}
                      imageUrl={item.sku.product.imageUrl}
                    />
                  </td>
                  <td>{item.sku.product.unit}</td>
                  <td className="numeric">{item.requestedQuantity}</td>
                  <td className="numeric">{item.dispatchedQuantity ?? '—'}</td>
                  <td className="numeric">{item.receivedQuantity ?? '—'}</td>
                  <td
                    className={`numeric ${
                      (item.discrepancy ?? 0) < 0 ? 'negative' : (item.discrepancy ?? 0) > 0 ? 'positive' : ''
                    }`}
                  >
                    <strong>{item.discrepancy ?? '—'}</strong>
                  </td>
                  <td>{item.discrepancyReason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {fulfillment && (
        <TransferFulfillmentDialog
          transfer={row}
          mode={fulfillment}
          onClose={() => setFulfillment(null)}
          onDone={updated => {
            setRow(updated);
            setFulfillment(null);
            showToast(
              fulfillment === 'dispatch'
                ? 'Đã xuất kho và chuyển hàng sang trạng thái đang vận chuyển.'
                : 'Đã nhận hàng và cập nhật tồn kho đích.'
            );
          }}
        />
      )}

      {cancelling && (
        <TransferCancelDialog
          transfer={row}
          onClose={() => setCancelling(false)}
          onDone={updated => {
            setRow(updated);
            setCancelling(false);
            showToast('Đã hủy phiếu điều chuyển.');
          }}
        />
      )}
    </div>
  );
}
