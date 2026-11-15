/**
 * Module mô phỏng phân bổ FEFO kết hợp Dự báo nhu cầu AI (FEFO × Demand Forecast)
 *
 * Phân loại rõ 3 nhóm công thức / quy tắc:
 * 1. Phương pháp chuẩn quốc tế / học thuật:
 *    - Nguyên tắc FEFO (First-Expired, First-Out): WHO Warehouse & Stock Management; GS1 Retail Systems Playbook.
 *    - Dự báo chuỗi thời gian & Horizon đánh giá: Hyndman & Athanasopoulos (FPP2); M5 Forecasting Benchmark.
 * 2. Công thức cân bằng tồn kho (Inventory Balance Identities):
 *    - Khấu trừ nhu cầu lũy kế theo thứ tự hạn dùng (không phân bổ trùng nhu cầu giữa các lô, không cộng tồn đã hết hạn).
 *    - Ràng buộc khả năng hấp thụ ròng tại kho nhận sau thời gian vận chuyển và các lô FEFO cạnh tranh tại kho nhận.
 * 3. Quy tắc nghiệp vụ cấu hình (Configurable Heuristic Policy Rules):
 *    - Ngưỡng cảnh báo ngày cận hạn, bậc giảm giá gợi ý, gợi ý khuyến mãi mua kèm/mua 1 tặng 1 có điều kiện.
 *    - Lưu ý: Các ngưỡng này là tham số cấu hình vận hành, KHÔNG phải kết quả mô hình AI học được độ co giãn khuyến mãi.
 */

export const FEFO_POLICY_CONFIG = {
  /** Ngưỡng ngày còn lại để phân loại mức độ ưu tiên xử lý (tham số cấu hình nghiệp vụ) */
  criticalDaysThreshold: 7,
  highRiskDaysThreshold: 14,
  mediumRiskDaysThreshold: 21,

  /** Bậc giảm giá gợi ý theo số ngày còn lại (tham số chính sách bán lẻ) */
  discountSchedule: [
    { maxDaysRemaining: 7, discountPercent: 35 },
    { maxDaysRemaining: 14, discountPercent: 25 },
    { maxDaysRemaining: 21, discountPercent: 15 },
    { maxDaysRemaining: Number.POSITIVE_INFINITY, discountPercent: 10 },
  ],

  /** Ngưỡng gợi ý cân nhắc chương trình xả nhanh (ví dụ: mua kèm / mua 1 tặng 1 có điều kiện) */
  comboPromoMaxDays: 10,
  comboPromoMinUnsoldRatio: 0.45,

  /** Tham số cấu hình điều chuyển nội bộ xả lô cận hạn */
  transferMinDailyDemandRatio: 1.4,
  transferMinDailyDemandFloor: 2,
  transferTransitDays: 2,
  transferMinUnits: 3,
} as const;

export type ForecastAllocationStatus =
  | 'EVALUATED_WITHIN_HORIZON'
  | 'BEYOND_FORECAST_HORIZON'
  | 'NO_FORECAST_RUN'
  | 'NO_SALES_HISTORY'
  | 'EXPIRED_OR_QUARANTINED';

export type LotSimulationInput = {
  lotId: string;
  lotCode: string;
  quantity: number;
  status: string;
  daysRemaining: number;
  costPrice: number;
  sellingPrice: number;
};

export type LotSimulationForecastInput = {
  hasForecastRun: boolean;
  dataQuality: 'SUFFICIENT' | 'SPARSE' | 'NO_SALES' | null;
  predictedHorizonDemand: number;
  horizonDays: number;
};

export type LotSimulationResult = {
  lotId: string;
  daysRemaining: number;
  lotQuantity: number;
  priorLotsQuantity: number;
  priorConsumedDemand: number;
  evaluatedDays: number;
  dailyForecastRate: number;
  projectedSoldBeforeExpiry: number;
  atRiskQuantity: number;
  unsoldRatio: number;
  atRiskValue: number;
  suggestedDiscountPercent: number;
  discountedPrice: number;
  recoverableValue: number;
  riskLevel: 'EXPIRED' | 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'SAFE';
  allocationStatus: ForecastAllocationStatus;
  beyondHorizon: boolean;
  hasValidForecast: boolean;
  conditionalComboSuggestion: boolean;
};

