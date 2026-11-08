'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Protected } from '../../../components/auth-provider';
import { api, errorMessage } from '../../../lib/auth-api';

type Report = { html: string; summary: { selected_model: string; generated_at: string } };

function ExperimentPage() {
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const load = async () => {
    setLoading(true); setError('');
    try { setReport(await api<Report>('forecasts/experiment')); }
    catch (reason) { setError(errorMessage(reason)); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, []);
  const download = () => {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([report.html], { type: 'text/html;charset=utf-8' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'FreshMart-khao-sat-AI.html'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <main className="suite-page">
    <header className="suite-heading"><div><div className="breadcrumb">Dự báo hàng · Thực nghiệm CSV</div><h1>Khảo sát mô hình AI</h1><p>So sánh 7 mô hình trên cùng dữ liệu M5, chọn bằng validation và kiểm chứng bằng test.</p></div><Link className="outline-button" href="/du-bao-nhu-cau">Về dự báo cửa hàng</Link></header>
    <section className="panel" style={{ padding: 20 }}><p>Train: học quy luật → Validation: chọn mô hình → Test: đánh giá cuối cùng.</p><p>Báo cáo nghiên cứu dùng CSV M5; dự báo vận hành vẫn sử dụng doanh số thật của FreshMart.</p><div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 12 }}><button className="outline-button" disabled={loading} onClick={() => void load()}>{loading ? 'Đang tải…' : 'Tải lại kết quả'}</button>{report && <button className="primary-button" onClick={download}>Tải báo cáo để trình bày</button>}</div></section>
    {error && <p className="ui-error" role="alert">{error}</p>}
    {report && <iframe title="Bảng và biểu đồ khảo sát mô hình AI" sandbox="" srcDoc={report.html} style={{ width: '100%', height: '80vh', minHeight: 600, border: '1px solid #dce5df', borderRadius: 12, background: 'white' }} />}
  </main>;
}

export default function Page() { return <Protected permission="reports.read"><ExperimentPage /></Protected>; }
