'use client';
import { PosCatalog, PosQuantity } from '../../../components/invoices/pos-catalog';
import { ProductIdentity, ProductImage } from '../../../components/ui/product-image';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Protected, useAuth } from '../../../components/auth-provider';
import { ActionButton } from '../../../components/ui/action-button';
import { CurrencyInput, parseCurrency } from '../../../components/ui/currency-input';
import { Icon } from '../../../components/ui/icon';
import { useToast } from '../../../components/ui/toast-provider';
import { errorMessage } from '../../../lib/auth-api';
import { getInventory, type Inventory } from '../../../lib/inventory-api';
import { getPayosConfig, payosStorageKey, type PayosCheckoutInput } from '../../../lib/payos-api';
import {
  createInvoice,
  getFefoPromoCodes,
  getInvoices,
  verifyFefoPromo,
  type FefoPromoCodeItem,
  type FefoPromoVerifyItem,
} from '../../../lib/invoices-api';
import {
  buildCashTenderReference,
  suggestCashDenominations,
  type InvoiceReturnTarget,
} from '../../../lib/invoice-receipt';
import { printInvoice } from '../../../lib/print-invoice';
import { getWarehouses, type Warehouse } from '../../../lib/organization-api';
import { getShifts, type Shift } from '../../../lib/shifts-api';
import { getDemandForecast, getShortageAlerts, runDemandForecast, type ForecastInventoryAdvice } from '../../../lib/forecasts-api';
import { extractBarcodeQueryFromText } from '../../../lib/pos-camera-scanner';

type CartLine = { stock: Inventory; quantity: number };

type PosOrderTab = {
  id: string;
  seq: number;
  createdAt: number;
  cart: CartLine[];
  discount: string;
  discountMode: 'amount' | 'percent';
  fefoPromoInput: string;
  appliedFefoPromos: FefoPromoVerifyItem[];
  cashPayment: string | null;
  cashTendered?: string | null;
  qrPayment: string;
  note: string;
  transferMemo: string;
  payosSelected: boolean;
};

type StoredPosTabsPayload = {
  tabs: PosOrderTab[];
  activeTabId: string;
};

