import { prisma } from '../../common/database.js';
import { AppError } from '../../common/app-error.js';
import type { CurrentUser } from '../auth/auth.repository.js';

const DEFAULT_DAILY_TASKS = [
  {
    sortOrder: 1,
    category: 'FEFO',
    title: 'Kiểm tra hàng cận hạn & hết hạn',
    description: 'Rà soát các lô hàng còn dưới 7 ngày sử dụng trên kệ bán lẻ và khu cách ly.',
  },
  {
    sortOrder: 2,
    category: 'SHELF',
    title: 'Kiểm tra hàng hóa & bảng giá trên kệ',
    description: 'Đảm bảo các mặt hàng bán chạy đủ tồn trưng bày, tem giá khớp hệ thống.',
  },
  {
    sortOrder: 3,
    category: 'FEFO',
    title: 'Sắp xếp hàng hóa theo nguyên tắc FEFO',
    description: 'Đẩy các lô có hạn sử dụng gần nhất ra phía trước quầy kệ để ưu tiên xuất bán.',
  },
  {
    sortOrder: 4,
    category: 'STOCK',
    title: 'Kiểm tra tồn kho thực tế',
    description: 'Đối chiếu nhanh các SKU có chênh lệch hoặc thuộc danh sách cảnh báo thiếu hàng AI.',
  },
  {
    sortOrder: 5,
    category: 'IOT',
    title: 'Kiểm tra thiết bị & an ninh cửa kho',
    description: 'Xác nhận trạng thái ESP32-CAM, đầu đọc RFID RC522 và cảm biến cửa kho hoạt động ổn định.',
  },
];

function allowedStoreIds(user: CurrentUser): string[] {
  return user.stores.map((s) => s.id);
}

async function resolveTargetStoreId(user: CurrentUser, requestedStoreId?: string): Promise<string> {
  if (requestedStoreId) {
    if (!user.globalAccess && !allowedStoreIds(user).includes(requestedStoreId)) {
      throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không có quyền truy cập chi nhánh này.');
    }
    return requestedStoreId;
  }
  if (user.stores.length > 0) {
    return user.stores[0]!.id;
  }
  if (user.globalAccess) {
    const firstStore = await prisma.store.findFirst({ where: { active: true }, orderBy: { code: 'asc' } });
    if (firstStore) return firstStore.id;
  }
  throw new AppError(400, 'STORE_REQUIRED', 'Tài khoản chưa được gắn chi nhánh hoạt động.');
}

function assertStoreAccess(user: CurrentUser, storeId: string) {
  if (!user.globalAccess && !allowedStoreIds(user).includes(storeId)) {
    throw new AppError(403, 'STORE_FORBIDDEN', 'Bạn không có quyền thao tác tại chi nhánh này.');
  }
}

export function todayDateKey(): string {
  const now = new Date();
  const vn = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return vn.toISOString().slice(0, 10);
}

// ============================================================
// 1. DAILY OPERATIONS CHECKLIST
// ============================================================
export async function getDailyChecklist(user: CurrentUser, storeId?: string, dateKey?: string) {
  const targetStoreId = await resolveTargetStoreId(user, storeId);
  const targetDate = dateKey || todayDateKey();

  let items = await prisma.dailyChecklistItem.findMany({
    where: { storeId: targetStoreId, dateKey: targetDate },
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  });

  if (items.length === 0) {
    await prisma.dailyChecklistItem.createMany({
      data: DEFAULT_DAILY_TASKS.map((t) => ({
        storeId: targetStoreId,
        dateKey: targetDate,
        sortOrder: t.sortOrder,
        category: t.category,
        title: t.title,
        description: t.description,
      })),
    });
    items = await prisma.dailyChecklistItem.findMany({
      where: { storeId: targetStoreId, dateKey: targetDate },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  const completedCount = items.filter((i) => i.completed).length;
  return {
    storeId: targetStoreId,
    dateKey: targetDate,
    items,
    summary: {
      total: items.length,
      completed: completedCount,
      percent: items.length > 0 ? Math.round((completedCount / items.length) * 100) : 0,
    },
  };
}

export async function toggleChecklistItem(
  user: CurrentUser,
  id: string,
  completed: boolean,
  note?: string | null
) {
  const existing = await prisma.dailyChecklistItem.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'CHECKLIST_NOT_FOUND', 'Không tìm thấy đầu việc kiểm tra.');
  assertStoreAccess(user, existing.storeId);

  const updated = await prisma.dailyChecklistItem.update({
    where: { id },
    data: {
      completed,
      completedById: completed ? user.id : null,
      completedByName: completed ? user.name : null,
      completedAt: completed ? new Date() : null,
      ...(note !== undefined ? { note: note || null } : {}),
    },
  });

  if (completed) {
    await prisma.mobileActivityLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        storeId: existing.storeId,
        activityType: 'CHECKLIST_DONE',
        title: `Hoàn thành: ${existing.title}`,
        detail: note || `Checklist ngày ${existing.dateKey}`,
        targetCode: existing.category,
      },
    });
  }

  return updated;
}