/**
 * Mô phỏng phân bổ nhu cầu theo nguyên tắc FEFO cho danh sách lô của cùng một SKU (đã sắp xếp theo hạn dùng tăng dần).
 *
 * Quy tắc:
 * - Đồng nhất mốc hết hạn với POS (`lot-stock.ts`): `daysRemaining < 0` là đã hết hạn (bị chặn bán tại POS).
 *   Khi `daysRemaining === 0` (đúng ngày in trên bao bì), lô vẫn được phép bán hết ngày hôm đó (tương đương 1 ngày bán cuối).
 * - Chỉ đánh giá kết luận `atRiskQuantity` khi có dự báo hợp lệ (`hasForecastRun && dataQuality !== 'NO_SALES'`)
 *   và hạn dùng nằm trong tầm nhìn dự báo (`daysRemaining <= horizonDays`).
 * - Không bao giờ phân bổ trùng nhu cầu giữa các lô: lô sau chỉ nhận phần nhu cầu còn lại sau khi trừ
 *   `consumedDemandSoFar` (lượng thực tế các lô trước bán được, KHÔNG trừ phần tồn dư bị hết hạn của lô trước).
 */
export function simulateFefoLotsForSku(
  lots: LotSimulationInput[],
  forecast: LotSimulationForecastInput
): LotSimulationResult[] {
  const horizonDays = Math.max(1, forecast.horizonDays);
  const hasValidForecast =
    forecast.hasForecastRun &&
    forecast.dataQuality !== null &&
    forecast.dataQuality !== 'NO_SALES' &&
    forecast.predictedHorizonDemand >= 0;

  const dailyRate = hasValidForecast ? forecast.predictedHorizonDemand / horizonDays : 0;

  let cumulativePriorAvailableLotQty = 0;
  let consumedDemandSoFar = 0;

  return lots.map(lot => {
    const lotQty = Math.max(0, lot.quantity);
    const isExpiredOrQuarantined = lot.daysRemaining < 0 || lot.status !== 'AVAILABLE';
    const priorLotsQuantity = cumulativePriorAvailableLotQty;
    const priorConsumedDemand = consumedDemandSoFar;

    if (isExpiredOrQuarantined) {
      const atRiskQuantity = lotQty;
      const atRiskValue = atRiskQuantity * lot.costPrice;
      return {
        lotId: lot.lotId,
        daysRemaining: lot.daysRemaining,
        lotQuantity: lotQty,
        priorLotsQuantity,
        priorConsumedDemand,
        evaluatedDays: 0,
        dailyForecastRate: Number(dailyRate.toFixed(2)),
        projectedSoldBeforeExpiry: 0,
        atRiskQuantity,
        unsoldRatio: lotQty > 0 ? 1 : 0,
        atRiskValue,
        suggestedDiscountPercent: 0,
        discountedPrice: lot.sellingPrice,
        recoverableValue: 0,
        riskLevel: 'EXPIRED',
        allocationStatus: 'EXPIRED_OR_QUARANTINED',
        beyondHorizon: false,
        hasValidForecast,
        conditionalComboSuggestion: false,
      };
    }

    cumulativePriorAvailableLotQty += lotQty;

    if (!forecast.hasForecastRun || forecast.dataQuality === null) {
      return {
        lotId: lot.lotId,
        daysRemaining: lot.daysRemaining,
        lotQuantity: lotQty,
        priorLotsQuantity,
        priorConsumedDemand,
        evaluatedDays: 0,
        dailyForecastRate: 0,
        projectedSoldBeforeExpiry: 0,
        atRiskQuantity: 0,
        unsoldRatio: 0,
        atRiskValue: 0,
        suggestedDiscountPercent: 0,
        discountedPrice: lot.sellingPrice,
        recoverableValue: 0,
        riskLevel: 'SAFE',
        allocationStatus: 'NO_FORECAST_RUN',
        beyondHorizon: lot.daysRemaining > horizonDays,
        hasValidForecast: false,
        conditionalComboSuggestion: false,
      };
    }

    if (forecast.dataQuality === 'NO_SALES') {
      return {
        lotId: lot.lotId,
        daysRemaining: lot.daysRemaining,
        lotQuantity: lotQty,
        priorLotsQuantity,
        priorConsumedDemand,
        evaluatedDays: 0,
        dailyForecastRate: 0,
        projectedSoldBeforeExpiry: 0,
        atRiskQuantity: 0,
        unsoldRatio: 0,
        atRiskValue: 0,
        suggestedDiscountPercent: 0,
        discountedPrice: lot.sellingPrice,
        recoverableValue: 0,
        riskLevel: 'SAFE',
        allocationStatus: 'NO_SALES_HISTORY',
        beyondHorizon: lot.daysRemaining > horizonDays,
        hasValidForecast: false,
        conditionalComboSuggestion: false,
      };
    }

    const beyondHorizon = lot.daysRemaining > horizonDays;
    // Khi daysRemaining === 0, lô vẫn được bán đến hết ngày hiện tại tại POS (1 ngày bán thực tế).
    const sellableWindowDays = lot.daysRemaining === 0 ? 1 : Math.min(lot.daysRemaining, horizonDays);
    const cumulativeDemandAtWindow = Math.floor(dailyRate * sellableWindowDays);
    const remainingDemandForLot = Math.max(0, cumulativeDemandAtWindow - consumedDemandSoFar);
    const projectedSoldBeforeExpiry = Math.min(lotQty, remainingDemandForLot);

    consumedDemandSoFar += projectedSoldBeforeExpiry;

    // Không ngoại suy ngoài horizonDays để kết luận chắc chắn lô bị dư thừa
    const atRiskQuantity = beyondHorizon ? 0 : Math.max(0, lotQty - projectedSoldBeforeExpiry);
    const unsoldRatio = lotQty > 0 ? Number((atRiskQuantity / lotQty).toFixed(4)) : 0;
    const atRiskValue = atRiskQuantity * lot.costPrice;

    const discountRule = FEFO_POLICY_CONFIG.discountSchedule.find(
      rule => lot.daysRemaining <= rule.maxDaysRemaining
    )!;
    const suggestedDiscountPercent = atRiskQuantity > 0 ? discountRule.discountPercent : 0;
    const discountedPrice = Math.round(lot.sellingPrice * (1 - suggestedDiscountPercent / 100));
    const recoverableValue = atRiskQuantity * discountedPrice;

    let riskLevel: LotSimulationResult['riskLevel'] = 'SAFE';
    if (atRiskQuantity > 0) {
      if (lot.daysRemaining <= FEFO_POLICY_CONFIG.criticalDaysThreshold) {
        riskLevel = 'CRITICAL';
      } else if (lot.daysRemaining <= FEFO_POLICY_CONFIG.highRiskDaysThreshold) {
        riskLevel = 'HIGH';
      } else {
        riskLevel = 'MEDIUM';
      }
    }

    const conditionalComboSuggestion =
      atRiskQuantity > 0 &&
      (lot.daysRemaining <= FEFO_POLICY_CONFIG.comboPromoMaxDays ||
        unsoldRatio >= FEFO_POLICY_CONFIG.comboPromoMinUnsoldRatio);

    return {
      lotId: lot.lotId,
      daysRemaining: lot.daysRemaining,
      lotQuantity: lotQty,
      priorLotsQuantity,
      priorConsumedDemand,
      evaluatedDays: sellableWindowDays,
      dailyForecastRate: Number(dailyRate.toFixed(2)),
      projectedSoldBeforeExpiry,
      atRiskQuantity,
      unsoldRatio,
      atRiskValue,
      suggestedDiscountPercent,
      discountedPrice,
      recoverableValue,
      riskLevel,
      allocationStatus: beyondHorizon ? 'BEYOND_FORECAST_HORIZON' : 'EVALUATED_WITHIN_HORIZON',
      beyondHorizon,
      hasValidForecast: true,
      conditionalComboSuggestion,
    };
  });
}

