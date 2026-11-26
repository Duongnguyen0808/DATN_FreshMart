import { FEFO_POLICY_CONFIG } from './fefo-simulation.js';

export type FefoPolicyConfig = typeof FEFO_POLICY_CONFIG;
export type FefoPromoMode = 'DISCOUNT' | 'BOGO';

export type FefoPromoCalculationInput = {
  lotCode: string;
  lotQuantity: number;
  daysRemaining: number | null;
  expired: boolean;
  sellingPrice: number;
  cartQuantity: number;
  unit?: string;
  mode?: FefoPromoMode;
  policy?: FefoPolicyConfig;
};

export type FefoPromoCalculationResult = {
  eligible: boolean;
  reason?: string;
  mode: FefoPromoMode;
  promoCode: string;
  lotCode: string;
  daysRemaining: number | null;
  discountPercent: number;
  eligibleQuantity: number;
  freeQuantity: number;
  sellingPrice: number;
  discountAmount: number;
  proofSummary: string;
};

export function buildFefoPromoCode(lotCode: string): string {
  return `FEFO-${lotCode.trim().toUpperCase()}`;
}

export function buildBogoPromoCode(lotCode: string): string {
  return `BOGO-${lotCode.trim().toUpperCase()}`;
}

export function parseFefoPromoToken(promoCode: string): { mode: FefoPromoMode; lotCode: string } | null {
  const normalized = promoCode.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized.startsWith('BOGO-')) {
    const lotCode = normalized.slice(5).trim();
    return lotCode.length > 0 ? { mode: 'BOGO', lotCode } : null;
  }
  const lotCode = normalized.startsWith('FEFO-') ? normalized.slice(5).trim() : normalized;
  return lotCode.length > 0 ? { mode: 'DISCOUNT', lotCode } : null;
}

export function parseFefoPromoLotCode(promoCode: string): string | null {
  return parseFefoPromoToken(promoCode)?.lotCode ?? null;
}

export function isBogoEligibleByPolicy(
  daysRemaining: number | null,
  lotQuantity: number,
  policy: FefoPolicyConfig = FEFO_POLICY_CONFIG,
): boolean {
  return (
    daysRemaining !== null &&
    Number.isFinite(daysRemaining) &&
    daysRemaining >= 0 &&
    daysRemaining <= policy.comboPromoMaxDays &&
    lotQuantity >= 2
  );
}

export function resolveFefoDiscountPercent(
  daysRemaining: number | null,
  policy: FefoPolicyConfig = FEFO_POLICY_CONFIG,
): number {
  if (
    daysRemaining === null ||
    !Number.isFinite(daysRemaining) ||
    daysRemaining < 0 ||
    daysRemaining > policy.mediumRiskDaysThreshold
  ) {
    return 0;
  }
  const sorted = [...policy.discountSchedule].sort((a, b) => a.maxDaysRemaining - b.maxDaysRemaining);
  for (const tier of sorted) {
    if (daysRemaining <= tier.maxDaysRemaining) return tier.discountPercent;
  }
  return 0;
}

