'use client';

import { useCallback, useEffect, useState } from 'react';
import { AppShell } from '../../components/app-shell';
import { TabBar } from '../../components/ui/tab-bar';
import { useAuth } from '../../components/auth-provider';
import { api } from '../../lib/auth-api';

type ChecklistItem = {
  id: string;
  category: string;
  title: string;
  description: string | null;
  completed: boolean;
  completedByName: string | null;
  completedAt: string | null;
  note: string | null;
};

type ChecklistResponse = {
  storeId: string;
  dateKey: string;
  items: ChecklistItem[];
  summary: { total: number; completed: number; percent: number };
};

type QuickStocktake = {
  id: string;
  code: string;
  skuCode: string;
  barcode: string;
  productName: string;
  systemQuantity: number;
  actualQuantity: number;
  difference: number;
  note: string | null;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  reportedByName: string;
  reviewedByName: string | null;
  reviewNote: string | null;
  createdAt: string;
};

type IncidentReport = {
  id: string;
  code: string;
  type: 'DAMAGED' | 'EXPIRED' | 'STOCK_MISMATCH' | 'IOT_DEVICE';
  title: string;
  description: string;
  relatedCode: string | null;
  relatedName: string | null;
  imageUrl: string | null;
  status: 'OPEN' | 'IN_PROGRESS' | 'RESOLVED';
  reportedByName: string;
  handledByName: string | null;
  resolutionNote: string | null;
  createdAt: string;
};

const INCIDENT_TYPE_LABEL: Record<string, string> = {
  DAMAGED: 'Hàng hư hỏng',
  DAMAGED_GOODS: 'Hàng hư hỏng',
  EXPIRED: 'Hàng hết hạn',
  STOCK_MISMATCH: 'Chênh lệch tồn kho',
  IOT_DEVICE: 'Sự cố thiết bị IoT',
  DEVICE_MALFUNCTION: 'Sự cố thiết bị IoT',
};