export type TransferCandidateEvaluationInput = {
  atRiskQuantity: number;
  lotQuantity: number;
  daysRemaining: number;
  horizonDays: number;
  sourceDailyRate: number;
  sourceOnHand: number;
  sourceReserved: number;
  sourceSafetyStock: number;
  sourceBlockedLotQty: number;
  sourceCommittedOutboundQty: number;
  destinationDailyRate: number;
  destinationHasValidForecast: boolean;
  /** Tổng tồn các lô AVAILABLE tại kho nhận có hạn dùng <= hạn dùng của lô đang xét + tồn đang chuyển về kho nhận */
  destinationCompetingStockBeforeExpiry: number;
  transitDays?: number;
};

/**
 * Tính lượng hàng tối đa có thể điều chuyển sang kho nhận sao cho:
 * 1. Không xâm phạm tồn an toàn, hàng giữ chỗ, lô bị khóa và phiếu xuất đang chờ tại kho nguồn.
 * 2. Trừ thời gian vận chuyển (`transitDays`, mặc định 2 ngày).
 * 3. Trừ lượng tồn FEFO cạnh tranh tại kho nhận (`destinationCompetingStockBeforeExpiry`) sẽ được bán trước hoặc cùng hạn.
 * 4. Đảm bảo kho nhận có dự báo hợp lệ và tốc độ bán dự báo cao hơn rõ rệt (`>= max(2, 1.4 * sourceDailyRate)`).
 */