export function calculateFefoPromoDiscount(input: FefoPromoCalculationInput): FefoPromoCalculationResult {
  const policy = input.policy ?? FEFO_POLICY_CONFIG;
  const mode: FefoPromoMode = input.mode ?? 'DISCOUNT';
  const lotCode = input.lotCode.trim().toUpperCase();
  const promoCode = mode === 'BOGO' ? buildBogoPromoCode(lotCode) : buildFefoPromoCode(lotCode);
  const unit = input.unit?.trim() || 'đơn vị';

  if (input.expired || (input.daysRemaining !== null && input.daysRemaining < 0)) {
    return {
      eligible: false,
      reason: `Lô ${lotCode} đã hết hạn, hệ thống chặn xuất bán và không áp dụng mã xả cận hạn.`,
      mode,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 0,
      eligibleQuantity: 0,
      freeQuantity: 0,
      sellingPrice: input.sellingPrice,
      discountAmount: 0,
      proofSummary: '',
    };
  }

  if (mode === 'BOGO') {
    if (!isBogoEligibleByPolicy(input.daysRemaining, input.lotQuantity, policy) || input.daysRemaining === null) {
      return {
        eligible: false,
        reason: `Lô ${lotCode} chưa thuộc diện Mua 1 Tặng 1 (cần còn <= ${policy.comboPromoMaxDays} ngày và tồn lô >= 2 ${unit}).`,
        mode,
        promoCode,
        lotCode,
        daysRemaining: input.daysRemaining,
        discountPercent: 0,
        eligibleQuantity: 0,
        freeQuantity: 0,
        sellingPrice: input.sellingPrice,
        discountAmount: 0,
        proofSummary: '',
      };
    }
    if (input.cartQuantity < 2 || input.sellingPrice <= 0) {
      return {
        eligible: false,
        reason: `Chương trình Mua 1 Tặng 1 (${promoCode}) cần tối thiểu 2 ${unit} trong giỏ hàng (1 tính tiền + 1 tặng miễn phí).`,
        mode,
        promoCode,
        lotCode,
        daysRemaining: input.daysRemaining,
        discountPercent: 0,
        eligibleQuantity: 0,
        freeQuantity: 0,
        sellingPrice: input.sellingPrice,
        discountAmount: 0,
        proofSummary: '',
      };
    }
    const cappedUnits = Math.min(input.cartQuantity, input.lotQuantity);
    const freeQuantity = Math.floor(cappedUnits / 2);
    const eligibleQuantity = freeQuantity * 2;
    const discountAmount = Math.round(freeQuantity * input.sellingPrice);
    const formattedDiscount = new Intl.NumberFormat('vi-VN').format(discountAmount);
    const proofSummary = `[FEFO-BOGO ${promoCode} | Lô ${lotCode} còn ${input.daysRemaining} ngày | Mua 1 Tặng 1: tặng ${freeQuantity}/${eligibleQuantity} ${unit} = -${formattedDiscount} đ]`;
    return {
      eligible: true,
      mode,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 50,
      eligibleQuantity,
      freeQuantity,
      sellingPrice: input.sellingPrice,
      discountAmount,
      proofSummary,
    };
  }

  if (input.lotQuantity <= 0 || input.cartQuantity <= 0 || input.sellingPrice <= 0) {
    return {
      eligible: false,
      reason: `Số lượng lô (${input.lotQuantity}) hoặc số lượng mua (${input.cartQuantity}) không hợp lệ để áp mã ${promoCode}.`,
      mode,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 0,
      eligibleQuantity: 0,
      freeQuantity: 0,
      sellingPrice: input.sellingPrice,
      discountAmount: 0,
      proofSummary: '',
    };
  }

  const discountPercent = resolveFefoDiscountPercent(input.daysRemaining, policy);
  if (discountPercent <= 0 || input.daysRemaining === null) {
    return {
      eligible: false,
      reason: `Lô ${lotCode} chưa thuộc khung cận hạn cấu hình (cần còn <= 21 ngày theo chính sách FEFO).`,
      mode,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 0,
      eligibleQuantity: 0,
      freeQuantity: 0,
      sellingPrice: input.sellingPrice,
      discountAmount: 0,
      proofSummary: '',
    };
  }

  const eligibleQuantity = Math.min(input.cartQuantity, input.lotQuantity);
  const discountAmount = Math.round(eligibleQuantity * input.sellingPrice * (discountPercent / 100));
  const formattedDiscount = new Intl.NumberFormat('vi-VN').format(discountAmount);
  const proofSummary = `[FEFO-PROMO ${promoCode} | Lô ${lotCode} còn ${input.daysRemaining} ngày | Giảm ${discountPercent}% trên ${eligibleQuantity} ${unit} = -${formattedDiscount} đ]`;

  return {
    eligible: true,
    mode,
    promoCode,
    lotCode,
    daysRemaining: input.daysRemaining,
    discountPercent,
    eligibleQuantity,
    freeQuantity: 0,
    sellingPrice: input.sellingPrice,
    discountAmount,
    proofSummary,
  };
}
