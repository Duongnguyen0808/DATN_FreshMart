export type ShortageInputs = {
  predictedQuantity: number;
  available: number;
  safetyStock: number;
  inTransfer: number;
  incomingPurchase: number;
};

export function assessShortage(input: ShortageInputs) {
  const required = input.predictedQuantity + input.safetyStock;
  const plannedSupply = input.available + input.inTransfer + input.incomingPurchase;
  const shortageQuantity = Math.max(0, required - plannedSupply);
  const severity = shortageQuantity === 0 ? null
    : input.available <= 0 || shortageQuantity >= Math.max(1, input.predictedQuantity * 0.5) ? 'HIGH'
      : shortageQuantity >= Math.max(1, input.predictedQuantity * 0.2) ? 'MEDIUM' : 'LOW';
  return { required, plannedSupply, shortageQuantity, severity } as const;
}
