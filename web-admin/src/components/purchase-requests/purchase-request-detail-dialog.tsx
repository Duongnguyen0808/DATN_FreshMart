'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ProductIdentity } from '../ui/product-image';
import { errorMessage } from '../../lib/auth-api';
import { getPurchaseRequest, type PurchaseRequest } from '../../lib/purchase-requests-api';

export function PurchaseRequestDetailDialog({ id, onClose }: { id: string; onClose: () => void; onChanged: () => void }) {
 const [row,setRow]=useState<PurchaseRequest|null>(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;getPurchaseRequest(id).then(r=>{if(active)setRow(r)}).catch(e=>{if(active)setError(errorMessage(e))});return()=>{active=false}},[id]);
 return <div className="ui-modal"><section className="ui-modal-card purchase-request-detail-modal"><header><h2>{row?.code ?? 'Đề nghị mua hàng'}</h2><button onClick={onClose}>Đóng</button></header>{error && <p role="alert">{error}</p>}{row && <><p>{row.store.name} · {row.createdBy.name}</p><p>{row.reason}</p><p>{row.status==='READY'?'Sẵn sàng lập đơn mua hàng':row.status==='CONVERTED_TO_PO'?'Đã tạo đơn mua hàng':'Phiếu từ chối trước đây'}</p><div className="table-scroll"><table><thead><tr><th>Sản phẩm</th><th>Đơn vị</th><th>Số lượng mua</th></tr></thead><tbody>{row.items.map(i=><tr key={i.id}><td><ProductIdentity name={i.sku.product.name} code={i.sku.product.code} imageUrl={i.sku.product.imageUrl}/></td><td>{i.sku.product.unit}</td><td>{i.approvedQuantity??i.requestedQuantity}</td></tr>)}</tbody></table></div>{row.status==='READY'&&<Link href="/don-mua-hang">Lập đơn mua hàng →</Link>}</>}</section></div>;
}