const MAX_POS_TABS = 8;
const bankQrConfig = {
  bankId: process.env.NEXT_PUBLIC_VIETQR_BANK_ID ?? '',
  accountNo: process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NO ?? '',
  accountName: process.env.NEXT_PUBLIC_VIETQR_ACCOUNT_NAME ?? '',
};
const money = (value: number) => new Intl.NumberFormat('vi-VN').format(value) + ' đ';
const shortMoney = (value: number) => {
  if (value <= 0) return '0 đ';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}tr`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
  return `${value}đ`;
};
const posTabsStorageKey = (userId: string, warehouseId: string) => `freshmart:pos-held-tabs:v2:${userId}:${warehouseId}`;
const posTabsLegacyKey = (userId: string, warehouseId: string) => `freshmart:pos-held-tabs:v1:${userId}:${warehouseId}`;

function nextOrderSeq(tabs: PosOrderTab[]): number {
  const used = new Set(tabs.map(tab => Number(tab.seq)).filter(seq => Number.isInteger(seq) && seq >= 1));
  let candidate = 1;
  while (used.has(candidate)) candidate += 1;
  return candidate;
}

function createEmptyOrderTab(seq: number): PosOrderTab {
  const stamp = Date.now();
  return {
    id: `pos-tab-${stamp}-${Math.random().toString(36).slice(2, 7)}`,
    seq,
    createdAt: stamp,
    cart: [],
    discount: '',
    discountMode: 'amount',
    fefoPromoInput: '',
    appliedFefoPromos: [],
    cashPayment: null,
    cashTendered: null,
    qrPayment: '0',
    note: '',
    transferMemo: `SC${stamp.toString().slice(-8)}${seq}`,
    payosSelected: false,
  };
}

function computeTabTotal(tab: PosOrderTab): { itemCount: number; subtotal: number; total: number } {
  const itemCount = tab.cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = tab.cart.reduce((sum, line) => sum + line.quantity * line.stock.sku.sellingPrice, 0);
  const discountAmount =
    tab.discountMode === 'percent'
      ? Math.round((subtotal * Math.max(0, Math.min(100, Number(tab.discount.replace(',', '.')) || 0))) / 100)
      : parseCurrency(tab.discount);
  return { itemCount, subtotal, total: Math.max(0, subtotal - discountAmount) };
}

function NewInvoicePage() {
  const router = useRouter();
  const { user } = useAuth();
  const { showToast, confirmAction } = useToast();
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [shiftId, setShiftId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [query, setQuery] = useState('');
  const [stockLoading, setStockLoading] = useState(false);
  const [stockRows, setStockRows] = useState<Inventory[]>([]);
  const [aiShortages, setAiShortages] = useState<ForecastInventoryAdvice[]>([]);
  const [aiShortagesLoading, setAiShortagesLoading] = useState(false);

  // Multi-tab Hold Bills state (single source of truth for all open tickets)
  const [orderTabs, setOrderTabs] = useState<PosOrderTab[]>(() => [createEmptyOrderTab(1)]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const hydratedStorageKeyRef = useRef<string>('');

  // Deep-link promo from AI / FEFO screens (?fefoPromo=...&skuId=...&warehouseId=...)
  const pendingDeepLinkRef = useRef<{ promoCode: string; skuId: string | null; warehouseId: string | null } | null>(null);

  const [fefoPromoOptions, setFefoPromoOptions] = useState<FefoPromoCodeItem[]>([]);
  const [fefoPromoBusy, setFefoPromoBusy] = useState(false);
  const [fefoPromoError, setFefoPromoError] = useState('');
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  const [payosEnabled, setPayosEnabled] = useState(false);
  const [pendingPayosId, setPendingPayosId] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const activeTab = useMemo(
    () => orderTabs.find(tab => tab.id === activeTabId) ?? orderTabs[0] ?? createEmptyOrderTab(1),
    [orderTabs, activeTabId],
  );

  const updateTabById = useCallback((tabId: string, updater: (prev: PosOrderTab) => PosOrderTab) => {
    setOrderTabs(prev => prev.map(tab => (tab.id === tabId ? updater(tab) : tab)));
  }, []);

  const updateActiveTab = useCallback(
    (updater: (prev: PosOrderTab) => PosOrderTab) => {
      const targetId = activeTab.id;
      setOrderTabs(prev => prev.map(tab => (tab.id === targetId ? updater(tab) : tab)));
    },
    [activeTab.id],
  );

  const persistTabsImmediately = useCallback(
    (tabsToSave: PosOrderTab[], nextActiveId: string) => {
      if (typeof window === 'undefined' || !user?.id || !warehouseId) return;
      const key = posTabsStorageKey(user.id, warehouseId);
      try {
        const payload: StoredPosTabsPayload = {
          tabs: tabsToSave,
          activeTabId: nextActiveId,
        };
        localStorage.setItem(key, JSON.stringify(payload));
      } catch {
        // Ignore storage quota errors
      }
    },
    [user?.id, warehouseId],
  );

  // Parse URL params once on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const promo = params.get('fefoPromo')?.trim().toUpperCase();
    const skuId = params.get('skuId')?.trim() || null;
    const whId = params.get('warehouseId')?.trim() || null;
    if (promo) {
      pendingDeepLinkRef.current = { promoCode: promo, skuId, warehouseId: whId };
    }
  }, []);

  useEffect(() => {
    if (!user) return;
    void getPayosConfig().then(config => setPayosEnabled(config.enabled)).catch(() => setPayosEnabled(false));
    setPendingPayosId(localStorage.getItem(payosStorageKey(user.id)) ?? '');
  }, [user?.id]);

  const bankQrReady = Boolean(bankQrConfig.bankId && bankQrConfig.accountNo && bankQrConfig.accountName);
  const selectedShift = shifts.find(row => row.id === shiftId);
  const availableWarehouses = warehouses.filter(row => row.active && row.store.active && row.storeId === selectedShift?.storeId);

  useEffect(() => {
    Promise.all([getShifts({ status: 'OPEN', pageSize: 100 }), getWarehouses()])
      .then(([shiftRows, warehouseRows]) => {
        const allowed = shiftRows.items.filter(
          row => row.cashierId === user?.id || user?.permissions.includes('invoices.cancel') || user?.permissions.includes('*'),
        );
        setShifts(allowed);
        setWarehouses(warehouseRows);

        const targetWhId = pendingDeepLinkRef.current?.warehouseId;
        if (targetWhId) {
          const targetWh = warehouseRows.find(w => w.id === targetWhId && w.active);
          const matchingShift = targetWh ? allowed.find(s => s.storeId === targetWh.storeId) : undefined;
          if (matchingShift) {
            setShiftId(matchingShift.id);
            setWarehouseId(targetWh!.id);
            setLoading(false);
            return;
          }
        }
        if (allowed.length === 1) setShiftId(allowed[0]!.id);
        setLoading(false);
      })
      .catch(reason => {
        setError(errorMessage(reason));
        setLoading(false);
      });
  }, [user?.id]);

  useEffect(() => {
    if (!selectedShift) {
      setWarehouseId('');
      return;
    }
    setWarehouseId(current => {
      if (current && availableWarehouses.some(w => w.id === current)) return current;
      return availableWarehouses.length === 1 ? availableWarehouses[0]!.id : '';
    });
  }, [shiftId, warehouses]);

  // Hydrate held order tabs when warehouse changes (with clean v1 -> v2 sequence migration)
  useEffect(() => {
    if (!user?.id || !warehouseId) {
      const initial = createEmptyOrderTab(1);
      setOrderTabs([initial]);
      setActiveTabId(initial.id);
      hydratedStorageKeyRef.current = '';
      return;
    }
    const key = posTabsStorageKey(user.id, warehouseId);
    const legacyKey = posTabsLegacyKey(user.id, warehouseId);
    try {
      const rawV2 = localStorage.getItem(key);
      if (rawV2) {
        const parsed = JSON.parse(rawV2) as Partial<StoredPosTabsPayload>;
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          const validTabs = parsed.tabs
            .filter(t => t && typeof t.id === 'string' && Array.isArray(t.cart))
            .slice(0, MAX_POS_TABS);
          if (validTabs.length > 0) {
            const chosenId = validTabs.some(t => t.id === parsed.activeTabId) ? parsed.activeTabId! : validTabs[0]!.id;
            setOrderTabs(validTabs);
            setActiveTabId(chosenId);
            hydratedStorageKeyRef.current = key;
            return;
          }
        }
      }
      const rawV1 = localStorage.getItem(legacyKey);
      if (rawV1) {
        const parsed = JSON.parse(rawV1) as Partial<StoredPosTabsPayload>;
        if (Array.isArray(parsed.tabs) && parsed.tabs.length > 0) {
          const validLegacy = parsed.tabs
            .filter(t => t && typeof t.id === 'string' && Array.isArray(t.cart))
            .slice(0, MAX_POS_TABS);
          const nonEmpty = validLegacy.filter(t => t.cart.length > 0);
          const migrated = (nonEmpty.length > 0 ? nonEmpty : validLegacy.slice(0, 1)).map((t, index) => ({
            ...t,
            seq: index + 1,
          }));
          if (migrated.length > 0) {
            const chosenId = migrated.some(t => t.id === parsed.activeTabId) ? parsed.activeTabId! : migrated[0]!.id;
            localStorage.setItem(key, JSON.stringify({ tabs: migrated, activeTabId: chosenId }));
            localStorage.removeItem(legacyKey);
            setOrderTabs(migrated);
            setActiveTabId(chosenId);
            hydratedStorageKeyRef.current = key;
            return;
          }
        }
      }
    } catch {
      // Fallback to fresh tab
    }
    const fresh = createEmptyOrderTab(1);
    setOrderTabs([fresh]);
    setActiveTabId(fresh.id);
    hydratedStorageKeyRef.current = key;
  }, [user?.id, warehouseId]);

  // Persist held order tabs automatically on change
  useEffect(() => {
    if (!user?.id || !warehouseId) return;
    const key = posTabsStorageKey(user.id, warehouseId);
    if (hydratedStorageKeyRef.current !== key) return;
    persistTabsImmediately(orderTabs, activeTab.id);
  }, [orderTabs, activeTab.id, user?.id, warehouseId, persistTabsImmediately]);

  // Add / Switch / Close POS Hold Order Tabs + Keyboard shortcuts (Alt+N, Alt+1..8)
  const handleCreateHoldTab = useCallback(() => {
    if (!warehouseId) return;
    if (orderTabs.length >= MAX_POS_TABS) {
      showToast(`Tối đa ${MAX_POS_TABS} hóa đơn tạm cùng lúc tại một quầy.`, 'error');
      return;
    }
    const seq = nextOrderSeq(orderTabs);
    const created = createEmptyOrderTab(seq);
    setOrderTabs(prev => (prev.some(t => t.seq === created.seq) || prev.length >= MAX_POS_TABS ? prev : [...prev, created]));
    setActiveTabId(created.id);
    setFefoPromoError('');
    setError('');
    showToast(`Đã giữ đơn trước · Mở Đơn ${seq} mới.`);
  }, [warehouseId, orderTabs, showToast]);

  const handleCloseHoldTab = useCallback(
    async (tabId: string) => {
      const target = orderTabs.find(t => t.id === tabId);
      if (!target) return;
      if (target.cart.length > 0) {
        const itemCount = target.cart.reduce((sum, line) => sum + line.quantity, 0);
        const tabSummary = computeTabTotal(target);
        const confirmed = await confirmAction(
          `Đơn ${target.seq} đang giữ ${itemCount} sản phẩm (${money(tabSummary.total)}). Bạn có chắc chắn muốn đóng và xóa giỏ hàng của đơn này?`,
          { title: `Xác nhận đóng Đơn ${target.seq}` },
        );
        if (!confirmed) return;
      }
      setFefoPromoError('');
      setError('');
      if (orderTabs.length <= 1) {
        const fresh = createEmptyOrderTab(1);
        setOrderTabs([fresh]);
        setActiveTabId(fresh.id);
        return;
      }
      const idx = orderTabs.findIndex(t => t.id === tabId);
      const remaining = orderTabs.filter(t => t.id !== tabId);
      setOrderTabs(remaining);
      if (activeTab.id === tabId) {
        const fallback = remaining[Math.max(0, idx - 1)] ?? remaining[0]!;
        setActiveTabId(fallback.id);
      }
    },
    [orderTabs, activeTab.id, confirmAction],
  );

  useEffect(() => {
    if (!warehouseId) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === 'n') {
        event.preventDefault();
        handleCreateHoldTab();
        return;
      }
      const digit = Number(event.key);
      if (Number.isInteger(digit) && digit >= 1 && digit <= orderTabs.length) {
        event.preventDefault();
        const chosen = orderTabs[digit - 1];
        if (chosen) {
          setActiveTabId(chosen.id);
          setFefoPromoError('');
          setError('');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [warehouseId, orderTabs, handleCreateHoldTab]);

  useEffect(() => {
    const storeId = selectedShift?.storeId;
    if (!storeId) {
      setAiShortages([]);
      return;
    }
    let active = true;
    const refresh = async (ensureDailyForecast = false) => {
      try {
        if (ensureDailyForecast) {
          const current = await getDemandForecast(storeId, 14);
          const generatedDay =
            current.run && new Date(current.run.generatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
          const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
          if (!current.run || generatedDay !== today) await runDemandForecast(storeId, 14);
        }
        const result = await getShortageAlerts(storeId, 14);
        if (active) setAiShortages(result.items);
      } catch {
        if (active) setAiShortages([]);
      } finally {
        if (active) setAiShortagesLoading(false);
      }
    };
    setAiShortagesLoading(true);
    void refresh(true);
    const timer = window.setInterval(() => {
      void refresh(false);
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [selectedShift?.storeId]);

  useEffect(() => {
    if (!warehouseId) {
      setFefoPromoOptions([]);
      setFefoPromoError('');
      return;
    }
    setFefoPromoError('');
    let active = true;
    void getFefoPromoCodes(warehouseId)
      .then(rows => {
        if (active) setFefoPromoOptions(rows);
      })
      .catch(() => {
        if (active) setFefoPromoOptions([]);
      });
    return () => {
      active = false;
    };
  }, [warehouseId]);

  useEffect(() => {
    if (!warehouseId) {
      setStockRows([]);
      setStockLoading(false);
      return;
    }
    setStockLoading(true);
    let active = true;
    const timer = window.setTimeout(() => {
      getInventory({ warehouseId, q: query.trim() || undefined, pageSize: 50 })
        .then(result => {
          if (!active) return;
          setStockRows(result.items);
          setStockLoading(false);
          // Refresh live available stock snapshot across all held tabs
          const bySku = new Map(result.items.map(item => [item.skuId, item]));
          setOrderTabs(prev =>
            prev.map(tab => {
              let changed = false;
              const nextCart = tab.cart.map(line => {
                const fresh = bySku.get(line.stock.skuId);
                if (fresh && fresh !== line.stock) {
                  changed = true;
                  return { ...line, stock: fresh };
                }
                return line;
              });
              return changed ? { ...tab, cart: nextCart } : tab;
            }),
          );
        })
        .catch(reason => {
          if (active) {
            setError(errorMessage(reason));
            setStockLoading(false);
          }
        });
    }, 250);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [warehouseId, query]);

  // Extract active tab fields cleanly
  const {
    cart,
    discount,
    discountMode,
    fefoPromoInput,
    appliedFefoPromos,
    cashPayment,
    cashTendered = null,
    qrPayment,
    note,
    transferMemo,
    payosSelected,
  } = activeTab;

  // Promo badges shown directly on POS product catalog cards
  const catalogPromoBadges = useMemo(() => {
    const badges: Record<string, { label: string; isBogo: boolean }> = {};
    for (const opt of fefoPromoOptions) {
      if (badges[opt.skuId]) continue;
      if (opt.bogoEligible) {
        badges[opt.skuId] = { label: `🎁 1 Tặng 1 · -${opt.discountPercent}%`, isBogo: true };
      } else {
        badges[opt.skuId] = { label: `🏷️ Xả FEFO -${opt.discountPercent}%`, isBogo: false };
      }
    }
    return badges;
  }, [fefoPromoOptions]);

  // Quantities reserved in OTHER held tabs at the same warehouse (helpful warning for cashier)
  const otherTabsReservedBySku = useMemo(() => {
    const map: Record<string, number> = {};
    for (const tab of orderTabs) {
      if (tab.id === activeTab.id) continue;
      for (const line of tab.cart) {
        map[line.stock.skuId] = (map[line.stock.skuId] ?? 0) + line.quantity;
      }
    }
    return map;
  }, [orderTabs, activeTab.id]);

  // Smart unapplied AI/FEFO suggestions for items already in the active cart
  const cartPromoSuggestions = useMemo(() => {
    if (!cart.length || !fefoPromoOptions.length) return [];
    const appliedLots = new Set(appliedFefoPromos.map(p => p.lotCode.toUpperCase()));
    const seenSku = new Set<string>();
    const list: { option: FefoPromoCodeItem; line: CartLine }[] = [];
    for (const line of cart) {
      if (seenSku.has(line.stock.skuId)) continue;
      const opt = fefoPromoOptions.find(
        o => o.skuId === line.stock.skuId && !appliedLots.has(o.lotCode.toUpperCase()),
      );
      if (opt) {
        seenSku.add(line.stock.skuId);
        list.push({ option: opt, line });
      }
    }
    return list;
  }, [cart, fefoPromoOptions, appliedFefoPromos]);

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + line.quantity * line.stock.sku.sellingPrice, 0), [cart]);
  const discountAmount =
    discountMode === 'percent'
      ? Math.round((subtotal * Math.max(0, Math.min(100, Number(discount.replace(',', '.')) || 0))) / 100)
      : parseCurrency(discount);
  const discountInvalid =
    discountMode === 'percent'
      ? (Number(discount.replace(',', '.')) || 0) > 100 || (Number(discount.replace(',', '.')) || 0) < 0
      : discountAmount > subtotal;

  const total = Math.max(0, subtotal - discountAmount);
  const cashAmount = parseCurrency(cashPayment ?? String(total));
  const qrAmount = parseCurrency(qrPayment);
  const amountToCollect = cashAmount + qrAmount;
  const effectiveCashTendered = cashAmount > 0 ? parseCurrency(cashTendered ?? String(cashAmount)) : 0;
  const cashChange = Math.max(0, effectiveCashTendered - cashAmount);
  const cashShortfall = Math.max(0, cashAmount - effectiveCashTendered);
  const cashDenomSuggestions = useMemo(() => suggestCashDenominations(cashAmount), [cashAmount]);
  const activePaymentMethod =
    [cashAmount, qrAmount].filter(amount => amount > 0).length > 1 ? 'MIXED' : qrAmount > 0 ? 'QR' : 'CASH';

  const choosePaymentMethod = (method: 'CASH' | 'QR' | 'MIXED') => {
    updateActiveTab(tab => {
      const nextPayos = method === 'QR' && payosEnabled;
      if (method === 'CASH') return { ...tab, payosSelected: nextPayos, cashPayment: null, cashTendered: null, qrPayment: '0' };
      if (method === 'QR') return { ...tab, payosSelected: nextPayos, cashPayment: '0', cashTendered: null, qrPayment: String(total) };
      const cash = Math.floor(total / 2);
      return {
        ...tab,
        payosSelected: nextPayos,
        cashPayment: String(cash),
        cashTendered: null,
        qrPayment: bankQrReady && !payosEnabled ? String(total - cash) : '0',
      };
    });
  };

  const invalidStock = cart.some(line => line.quantity > line.stock.available || line.quantity < 1);
  const qrImageUrl =
    bankQrReady && qrAmount > 0
      ? `https://img.vietqr.io/image/${encodeURIComponent(bankQrConfig.bankId)}-${encodeURIComponent(bankQrConfig.accountNo)}-compact2.png?amount=${qrAmount}&addInfo=${encodeURIComponent(transferMemo)}&accountName=${encodeURIComponent(bankQrConfig.accountName)}`
      : '';

  const add = (stock: Inventory) => {
    if (stock.available < 1) return;
    updateActiveTab(tab => ({
      ...tab,
      cart: tab.cart.some(line => line.stock.skuId === stock.skuId)
        ? tab.cart.map(line =>
            line.stock.skuId === stock.skuId
              ? { ...line, stock, quantity: Math.min(line.quantity + 1, stock.available) }
              : line,
          )
        : [...tab.cart, { stock, quantity: 1 }],
    }));
  };

  const applyFefoPromoCode = useCallback(
    async (overrideCode?: string, customCart?: CartLine[], targetTabId?: string) => {
      const tabIdToUpdate = targetTabId ?? activeTab.id;
      const effectiveCart = customCart ?? cart;
      const rawCode = (overrideCode ?? fefoPromoInput).trim().toUpperCase();
      if (!warehouseId || !rawCode) return;
      if (!effectiveCart.length) {
        setFefoPromoError('Vui lòng thêm sản phẩm của lô cận hạn vào giỏ hàng trước khi áp mã.');
        return;
      }
      const existingCodes = (orderTabs.find(t => t.id === tabIdToUpdate)?.appliedFefoPromos ?? []).map(p => p.promoCode);
      const nextCodes = [...new Set([...existingCodes, rawCode])];
      setFefoPromoBusy(true);
      setFefoPromoError('');
      try {
        const result = await verifyFefoPromo({
          warehouseId,
          promoCodes: nextCodes,
          items: effectiveCart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })),
        });
        updateTabById(tabIdToUpdate, tab => ({
          ...tab,
          cart: customCart ?? tab.cart,
          appliedFefoPromos: result.promos,
          discountMode: 'amount',
          discount: String(result.totalDiscount),
          fefoPromoInput: '',
        }));
        const isBogo = rawCode.startsWith('BOGO-');
        showToast(
          isBogo
            ? `🎁 Đã áp dụng Mua 1 Tặng 1 (${rawCode}): giảm ${money(result.totalDiscount)} từ lô cận hạn.`
            : `🏷️ Đã xác minh & áp mã xả FEFO (${rawCode}): giảm ${money(result.totalDiscount)}.`,
        );
      } catch (reason) {
        setFefoPromoError(errorMessage(reason));
      } finally {
        setFefoPromoBusy(false);
      }
    },
    [activeTab.id, cart, fefoPromoInput, orderTabs, showToast, updateTabById, warehouseId],
  );

  const handleQuickApplySuggestion = async (opt: FefoPromoCodeItem, mode: 'DISCOUNT' | 'BOGO') => {
    const code = mode === 'BOGO' ? opt.bogoPromoCode ?? `BOGO-${opt.lotCode}` : opt.promoCode;
    let nextCart = cart;
    if (mode === 'BOGO') {
      const existing = cart.find(l => l.stock.skuId === opt.skuId);
      if (existing && existing.quantity < 2 && existing.stock.available >= 2) {
        nextCart = cart.map(l => (l.stock.skuId === opt.skuId ? { ...l, quantity: 2 } : l));
        updateActiveTab(tab => ({ ...tab, cart: nextCart }));
      }
    }
    await applyFefoPromoCode(code, nextCart, activeTab.id);
  };

  // Auto-handle deep link from AI Forecast / FEFO Lots page (?fefoPromo=...&skuId=...)
  useEffect(() => {
    const pending = pendingDeepLinkRef.current;
    if (!pending || !warehouseId || !user?.id) return;
    const expectedKey = posTabsStorageKey(user.id, warehouseId);
    if (hydratedStorageKeyRef.current !== expectedKey) return;
    if (!stockRows.length && stockLoading) return;

    pendingDeepLinkRef.current = null;
    if (typeof window !== 'undefined') {
      window.history.replaceState({}, '', window.location.pathname);
    }

    void (async () => {
      const isBogo = pending.promoCode.startsWith('BOGO-');
      const minQty = isBogo ? 2 : 1;
      let matchedStock = pending.skuId ? stockRows.find(r => r.skuId === pending.skuId) : undefined;

      if (!matchedStock && fefoPromoOptions.length > 0) {
        const opt = fefoPromoOptions.find(
          o => o.promoCode === pending.promoCode || o.bogoPromoCode === pending.promoCode,
        );
        if (opt) matchedStock = stockRows.find(r => r.skuId === opt.skuId);
      }
      if (!matchedStock && pending.skuId) {
        try {
          const lookup = await getInventory({ warehouseId, pageSize: 100 });
          matchedStock = lookup.items.find(r => r.skuId === pending.skuId);
        } catch {
          // Ignore lookup error
        }
      }

      if (!matchedStock || matchedStock.available < minQty) {
        updateActiveTab(tab => ({ ...tab, fefoPromoInput: pending.promoCode }));
        return;
      }

      // Never overwrite an existing held customer's cart — open a dedicated new tab if needed!
      let targetId = activeTab.id;
      let baseCart = activeTab.cart;
      if (activeTab.cart.length > 0 && !activeTab.cart.some(l => l.stock.skuId === matchedStock!.skuId) && orderTabs.length < MAX_POS_TABS) {
        const seq = nextOrderSeq(orderTabs);
        const freshTab = createEmptyOrderTab(seq);
        targetId = freshTab.id;
        baseCart = [];
        setOrderTabs(prev => (prev.some(t => t.seq === freshTab.seq) || prev.length >= MAX_POS_TABS ? prev : [...prev, freshTab]));
        setActiveTabId(freshTab.id);
      }

      const nextCart = baseCart.some(l => l.stock.skuId === matchedStock!.skuId)
        ? baseCart.map(l =>
            l.stock.skuId === matchedStock!.skuId
              ? { ...l, stock: matchedStock!, quantity: Math.min(Math.max(l.quantity, minQty), matchedStock!.available) }
              : l,
          )
        : [...baseCart, { stock: matchedStock, quantity: Math.min(minQty, matchedStock.available) }];

      updateTabById(targetId, tab => ({ ...tab, cart: nextCart, fefoPromoInput: pending.promoCode }));
      await applyFefoPromoCode(pending.promoCode, nextCart, targetId);
    })();
  }, [warehouseId, user?.id, stockRows, stockLoading, fefoPromoOptions, activeTab, orderTabs.length, applyFefoPromoCode, updateActiveTab, updateTabById]);

  // Keep applied FEFO / BOGO discount synchronized whenever cart quantities change
  const cartSignature = useMemo(() => cart.map(l => `${l.stock.skuId}:${l.quantity}`).join('|'), [cart]);
  const lastVerifiedSigRef = useRef<string>('');
  useEffect(() => {
    if (!warehouseId || !appliedFefoPromos.length) {
      lastVerifiedSigRef.current = `${activeTab.id}::${cartSignature}`;
      return;
    }
    const compositeSig = `${activeTab.id}::${cartSignature}::${appliedFefoPromos.map(p => p.promoCode).join(',')}`;
    if (lastVerifiedSigRef.current === compositeSig) return;
    lastVerifiedSigRef.current = compositeSig;

    const cartQtyBySku = new Map(cart.map(l => [l.stock.skuId, l.quantity]));
    const stillApplicable = appliedFefoPromos.filter(p => {
      const qty = cartQtyBySku.get(p.skuId) ?? 0;
      return p.mode === 'BOGO' || p.promoCode.startsWith('BOGO-') ? qty >= 2 : qty >= 1;
    });

    if (!stillApplicable.length) {
      updateActiveTab(tab => ({ ...tab, appliedFefoPromos: [], discount: '' }));
      return;
    }

    let active = true;
    void verifyFefoPromo({
      warehouseId,
      promoCodes: stillApplicable.map(p => p.promoCode),
      items: cart.map(l => ({ skuId: l.stock.skuId, quantity: l.quantity })),
    })
      .then(res => {
        if (!active) return;
        updateActiveTab(tab => ({
          ...tab,
          appliedFefoPromos: res.promos,
          discountMode: 'amount',
          discount: String(res.totalDiscount),
        }));
      })
      .catch(() => {
        if (!active) return;
        updateActiveTab(tab => ({ ...tab, appliedFefoPromos: [], discount: '' }));
      });
    return () => {
      active = false;
    };
  }, [activeTab.id, cartSignature, warehouseId]);

  const handleBarcodeScanned = async (rawCode: string, resolvedSkuId?: string | null): Promise<boolean> => {
    const clean = extractBarcodeQueryFromText(rawCode);
    const matched = stockRows.find(
      r =>
        (resolvedSkuId && r.skuId === resolvedSkuId) ||
        r.sku.barcode?.toLowerCase() === clean ||
        r.sku.code.toLowerCase() === clean ||
        r.sku.product.code.toLowerCase() === clean,
    );
    if (matched && matched.available > 0) {
      add(matched);
      showToast(`Đã quét mã ${rawCode} · Thêm "${matched.sku.product.name}" (${money(matched.sku.sellingPrice)}) vào Đơn ${activeTab.seq}.`);
      return true;
    }
    if (warehouseId) {
      try {
        const res = await getInventory({ warehouseId, q: clean, pageSize: 5 });
        const serverHit = res.items.find(
          r =>
            (resolvedSkuId && r.skuId === resolvedSkuId) ||
            r.sku.barcode?.toLowerCase() === clean ||
            r.sku.code.toLowerCase() === clean ||
            r.sku.product.code.toLowerCase() === clean,
        );
        if (serverHit && serverHit.available > 0) {
          setStockRows(prev => (prev.some(p => p.skuId === serverHit.skuId) ? prev : [serverHit, ...prev]));
          add(serverHit);
          showToast(`Đã quét mã ${rawCode} · Thêm "${serverHit.sku.product.name}" (${money(serverHit.sku.sellingPrice)}) vào Đơn ${activeTab.seq}.`);
          return true;
        }
      } catch {
        // Ignore lookup error
      }
    }
    return false;
  };

  const handleInvoiceReturnScanned = useCallback(
    async (target: InvoiceReturnTarget) => {
      if (target.kind === 'id') {
        showToast('Đã quét mã QR hóa đơn · Chuyển sang màn hình đổi trả hàng.');
        router.push(`/hoa-don/${target.invoiceId}?return=1`);
        return;
      }
      try {
        const found = await getInvoices({ q: target.invoiceCode, status: 'all', page: 1 });
        const exact = found.items.find(item => item.code.toUpperCase() === target.invoiceCode) ?? found.items[0];
        if (!exact) {
          showToast(`Không tìm thấy hóa đơn ${target.invoiceCode}.`, 'error');
          return;
        }
        showToast(`Đã nhận diện hóa đơn ${exact.code} · Mở phiếu đổi trả hàng.`);
        router.push(`/hoa-don/${exact.id}?return=1`);
      } catch (reason) {
        showToast(errorMessage(reason), 'error');
      }
    },
    [router, showToast],
  );

  const validateSale = () => {
    if (payosSelected) {
      if (!selectedShift || !warehouseId || !cart.length || invalidStock || discountInvalid || total <= 0) {
        setError('Kiểm tra ca, kho, tồn hàng và tổng tiền trước khi tạo QR.');
        return false;
      }
      setError('');
      return true;
    }
    if (payosEnabled && qrAmount > 0) {
      setError('Chọn QR thanh toán để thanh toán toàn bộ hóa đơn qua payOS.');
      return false;
    }
    if (cashAmount > 0 && cashShortfall > 0) {
      setError(`Tiền mặt khách đưa còn thiếu ${money(cashShortfall)} so với số tiền mặt cần thu.`);
      return false;
    }
    if (
      !selectedShift ||
      !warehouseId ||
      !cart.length ||
      invalidStock ||
      amountToCollect !== total ||
      (qrAmount > 0 && (!bankQrReady || !transferMemo)) ||
      discountInvalid
    ) {
      setError('Kiểm tra ca, kho, tồn khả dụng và tổng tiền thanh toán trước khi lưu.');
      return false;
    }
    setError('');
    return true;
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!validateSale()) return;
    if (payosSelected) {
      startPayos();
      return;
    }
    setCheckoutOpen(true);
  };

  const startPayos = () => {
    if (!user || busy) return;
    const existing = localStorage.getItem(payosStorageKey(user.id));
    if (existing) {
      router.push(`/thanh-toan/payos?checkoutId=${encodeURIComponent(existing)}`);
      return;
    }
    const checkoutId = crypto.randomUUID();
    const input: PayosCheckoutInput = {
      checkoutId,
      shiftId,
      warehouseId,
      discount: discountAmount,
      note: note.trim() || undefined,
      items: cart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })),
    };
    sessionStorage.setItem(`${payosStorageKey(user.id)}-request`, JSON.stringify(input));
    localStorage.setItem(payosStorageKey(user.id), checkoutId);
    setBusy(true);
    router.push(`/thanh-toan/payos?checkoutId=${checkoutId}`);
  };

  const removeFefoPromoCode = async (promoCode: string) => {
    const remaining = appliedFefoPromos.filter(p => p.promoCode !== promoCode).map(p => p.promoCode);
    setFefoPromoError('');
    if (!remaining.length || !warehouseId || !cart.length) {
      updateActiveTab(tab => ({ ...tab, appliedFefoPromos: [], discount: '' }));
      return;
    }
    setFefoPromoBusy(true);
    try {
      const result = await verifyFefoPromo({
        warehouseId,
        promoCodes: remaining,
        items: cart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })),
      });
      updateActiveTab(tab => ({
        ...tab,
        appliedFefoPromos: result.promos,
        discountMode: 'amount',
        discount: String(result.totalDiscount),
      }));
    } catch (reason) {
      setFefoPromoError(errorMessage(reason));
    } finally {
      setFefoPromoBusy(false);
    }
  };

  const completeSale = async () => {
    if (!validateSale()) return;
    setBusy(true);
    setError('');
    try {
      const cashRef = cashAmount > 0 ? buildCashTenderReference(effectiveCashTendered, cashChange) : undefined;
      const payments = [
        ...(cashAmount > 0 ? [{ method: 'CASH' as const, amount: cashAmount, reference: cashRef }] : []),
        ...(qrAmount > 0 ? [{ method: 'QR' as const, amount: qrAmount, reference: transferMemo }] : []),
      ];
      const invoice = await createInvoice({
        shiftId,
        warehouseId,
        customerName: 'Khách vãng lai',
        discount: discountAmount,
        creditAmount: 0,
        note: note.trim() || undefined,
        fefoPromoCodes: appliedFefoPromos.length ? appliedFefoPromos.map(p => p.promoCode) : undefined,
        items: cart.map(line => ({ skuId: line.stock.skuId, quantity: line.quantity })),
        payments,
      });

      // Remove only the completed tab and keep any remaining held tabs intact for waiting customers
      const remainingTabs = orderTabs.filter(t => t.id !== activeTab.id);
      if (remainingTabs.length > 0) {
        const nextActive = remainingTabs[0]!;
        setOrderTabs(remainingTabs);
        setActiveTabId(nextActive.id);
        persistTabsImmediately(remainingTabs, nextActive.id);
      } else {
        const fresh = createEmptyOrderTab(1);
        setOrderTabs([fresh]);
        setActiveTabId(fresh.id);
        persistTabsImmediately([fresh], fresh.id);
      }

      setCheckoutOpen(false);
      let printed = false;
      if (autoPrintReceipt) {
        printed = printInvoice(invoice, { silentIfBlocked: true });
      }
      const changeSuffix = cashAmount > 0 && cashChange > 0 ? ` · Tiền thừa trả khách: ${money(cashChange)}` : '';
      showToast(
        autoPrintReceipt && !printed
          ? `Đã thanh toán ${invoice.code}${changeSuffix} · Bấm "In hóa đơn" trên trang chi tiết để in bill.`
          : `Đã hoàn tất hóa đơn ${invoice.code}${changeSuffix}.`,
      );
      router.push(`/hoa-don/${invoice.id}`);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="suite-page sale-page pos-workspace">
      <header className="suite-heading">
        <div>
          <div className="breadcrumb">
            <Link href="/hoa-don">Hóa đơn</Link> <span>›</span> Bán hàng
          </div>
          <h1>Tạo hóa đơn bán hàng</h1>
          <p>Hỗ trợ giữ nhiều đơn tạm song song (Alt+N mở đơn mới), quét mã vạch và tự động gợi ý xả hàng cận hạn.</p>
        </div>
        <Link className="ui-action-button action-view" href="/hoa-don">
          ‹ Danh sách hóa đơn
        </Link>
      </header>
      {loading && <p role="status">Đang tải ca và kho…</p>}
      {error && (
        <div className="ui-error" role="alert">
          {error}
        </div>
      )}
      <form className="sale-layout" onSubmit={submit}>
        <section className="pos-sessionbar">
          <div
            className="sale-fields"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
              alignItems: 'center',
              gap: 18,
              padding: '14px 18px',
            }}
          >
            <div
              className="pos-session-field"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                margin: 0,
                padding: 0,
                height: 42,
                minHeight: 42,
              }}
            >
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#334155', lineHeight: '42px', margin: 0 }}>Ca đang mở</span>
              <select
                required
                aria-label="Ca đang mở"
                value={shiftId}
                onChange={event => setShiftId(event.target.value)}
                style={{ height: 42, minHeight: 42, margin: 0, marginTop: 0, flex: 1, minWidth: 0, width: '100%' }}
              >
                <option value="">Chọn ca làm việc</option>
                {shifts.map(shift => (
                  <option key={shift.id} value={shift.id}>
                    {shift.store.name} · Máy {shift.posCode} · {shift.cashier.name}
                  </option>
                ))}
              </select>
            </div>
            <div
              className="pos-session-field"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                margin: 0,
                padding: 0,
                height: 42,
                minHeight: 42,
              }}
            >
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#334155', lineHeight: '42px', margin: 0 }}>Kho xuất hàng</span>
              <select
                required
                aria-label="Kho xuất hàng"
                value={warehouseId}
                onChange={event => {
                  setWarehouseId(event.target.value);
                }}
                style={{ height: 42, minHeight: 42, margin: 0, marginTop: 0, flex: 1, minWidth: 0, width: '100%' }}
              >
                <option value="">Chọn kho</option>
                {availableWarehouses.map(row => (
                  <option key={row.id} value={row.id}>
                    {row.code} · {row.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {!loading && shifts.length === 0 && (
            <p className="sale-note">Chưa có ca mở phù hợp. Hãy liên hệ quản lý để bắt đầu bán hàng.</p>
          )}

          {/* Thanh Giữ Đơn Tạm Đa Tab (Chuẩn KiotViet / Sapo POS) */}
          {warehouseId && (
            <div className="pos-hold-tabs-bar" role="tablist" aria-label="Danh sách hóa đơn đang phục vụ">
              <div className="pos-hold-tabs-list">
                {orderTabs.map((tab, idx) => {
                  const summary = computeTabTotal(tab);
                  const isActive = tab.id === activeTab.id;
                  return (
                    <div key={tab.id} className={`pos-hold-tab${isActive ? ' is-active' : ''}`}>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        className="pos-hold-tab-trigger"
                        title={`Chuyển sang Đơn ${tab.seq} (Phím tắt Alt+${idx + 1})`}
                        onClick={() => {
                          setActiveTabId(tab.id);
                          setFefoPromoError('');
                          setError('');
                        }}
                      >
                        <strong>Đơn {tab.seq}</strong>
                        <span className={`pos-hold-tab-meta${summary.itemCount > 0 ? ' has-items' : ''}`}>
                          {summary.itemCount > 0 ? `${summary.itemCount} SP · ${shortMoney(summary.total)}` : 'Trống'}
                        </span>
                      </button>
                      {(orderTabs.length > 1 || summary.itemCount > 0) && (
                        <button
                          type="button"
                          className="pos-hold-tab-close"
                          aria-label={`Đóng Đơn ${tab.seq}`}
                          title={orderTabs.length > 1 ? `Đóng Đơn ${tab.seq}` : `Làm mới Đơn ${tab.seq}`}
                          onClick={() => void handleCloseHoldTab(tab.id)}
                        >
                          ×
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                className="pos-hold-add-btn"
                disabled={orderTabs.length >= MAX_POS_TABS}
                onClick={handleCreateHoldTab}
                title="Giữ đơn hiện tại và mở tab hóa đơn mới cho khách tiếp theo (Alt+N)"
              >
                ＋ Giữ / Đơn mới <kbd>Alt+N</kbd>
              </button>
            </div>
          )}
        </section>

        <section className="panel sale-products">
          <PosCatalog
            key={warehouseId}
            rows={stockRows}
            ready={!!warehouseId}
            loading={stockLoading}
            query={query}
            onQuery={setQuery}
            onAdd={add}
            onBarcodeScanned={handleBarcodeScanned}
            onInvoiceReturnScanned={handleInvoiceReturnScanned}
            quantities={Object.fromEntries(cart.map(line => [line.stock.skuId, line.quantity]))}
            promoBadges={catalogPromoBadges}
          />
        </section>

        <section className="panel sale-checkout pos-ticket">
          <div className="panel-heading pos-ticket-heading">
            <div>
              <h2>
                Đơn {activeTab.seq} {orderTabs.length > 1 && <small className="pos-held-indicator">({orderTabs.length} đơn đang mở)</small>}
              </h2>
              <span className="pos-ticket-count">{cart.reduce((sum, line) => sum + line.quantity, 0)} sản phẩm</span>
            </div>
            {warehouseId && (
              <button
                type="button"
                className="outline-button pos-ticket-hold-btn"
                disabled={orderTabs.length >= MAX_POS_TABS}
                onClick={handleCreateHoldTab}
                title="Giữ tạm đơn này để tính tiền cho khách khác trước"
              >
                ＋ Đơn tạm
              </button>
            )}
          </div>

          <div className="sale-checkout-body">
            <div className="sale-cart">
              <div className="sale-cart-heading">
                <strong>Giỏ hàng (Đơn {activeTab.seq} · Khách vãng lai)</strong>
                <span>{cart.length} mặt hàng</span>
              </div>
              {cart.length ? (
                <div className="sale-cart-items">
                  {cart.map(line => {
                    const heldElsewhere = otherTabsReservedBySku[line.stock.skuId] ?? 0;
                    const overHeldAcrossTabs = line.quantity + heldElsewhere > line.stock.available;
                    return (
                      <article key={line.stock.skuId}>
                        <div className="sale-cart-product">
                          <ProductIdentity
                            name={line.stock.sku.product.name}
                            code={line.stock.sku.product.code}
                            imageUrl={line.stock.sku.product.imageUrl}
                          />
                          <span>
                            <small>
                              {money(line.stock.sku.sellingPrice)} / {line.stock.sku.product.unit}
                            </small>
                            {overHeldAcrossTabs && (
                              <small style={{ display: 'block', color: '#b45309', fontWeight: 600 }}>
                                Lưu ý: Các đơn tạm khác đang giữ thêm {heldElsewhere} {line.stock.sku.product.unit} (tồn kho: {line.stock.available})
                              </small>
                            )}
                          </span>
                        </div>
                        <div className="sale-cart-edit">
                          <PosQuantity
                            name={line.stock.sku.product.name}
                            value={line.quantity}
                            max={line.stock.available}
                            onChange={quantity =>
                              updateActiveTab(tab => ({
                                ...tab,
                                cart: tab.cart.map(item =>
                                  item.stock.skuId === line.stock.skuId ? { ...item, quantity } : item,
                                ),
                              }))
                            }
                          />
                          <strong>{money(line.quantity * line.stock.sku.sellingPrice)}</strong>
                          <ActionButton
                            tone="danger"
                            onClick={() =>
                              updateActiveTab(tab => ({
                                ...tab,
                                cart: tab.cart.filter(item => item.stock.skuId !== line.stock.skuId),
                              }))
                            }
                          >
                            Xóa
                          </ActionButton>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="sale-cart-empty">
                  <Icon name="bag" size={32} />
                  <strong>Đơn {activeTab.seq} đang trống</strong>
                  <span>Chọn sản phẩm hoặc quét mã vạch để thêm vào đơn này.</span>
                </div>
              )}
            </div>

            {/* Banner tự động phát hiện & gợi ý 1-click áp khuyến mãi AI × FEFO / Mua 1 Tặng 1 ngay khi quét món */}
            {cartPromoSuggestions.length > 0 && (
              <div className="pos-smart-promo-banner" role="region" aria-label="Gợi ý khuyến mãi lô cận hạn AI × FEFO">
                <div className="pos-smart-promo-title">
                  Phát hiện ưu đãi xả hàng cận hạn cho sản phẩm trong giỏ:
                </div>
                {cartPromoSuggestions.map(({ option, line }) => (
                  <div key={option.lotId} className="pos-smart-promo-item">
                    <div className="pos-smart-promo-info">
                      <strong>{option.productName}</strong>
                      <small>
                        Lô <code>{option.lotCode}</code> · còn {option.daysRemaining} ngày ({option.lotQuantity} {option.unit})
                      </small>
                    </div>
                    <div className="pos-smart-promo-actions">
                      <button
                        type="button"
                        className="pos-smart-btn is-discount"
                        disabled={fefoPromoBusy}
                        onClick={() => void handleQuickApplySuggestion(option, 'DISCOUNT')}
                      >
                        🏷️ Giảm -{option.discountPercent}%
                      </button>
                      {option.bogoEligible && option.bogoPromoCode && line.stock.available >= 2 && (
                        <button
                          type="button"
                          className="pos-smart-btn is-bogo"
                          disabled={fefoPromoBusy}
                          onClick={() => void handleQuickApplySuggestion(option, 'BOGO')}
                          title={
                            line.quantity < 2
                              ? 'Tự động nâng số lượng lên 2 (1 tính tiền + 1 tặng miễn phí) và trừ tồn lô FEFO'
                              : 'Áp dụng Mua 1 Tặng 1 trên số cặp sản phẩm trong giỏ'
                          }
                        >
                          🎁 1 Tặng 1 {line.quantity < 2 ? '(+1 tặng)' : ''}
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <details className="pos-discount" open={appliedFefoPromos.length > 0 || Boolean(fefoPromoInput)}>
              <summary>
                Chiết khấu & Mã xả cận hạn FEFO / 1 Tặng 1 <span>{money(discountAmount)}</span>
              </summary>
              <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
                <label>
                  Mã xả cận hạn FEFO hoặc Mua 1 Tặng 1 (xác minh theo lô thực tế)
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {fefoPromoOptions.length > 0 && (
                      <select
                        value=""
                        disabled={!warehouseId || fefoPromoBusy}
                        onChange={event => {
                          const chosen = event.target.value;
                          if (!chosen) return;
                          updateActiveTab(tab => ({ ...tab, fefoPromoInput: chosen }));
                          void applyFefoPromoCode(chosen);
                        }}
                        style={{ flex: '1 1 180px' }}
                      >
                        <option value="">Chọn nhanh ưu đãi lô cận hạn tại kho ({fefoPromoOptions.length})</option>
                        {fefoPromoOptions.flatMap(opt => {
                          const items = [
                            <option key={opt.promoCode} value={opt.promoCode}>
                              {opt.promoCode} · {opt.productName} · còn {opt.daysRemaining}d · Giảm -{opt.discountPercent}% ({opt.lotQuantity} {opt.unit})
                            </option>,
                          ];
                          if (opt.bogoEligible && opt.bogoPromoCode) {
                            items.push(
                              <option key={opt.bogoPromoCode} value={opt.bogoPromoCode}>
                                {opt.bogoPromoCode} · {opt.productName} · còn {opt.daysRemaining}d · 🎁 Mua 1 Tặng 1
                              </option>,
                            );
                          }
                          return items;
                        })}
                      </select>
                    )}
                    <input
                      value={fefoPromoInput}
                      disabled={!warehouseId || fefoPromoBusy}
                      onChange={event => updateActiveTab(tab => ({ ...tab, fefoPromoInput: event.target.value }))}
                      placeholder="VD: FEFO-LOT-... hoặc BOGO-LOT-..."
                      style={{ flex: '1 1 140px' }}
                    />
                    <button
                      type="button"
                      className="outline-button"
                      disabled={!warehouseId || !fefoPromoInput.trim() || fefoPromoBusy}
                      onClick={() => void applyFefoPromoCode()}
                    >
                      {fefoPromoBusy ? 'Đang kiểm tra…' : 'Áp mã'}
                    </button>
                  </div>
                </label>
                {fefoPromoError && <p className="negative">{fefoPromoError}</p>}
                {appliedFefoPromos.map(promo => {
                  const isBogo = promo.mode === 'BOGO' || promo.promoCode.startsWith('BOGO-');
                  return (
                    <div
                      key={promo.promoCode}
                      style={{
                        fontSize: 12,
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: isBogo ? '#fff1f2' : '#ecfdf5',
                        border: `1px solid ${isBogo ? '#fecdd3' : '#a7f3d0'}`,
                        color: isBogo ? '#9f1239' : '#065f46',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 8,
                      }}
                    >
                      <span>
                        <strong>{promo.promoCode}</strong> · Lô <code>{promo.lotCode}</code> còn {promo.daysRemaining} ngày ·{' '}
                        {isBogo
                          ? `🎁 Mua 1 Tặng 1 (miễn phí ${promo.freeQuantity ?? Math.floor(promo.eligibleQuantity / 2)}/${promo.eligibleQuantity} ${promo.unit})`
                          : `giảm ${promo.discountPercent}% trên ${promo.eligibleQuantity} ${promo.unit}`}{' '}
                        = <strong>-{money(promo.discountAmount)}</strong>
                      </span>
                      <button
                        type="button"
                        className="outline-button"
                        onClick={() => void removeFefoPromoCode(promo.promoCode)}
                      >
                        Gỡ
                      </button>
                    </div>
                  );
                })}
              </div>
              <label>
                Chiết khấu
                <select
                  value={discountMode}
                  onChange={event =>
                    updateActiveTab(tab => ({ ...tab, discountMode: event.target.value as 'amount' | 'percent' }))
                  }
                >
                  <option value="amount">Theo số tiền</option>
                  <option value="percent">Theo phần trăm</option>
                </select>
                {discountMode === 'amount' ? (
                  <CurrencyInput
                    min={0}
                    max={subtotal}
                    value={discount}
                    onChange={val => updateActiveTab(tab => ({ ...tab, discount: val }))}
                  />
                ) : (
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="0.1"
                    value={discount}
                    onChange={event => updateActiveTab(tab => ({ ...tab, discount: event.target.value }))}
                    placeholder="0-100%"
                  />
                )}
              </label>
              {discountInvalid && <p className="negative">Chiết khấu phải nằm trong giới hạn cho phép.</p>}
            </details>

            <div className="sale-bill-summary">
              <div>
                <span>Tiền hàng</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <div>
                <span>Chiết khấu</span>
                <strong>{money(discountAmount)}</strong>
              </div>
              <div className="sale-bill-total">
                <span>Tổng tiền</span>
                <strong>{money(total)}</strong>
              </div>
            </div>

            <div className="sale-method-picker">
              <strong>Phương thức thanh toán</strong>
              <div role="group" aria-label="Chọn phương thức thanh toán">
                {(
                  [
                    ['CASH', 'Tiền mặt', 'wallet'],
                    ['QR', 'QR / chuyển khoản', 'card'],
                    ['MIXED', 'Thanh toán kết hợp', 'receipt'],
                  ] as const
                ).map(([method, label, icon]) => (
                  <button
                    type="button"
                    key={method}
                    className={activePaymentMethod === method ? 'selected' : ''}
                    disabled={method === 'QR' && !bankQrReady && !payosEnabled}
                    title={
                      method === 'QR' && !bankQrReady && !payosEnabled
                        ? 'Cần cấu hình VietQR để tạo mã thanh toán.'
                        : undefined
                    }
                    onClick={() => choosePaymentMethod(method)}
                  >
                    <Icon name={icon} size={15} />
                    {method === 'QR' && payosEnabled ? 'QR thanh toán' : label}
                  </button>
                ))}
              </div>
              {!bankQrReady && !payosEnabled && <small>Thanh toán QR chưa khả dụng tại cửa hàng này.</small>}
            </div>

            {cashAmount > 0 && cart.length > 0 && !payosSelected && (
              <div className="pos-cash-calc-box" aria-label="Tính nhanh tiền khách đưa và tiền thối">
                <label>
                  Tiền mặt khách đưa
                  <CurrencyInput
                    min={0}
                    max={999_999_999}
                    value={cashTendered ?? String(cashAmount)}
                    onChange={val => updateActiveTab(tab => ({ ...tab, cashTendered: val }))}
                  />
                </label>
                {cashDenomSuggestions.length > 0 && (
                  <div className="pos-cash-denom-row" role="group" aria-label="Chọn nhanh mệnh giá tiền khách đưa">
                    {cashDenomSuggestions.map(item => {
                      const isSelected = effectiveCashTendered === item.amount;
                      return (
                        <button
                          type="button"
                          key={item.amount}
                          className={`pos-cash-denom-btn${isSelected ? ' is-selected' : ''}${item.isExact ? ' is-exact' : ''}`}
                          onClick={() =>
                            updateActiveTab(tab => ({
                              ...tab,
                              cashTendered: item.isExact ? null : String(item.amount),
                            }))
                          }
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                <div className={`pos-cash-change-banner${cashShortfall > 0 ? ' is-short' : ''}`}>
                  <span>{cashShortfall > 0 ? 'Khách đưa còn thiếu' : 'Tiền thừa trả khách'}</span>
                  <strong>{money(cashShortfall > 0 ? cashShortfall : cashChange)}</strong>
                </div>
              </div>
            )}

            {payosSelected && (
              <p className="sale-checkout-hint">Quét mã QR để trả toàn bộ hóa đơn; hệ thống tự xác minh tiền vào.</p>
            )}
            <p className="sale-checkout-hint">Chọn phương thức, sau đó tiếp tục để xác nhận số tiền và hoàn tất hóa đơn.</p>
            <ActionButton
              tone="approve"
              type="submit"
              disabled={busy || !shiftId || !warehouseId || !cart.length || invalidStock || discountInvalid || (cashAmount > 0 && cashShortfall > 0)}
            >
              {busy ? 'Đang xử lý...' : `Thanh toán Đơn ${activeTab.seq} · ${money(total)}`}
            </ActionButton>
          </div>
        </section>
      </form>

      <details className="pos-stock-advice">
        <summary>Thông tin bổ sung về tồn kho</summary>
        {selectedShift && (
          <section className="sale-ai-shortages">
            <header>
              <div>
                <h3>Sản phẩm cần chú ý ({aiShortages.length})</h3>
                <p>Dự báo 14 ngày · ưu tiên thiếu nhiều/rủi ro cao · tồn cập nhật mỗi phút</p>
              </div>
              <Link href="/du-bao-nhu-cau">Xem toàn bộ dự báo</Link>
            </header>
            {aiShortagesLoading ? (
              <p className="sale-ai-shortages-empty">Đang kiểm tra tồn kho…</p>
            ) : aiShortages.length ? (
              <div className="sale-ai-shortage-list">
                {aiShortages.slice(0, 8).map(item => (
                  <div className="sale-ai-shortage" key={item.skuId}>
                    <ProductImage src={item.imageUrl} name={item.productName} />
                    <span>
                      <strong>
                        {item.productName}{' '}
                        <i className={`sale-ai-priority ${item.severity?.toLowerCase() ?? 'low'}`}>
                          {item.severity === 'HIGH' ? 'Ưu tiên cao' : item.severity === 'MEDIUM' ? 'Ưu tiên vừa' : 'Theo dõi'}
                        </i>
                      </strong>
                      <small>
                        {item.productCode} · Bán lịch sử {new Intl.NumberFormat('vi-VN').format(item.observedQuantity)} · dự báo{' '}
                        {new Intl.NumberFormat('vi-VN').format(item.predictedQuantity)} {item.unit}
                      </small>
                      <small>
                        Còn {new Intl.NumberFormat('vi-VN').format(item.available)} · an toàn{' '}
                        {new Intl.NumberFormat('vi-VN').format(item.safetyStock)} · đang về{' '}
                        {new Intl.NumberFormat('vi-VN').format(item.inTransfer + item.incomingPurchase)} · cần bù{' '}
                        {new Intl.NumberFormat('vi-VN').format(item.shortageQuantity)}
                      </small>
                    </span>
                    <button type="button" disabled={!warehouseId} onClick={() => setQuery(item.productCode)}>
                      Tìm hàng
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sale-ai-shortages-empty">Chưa có sản phẩm nào được dự báo thiếu trong kỳ này.</p>
            )}
          </section>
        )}
      </details>

      {pendingPayosId && (
        <p className="suite-panel">
          Bạn có đơn thanh toán QR cần kiểm tra.{' '}
          <Link href={`/thanh-toan/payos?checkoutId=${encodeURIComponent(pendingPayosId)}`}>Mở lại thanh toán →</Link>
        </p>
      )}

      {checkoutOpen && (
        <div
          className="ui-modal"
          onMouseDown={event => {
            if (event.target === event.currentTarget && !busy) setCheckoutOpen(false);
          }}
        >
          <section className="ui-modal-card sale-checkout-modal">
            <header>
              <div>
                <h2>Thanh toán Đơn {activeTab.seq}</h2>
                <p>Khách vãng lai · {cart.length} mặt hàng</p>
              </div>
              <button type="button" disabled={busy} onClick={() => setCheckoutOpen(false)} aria-label="Đóng">
                ×
              </button>
            </header>
            <div className="sale-checkout-summary">
              <div>
                <span>Tiền hàng</span>
                <strong>{money(subtotal)}</strong>
              </div>
              <div>
                <span>Chiết khấu</span>
                <strong>{money(discountAmount)}</strong>
              </div>
              <div className="sale-bill-total">
                <span>Tổng tiền</span>
                <strong>{money(total)}</strong>
              </div>
            </div>
            <div className="sale-checkout-payment">
              <label>
                Tiền mặt cần thu
                <CurrencyInput
                  min={0}
                  max={total}
                  value={cashPayment ?? String(total)}
                  onChange={val => updateActiveTab(tab => ({ ...tab, cashPayment: val, cashTendered: null }))}
                />
              </label>
              <label>
                QR / chuyển khoản
                <CurrencyInput
                  min={0}
                  max={total}
                  value={qrPayment}
                  onChange={val => updateActiveTab(tab => ({ ...tab, qrPayment: val }))}
                />
              </label>

              {cashAmount > 0 && (
                <div className="pos-cash-calc-box is-modal">
                  <label>
                    Tiền mặt khách đưa
                    <CurrencyInput
                      min={0}
                      max={999_999_999}
                      value={cashTendered ?? String(cashAmount)}
                      onChange={val => updateActiveTab(tab => ({ ...tab, cashTendered: val }))}
                    />
                  </label>
                  {cashDenomSuggestions.length > 0 && (
                    <div className="pos-cash-denom-row" role="group" aria-label="Chọn nhanh mệnh giá tiền">
                      {cashDenomSuggestions.map(item => {
                        const isSelected = effectiveCashTendered === item.amount;
                        return (
                          <button
                            type="button"
                            key={item.amount}
                            className={`pos-cash-denom-btn${isSelected ? ' is-selected' : ''}${item.isExact ? ' is-exact' : ''}`}
                            onClick={() =>
                              updateActiveTab(tab => ({
                                ...tab,
                                cashTendered: item.isExact ? null : String(item.amount),
                              }))
                            }
                          >
                            {item.label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  <div className={`pos-cash-change-banner${cashShortfall > 0 ? ' is-short' : ''}`}>
                    <span>{cashShortfall > 0 ? 'Khách đưa còn thiếu' : 'Tiền thừa trả khách (Tiền thối)'}</span>
                    <strong>{money(cashShortfall > 0 ? cashShortfall : cashChange)}</strong>
                  </div>
                </div>
              )}

              <div className="sale-autopay">
                <span>Tổng cần thu (Tiền mặt + QR)</span>
                <strong>{money(amountToCollect)}</strong>
              </div>
              {amountToCollect !== total && (
                <p className="negative">
                  Tổng tiền mặt cần thu + QR ({money(amountToCollect)}) phải khớp đúng tổng hóa đơn ({money(total)}).
                </p>
              )}
              <label className="pos-autoprint-toggle">
                <input
                  type="checkbox"
                  checked={autoPrintReceipt}
                  onChange={event => setAutoPrintReceipt(event.target.checked)}
                />
                <span>In hóa đơn nhiệt K80 (kèm tiền thừa & mã QR đổi trả) ngay sau khi xác nhận</span>
              </label>
              <label>
                Ghi chú
                <textarea
                  maxLength={500}
                  value={note}
                  onChange={event => updateActiveTab(tab => ({ ...tab, note: event.target.value }))}
                  placeholder="Ghi chú thanh toán (không bắt buộc)"
                />
              </label>
              {qrAmount > 0 && (
                <section className="sale-bank-qr">
                  <div>
                    <strong>Quét mã để chuyển khoản</strong>
                    <span>
                      Số tiền: <b>{money(qrAmount)}</b>
                    </span>
                    <span>
                      Nội dung: <b>{transferMemo}</b>
                    </span>
                    {bankQrConfig.accountName && (
                      <span>
                        Người nhận: <b>{bankQrConfig.accountName}</b>
                      </span>
                    )}
                  </div>
                  {qrImageUrl && <img src={qrImageUrl} alt={`QR chuyển khoản ${money(qrAmount)}`} />}
                </section>
              )}
              {error && (
                <div className="ui-error" role="alert">
                  {error}
                </div>
              )}
            </div>
            <footer>
              <ActionButton tone="more" disabled={busy} onClick={() => setCheckoutOpen(false)}>
                Quay lại
              </ActionButton>
              <ActionButton
                tone="approve"
                disabled={
                  busy ||
                  amountToCollect !== total ||
                  (cashAmount > 0 && cashShortfall > 0) ||
                  (qrAmount > 0 && !bankQrReady)
                }
                onClick={() => void completeSale()}
              >
                {busy ? 'Đang lưu...' : 'Xác nhận thanh toán'}
              </ActionButton>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}

export default function Page() {
  return (
    <Protected permission="invoices.create">
      <NewInvoicePage />
    </Protected>
  );
}