export default function MobileOpsManagerPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<'stocktakes' | 'incidents' | 'checklist'>('stocktakes');
  const [stocktakes, setStocktakes] = useState<QuickStocktake[]>([]);
  const [incidents, setIncidents] = useState<IncidentReport[]>([]);
  const [checklist, setChecklist] = useState<ChecklistResponse | null>(null);
  const [checklistModalOpen, setChecklistModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const canApprove = !!user && (user.globalAccess || user.permissions.includes('stocktakes.approve'));

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [stRes, incRes, chkRes] = await Promise.all([
        api<QuickStocktake[]>('mobile-ops/quick-stocktakes'),
        api<IncidentReport[]>('mobile-ops/incidents'),
        api<ChecklistResponse>('mobile-ops/checklist'),
      ]);
      setStocktakes(stRes);
      setIncidents(incRes);
      setChecklist(chkRes);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu vận hành Mobile.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void loadAll();
  }, [user, loadAll]);

  const handleReviewStocktake = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setBusyId(id);
    try {
      await api(`mobile-ops/quick-stocktakes/${id}/review`, 'PATCH', {
        status,
        reviewNote: status === 'APPROVED' ? 'Đã xác nhận biên bản kiểm đếm từ Mobile.' : 'Yêu cầu kiểm đếm lại.',
      });
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật kiểm đếm.');
    } finally {
      setBusyId(null);
    }
  };

  const handleUpdateIncident = async (id: string, status: 'IN_PROGRESS' | 'RESOLVED') => {
    setBusyId(id);
    try {
      await api(`mobile-ops/incidents/${id}/status`, 'PATCH', {
        status,
        resolutionNote: status === 'RESOLVED' ? 'Quản lý đã xử lý xong sự cố.' : 'Đang tiến hành xử lý.',
      });
      await loadAll();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Không thể cập nhật sự cố.');
    } finally {
      setBusyId(null);
    }
  };

  const pendingStocktakes = stocktakes.filter((s) => s.status === 'PENDING').length;
  const openIncidents = incidents.filter((i) => i.status !== 'RESOLVED').length;

  return (
    <AppShell user={user}>
      <div className="suite-page">
        <div className="suite-heading">
          <div>
            <h1>Vận hành Mobile Ops</h1>
            <p>Đồng bộ dữ liệu thực tế từ ứng dụng di động nhân viên kho & cửa hàng</p>
          </div>
          <div className="actions">
            <button type="button" className="secondary" onClick={() => void loadAll()} disabled={loading}>
              Làm mới
            </button>
          </div>
        </div>

        {error && <div className="ui-error" style={{ marginBottom: 12 }}>{error}</div>}

        <div className="suite-panel">
          <TabBar
            value={tab}
            onChange={(next) => setTab(next)}
            items={[
              { value: 'stocktakes', label: 'Kiểm đếm nhanh', count: pendingStocktakes },
              { value: 'incidents', label: 'Báo cáo sự cố', count: openIncidents },
              { value: 'checklist', label: 'Checklist ngày', count: checklist?.summary.completed ?? 0 },
            ]}
          />

          <div style={{ padding: 18 }}>
            {loading ? (
              <p className="table-state">Đang tải dữ liệu vận hành Mobile...</p>
            ) : tab === 'stocktakes' ? (
              stocktakes.length === 0 ? (
                <p className="table-state">Chưa có phiếu kiểm đếm nhanh nào gửi từ Mobile App.</p>
              ) : (
                <div className="table-scroll">
                  <table className="suite-table">
                    <thead>
                      <tr>
                        <th>Mã phiếu</th>
                        <th>Sản phẩm / Barcode</th>
                        <th className="numeric">Tồn hệ thống</th>
                        <th className="numeric">Thực đếm</th>
                        <th className="numeric">Chênh lệch</th>
                        <th>Nhân viên & Ghi chú</th>
                        <th>Trạng thái</th>
                        {canApprove && <th>Phê duyệt</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {stocktakes.map((row) => (
                        <tr key={row.id}>
                          <td><strong>{row.code}</strong></td>
                          <td>
                            <div><strong>{row.productName}</strong></div>
                            <small className="muted">{row.skuCode} · {row.barcode}</small>
                          </td>
                          <td className="numeric">{row.systemQuantity}</td>
                          <td className="numeric"><strong>{row.actualQuantity}</strong></td>
                          <td className={`numeric ${row.difference < 0 ? 'negative' : row.difference > 0 ? 'positive' : ''}`}>
                            {row.difference > 0 ? `+${row.difference}` : row.difference}
                          </td>
                          <td>
                            <div>{row.reportedByName}</div>
                            <small className="muted">{row.note || 'Không có ghi chú'}</small>
                          </td>
                          <td>
                            <span className="ui-status-badge">
                              {row.status === 'PENDING' ? 'Chờ duyệt' : row.status === 'APPROVED' ? 'Đã xác nhận' : 'Từ chối'}
                            </span>
                          </td>
                          {canApprove && (
                            <td>
                              {row.status === 'PENDING' ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                  <button
                                    type="button"
                                    className="ui-action-button action-approve"
                                    disabled={busyId === row.id}
                                    onClick={() => void handleReviewStocktake(row.id, 'APPROVED')}
                                  >
                                    Xác nhận
                                  </button>
                                  <button
                                    type="button"
                                    className="ui-action-button action-more"
                                    disabled={busyId === row.id}
                                    onClick={() => void handleReviewStocktake(row.id, 'REJECTED')}
                                  >
                                    Từ chối
                                  </button>
                                </div>
                              ) : (
                                <small className="muted">{row.reviewedByName || 'Đã xử lý'}</small>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : tab === 'incidents' ? (
              incidents.length === 0 ? (
                <p className="table-state">Chưa có báo cáo sự cố nào gửi từ Mobile App.</p>
              ) : (
                <div className="table-scroll">
                  <table className="suite-table">
                    <thead>
                      <tr>
                        <th>Mã / Loại</th>
                        <th>Nội dung sự cố</th>
                        <th>Ảnh thực tế</th>
                        <th>Người báo cáo</th>
                        <th>Trạng thái</th>
                        {canApprove && <th>Xử lý</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {incidents.map((inc) => (
                        <tr key={inc.id}>
                          <td>
                            <div><strong>{inc.code}</strong></div>
                            <small className="muted">{INCIDENT_TYPE_LABEL[inc.type] || inc.type}</small>
                          </td>
                          <td>
                            <div><strong>{inc.title}</strong></div>
                            <div style={{ fontSize: 12, color: '#566e6c', marginTop: 2 }}>{inc.description}</div>
                            {inc.relatedCode && <small className="muted">Đối tượng: {inc.relatedCode} {inc.relatedName ? `· ${inc.relatedName}` : ''}</small>}
                          </td>
                          <td>
                            {inc.imageUrl ? (
                              <img
                                src={inc.imageUrl}
                                alt={inc.title}
                                style={{ width: 64, height: 64, objectFit: 'cover', borderRadius: 8, border: '1px solid #d4eae5' }}
                              />
                            ) : (
                              <small className="muted">Không có ảnh</small>
                            )}
                          </td>
                          <td>
                            <div>{inc.reportedByName}</div>
                            <small className="muted">{new Date(inc.createdAt).toLocaleString('vi-VN')}</small>
                          </td>
                          <td>
                            <span className="ui-status-badge">
                              {inc.status === 'OPEN' ? 'Mới gửi' : inc.status === 'IN_PROGRESS' ? 'Đang xử lý' : 'Đã xử lý'}
                            </span>
                          </td>
                          {canApprove && (
                            <td>
                              {inc.status !== 'RESOLVED' ? (
                                <div style={{ display: 'flex', gap: 6 }}>
                                  {inc.status === 'OPEN' && (
                                    <button
                                      type="button"
                                      className="ui-action-button action-view"
                                      disabled={busyId === inc.id}
                                      onClick={() => void handleUpdateIncident(inc.id, 'IN_PROGRESS')}
                                    >
                                      Tiếp nhận
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    className="ui-action-button action-approve"
                                    disabled={busyId === inc.id}
                                    onClick={() => void handleUpdateIncident(inc.id, 'RESOLVED')}
                                  >
                                    Hoàn tất
                                  </button>
                                </div>
                              ) : (
                                <small className="muted">{inc.handledByName || 'Hoàn tất'}</small>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              checklist ? (
                (() => {
                  const completedItems = checklist.items.filter((i) => i.completed);
                  const actors = Array.from(
                    new Set(completedItems.map((i) => i.completedByName).filter(Boolean))
                  ) as string[];
                  const latestAt = completedItems
                    .map((i) => i.completedAt)
                    .filter(Boolean)
                    .sort()
                    .pop();
                  const isDone = checklist.summary.total > 0 && checklist.summary.completed >= checklist.summary.total;
                  return (
                    <div className="table-scroll">
                      <table className="suite-table">
                        <thead>
                          <tr>
                            <th>Ngày vận hành</th>
                            <th>Tiến độ hoàn thành</th>
                            <th>Người thực hiện</th>
                            <th>Cập nhật gần nhất</th>
                            <th>Trạng thái</th>
                            <th>Chi tiết</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr
                            className="clickable-row"
                            style={{ cursor: 'pointer' }}
                            onClick={() => setChecklistModalOpen(true)}
                          >
                            <td>
                              <strong>Checklist ngày {checklist.dateKey}</strong>
                              <small className="muted" style={{ display: 'block' }}>
                                Tổng {checklist.summary.total} đầu việc vận hành
                              </small>
                            </td>
                            <td>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 120, height: 8, borderRadius: 999, background: '#e5efec', overflow: 'hidden' }}>
                                  <div
                                    style={{
                                      width: `${checklist.summary.percent}%`,
                                      height: '100%',
                                      background: isDone ? '#16a34a' : '#0d9488',
                                      borderRadius: 999,
                                    }}
                                  />
                                </div>
                                <strong>
                                  {checklist.summary.completed}/{checklist.summary.total} ({checklist.summary.percent}%)
                                </strong>
                              </div>
                            </td>
                            <td>
                              {actors.length > 0 ? (
                                <strong>{actors.join(', ')}</strong>
                              ) : (
                                <small className="muted">Chưa có người thực hiện</small>
                              )}
                            </td>
                            <td>
                              {latestAt ? new Date(latestAt).toLocaleString('vi-VN') : <small className="muted">—</small>}
                            </td>
                            <td>
                              <span className="ui-status-badge">
                                {isDone
                                  ? 'Hoàn thành 100%'
                                  : checklist.summary.completed > 0
                                  ? 'Đang thực hiện'
                                  : 'Chưa bắt đầu'}
                              </span>
                            </td>
                            <td>
                              <button
                                type="button"
                                className="ui-action-button action-view"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setChecklistModalOpen(true);
                                }}
                              >
                                Xem chi tiết
                              </button>
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()
              ) : (
                <p className="table-state">Chưa có dữ liệu checklist ngày hôm nay.</p>
              )
            )}
          </div>
        </div>

        {/* Checklist Detail Modal */}
        {checklistModalOpen && checklist && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Chi tiết checklist ngày"
            onClick={() => setChecklistModalOpen(false)}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 400,
              background: 'rgba(15, 41, 40, 0.45)',
              backdropFilter: 'blur(2px)',
              display: 'grid',
              placeItems: 'center',
              padding: 20,
            }}
          >
            <div
              className="ui-modal-card"
              onClick={(e) => e.stopPropagation()}
              style={{
                width: 'min(760px, 100%)',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                borderRadius: 18,
                background: '#ffffff',
                border: '1px solid #cce3de',
              }}
            >
              <header
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '16px 20px',
                  borderBottom: '1px solid #d4eae5',
                  background: 'linear-gradient(90deg, #ecfaf7 0%, #ffffff 100%)',
                }}
              >
                <div>
                  <h2 style={{ margin: 0, fontSize: 17, color: '#0f2928' }}>
                    Chi tiết Checklist ngày {checklist.dateKey}
                  </h2>
                  <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#566e6c' }}>
                    Hoàn thành {checklist.summary.completed}/{checklist.summary.total} đầu việc ({checklist.summary.percent}%)
                  </p>
                </div>
                <button
                  type="button"
                  className="outline-button"
                  onClick={() => setChecklistModalOpen(false)}
                  style={{ minHeight: 34, padding: '6px 12px' }}
                >
                  Đóng
                </button>
              </header>
              <div style={{ padding: 18, overflowY: 'auto', display: 'grid', gap: 10 }}>
                {checklist.items.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'flex-start',
                      gap: 14,
                      padding: '12px 14px',
                      borderRadius: 12,
                      border: `1px solid ${item.completed ? '#bce5dc' : '#e2ece9'}`,
                      background: item.completed ? '#f4fbf9' : '#ffffff',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span className="ui-status-badge">{item.category}</span>
                        <strong style={{ fontSize: 13.5, color: '#0f2928' }}>{item.title}</strong>
                      </div>
                      {item.description && (
                        <p style={{ margin: 0, fontSize: 12, color: '#566e6c' }}>{item.description}</p>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', flexShrink: 0 }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: item.completed ? '#15803d' : '#64748b',
                        }}
                      >
                        {item.completed ? '✓ Đã hoàn thành' : 'Chưa thực hiện'}
                      </div>
                      {item.completed && (
                        <small className="muted" style={{ display: 'block', marginTop: 3 }}>
                          {item.completedByName}
                          {item.completedAt
                            ? ` · ${new Date(item.completedAt).toLocaleString('vi-VN')}`
                            : ''}
                        </small>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