// ============================================================
// 2. QUICK STOCKTAKING (KHÔNG TỰ ĐỘNG THAY ĐỔI TỒN KHO)
// ============================================================
export async function createQuickStocktake(
  user: CurrentUser,
  input: {
    storeId?: string;
    warehouseId?: string;
    barcode: string;
    actualQuantity: number;
    note?: string | null;
  }
) {
  const targetStoreId = await resolveTargetStoreId(user, input.storeId);

  const sku = await prisma.sku.findUnique({
    where: { barcode: input.barcode.trim() },
    include: { product: true },
  });
  if (!sku || !sku.active || !sku.product.active) {
    throw new AppError(404, 'SKU_NOT_FOUND', 'Không tìm thấy sản phẩm với mã vạch này.');
  }

  // Resolve warehouse for store
  let warehouse = input.warehouseId
    ? await prisma.warehouse.findFirst({ where: { id: input.warehouseId, storeId: targetStoreId, active: true } })
    : await prisma.warehouse.findFirst({ where: { storeId: targetStoreId, active: true }, orderBy: { code: 'asc' } });

  const stock = warehouse
    ? await prisma.inventory.findUnique({
        where: { warehouseId_skuId: { warehouseId: warehouse.id, skuId: sku.id } },
      })
    : null;

  const systemQuantity = stock ? stock.onHand : 0;
  const difference = input.actualQuantity - systemQuantity;
  const code = `QKK-${todayDateKey().replaceAll('-', '')}-${Date.now().toString().slice(-6)}`;

  const created = await prisma.$transaction(async (tx) => {
    const report = await tx.quickStocktakeReport.create({
      data: {
        code,
        storeId: targetStoreId,
        warehouseId: warehouse?.id ?? null,
        skuId: sku.id,
        skuCode: sku.code,
        barcode: sku.barcode,
        productName: sku.product.name,
        systemQuantity,
        actualQuantity: input.actualQuantity,
        difference,
        note: input.note || null,
        status: 'PENDING',
        reportedById: user.id,
        reportedByName: user.name,
      },
    });

    await tx.mobileActivityLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        storeId: targetStoreId,
        activityType: 'STOCKTAKE_SUBMIT',
        title: `Kiểm đếm nhanh: ${sku.product.name}`,
        detail: `Hệ thống: ${systemQuantity} · Thực tế: ${input.actualQuantity} · Lệch: ${difference >= 0 ? `+${difference}` : difference}`,
        targetCode: code,
      },
    });

    return report;
  });

  return created;
}

