'use client';

import { useEffect, useRef, useState } from 'react';

export type DemoResult = {
  workflow: 'inbound' | 'transfer';
  simulated: boolean;
  reference: string;
  source: string;
  destination: string;
  items: { skuId: string; code: string; name: string; unit: string; imageUrl: string | null; quantity: number }[];
};

function ResultImage({ src, name }: { src: string | null; name: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="twin-result-image">{src && !failed
    ? <img src={src} alt={name} onError={() => setFailed(true)} />
    : <span>Chưa có ảnh</span>}</span>;
}

export function DemoResultDialog({ result, onClose }: { result: DemoResult; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    return () => node?.close();
  }, []);
  const totals = new Map<string, number>();
  result.items.forEach((item) => totals.set(item.unit, (totals.get(item.unit) ?? 0) + item.quantity));
  const count = (value: number) => new Intl.NumberFormat('vi-VN').format(value);
  return <dialog ref={dialog} className="twin-result-dialog" aria-labelledby="twin-result-title" aria-describedby="twin-result-description" onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <header><span className="twin-result-success" aria-hidden="true">✓</span><div><small>{result.simulated ? 'KẾT QUẢ DEMO MÔ PHỎNG' : 'KẾT QUẢ GIAO DỊCH'}</small><h2 id="twin-result-title">{result.workflow === 'inbound' ? 'Nhập hàng hoàn tất' : 'Chuyển hàng hoàn tất'}</h2></div><button type="button" aria-label="Đóng kết quả" onClick={onClose}>×</button></header>
    <p id="twin-result-description">{result.simulated ? 'Luồng mô phỏng đã hoàn thành. Event RFID và audit đã được lưu; không tạo phiếu hoặc thay đổi tồn kho.' : 'Đã xác nhận nghiệp vụ và cập nhật tồn kho.'}</p>
    <dl className="twin-result-route"><div><dt>{result.workflow === 'inbound' ? 'Nguồn hàng' : 'Kho xuất'}</dt><dd>{result.source}</dd></div><div><dt>Kho nhận</dt><dd>{result.destination}</dd></div><div><dt>Chứng từ</dt><dd>{result.reference}</dd></div></dl>
    <div className="twin-result-total"><strong>{result.items.length} mặt hàng / SKU</strong><span>{[...totals].map(([unit, quantity]) => `${count(quantity)} ${unit}`).join(' · ')}</span></div>
    <ul className="twin-result-items">{result.items.map((item) => <li key={item.skuId}>
      <ResultImage src={item.imageUrl} name={item.name} />
      <div><strong>{item.name}</strong><small>Mã SP: {item.code}</small></div>
      <span className="twin-result-quantity"><b>{count(item.quantity)}</b> {item.unit}</span>
    </li>)}</ul>
    <footer><button type="button" className="primary-button" onClick={onClose} autoFocus>Đã hiểu</button></footer>
  </dialog>;
}
