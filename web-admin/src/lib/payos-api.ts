import { api } from './auth-api';
export type PayosCheckout = { id: string; orderCode: string; amount: number; status: 'CREATING' | 'PENDING' | 'PAID' | 'CANCELLED' | 'EXPIRED'; checkoutUrl: string | null; qrCode: string | null; accountName: string | null; accountNumber: string | null; description: string | null; expiresAt: string; invoiceId: string | null };
export type PayosCheckoutInput = { checkoutId: string; shiftId: string; warehouseId: string; customerId?: string; discount: number; note?: string; items: { skuId: string; quantity: number }[] };
export const getPayosConfig = () => api<{ enabled: boolean }>('payos/config');
export const createPayosCheckout = (input: PayosCheckoutInput) => api<PayosCheckout>('payos/checkouts', 'POST', input, 45000);
export const getPayosCheckout = (id: string) => api<PayosCheckout>(`payos/checkouts/${encodeURIComponent(id)}`, 'GET', undefined, 45000);
export const cancelPayosCheckout = (id: string) => api<PayosCheckout>(`payos/checkouts/${encodeURIComponent(id)}/cancel`, 'POST', undefined, 45000);
export const payosStorageKey = (userId: string) => `freshmart-payos-${userId}`;
