'use client';
import { useParams, useRouter } from 'next/navigation';
import { PurchaseRequestDetailDialog } from '../../../components/purchase-requests/purchase-request-detail-dialog';
export default function Page(){const {id}=useParams<{id:string}>();const router=useRouter();return <PurchaseRequestDetailDialog id={id} onClose={()=>router.push('/don-mua-hang')} onChanged={()=>{}}/>;}
