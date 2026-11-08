'use client';
import { useState } from 'react';
import { Icon } from './ui/icon';
import { MetricCard } from './ui/metric-card';
const fmt = (value: number) => new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value);
const colors = ['#087f78', '#65cfc7', '#527e8b', '#9ccbc5', '#426c65', '#b0d9d4'];

export function ReportComposition({ kind, summary }: { kind: 'stock' | 'products' | 'debt'; summary: Record<string, number> }) {
  if (kind === 'stock') return <DistributionPanel title="Sức khỏe tồn kho" description="Tỷ trọng theo số dòng sản phẩm tại các kho, không phải số đơn vị hàng." unit="dòng tồn" rows={[
    { id: 'normal', label: 'Tồn ổn định', value: summary.normal }, { id: 'low', label: 'Sắp thiếu', value: summary.low },
    { id: 'out', label: 'Hết hàng', value: summary.out }, { id: 'high', label: 'Tồn cao', value: summary.high },
  ]}/>;
  if (kind === 'products') return <DistributionPanel title="Độ phủ bán hàng" description="Sản phẩm có phát sinh bán so với danh mục đang kinh doanh trong phạm vi báo cáo." unit="mã hàng" rows={[
    { id: 'sold', label: 'Có phát sinh bán', value: summary.soldSkus },
    { id: 'unsold', label: 'Chưa phát sinh bán', value: Math.max(0, summary.activeSkus - summary.soldSkus) },
  ]}/>;
  return <DistributionPanel title="Tiến độ thanh toán nhà cung cấp" description="Phân bổ tổng công nợ phát sinh theo số tiền đã trả và còn phải trả." rows={[
    { id: 'paid', label: 'Đã thanh toán', value: summary.paidAmount },
    { id: 'remaining', label: 'Còn phải trả', value: summary.outstandingAmount },
  ]}/>;
}

export function AnalyticsHero({ revenue, profit, margin, invoices, period, loading }: { revenue: number; profit: number; margin: number; invoices: number; period: number; loading: boolean }) {
  const money = (value: number) => <>{loading ? '…' : fmt(value)} <small>đ</small></>;
  return <section className="dashboard-kpi-grid" aria-label="Kết quả kinh doanh trong kỳ" aria-busy={loading}>
    <MetricCard tone="teal" className="dashboard-kpi-featured" label="Doanh thu" icon={<Icon name="wallet" size={20}/>} value={money(revenue)} caption={`Hóa đơn hoàn tất · ${period} ngày`}/>
    <MetricCard tone="green" label="Lợi nhuận gộp" icon={<Icon name="chart" size={20}/>} value={money(profit)} caption={loading ? 'Đang cập nhật…' : revenue > 0 ? `Biên ${fmt(margin)}% · theo giá vốn hóa đơn` : 'Ước tính theo giá vốn hóa đơn'}/>
    <MetricCard tone="blue" label="Số hóa đơn" icon={<Icon name="receipt" size={20}/>} value={<>{loading ? '…' : fmt(invoices)} <small>hóa đơn</small></>} caption={`Đã hoàn tất trong ${period} ngày`}/>
    <MetricCard tone="violet" label="Trung bình / hóa đơn" icon={<Icon name="bag" size={20}/>} value={loading ? '…' : invoices ? money(revenue / invoices) : '—'} caption={invoices ? 'Doanh thu chia số hóa đơn hoàn tất' : 'Chưa có hóa đơn để tính trung bình'}/>
  </section>;
}

export function DistributionPanel({ title, description, rows, unit = 'đ', onSelect }: { title: string; description: string; rows: { id: string; label: string; value: number }[]; unit?: string; onSelect?: (id: string) => void }) {
  const valid = rows.filter(row => Number.isFinite(row.value) && row.value > 0).sort((a, b) => b.value - a.value);
  const total = valid.reduce((sum, row) => sum + row.value, 0);
  return <section className="analytics-distribution panel"><header><div><span className="analytics-eyebrow">CƠ CẤU & TỶ TRỌNG</span><h2>{title}</h2><p>{description}</p></div><div className="analytics-distribution-total"><small>Tổng</small><strong>{fmt(total)} <small>{unit}</small></strong></div></header>
    {total > 0 ? <><div className="analytics-stacked" aria-hidden="true">{valid.map((row, i) => <span key={row.id} style={{ width: `${row.value / total * 100}%`, background: colors[i % colors.length] }}/>)}</div><div className="analytics-distribution-list">{valid.map((row, i) => <div className="analytics-distribution-row" key={row.id}><span className="analytics-rank">{String(i + 1).padStart(2, '0')}</span><div><div className="analytics-distribution-label">{onSelect ? <button onClick={() => onSelect(row.id)}>{row.label} ↗</button> : <strong>{row.label}</strong>}<b>{fmt(row.value / total * 100)}%</b></div><div className="analytics-track"><span style={{ width: `${row.value / total * 100}%`, background: colors[i % colors.length] }}/></div></div><strong>{fmt(row.value)} <small>{unit}</small></strong></div>)}</div></> : <p className="analytics-empty">Chưa có số liệu để tính tỷ trọng trong phạm vi đã chọn.</p>}
  </section>;
}

export function RevenueExplorer({ rows }: { rows: { date: string; revenue: number; invoices: number }[] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const peak = rows.reduce<(typeof rows)[number] | null>((best, row) => !best || row.revenue > best.revenue ? row : best, null);
  const active = rows.find(row => row.date === selected) ?? peak;
  const max = Math.max(1, ...rows.map(row => row.revenue));
  const total = rows.reduce((sum, row) => sum + row.revenue, 0);
  return <div className="analytics-explorer">
    <div className="analytics-chart-readout"><div><small>{selected ? 'Ngày đang xem' : 'Ngày có doanh thu cao nhất'}</small><strong>{active ? active.date.slice(0, 10).split('-').reverse().join('/') : 'Chưa có dữ liệu'}</strong></div><div><strong>{fmt(active?.revenue ?? 0)} đ</strong><small>{fmt(active?.invoices ?? 0)} hóa đơn hoàn tất</small></div><p>Chạm hoặc đưa chuột lên cột để xem từng ngày.</p></div>
    {rows.length ? <><div className="analytics-plot"><div className="analytics-yaxis"><span>{fmt(max)} đ</span><span>{fmt(max / 2)}</span><span>0</span></div><div className="analytics-bars" role="group" aria-label="Doanh thu từng ngày">{rows.map(row => <button key={row.date} aria-label={`${row.date}: ${fmt(row.revenue)} đồng, ${row.invoices} hóa đơn`} aria-pressed={active?.date === row.date} onMouseEnter={() => setSelected(row.date)} onFocus={() => setSelected(row.date)} onClick={() => setSelected(row.date)}><span style={{ height: `${Math.max(0, row.revenue) / max * 100}%` }}/><output className="analytics-bar-tooltip" aria-hidden="true">{row.date.slice(0,10).split('-').reverse().join('/')}<b>{fmt(row.revenue)} đ</b></output></button>)}</div></div><div className="analytics-xaxis"><span>{rows[0].date.slice(0, 10)}</span><span>{rows.at(-1)?.date.slice(0, 10)}</span></div></> : <p className="analytics-empty">Chưa có dữ liệu doanh thu cho kỳ này.</p>}
    <footer><span><i/>Doanh thu từ hóa đơn hoàn tất</span><span>Trung bình/ngày: <b>{fmt(rows.length ? total / rows.length : 0)} đ</b></span></footer>
  </div>;
}