export async function listQuickStocktakes(
  user: CurrentUser,
  query: { storeId?: string; status?: string; mineOnly?: boolean }
) {
  const storeFilter = query.storeId
    ? (assertStoreAccess(user, query.storeId), { storeId: query.storeId })
    : user.globalAccess
    ? {}
    : { storeId: { in: allowedStoreIds(user) } };

  return prisma.quickStocktakeReport.findMany({
    where: {
      ...storeFilter,
      ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
      ...(query.mineOnly ? { reportedById: user.id } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function reviewQuickStocktake(
  user: CurrentUser,
  id: string,
  status: 'APPROVED' | 'REJECTED',
  reviewNote?: string | null
) {
  if (!user.globalAccess && !user.permissions.includes('stocktakes.approve')) {
    throw new AppError(403, 'FORBIDDEN', 'Chỉ Quản lý chi nhánh hoặc Chủ hệ thống mới được duyệt kiểm đếm.');
  }
  const existing = await prisma.quickStocktakeReport.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy phiếu kiểm đếm nhanh.');
  assertStoreAccess(user, existing.storeId);

  return prisma.quickStocktakeReport.update({
    where: { id },
    data: {
      status,
      reviewedById: user.id,
      reviewedByName: user.name,
      reviewedAt: new Date(),
      reviewNote: reviewNote || null,
    },
  });
}

// ============================================================
// 3. INCIDENT REPORTS
// ============================================================
export async function createIncidentReport(
  user: CurrentUser,
  input: {
    storeId?: string;
    warehouseId?: string;
    type: 'DAMAGED' | 'EXPIRED' | 'STOCK_MISMATCH' | 'IOT_DEVICE';
    title: string;
    description: string;
    relatedCode?: string | null;
    relatedName?: string | null;
    imageUrl?: string | null;
  }
) {
  const targetStoreId = await resolveTargetStoreId(user, input.storeId);
  const warehouse = input.warehouseId
    ? await prisma.warehouse.findFirst({ where: { id: input.warehouseId, storeId: targetStoreId } })
    : await prisma.warehouse.findFirst({ where: { storeId: targetStoreId, active: true }, orderBy: { code: 'asc' } });

  const code = `INC-${todayDateKey().replaceAll('-', '')}-${Date.now().toString().slice(-6)}`;

  return prisma.$transaction(async (tx) => {
    const report = await tx.incidentReport.create({
      data: {
        code,
        storeId: targetStoreId,
        warehouseId: warehouse?.id ?? null,
        type: input.type,
        title: input.title,
        description: input.description,
        relatedCode: input.relatedCode || null,
        relatedName: input.relatedName || null,
        imageUrl: input.imageUrl || null,
        status: 'OPEN',
        reportedById: user.id,
        reportedByName: user.name,
      },
    });

    await tx.mobileActivityLog.create({
      data: {
        userId: user.id,
        userName: user.name,
        storeId: targetStoreId,
        activityType: 'INCIDENT_REPORT',
        title: `Báo cáo sự cố: ${input.title}`,
        detail: input.description.slice(0, 160),
        targetCode: code,
      },
    });

    return report;
  });
}

export async function listIncidentReports(
  user: CurrentUser,
  query: { storeId?: string; status?: string; type?: string; mineOnly?: boolean }
) {
  const storeFilter = query.storeId
    ? (assertStoreAccess(user, query.storeId), { storeId: query.storeId })
    : user.globalAccess
    ? {}
    : { storeId: { in: allowedStoreIds(user) } };

  return prisma.incidentReport.findMany({
    where: {
      ...storeFilter,
      ...(query.status && query.status !== 'ALL' ? { status: query.status } : {}),
      ...(query.type && query.type !== 'ALL' ? { type: query.type } : {}),
      ...(query.mineOnly ? { reportedById: user.id } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
}

export async function updateIncidentStatus(
  user: CurrentUser,
  id: string,
  status: 'IN_PROGRESS' | 'RESOLVED',
  resolutionNote?: string | null
) {
  const isManager =
    user.globalAccess ||
    user.permissions.includes('stocktakes.approve') ||
    user.permissions.includes('shifts.approve');
  if (!isManager) {
    throw new AppError(403, 'FORBIDDEN', 'Chỉ Quản lý chi nhánh hoặc Chủ hệ thống mới được cập nhật xử lý sự cố.');
  }

  const existing = await prisma.incidentReport.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, 'NOT_FOUND', 'Không tìm thấy báo cáo sự cố.');
  assertStoreAccess(user, existing.storeId);

  return prisma.incidentReport.update({
    where: { id },
    data: {
      status,
      handledById: user.id,
      handledByName: user.name,
      handledAt: new Date(),
      resolutionNote: resolutionNote || null,
    },
  });
}

// ============================================================
// 4. PERSONAL ACTIVITY HISTORY (SCAN + RFID + CHECKLIST + INCIDENT)
// ============================================================
export async function logMobileActivity(
  user: CurrentUser,
  input: {
    storeId?: string | null;
    activityType: 'BARCODE_SCAN' | 'CHECKLIST_DONE' | 'STOCKTAKE_SUBMIT' | 'INCIDENT_REPORT';
    title: string;
    detail?: string | null;
    targetCode?: string | null;
  }
) {
  return prisma.mobileActivityLog.create({
    data: {
      userId: user.id,
      userName: user.name,
      storeId: input.storeId || user.stores[0]?.id || null,
      activityType: input.activityType,
      title: input.title,
      detail: input.detail || null,
      targetCode: input.targetCode || null,
    },
  });
}

export async function listPersonalActivities(
  user: CurrentUser,
  range: 'today' | '7d' | '30d' | 'all' = '7d'
) {
  const now = new Date();
  let since: Date | undefined;
  if (range === 'today') {
    since = new Date(now);
    since.setHours(0, 0, 0, 0);
  } else if (range === '7d') {
    since = new Date(now.getTime() - 7 * 86400000);
  } else if (range === '30d') {
    since = new Date(now.getTime() - 30 * 86400000);
  }

  const [mobileLogs, rfidEvents] = await Promise.all([
    prisma.mobileActivityLog.findMany({
      where: {
        userId: user.id,
        ...(since ? { createdAt: { gte: since } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    }),
    prisma.warehouseAccessEvent.findMany({
      where: {
        employeeId: user.id,
        ...(since ? { occurredAt: { gte: since } } : {}),
      },
      include: { door: { select: { name: true, code: true } } },
      orderBy: { occurredAt: 'desc' },
      take: 40,
    }),
  ]);

  const combined = [
    ...mobileLogs.map((log) => ({
      id: log.id,
      activityType: log.activityType,
      title: log.title,
      detail: log.detail,
      targetCode: log.targetCode,
      createdAt: log.createdAt.toISOString(),
    })),
    ...rfidEvents.map((ev) => ({
      id: `rfid-${ev.id}`,
      activityType: 'RFID_SCAN',
      title: `Quẹt thẻ RFID · ${ev.door?.name || 'Cửa kho'}`,
      detail: `${ev.eventType} · Nguồn: ${ev.source}`,
      targetCode: ev.door?.code || null,
      createdAt: ev.occurredAt.toISOString(),
    })),
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return combined.slice(0, 100);
}
