import { FEFO_POLICY_CONFIG } from './fefo-simulation.js';

export type FefoPolicyConfig = typeof FEFO_POLICY_CONFIG;

export type FefoPromoCalculationInput = {
  lotCode: string;
  lotQuantity: number;
  daysRemaining: number | null;
  expired: boolean;
  sellingPrice: number;
  cartQuantity: number;
  unit?: string;
  policy?: FefoPolicyConfig;
};

export type FefoPromoCalculationResult = {
  eligible: boolean;
  reason?: string;
  promoCode: string;
  lotCode: string;
  daysRemaining: number | null;
  discountPercent: number;
  eligibleQuantity: number;
  sellingPrice: number;
  discountAmount: number;
  proofSummary: string;
};

export function buildFefoPromoCode(lotCode: string): string {
  return `FEFO-${lotCode.trim().toUpperCase()}`;
}

export function parseFefoPromoLotCode(promoCode: string): string | null {
  const normalized = promoCode.trim().toUpperCase();
  if (!normalized) return null;
  const lotCode = normalized.startsWith('FEFO-') ? normalized.slice(5).trim() : normalized;
  return lotCode.length > 0 ? lotCode : null;
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
  const lotCode = input.lotCode.trim().toUpperCase();
  const promoCode = buildFefoPromoCode(lotCode);
  const unit = input.unit?.trim() || 'đơn vị';

  if (input.expired || (input.daysRemaining !== null && input.daysRemaining < 0)) {
    return {
      eligible: false,
      reason: `Lô ${lotCode} đã hết hạn, hệ thống chặn xuất bán và không áp dụng mã xả cận hạn.`,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 0,
      eligibleQuantity: 0,
      sellingPrice: input.sellingPrice,
      discountAmount: 0,
      proofSummary: '',
    };
  }

  if (input.lotQuantity <= 0 || input.cartQuantity <= 0 || input.sellingPrice <= 0) {
    return {
      eligible: false,
      reason: `Số lượng lô (${input.lotQuantity}) hoặc số lượng mua (${input.cartQuantity}) không hợp lệ để áp mã ${promoCode}.`,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 0,
      eligibleQuantity: 0,
      sellingPrice: input.sellingPrice,
      discountAmount: 0,
      proofSummary: '',
    };
  }

  const discountPercent = resolveFefoDiscountPercent(input.daysRemaining, input.policy ?? FEFO_POLICY_CONFIG);
  if (discountPercent <= 0 || input.daysRemaining === null) {
    return {
      eligible: false,
      reason: `Lô ${lotCode} chưa thuộc khung cận hạn cấu hình (cần còn <= 21 ngày theo chính sách FEFO).`,
      promoCode,
      lotCode,
      daysRemaining: input.daysRemaining,
      discountPercent: 0,
      eligibleQuantity: 0,
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
    promoCode,
    lotCode,
    daysRemaining: input.daysRemaining,
    discountPercent,
    eligibleQuantity,
    sellingPrice: input.sellingPrice,
    discountAmount,
    proofSummary,
  };
}
