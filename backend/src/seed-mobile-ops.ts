import 'dotenv/config';
import { prisma } from './common/database.js';

async function seedMobileOps() {
  console.log('Seeding rich realistic Mobile Ops data...');

  const [stores, users, products, warehouses] = await Promise.all([
    prisma.store.findMany({ take: 3 }),
    prisma.user.findMany({ take: 5 }),
    prisma.product.findMany({
      take: 10,
      include: { skus: true },
    }),
    prisma.warehouse.findMany({ take: 3 }),
  ]);

  if (stores.length === 0 || users.length === 0) {
    console.warn('Stores or Users not found in DB. Run seed first.');
    return;
  }

  const primaryStore = stores[0];
  const primaryWarehouse = warehouses.find((w) => w.storeId === primaryStore.id) || warehouses[0];
  const primaryUser = users.find((u) => u.email.includes('employee')) || users[0];
  const managerUser = users.find((u) => u.email.includes('manager')) || users[1] || primaryUser;
  const todayKey = new Date().toISOString().split('T')[0];

  // 1. Clear existing mobile ops data to avoid unique code conflicts
  await prisma.mobileActivityLog.deleteMany({});
  await prisma.incidentReport.deleteMany({});
  await prisma.quickStocktakeReport.deleteMany({});
  await prisma.dailyChecklistItem.deleteMany({});

  // 2. Seed Daily Checklist Items
  const checklistData = [
    {
      title: 'Kiểm tra hàng cận date tại quầy Sữa & Chế phẩm tươi',
      category: 'FEFO_CHECK',
      description: 'Rà soát hạn sử dụng sữa TH True Milk, Vinamilk và sữa chua ăn. Đảo date đưa hàng cận 3 ngày ra phía trước kệ.',
      completed: true,
      completedById: primaryUser.id,
      completedByName: primaryUser.name || 'Nguyễn Văn Dương',
      completedAt: new Date(Date.now() - 3600 * 1000 * 2), // 2 hours ago
      sortOrder: 1,
    },
    {
      title: 'Đảo date và sắp xếp kệ Bánh ngọt & Thực phẩm khô theo FEFO',
      category: 'FEFO_CHECK',
      description: 'Bánh Danisa, Nabati, Oishi: Xếp lô cũ ra trước, lô mới vào sau khay trưng bày.',
      completed: true,
      completedById: primaryUser.id,
      completedByName: primaryUser.name || 'Nguyễn Văn Dương',
      completedAt: new Date(Date.now() - 3600 * 1000 * 1), // 1 hour ago
      sortOrder: 2,
    },
    {
      title: 'Kiểm tra nhiệt độ & hoạt động tủ đông thực phẩm đông lạnh',
      category: 'DEVICE_CHECK',
      description: 'Kiểm tra đồng hồ nhiệt độ tủ đông cá viên chiên và xúc xích duy trì mức -18°C đến -22°C.',
      completed: false,
      completedById: null,
      completedByName: null,
      completedAt: null,
      sortOrder: 3,
    },
    {
      title: 'Kiểm đếm nhanh tồn kho thực tế 05 mặt hàng trọng điểm',
      category: 'STOCK_CHECK',
      description: 'Dùng máy quét barcode đối chiếu số lượng trên kệ trưng bày và trong kho trung chuyển.',
      completed: false,
      completedById: null,
      completedByName: null,
      completedAt: null,
      sortOrder: 4,
    },
    {
      title: 'Kiểm tra trạm quét thẻ RFID RC522 và camera cổng kho',
      category: 'DEVICE_CHECK',
      description: 'Quẹt thẻ thử nghiệm, xác nhận đèn LED xanh sáng và chốt khóa từ cửa mở bình thường.',
      completed: true,
      completedById: primaryUser.id,
      completedByName: primaryUser.name || 'Nguyễn Văn Dương',
      completedAt: new Date(Date.now() - 3600 * 1000 * 3),
      sortOrder: 5,
    },
    {
      title: 'Bàn giao ca & tổng kết biên bản sự cố trong ngày',
      category: 'HANDOVER',
      description: 'Kiểm tra các phiếu báo sự cố hàng hỏng đã gửi quản lý và ký xác nhận sổ ca.',
      completed: false,
      completedById: null,
      completedByName: null,
      completedAt: null,
      sortOrder: 6,
    },
  ];

  for (const item of checklistData) {
    await prisma.dailyChecklistItem.create({
      data: {
        storeId: primaryStore.id,
        dateKey: todayKey,
        title: item.title,
        category: item.category,
        description: item.description,
        completed: item.completed,
        completedById: item.completedById,
        completedByName: item.completedByName,
        completedAt: item.completedAt,
        sortOrder: item.sortOrder,
      },
    });
  }
  console.log(`Created ${checklistData.length} daily checklist items.`);

  // 3. Seed Quick Stocktake Reports
  const sampleProduct1 = products[0];
  const sampleProduct2 = products[1] || products[0];
  const sampleSku1 = sampleProduct1?.skus?.[0];
  const sampleSku2 = sampleProduct2?.skus?.[0];

  const stocktakeData = [
    {
      code: `STK-${Date.now()}-01`,
      storeId: primaryStore.id,
      warehouseId: primaryWarehouse?.id,
      skuId: sampleSku1?.id || 'sku-01',
      skuCode: sampleSku1?.code || 'SKU-DN-775',
      barcode: sampleSku1?.barcode || '8938882001954',
      productName: sampleProduct1?.name || 'Bánh quy bơ cao cấp Danisa Hộp thiếc 454g',
      systemQuantity: 48,
      actualQuantity: 45,
      difference: -3,
      note: 'Hao hụt 3 hộp tại quầy bánh trung tâm do móp méo khi bốc dỡ',
      status: 'PENDING',
      reportedById: primaryUser.id,
      reportedByName: primaryUser.name || 'Nguyễn Văn Dương',
    },
    {
      code: `STK-${Date.now()}-02`,
      storeId: primaryStore.id,
      warehouseId: primaryWarehouse?.id,
      skuId: sampleSku2?.id || 'sku-02',
      skuCode: sampleSku2?.code || 'SKU-DEMO-033',
      barcode: sampleSku2?.barcode || '8930000000033',
      productName: sampleProduct2?.name || 'Nước rửa chén Sunlight 750g',
      systemQuantity: 30,
      actualQuantity: 30,
      difference: 0,
      note: 'Khớp 100% số lượng tồn hệ thống trên kệ trưng bày',
      status: 'APPROVED',
      reviewedById: managerUser.id,
      reviewedByName: managerUser.name || 'Quản lý chi nhánh',
      reviewedAt: new Date(Date.now() - 3600 * 1000 * 4),
      reviewNote: 'Đã kiểm tra chéo, số lượng trùng khớp.',
      reportedById: primaryUser.id,
      reportedByName: primaryUser.name || 'Nguyễn Văn Dương',
    },
  ];

  for (const st of stocktakeData) {
    await prisma.quickStocktakeReport.create({ data: st });
  }
  console.log(`Created ${stocktakeData.length} quick stocktake reports.`);

  // 4. Seed Incident Reports
  const incidentData = [
    {
      code: `INC-${Date.now()}-01`,
      storeId: primaryStore.id,
      warehouseId: primaryWarehouse?.id,
      type: 'DAMAGED_GOODS',
      title: 'Hàng móp méo khi vận chuyển',
      description: 'Phát hiện 02 hộp bánh Danisa bị móp góc nắp thiếc trong quá trình dỡ hàng từ xe tải giao hàng sáng nay.',
      relatedCode: sampleProduct1?.code || 'PRD-DN-077',
      relatedName: sampleProduct1?.name || 'Bánh Danisa Hộp thiếc 454g',
      imageUrl: 'https://res.cloudinary.com/diml6g3k2/image/upload/v1794645413/smart-store/products/rhbnzaof81bdxg45amhl.webp',
      status: 'PENDING',
      reportedById: primaryUser.id,
      reportedByName: primaryUser.name || 'Nguyễn Văn Dương',
    },
    {
      code: `INC-${Date.now()}-02`,
      storeId: primaryStore.id,
      warehouseId: primaryWarehouse?.id,
      type: 'DEVICE_MALFUNCTION',
      title: 'Đầu đọc thẻ RFID phản hồi chậm',
      description: 'Đầu đọc thẻ RFID cửa kho số 1 thi thoảng quét thẻ phản hồi trễ 3-5 giây. Đã kiểm tra lại dây cáp nguồn.',
      relatedCode: 'RFID-READER-01',
      relatedName: 'Trạm kiểm soát RFID Cửa kho chính',
      status: 'RESOLVED',
      resolutionNote: 'Đã vệ sinh đầu đọc và khởi động lại trạm ESP32, tín hiệu hoạt động ổn định.',
      handledById: managerUser.id,
      handledByName: managerUser.name || 'Quản lý chi nhánh',
      handledAt: new Date(Date.now() - 3600 * 1000 * 8),
      reportedById: primaryUser.id,
      reportedByName: primaryUser.name || 'Nguyễn Văn Dương',
    },
  ];

  for (const inc of incidentData) {
    await prisma.incidentReport.create({ data: inc });
  }
  console.log(`Created ${incidentData.length} incident reports.`);

  // 5. Seed Mobile Activity Logs
  const activityData = [
    {
      userId: primaryUser.id,
      userName: primaryUser.name || 'Nguyễn Văn Dương',
      storeId: primaryStore.id,
      activityType: 'BARCODE_SCAN',
      title: 'Quét barcode tra cứu',
      detail: `Đã quét barcode ${sampleSku1?.barcode || '8938882001954'} (${sampleProduct1?.name || 'Danisa'}) kiểm tra thông tin giá & tồn`,
      targetCode: sampleSku1?.barcode || '8938882001954',
      createdAt: new Date(Date.now() - 1000 * 60 * 25), // 25 mins ago
    },
    {
      userId: primaryUser.id,
      userName: primaryUser.name || 'Nguyễn Văn Dương',
      storeId: primaryStore.id,
      activityType: 'STOCKTAKE_SUBMIT',
      title: 'Gửi kết quả kiểm đếm nhanh',
      detail: `Gửi phiếu kiểm đếm mã ${sampleProduct1?.code || 'PRD-DN-077'}, chênh lệch: -3 hộp`,
      targetCode: sampleProduct1?.code || 'PRD-DN-077',
      createdAt: new Date(Date.now() - 1000 * 60 * 40), // 40 mins ago
    },
    {
      userId: primaryUser.id,
      userName: primaryUser.name || 'Nguyễn Văn Dương',
      storeId: primaryStore.id,
      activityType: 'CHECKLIST_COMPLETE',
      title: 'Hoàn thành đầu việc Checklist',
      detail: 'Đã hoàn thành kiểm tra hàng cận date tại quầy Sữa tươi & Chế phẩm',
      targetCode: 'FEFO_CHECK',
      createdAt: new Date(Date.now() - 1000 * 60 * 85),
    },
    {
      userId: primaryUser.id,
      userName: primaryUser.name || 'Nguyễn Văn Dương',
      storeId: primaryStore.id,
      activityType: 'RFID_SCAN',
      title: 'Quẹt thẻ RFID mở cửa kho',
      detail: 'Quẹt thẻ định danh nhân viên tại trạm ESP32-RC522 Cửa kho chính - Hợp lệ',
      targetCode: 'DOOR-01',
      createdAt: new Date(Date.now() - 1000 * 60 * 120),
    },
    {
      userId: primaryUser.id,
      userName: primaryUser.name || 'Nguyễn Văn Dương',
      storeId: primaryStore.id,
      activityType: 'INCIDENT_REPORT',
      title: 'Gửi báo cáo sự cố hàng hư hỏng',
      detail: 'Đã gửi báo cáo sự cố 02 hộp bánh móp nắp kèm ảnh chụp thực tế từ camera iPhone',
      targetCode: 'DAMAGED_GOODS',
      createdAt: new Date(Date.now() - 1000 * 60 * 180),
    },
  ];

  for (const act of activityData) {
    await prisma.mobileActivityLog.create({ data: act });
  }
  console.log(`Created ${activityData.length} personal activity logs.`);

  console.log('Mobile Ops seed completed successfully!');
}

seedMobileOps()
  .catch((e) => {
    console.error('Error seeding mobile ops:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
