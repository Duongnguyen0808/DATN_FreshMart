export function supplyTiming(input: {
  predictedQuantity: number; horizonDays: number; available: number; safetyStock: number;
  leadTimeDays: number | null; packSize: number; shortage: number;
  receipts: { day: number; quantity: number }[];
}) {
  const dailyDemand = input.predictedQuantity / input.horizonDays;
  let balance = input.available;
  let firstShortageDay: number | null = null;
  for (let day = 0; day < input.horizonDays; day++) {
    balance += input.receipts.filter(row => row.day === day).reduce((sum, row) => sum + row.quantity, 0);
    balance -= dailyDemand;
    if (balance < -0.00001 && firstShortageDay === null) firstShortageDay = day;
  }
  const leadTimeCovered = input.leadTimeDays !== null && input.leadTimeDays <= input.horizonDays;
  const dueBeforeLead = input.receipts.filter(row => input.leadTimeDays !== null && row.day >= 0 && row.day < input.leadTimeDays).reduce((sum, row) => sum + row.quantity, 0);
  const leadTimeNeed = leadTimeCovered ? Math.max(0, Math.ceil(dailyDemand * input.leadTimeDays! + input.safetyStock - input.available - dueBeforeLead)) : null;
  const packs = Math.ceil(input.shortage / input.packSize);
  return { dailyDemand, firstShortageDay, leadTimeDays: input.leadTimeDays, leadTimeCovered,
    leadTimeNeed, orderNow: leadTimeNeed === null ? null : leadTimeNeed > 0,
    urgent: firstShortageDay !== null && input.leadTimeDays !== null && firstShortageDay < input.leadTimeDays,
    suggestedPacks: packs, roundedPurchaseQuantity: packs * input.packSize,
    basis: 'Ước tính tiêu thụ đều từ tổng dự báo; chỉ cộng đơn mua hàng còn mở có ngày về từ hôm nay. Hàng đang chuyển chưa có lịch về không bảo đảm tránh thiếu trước ngày giao.' };
}
