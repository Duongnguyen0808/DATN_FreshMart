import { describe, expect, it } from 'vitest';
import {
  evaluateFefoTransferCandidate,
  FEFO_POLICY_CONFIG,
  simulateFefoLotsForSku,
} from './fefo-simulation.js';
import { assessShortage } from './shortage-rule.js';
import { supplyTiming } from './supply-timing.js';
import { planReplenishment } from './recommendation-plan.js';
import { expired, takeLots, warehouseToday } from '../inventory/lot-stock.js';
import { buildBogoPromoCode, buildFefoPromoCode, calculateFefoPromoDiscount, parseFefoPromoLotCode, parseFefoPromoToken } from './fefo-promo.js';

describe('FEFO × AI Demand Forecast Simulation & Inventory Balance', () => {
  it('Ví dụ tính tay 1: Mô phỏng 1 lô cận hạn trong tầm nhìn 14 ngày (FEFO × Forecast)', () => {
    /**
     * Tính tay:
     * - Dự báo 14 ngày: P_14 = 28 đv, H = 14 ngày => r = 28 / 14 = 2.0 đv/ngày
     * - Lô L1: Q_1 = 15 đv, d_1 = 5 ngày (<= 14 ngày), giá vốn c = 25.000 đ, giá bán p = 40.000 đ
     * - Nhu cầu tích lũy trong 5 ngày: D(5) = floor(2.0 * 5) = 10 đv
     * - Lượng bán dự kiến trước hạn: S_1 = min(15, 10 - 0) = 10 đv
     * - Nguy cơ dư: R_1 = max(0, 15 - 10) = 5 đv
     * - Tỷ lệ dư: u_1 = 5 / 15 = 0.3333
     * - Giá trị vốn nguy cơ dư: V_risk = 5 * 25.000 = 125.000 đ
     * - Bậc giảm giá gợi ý (d_1 = 5 <= 7): delta = 35% => p_disc = round(40.000 * 0.65) = 26.000 đ
     * - Giá trị thu hồi ước tính nếu bán hết lượng dư ở giá giảm: V_rec = 5 * 26.000 = 130.000 đ
     * - Gợi ý cân nhắc combo/BOGO có điều kiện: d_1 = 5 <= 10 => true
     */
    const [res] = simulateFefoLotsForSku(
      [
        {
          lotId: 'lot-1',
          lotCode: 'LOT-001',
          quantity: 15,
          status: 'AVAILABLE',
          daysRemaining: 5,
          costPrice: 25_000,
          sellingPrice: 40_000,
        },
      ],
      {
        hasForecastRun: true,
        dataQuality: 'SUFFICIENT',
        predictedHorizonDemand: 28,
        horizonDays: 14,
      }
    );

    expect(res).toBeDefined();
    expect(res!.dailyForecastRate).toBe(2);
    expect(res!.evaluatedDays).toBe(5);
    expect(res!.projectedSoldBeforeExpiry).toBe(10);
    expect(res!.atRiskQuantity).toBe(5);
    expect(res!.unsoldRatio).toBe(0.3333);
    expect(res!.atRiskValue).toBe(125_000);
    expect(res!.suggestedDiscountPercent).toBe(35);
    expect(res!.discountedPrice).toBe(26_000);
    expect(res!.recoverableValue).toBe(130_000);
    expect(res!.riskLevel).toBe('CRITICAL');
    expect(res!.allocationStatus).toBe('EVALUATED_WITHIN_HORIZON');
    expect(res!.beyondHorizon).toBe(false);
    expect(res!.hasValidForecast).toBe(true);
    expect(res!.conditionalComboSuggestion).toBe(true);
  });

  it('Ví dụ tính tay 2: Phân bổ FEFO nhiều lô liên tiếp — không tính trùng nhu cầu và không trừ nhầm phần đã hết hạn của lô trước', () => {
    /**
     * Tính tay:
     * - Dự báo 14 ngày: P_14 = 28 đv, H = 14 ngày => r = 2.0 đv/ngày
     * - Lô 1 (hết hạn sau d_1 = 4 ngày): Q_1 = 20 đv
     *   + D(4) = floor(2.0 * 4) = 8 đv
     *   + S_1 = min(20, 8 - 0) = 8 đv
     *   + R_1 = max(0, 20 - 8) = 12 đv (12 đv này hết hạn sau ngày thứ 4, KHÔNG được chiếm cầu của ngày 5..10)
     *   + C_1 = consumedDemandSoFar = 8 đv
     * - Lô 2 (hết hạn sau d_2 = 10 ngày): Q_2 = 15 đv
     *   + D(10) = floor(2.0 * 10) = 20 đv
     *   + Cầu còn lại cho Lô 2 (từ ngày 5 đến ngày 10): D_rem,2 = max(0, 20 - C_1) = 20 - 8 = 12 đv
     *   + S_2 = min(15, 12) = 12 đv
     *   + R_2 = max(0, 15 - 12) = 3 đv
     *   + Tổng bán dự kiến 2 lô trong 10 ngày: S_1 + S_2 = 8 + 12 = 20 đv = D(10) (không vượt tổng cầu, không tính trùng).
     */
    const [lot1, lot2] = simulateFefoLotsForSku(
      [
        {
          lotId: 'lot-1',
          lotCode: 'LOT-EARLY',
          quantity: 20,
          status: 'AVAILABLE',
          daysRemaining: 4,
          costPrice: 10_000,
          sellingPrice: 15_000,
        },
        {
          lotId: 'lot-2',
          lotCode: 'LOT-LATER',
          quantity: 15,
          status: 'AVAILABLE',
          daysRemaining: 10,
          costPrice: 10_000,
          sellingPrice: 15_000,
        },
      ],
      {
        hasForecastRun: true,
        dataQuality: 'SUFFICIENT',
        predictedHorizonDemand: 28,
        horizonDays: 14,
      }
    );

    expect(lot1).toBeDefined();
    expect(lot2).toBeDefined();

    expect(lot1!.priorConsumedDemand).toBe(0);
    expect(lot1!.projectedSoldBeforeExpiry).toBe(8);
    expect(lot1!.atRiskQuantity).toBe(12);

    expect(lot2!.priorLotsQuantity).toBe(20);
    expect(lot2!.priorConsumedDemand).toBe(8);
    expect(lot2!.projectedSoldBeforeExpiry).toBe(12);
    expect(lot2!.atRiskQuantity).toBe(3);
    expect(lot1!.projectedSoldBeforeExpiry + lot2!.projectedSoldBeforeExpiry).toBe(20);
  });

  it('Ví dụ tính tay 3: Đồng nhất mốc hết hạn với POS (daysRemaining = 0 còn bán được trong ngày; daysRemaining < 0 bị khóa)', () => {
    const [expiredLot, todayLot] = simulateFefoLotsForSku(
      [
        {
          lotId: 'lot-expired',
          lotCode: 'LOT-EXP',
          quantity: 10,
          status: 'AVAILABLE',
          daysRemaining: -1,
          costPrice: 20_000,
          sellingPrice: 30_000,
        },
        {
          lotId: 'lot-today',
          lotCode: 'LOT-TODAY',
          quantity: 5,
          status: 'AVAILABLE',
          daysRemaining: 0,
          costPrice: 20_000,
          sellingPrice: 30_000,
        },
      ],
      {
        hasForecastRun: true,
        dataQuality: 'SUFFICIENT',
        predictedHorizonDemand: 42, // 3 đv/ngày
        horizonDays: 14,
      }
    );

    expect(expiredLot!.projectedSoldBeforeExpiry).toBe(0);
    expect(expiredLot!.atRiskQuantity).toBe(10);
    expect(expiredLot!.riskLevel).toBe('EXPIRED');
    expect(expiredLot!.allocationStatus).toBe('EXPIRED_OR_QUARANTINED');

    expect(todayLot!.priorConsumedDemand).toBe(0);
    expect(todayLot!.evaluatedDays).toBe(1);
    expect(todayLot!.projectedSoldBeforeExpiry).toBe(3);
    expect(todayLot!.atRiskQuantity).toBe(2);
    expect(todayLot!.riskLevel).toBe('CRITICAL');
  });

  it('Ví dụ tính tay 4: Giới hạn tầm nhìn dự báo (Horizon = 14 ngày) — không ngoại suy để kết luận dư thừa cho lô còn 25 ngày', () => {
    const [res] = simulateFefoLotsForSku(
      [
        {
          lotId: 'lot-far',
          lotCode: 'LOT-FAR',
          quantity: 40,
          status: 'AVAILABLE',
          daysRemaining: 25,
          costPrice: 12_000,
          sellingPrice: 18_000,
        },
      ],
      {
        hasForecastRun: true,
        dataQuality: 'SUFFICIENT',
        predictedHorizonDemand: 14,
        horizonDays: 14,
      }
    );

    expect(res!.beyondHorizon).toBe(true);
    expect(res!.allocationStatus).toBe('BEYOND_FORECAST_HORIZON');
    expect(res!.evaluatedDays).toBe(14);
    expect(res!.projectedSoldBeforeExpiry).toBe(14);
    expect(res!.atRiskQuantity).toBe(0);
    expect(res!.riskLevel).toBe('SAFE');
    expect(res!.suggestedDiscountPercent).toBe(0);
  });

  it('Ví dụ tính tay 5: SKU chưa có dự báo hoặc NO_SALES — không tạo dự báo giả và không báo dư thừa giả', () => {
    const [noRun] = simulateFefoLotsForSku(
      [
        {
          lotId: 'lot-no-run',
          lotCode: 'LOT-NR',
          quantity: 25,
          status: 'AVAILABLE',
          daysRemaining: 6,
          costPrice: 10_000,
          sellingPrice: 15_000,
        },
      ],
      {
        hasForecastRun: false,
        dataQuality: null,
        predictedHorizonDemand: 0,
        horizonDays: 14,
      }
    );

    const [noSales] = simulateFefoLotsForSku(
      [
        {
          lotId: 'lot-no-sales',
          lotCode: 'LOT-NS',
          quantity: 25,
          status: 'AVAILABLE',
          daysRemaining: 6,
          costPrice: 10_000,
          sellingPrice: 15_000,
        },
      ],
      {
        hasForecastRun: true,
        dataQuality: 'NO_SALES',
        predictedHorizonDemand: 0,
        horizonDays: 14,
      }
    );

    expect(noRun!.hasValidForecast).toBe(false);
    expect(noRun!.allocationStatus).toBe('NO_FORECAST_RUN');
    expect(noRun!.atRiskQuantity).toBe(0);

    expect(noSales!.hasValidForecast).toBe(false);
    expect(noSales!.allocationStatus).toBe('NO_SALES_HISTORY');
    expect(noSales!.atRiskQuantity).toBe(0);
  });

  it('Ví dụ tính tay 6: Đánh giá điều chuyển nội bộ — xét tồn an toàn kho nguồn, 2 ngày vận chuyển và tồn FEFO cạnh tranh tại kho nhận', () => {
    const evalResult = evaluateFefoTransferCandidate({
      atRiskQuantity: 12,
      lotQuantity: 20,
      daysRemaining: 9,
      horizonDays: 14,
      sourceDailyRate: 1.0,
      sourceOnHand: 30,
      sourceReserved: 2,
      sourceSafetyStock: 10,
      sourceBlockedLotQty: 0,
      sourceCommittedOutboundQty: 3,
      destinationDailyRate: 3.0,
      destinationHasValidForecast: true,
      destinationCompetingStockBeforeExpiry: 16,
      transitDays: FEFO_POLICY_CONFIG.transferTransitDays,
    });

    expect(evalResult.maxTransferableFromSource).toBe(12);
    expect(evalResult.destSellableDaysAfterTransit).toBe(7);
    expect(evalResult.netDestinationCapacity).toBe(11);
    expect(evalResult.absorbableQuantity).toBe(11);
    expect(evalResult.eligible).toBe(true);

    const saturatedDest = evaluateFefoTransferCandidate({
      atRiskQuantity: 12,
      lotQuantity: 20,
      daysRemaining: 9,
      horizonDays: 14,
      sourceDailyRate: 1.0,
      sourceOnHand: 30,
      sourceReserved: 2,
      sourceSafetyStock: 10,
      sourceBlockedLotQty: 0,
      sourceCommittedOutboundQty: 3,
      destinationDailyRate: 3.0,
      destinationHasValidForecast: true,
      destinationCompetingStockBeforeExpiry: 30,
    });
    expect(saturatedDest.netDestinationCapacity).toBe(0);
    expect(saturatedDest.absorbableQuantity).toBe(0);
    expect(saturatedDest.eligible).toBe(false);
  });

  it('Ví dụ tính tay 7: Công thức cân bằng tồn kho thiếu hụt (assessShortage), cung ứng (supplyTiming) và kế hoạch nhập/chuyển (planReplenishment)', () => {
    const shortage = assessShortage({
      predictedQuantity: 40,
      available: 18,
      safetyStock: 10,
      inTransfer: 3,
      incomingPurchase: 4,
    });
    expect(shortage.required).toBe(50);
    expect(shortage.plannedSupply).toBe(25);
    expect(shortage.shortageQuantity).toBe(25);
    expect(shortage.severity).toBe('HIGH');

    const timing = supplyTiming({
      predictedQuantity: 28,
      horizonDays: 14,
      available: 5,
      safetyStock: 6,
      leadTimeDays: 4,
      packSize: 12,
      shortage: 25,
      receipts: [],
    });
    expect(timing.dailyDemand).toBe(2);
    expect(timing.firstShortageDay).toBe(2);
    expect(timing.leadTimeNeed).toBe(9);
    expect(timing.orderNow).toBe(true);
    expect(timing.urgent).toBe(true);
    expect(timing.suggestedPacks).toBe(3);
    expect(timing.roundedPurchaseQuantity).toBe(36);

    const plan = planReplenishment(25, [{ warehouseId: 'wh-source-1', surplus: 15 }]);
    expect(plan.transfers).toEqual([{ sourceWarehouseId: 'wh-source-1', quantity: 15 }]);
    expect(plan.purchaseQuantity).toBe(10);
  });

  it('Kiểm thử tích hợp logic xuất lô POS (takeLots): chặn xuất lô quá hạn/cách ly và trừ tồn đúng thứ tự FEFO', async () => {
    const today = warehouseToday();
    const yesterday = new Date(today.getTime() - 86_400_000);
    const in3Days = new Date(today.getTime() + 3 * 86_400_000);
    const in10Days = new Date(today.getTime() + 10 * 86_400_000);

    expect(expired(yesterday)).toBe(true);
    expect(expired(today)).toBe(false);
    expect(expired(in3Days)).toBe(false);

    const mockLots = [
      {
        id: 'lot-expired',
        code: 'LOT-EXP',
        quantity: 50,
        status: 'AVAILABLE',
        expiresAt: yesterday,
        createdAt: new Date('2026-01-01T00:00:00Z'),
      },
      {
        id: 'lot-quarantine',
        code: 'LOT-HOLD',
        quantity: 50,
        status: 'QUARANTINE',
        expiresAt: in3Days,
        createdAt: new Date('2026-01-02T00:00:00Z'),
      },
      {
        id: 'lot-fefo-1',
        code: 'LOT-SOON',
        quantity: 4,
        status: 'AVAILABLE',
        expiresAt: in3Days,
        createdAt: new Date('2026-01-03T00:00:00Z'),
      },
      {
        id: 'lot-fefo-2',
        code: 'LOT-LATER',
        quantity: 6,
        status: 'AVAILABLE',
        expiresAt: in10Days,
        createdAt: new Date('2026-01-04T00:00:00Z'),
      },
    ];

    const movements: { lotId: string; quantity: number }[] = [];
    const updatedQuantities = new Map<string, number>();

    const mockTx = {
      inventory: {
        findUniqueOrThrow: async () => ({ id: 'inv-1', warehouseId: 'wh-1', skuId: 'sku-1', onHand: 110, reserved: 0 }),
      },
      inventoryLot: {
        findMany: async () => [...mockLots],
        update: async ({ where, data }: { where: { id: string }; data: { quantity: { decrement: number } } }) => {
          const lot = mockLots.find(l => l.id === where.id)!;
          lot.quantity -= data.quantity.decrement;
          updatedQuantities.set(where.id, lot.quantity);
        },
      },
      lotMovement: {
        create: async ({ data }: { data: { lotId: string; quantity: number } }) => {
          movements.push({ lotId: data.lotId, quantity: data.quantity });
        },
      },
    };

    await takeLots(mockTx as never, 'inv-1', 7, 'SALE', 'HD-TEST-001', 'user-1');

    expect(movements).toEqual([
      { lotId: 'lot-fefo-1', quantity: -4 },
      { lotId: 'lot-fefo-2', quantity: -3 },
    ]);
    expect(updatedQuantities.get('lot-fefo-1')).toBe(0);
    expect(updatedQuantities.get('lot-fefo-2')).toBe(3);

    await expect(
      takeLots(mockTx as never, 'inv-1', 5, 'SALE', 'HD-TEST-002', 'user-1')
    ).rejects.toMatchObject({
      status: 409,
      code: 'LOT_STOCK_UNAVAILABLE',
    });
  });

  it('Ví dụ tính tay 9: Mã xả cận hạn FEFO tại POS — giới hạn theo tồn lô thực tế và tạo minh chứng', () => {
    /**
     * Tính tay:
     * Lô LOT-MILK-01 còn 5 hộp, hạn còn 6 ngày (<= 7 ngày -> mức giảm cấu hình 35%).
     * Giá bán = 30.000 đ/hộp. Khách mua 8 hộp (5 hộp từ lô cận hạn + 3 hộp từ lô mới).
     * Số lượng được giảm giá tối đa = min(8, 5) = 5 hộp.
     * Tiền giảm = round(5 × 30.000 × 35%) = 52.500 đ.
     */
    expect(buildFefoPromoCode('lot-milk-01')).toBe('FEFO-LOT-MILK-01');
    expect(parseFefoPromoLotCode('fefo-lot-milk-01')).toBe('LOT-MILK-01');

    const res = calculateFefoPromoDiscount({
      lotCode: 'LOT-MILK-01',
      lotQuantity: 5,
      daysRemaining: 6,
      expired: false,
      sellingPrice: 30_000,
      cartQuantity: 8,
      unit: 'hộp',
    });

    expect(res.eligible).toBe(true);
    expect(res.promoCode).toBe('FEFO-LOT-MILK-01');
    expect(res.discountPercent).toBe(35);
    expect(res.eligibleQuantity).toBe(5);
    expect(res.discountAmount).toBe(52_500);
    expect(res.proofSummary).toContain('FEFO-LOT-MILK-01');
    expect(res.proofSummary).toContain('còn 6 ngày');
    expect(res.proofSummary).toContain('35%');
  });

  it('Từ chối áp mã xả cận hạn cho lô đã hết hạn hoặc ngoài ngưỡng cận hạn 21 ngày', () => {
    const expiredLot = calculateFefoPromoDiscount({
      lotCode: 'LOT-EXP',
      lotQuantity: 10,
      daysRemaining: -1,
      expired: true,
      sellingPrice: 25_000,
      cartQuantity: 2,
    });
    expect(expiredLot.eligible).toBe(false);
    expect(expiredLot.discountAmount).toBe(0);

    const farLot = calculateFefoPromoDiscount({
      lotCode: 'LOT-FAR',
      lotQuantity: 10,
      daysRemaining: 25,
      expired: false,
      sellingPrice: 25_000,
      cartQuantity: 2,
    });
    expect(farLot.eligible).toBe(false);
    expect(farLot.discountAmount).toBe(0);
  });

  it('Ví dụ tính tay 10: Mã Mua 1 Tặng 1 (BOGO) cho lô cận hạn <= 10 ngày tại POS', () => {
    expect(buildBogoPromoCode('lot-yogurt-02')).toBe('BOGO-LOT-YOGURT-02');
    expect(parseFefoPromoToken('bogo-lot-yogurt-02')).toEqual({ mode: 'BOGO', lotCode: 'LOT-YOGURT-02' });
    expect(parseFefoPromoLotCode('bogo-lot-yogurt-02')).toBe('LOT-YOGURT-02');

    // Lô còn 5 hộp, hạn 8 ngày (<= 10 ngày), giá 20.000đ. Khách lấy 5 hộp -> tối đa 2 cặp (4 hộp), tặng 2 hộp (-40.000đ)
    const bogoOk = calculateFefoPromoDiscount({
      lotCode: 'LOT-YOGURT-02',
      lotQuantity: 5,
      daysRemaining: 8,
      expired: false,
      sellingPrice: 20_000,
      cartQuantity: 5,
      unit: 'hộp',
      mode: 'BOGO',
    });
    expect(bogoOk.eligible).toBe(true);
    expect(bogoOk.mode).toBe('BOGO');
    expect(bogoOk.promoCode).toBe('BOGO-LOT-YOGURT-02');
    expect(bogoOk.freeQuantity).toBe(2);
    expect(bogoOk.eligibleQuantity).toBe(4);
    expect(bogoOk.discountAmount).toBe(40_000);

    // Nếu giỏ mới có 1 hộp thì yêu cầu tối thiểu 2 hộp (1 mua + 1 tặng)
    const singleItem = calculateFefoPromoDiscount({
      lotCode: 'LOT-YOGURT-02',
      lotQuantity: 5,
      daysRemaining: 8,
      expired: false,
      sellingPrice: 20_000,
      cartQuantity: 1,
      unit: 'hộp',
      mode: 'BOGO',
    });
    expect(singleItem.eligible).toBe(false);
  });
});