export function evaluateFefoTransferCandidate(input: TransferCandidateEvaluationInput): {
  eligible: boolean;
  maxTransferableFromSource: number;
  destSellableDaysAfterTransit: number;
  netDestinationCapacity: number;
  absorbableQuantity: number;
} {
  const transitDays = input.transitDays ?? FEFO_POLICY_CONFIG.transferTransitDays;
  const effectiveHorizon = Math.min(Math.max(0, input.daysRemaining), Math.max(1, input.horizonDays));
  const destSellableDaysAfterTransit = Math.max(0, effectiveHorizon - transitDays);

  const sourceTransferableAboveSafety = Math.max(
    0,
    input.sourceOnHand -
      input.sourceReserved -
      input.sourceBlockedLotQty -
      input.sourceSafetyStock -
      input.sourceCommittedOutboundQty
  );
  const maxTransferableFromSource = Math.min(
    Math.max(0, input.atRiskQuantity),
    Math.max(0, input.lotQuantity),
    sourceTransferableAboveSafety
  );

  if (
    !input.destinationHasValidForecast ||
    maxTransferableFromSource <= 0 ||
    destSellableDaysAfterTransit <= 0
  ) {
    return {
      eligible: false,
      maxTransferableFromSource,
      destSellableDaysAfterTransit,
      netDestinationCapacity: 0,
      absorbableQuantity: 0,
    };
  }

  const minTargetDailyRate = Math.max(
    FEFO_POLICY_CONFIG.transferMinDailyDemandFloor,
    input.sourceDailyRate * FEFO_POLICY_CONFIG.transferMinDailyDemandRatio
  );

  if (input.destinationDailyRate < minTargetDailyRate) {
    return {
      eligible: false,
      maxTransferableFromSource,
      destSellableDaysAfterTransit,
      netDestinationCapacity: 0,
      absorbableQuantity: 0,
    };
  }

  // Trong thời gian vận chuyển (transitDays), kho đích tự tiêu thụ một phần tồn cạnh tranh hiện có của chính nó
  const consumedAtDestDuringTransit = Math.floor(input.destinationDailyRate * transitDays);
  const remainingCompetingAtDestOnArrival = Math.max(
    0,
    input.destinationCompetingStockBeforeExpiry - consumedAtDestDuringTransit
  );

  const grossDestDemandAfterArrival = Math.floor(
    input.destinationDailyRate * destSellableDaysAfterTransit
  );
  const netDestinationCapacity = Math.max(
    0,
    grossDestDemandAfterArrival - remainingCompetingAtDestOnArrival
  );

  const absorbableQuantity = Math.min(maxTransferableFromSource, netDestinationCapacity);
  const minRequiredUnits = Math.min(
    Math.max(1, input.atRiskQuantity),
    FEFO_POLICY_CONFIG.transferMinUnits
  );

  return {
    eligible: absorbableQuantity >= minRequiredUnits,
    maxTransferableFromSource,
    destSellableDaysAfterTransit,
    netDestinationCapacity,
    absorbableQuantity,
  };
}
