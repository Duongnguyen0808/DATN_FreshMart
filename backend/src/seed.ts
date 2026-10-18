import 'dotenv/config';
import { z } from 'zod';
import { prisma } from './common/database.js';
import { hashPassword } from './modules/auth/password.js';
import { synchronizeSystemRoles } from './modules/auth/system-roles.js';
import { readableProductCodes } from './readable-product-codes.js';

export const permissionCatalog = [
  ['users.read', 'Xem người dùng'], ['users.manage', 'Tạo, sửa, khóa và gán vai trò người dùng'],
  ['roles.read', 'Xem vai trò'], ['roles.manage', 'Quản lý vai trò (chủ doanh nghiệp)'],
  ['permissions.read', 'Xem danh sách quyền'], ['stores.read', 'Xem chi nhánh được phân công'],
  ['stores.manage', 'Thêm, sửa và đổi trạng thái chi nhánh'],
  ['warehouses.read', 'Xem kho thuộc chi nhánh được phân công'], ['warehouses.manage', 'Thêm, sửa và đổi trạng thái kho'],
  ['products.read', 'Xem danh mục sản phẩm và SKU'], ['products.manage', 'Thêm, sửa và đổi trạng thái sản phẩm'],
  ['categories.manage', 'Quản lý danh mục sản phẩm'],
  ['shifts.read', 'Xem ca làm việc trong phạm vi chi nhánh'], ['shifts.manage', 'Mở và chốt ca làm việc'],
  ['shifts.approve', 'Duyệt chênh lệch và khóa sổ ca'],
  ['invoices.read', 'Xem hóa đơn bán hàng trong phạm vi chi nhánh'], ['invoices.create', 'Tạo hóa đơn và ghi nhận thanh toán'],
  ['invoices.cancel', 'Hủy hóa đơn và hoàn doanh thu ca'], ['inventory.read', 'Xem tồn kho và lịch sử biến động'],
  ['returns.read', 'Xem lịch sử đổi trả hàng'], ['returns.manage', 'Tạo phiếu trả hàng và hoàn tiền'],
  ['customers.read', 'Xem hồ sơ khách hàng'], ['customers.manage', 'Thêm, sửa và đổi trạng thái khách hàng'],
  ['stocktakes.read', 'Xem phiếu kiểm kho và chênh lệch'], ['stocktakes.create', 'Tạo và gửi phiếu kiểm kho'], ['stocktakes.approve', 'Duyệt điều chỉnh tồn kho'],
  ['transfers.read', 'Xem phiếu điều chuyển'], ['transfers.create', 'Tạo phiếu điều chuyển'], ['transfers.approve', 'Duyệt và từ chối phiếu điều chuyển'], ['transfers.dispatch', 'Xác nhận xuất kho điều chuyển'], ['transfers.receive', 'Xác nhận nhận hàng điều chuyển'],
  ['suppliers.read', 'Xem hồ sơ nhà cung cấp'], ['suppliers.manage', 'Thêm, sửa và đổi trạng thái nhà cung cấp'],
  ['purchase_requests.read', 'Xem đề nghị mua hàng'], ['purchase_requests.create', 'Tạo đề nghị mua hàng'], ['purchase_requests.approve', 'Duyệt, điều chỉnh hoặc từ chối đề nghị mua hàng'],
  ['purchase_orders.read', 'Xem đơn mua hàng'], ['purchase_orders.create', 'Tạo đơn mua hàng từ đề nghị đã duyệt'], ['purchase_orders.receive', 'Nhận hàng theo đơn mua hàng'],
  ['payables.read', 'Xem công nợ phải trả'], ['payables.pay', 'Ghi nhận thanh toán công nợ'],
  ['receivables.read', 'Xem công nợ phải thu khách hàng'], ['receivables.pay', 'Ghi nhận thu tiền công nợ khách hàng'],
  ['dashboard.read', 'Xem dashboard vận hành'],
  ['reports.read', 'Xem báo cáo vận hành'],
] as const;
async function seed() {
  const email = z.string().email().parse(process.env.SEED_OWNER_EMAIL).toLowerCase();
  const password = z.string().min(10).max(128).parse(process.env.SEED_OWNER_PASSWORD);
  const passwordHash = await hashPassword(password);
  await prisma.$transaction(async tx => {
    for (const [code, name] of permissionCatalog) await tx.permission.upsert({ where: { code }, update: { name }, create: { code, name } });
    const roleIds = await synchronizeSystemRoles(tx);
    const owner = await tx.user.upsert({ where: { email }, update: {}, create: { email, name: 'Chủ doanh nghiệp', passwordHash } });
    await tx.userRole.upsert({ where: { userId_roleId: { userId: owner.id, roleId: roleIds.get('OWNER')! } }, create: { userId: owner.id, roleId: roleIds.get('OWNER')! }, update: {} });
    const stores = [
      { code: 'CN001', name: 'Chi nhánh Ba Đình', address: '45 Kim Mã, Ba Đình, Hà Nội', region: 'MIEN_BAC', phone: '0988123456', managerName: 'Trần Thu Trang', warehouse: { code: 'KHO001', name: 'Kho Ba Đình', address: '45 Kim Mã, Ba Đình, Hà Nội' } },
      { code: 'CN002', name: 'Chi nhánh Hải Châu', address: '56 Nguyễn Văn Linh, Hải Châu, Đà Nẵng', region: 'MIEN_TRUNG', phone: '0942111444', managerName: 'Vũ Mai Lan', warehouse: { code: 'KHO002', name: 'Kho Hải Châu', address: '56 Nguyễn Văn Linh, Hải Châu, Đà Nẵng' } },
      { code: 'CN003', name: 'Chi nhánh Quận 1', address: '88 Nguyễn Huệ, Quận 1, TP.HCM', region: 'MIEN_NAM', phone: '0903999888', managerName: 'Phạm Minh Đức', warehouse: { code: 'KHO003', name: 'Kho Quận 1', address: '88 Nguyễn Huệ, Quận 1, TP.HCM' } },
    ];
    const storeIds = new Map<string, string>();
    const warehouses = new Map<string, string>();
    for (const item of stores) {
      const { warehouse, ...store } = item;
      const saved = await tx.store.upsert({ where: { code: store.code }, update: store, create: store });
      storeIds.set(store.code, saved.id);
      const savedWarehouse = await tx.warehouse.upsert({ where: { code: warehouse.code }, update: { ...warehouse, storeId: saved.id }, create: { ...warehouse, storeId: saved.id } });
      warehouses.set(warehouse.code, savedWarehouse.id);
    }
    const categoryRows = [
      ['DO_UONG_SUA', 'Đồ uống & Sữa'], ['BANH_KEO_DO_KHO', 'Bánh kẹo & Đồ khô'],
      ['TRA_CA_PHE', 'Trà & Cà phê'], ['GIA_VI_THUC_PHAM', 'Gia vị & Thực phẩm'],
      ['MI_AN_LIEN', 'Mì & Thực phẩm ăn liền'], ['CHAM_SOC_CA_NHAN', 'Chăm sóc cá nhân'],
      ['GIA_DUNG', 'Gia dụng'], ['THUC_PHAM_DONG_LANH', 'Thực phẩm đông lạnh'],
    ] as const;
    const categories = new Map<string, string>();
    for (const [code, name] of categoryRows) {
      const category = await tx.category.upsert({ where: { code }, update: { name }, create: { code, name } });
      categories.set(code, category.id);
    }
    const products = [
      { code: 'PRD-YM-041', sku: 'SKU-YM-410', barcode: '8934567891201', name: 'Sữa chua uống tiệt trùng Yomost Cam 170ml', category: 'DO_UONG_SUA', unit: 'Lốc 4 hộp', cost: 24500, price: 32000 },
      { code: 'PRD-DN-077', sku: 'SKU-DN-775', barcode: '8938882001954', name: 'Bánh quy bơ cao cấp Danisa Hộp thiếc 454g', category: 'BANH_KEO_DO_KHO', unit: 'Hộp', cost: 110000, price: 142000 },
      { code: 'PRD-CF-088', sku: 'SKU-CF-882', barcode: '8935012490118', name: 'Cà phê rang xay Hạt Arabica Cầu Đất 500g', category: 'TRA_CA_PHE', unit: 'Gói', cost: 82000, price: 115000 },
      { code: 'PRD-LV-019', sku: 'SKU-LV-190', barcode: '8931122334405', name: 'Nước khoáng Lavie bình 19L', category: 'DO_UONG_SUA', unit: 'Bình', cost: 45000, price: 68000 },
      { code: 'PRD-OL-060', sku: 'SKU-OL-602', barcode: '8939988776652', name: 'Dầu ô liu Extra Virgin Borges 500ml', category: 'GIA_VI_THUC_PHAM', unit: 'Chai', cost: 148000, price: 185000 },
      { code: 'PRD-TE-077', sku: 'SKU-TE-774', barcode: '8937740112961', name: 'Trà Ô Long Shan Tuyết Hộp 200g', category: 'TRA_CA_PHE', unit: 'Hộp', cost: 68000, price: 95000 },
      { code: 'PRD-DEMO-007', sku: 'SKU-DEMO-007', barcode: '8930000000007', name: 'Nước ngọt Coca-Cola 1.5L', category: 'DO_UONG_SUA', unit: 'Chai', cost: 14500, price: 19000 },
      { code: 'PRD-DEMO-008', sku: 'SKU-DEMO-008', barcode: '8930000000008', name: 'Sữa tươi TH True Milk ít đường 1L', category: 'DO_UONG_SUA', unit: 'Hộp', cost: 31500, price: 39000 },
      { code: 'PRD-DEMO-009', sku: 'SKU-DEMO-009', barcode: '8930000000009', name: 'Sữa lúa mạch Milo 180ml', category: 'DO_UONG_SUA', unit: 'Lốc 4 hộp', cost: 26500, price: 34000 },
      { code: 'PRD-DEMO-010', sku: 'SKU-DEMO-010', barcode: '8930000000010', name: 'Nước tinh khiết Aquafina 500ml', category: 'DO_UONG_SUA', unit: 'Chai', cost: 4500, price: 7000 },
      { code: 'PRD-DEMO-011', sku: 'SKU-DEMO-011', barcode: '8930000000011', name: 'Bánh quy Oreo Vanilla 133g', category: 'BANH_KEO_DO_KHO', unit: 'Gói', cost: 14500, price: 19000 },
      { code: 'PRD-DEMO-012', sku: 'SKU-DEMO-012', barcode: '8930000000012', name: 'Snack Oishi tôm cay 80g', category: 'BANH_KEO_DO_KHO', unit: 'Gói', cost: 9000, price: 13000 },
      { code: 'PRD-DEMO-013', sku: 'SKU-DEMO-013', barcode: '8930000000013', name: 'Bánh ChocoPie Orion hộp 12 cái', category: 'BANH_KEO_DO_KHO', unit: 'Hộp', cost: 48500, price: 62000 },
      { code: 'PRD-DEMO-014', sku: 'SKU-DEMO-014', barcode: '8930000000014', name: 'Ngũ cốc dinh dưỡng Calbee 700g', category: 'BANH_KEO_DO_KHO', unit: 'Gói', cost: 142000, price: 179000 },
      { code: 'PRD-DEMO-015', sku: 'SKU-DEMO-015', barcode: '8930000000015', name: 'Trà xanh Thái Nguyên 200g', category: 'TRA_CA_PHE', unit: 'Gói', cost: 72000, price: 98000 },
      { code: 'PRD-DEMO-016', sku: 'SKU-DEMO-016', barcode: '8930000000016', name: 'Cà phê hòa tan G7 3 trong 1', category: 'TRA_CA_PHE', unit: 'Hộp', cost: 43000, price: 56000 },
      { code: 'PRD-DEMO-017', sku: 'SKU-DEMO-017', barcode: '8930000000017', name: 'Trà túi lọc Lipton Nhãn Vàng', category: 'TRA_CA_PHE', unit: 'Hộp', cost: 35000, price: 47000 },
      { code: 'PRD-DEMO-018', sku: 'SKU-DEMO-018', barcode: '8930000000018', name: 'Bột cacao nguyên chất 250g', category: 'TRA_CA_PHE', unit: 'Gói', cost: 68000, price: 89000 },
      { code: 'PRD-DEMO-019', sku: 'SKU-DEMO-019', barcode: '8930000000019', name: 'Nước mắm Nam Ngư 750ml', category: 'GIA_VI_THUC_PHAM', unit: 'Chai', cost: 38500, price: 49000 },
      { code: 'PRD-DEMO-020', sku: 'SKU-DEMO-020', barcode: '8930000000020', name: 'Nước tương Chinsu 500ml', category: 'GIA_VI_THUC_PHAM', unit: 'Chai', cost: 19000, price: 26000 },
      { code: 'PRD-DEMO-021', sku: 'SKU-DEMO-021', barcode: '8930000000021', name: 'Dầu ăn Neptune Light 1L', category: 'GIA_VI_THUC_PHAM', unit: 'Chai', cost: 51500, price: 65000 },
      { code: 'PRD-DEMO-022', sku: 'SKU-DEMO-022', barcode: '8930000000022', name: 'Đường tinh luyện Biên Hòa 1kg', category: 'GIA_VI_THUC_PHAM', unit: 'Gói', cost: 22500, price: 29000 },
      { code: 'PRD-DEMO-023', sku: 'SKU-DEMO-023', barcode: '8930000000023', name: 'Muối i-ốt Bạc Liêu 500g', category: 'GIA_VI_THUC_PHAM', unit: 'Gói', cost: 6500, price: 10000 },
      { code: 'PRD-DEMO-024', sku: 'SKU-DEMO-024', barcode: '8930000000024', name: 'Gạo thơm ST25 túi 5kg', category: 'GIA_VI_THUC_PHAM', unit: 'Túi', cost: 145000, price: 179000 },
      { code: 'PRD-DEMO-025', sku: 'SKU-DEMO-025', barcode: '8930000000025', name: 'Mì Hảo Hảo tôm chua cay', category: 'MI_AN_LIEN', unit: 'Thùng 30 gói', cost: 102000, price: 125000 },
      { code: 'PRD-DEMO-026', sku: 'SKU-DEMO-026', barcode: '8930000000026', name: 'Mì Omachi sườn hầm ngũ quả', category: 'MI_AN_LIEN', unit: 'Thùng 30 gói', cost: 185000, price: 220000 },
      { code: 'PRD-DEMO-027', sku: 'SKU-DEMO-027', barcode: '8930000000027', name: 'Mì Kokomi đại 90g', category: 'MI_AN_LIEN', unit: 'Thùng 30 gói', cost: 112000, price: 138000 },
      { code: 'PRD-DEMO-028', sku: 'SKU-DEMO-028', barcode: '8930000000028', name: 'Phở bò Vifon 65g', category: 'MI_AN_LIEN', unit: 'Thùng 30 gói', cost: 188000, price: 225000 },
      { code: 'PRD-DEMO-029', sku: 'SKU-DEMO-029', barcode: '8930000000029', name: 'Dầu gội Clear Men 650g', category: 'CHAM_SOC_CA_NHAN', unit: 'Chai', cost: 142000, price: 179000 },
      { code: 'PRD-DEMO-030', sku: 'SKU-DEMO-030', barcode: '8930000000030', name: 'Kem đánh răng P/S bảo vệ 123 180g', category: 'CHAM_SOC_CA_NHAN', unit: 'Tuýp', cost: 28500, price: 39000 },
      { code: 'PRD-DEMO-031', sku: 'SKU-DEMO-031', barcode: '8930000000031', name: 'Nước rửa tay Lifebuoy 500g', category: 'CHAM_SOC_CA_NHAN', unit: 'Chai', cost: 52000, price: 69000 },
      { code: 'PRD-DEMO-032', sku: 'SKU-DEMO-032', barcode: '8930000000032', name: 'Khăn giấy Pulppy 180 tờ', category: 'CHAM_SOC_CA_NHAN', unit: 'Hộp', cost: 19500, price: 27000 },
      { code: 'PRD-DEMO-033', sku: 'SKU-DEMO-033', barcode: '8930000000033', name: 'Nước rửa chén Sunlight 750g', category: 'GIA_DUNG', unit: 'Chai', cost: 26500, price: 36000 },
      { code: 'PRD-DEMO-034', sku: 'SKU-DEMO-034', barcode: '8930000000034', name: 'Nước giặt OMO Matic 3.6kg', category: 'GIA_DUNG', unit: 'Túi', cost: 168000, price: 209000 },
      { code: 'PRD-DEMO-035', sku: 'SKU-DEMO-035', barcode: '8930000000035', name: 'Túi rác tự hủy cuộn 30 túi', category: 'GIA_DUNG', unit: 'Cuộn', cost: 22000, price: 32000 },
      { code: 'PRD-DEMO-036', sku: 'SKU-DEMO-036', barcode: '8930000000036', name: 'Hộp bảo quản thực phẩm Lock&Lock 1L', category: 'GIA_DUNG', unit: 'Hộp', cost: 78000, price: 105000 },
      { code: 'PRD-DEMO-037', sku: 'SKU-DEMO-037', barcode: '8930000000037', name: 'Pin tiểu Panasonic AA vỉ 4 viên', category: 'GIA_DUNG', unit: 'Vỉ', cost: 28000, price: 39000 },
      { code: 'PRD-DEMO-038', sku: 'SKU-DEMO-038', barcode: '8930000000038', name: 'Cá viên chiên đông lạnh 500g', category: 'THUC_PHAM_DONG_LANH', unit: 'Gói', cost: 46000, price: 62000 },
      { code: 'PRD-DEMO-039', sku: 'SKU-DEMO-039', barcode: '8930000000039', name: 'Xúc xích CP tiệt trùng gói 10 cây', category: 'THUC_PHAM_DONG_LANH', unit: 'Gói', cost: 38500, price: 52000 },
      { code: 'PRD-DEMO-040', sku: 'SKU-DEMO-040', barcode: '8930000000040', name: 'Kem hộp Vinamilk vani 1L', category: 'THUC_PHAM_DONG_LANH', unit: 'Hộp', cost: 72000, price: 95000 },
    ] as const;
    const skus = new Map<string, string>();
    for (const item of products) {
      const productCode = readableProductCodes[item.code] ?? item.code;
      const product = await tx.product.upsert({
        where: { code: productCode },
        update: { name: item.name, unit: item.unit, categoryId: categories.get(item.category)! },
        create: { code: productCode, name: item.name, unit: item.unit, categoryId: categories.get(item.category)! },
      });
      const sku = await tx.sku.upsert({
        where: { code: item.sku }, update: { productId: product.id, barcode: item.barcode },
        create: { code: item.sku, barcode: item.barcode, productId: product.id, costPrice: item.cost, sellingPrice: item.price,
          priceHistory: { create: { costPrice: item.cost, sellingPrice: item.price } } },
      });
      skus.set(item.sku, sku.id);
    }
    for (const [warehouseIndex, [warehouseCode, warehouseId]] of [...warehouses].entries()) {
      for (const [productIndex, item] of products.entries()) {
        const skuId = skus.get(item.sku)!;
        const existing = await tx.inventory.findUnique({ where: { warehouseId_skuId: { warehouseId, skuId } } });
        if (existing) continue;
        const safetyStock = 18 + ((productIndex * 7 + warehouseIndex * 5) % 25);
        const lowStock = (productIndex + warehouseIndex) % 9 === 0;
        const onHand = lowStock ? (productIndex + warehouseIndex) % 6 : 35 + ((productIndex * 17 + warehouseIndex * 13) % 125);
        const reserved = onHand > safetyStock ? (productIndex + warehouseIndex) % 5 : 0;
        await tx.inventory.create({ data: {
          warehouseId, skuId, onHand, reserved, safetyStock,
          ...(onHand > 0 ? { transactions: { create: { warehouseId, skuId, type: 'INITIAL', quantity: onHand, beforeQuantity: 0, afterQuantity: onHand, referenceType: 'SEED', referenceId: `SEED-${warehouseCode}-${item.sku}`, reason: 'Tồn đầu kỳ dữ liệu demo' } } } : {}),
        } });
      }
    }
    const customers = [
      { code: 'CUS-00001', name: 'Nguyễn Ngọc Minh Anh', phone: '0988123456', email: 'minhanh@gmail.com', note: 'Khách hàng thường xuyên tại chi nhánh Ba Đình.' },
      { code: 'CUS-00002', name: 'Trần Quốc Bảo', phone: '0912556889', email: 'bao.tran@gmail.com', note: 'Ưu tiên liên hệ qua điện thoại.' },
      { code: 'CUS-00003', name: 'Lê Thanh Hương', phone: '0904228116', email: 'huong.le@gmail.com', note: null },
      { code: 'CUS-00004', name: 'Phạm Gia Huy', phone: '0977330225', email: 'huy.pham@gmail.com', note: 'Khách hàng thành viên.' },
      { code: 'CUS-00005', name: 'Đỗ Mỹ Linh', phone: '0935662114', email: 'linh.do@gmail.com', note: null },
      { code: 'CUS-00006', name: 'Vũ Hoàng Nam', phone: '0968114220', email: 'nam.vu@gmail.com', note: null },
      { code: 'CUS-00007', name: 'Ngô Thanh Tâm', phone: '0914225778', email: 'tam.ngo@gmail.com', note: 'Ưu tiên nhận hóa đơn điện tử.' },
      { code: 'CUS-00008', name: 'Bùi Khánh An', phone: '0983771662', email: 'an.bui@gmail.com', note: null },
      { code: 'CUS-00009', name: 'Hoàng Minh Khoa', phone: '0905887331', email: 'khoa.hoang@gmail.com', note: null },
      { code: 'CUS-00010', name: 'Đặng Thu Hà', phone: '0926118554', email: 'ha.dang@gmail.com', note: 'Khách hàng doanh nghiệp nhỏ.' },
    ];
    const customerIds = new Map<string, string>();
    for (const customer of customers) {
      const saved = await tx.customer.upsert({ where: { phone: customer.phone }, update: { name: customer.name, email: customer.email, note: customer.note }, create: customer });
      customerIds.set(customer.code, saved.id);
    }
    const suppliers = [
      { code: 'SUP-0012', name: 'Công ty CP Sữa Việt Nam (Vinamilk)', contactName: 'Phạm Văn Thái', phone: '0912888333', email: 'thai.pv@vinamilk.com.vn', address: '10 Tân Trào, Quận 7, TP.HCM' },
      { code: 'SUP-0045', name: 'Công ty TNHH Masan Consumer', contactName: 'Nguyễn Quỳnh Anh', phone: '0903456789', email: 'anh.nq@masangroup.com', address: '23 Lê Duẩn, Quận 1, TP.HCM' },
      { code: 'SUP-0109', name: 'Công ty CP Chuỗi Thực phẩm TH', contactName: 'Trần Mạnh Cường', phone: '0977112233', email: 'cuong.tm@thmilk.vn', address: '166 Nguyễn Thái Học, Ba Đình, Hà Nội' },
      { code: 'SUP-0088', name: 'Công ty CP Acecook Việt Nam', contactName: 'Đỗ Mai Chi', phone: '0918776655', email: 'chi.dm@acecookvietnam.com', address: 'Lô II-3, KCN Tân Bình, TP.HCM' },
      { code: 'SUP-0032', name: 'Tập đoàn Nước giải khát Tân Hiệp Phát', contactName: 'Hoàng Văn Long', phone: '0934556778', email: 'long.hv@thp.com.vn', address: '219 Đại lộ Bình Dương, Bình Dương' },
    ];
    const supplierIds = new Map<string, string>();
    for (const supplier of suppliers) {
      const saved = await tx.supplier.upsert({ where: { code: supplier.code }, update: supplier, create: supplier });
      supplierIds.set(supplier.code, saved.id);
    }

    const demoNow = new Date();
    const daysAgo = (days: number, hour = 9) => {
      const value = new Date(demoNow);
      value.setDate(value.getDate() - days);
      value.setHours(hour, 0, 0, 0);
      return value;
    };

    const shiftIds = new Map<string, string>();
    for (const [index, storeCode] of ['CN001', 'CN002', 'CN003'].entries()) {
      const openedAt = daysAgo(30 - index, 7);
      const closedAt = daysAgo(1 + index, 22);
      const shift = await tx.workShift.upsert({
        where: { code: `CA-DEMO-00${index + 1}` },
        update: {},
        create: {
          code: `CA-DEMO-00${index + 1}`, storeId: storeIds.get(storeCode)!, cashierId: owner.id,
          posCode: `POS-DEMO-${index + 1}`, name: `Ca bán hàng demo ${index + 1}`, status: 'CLOSED',
          openingCash: 1_000_000, closingCash: 1_000_000, cashDiscrepancy: 0,
          openedAt, closedAt, approvedAt: closedAt, approvedById: owner.id, managerNote: 'Ca dữ liệu demo đã đối soát.',
        },
      });
      shiftIds.set(storeCode, shift.id);
    }

    const shiftRevenue = new Map<string, { cash: number; digital: number }>();
    for (const storeCode of ['CN001', 'CN002', 'CN003']) shiftRevenue.set(storeCode, { cash: 0, digital: 0 });
    for (let index = 0; index < 18; index++) {
      const storeCode = ['CN001', 'CN002', 'CN003'][index % 3]!;
      const warehouseCode = ['KHO001', 'KHO002', 'KHO003'][index % 3]!;
      const warehouseId = warehouses.get(warehouseCode)!;
      const code = `HD-DEMO-${String(index + 1).padStart(3, '0')}`;
      const available = await tx.inventory.findMany({ where: { warehouseId, onHand: { gte: 5 }, skuId: { in: [...skus.values()] } }, orderBy: { skuId: 'asc' } });
      const firstInventory = available[(index * 2) % available.length]!;
      const secondInventory = available[(index * 2 + 5) % available.length]!;
      const firstItem = products.find(item => skus.get(item.sku) === firstInventory.skuId)!;
      const secondItem = products.find(item => skus.get(item.sku) === secondInventory.skuId)!;
      const quantities = [1 + (index % 3), 1 + ((index + 1) % 2)];
      const lines = [firstItem, secondItem].map((item, lineIndex) => ({
        item, skuId: skus.get(item.sku)!, inventory: lineIndex === 0 ? firstInventory : secondInventory,
        quantity: quantities[lineIndex]!, lineTotal: item.price * quantities[lineIndex]!,
      }));
      const subtotal = lines.reduce((sum, line) => sum + line.lineTotal, 0);
      const existingInvoice = await tx.invoice.findUnique({ where: { code } });
      const cashAmount = index % 3 === 0 ? subtotal : Math.floor(subtotal * 0.4);
      const digitalAmount = subtotal - cashAmount;
      const revenue = shiftRevenue.get(storeCode)!;
      revenue.cash += cashAmount;
      revenue.digital += digitalAmount;
      if (existingInvoice) continue;
      const completedAt = daysAgo(index + 1, 8 + (index % 12));
      const customerCode = `CUS-${String((index % customers.length) + 1).padStart(5, '0')}`;
      const customer = customers[index % customers.length]!;
      const invoice = await tx.invoice.create({ data: {
        code, shiftId: shiftIds.get(storeCode)!, warehouseId, storeId: storeIds.get(storeCode)!, cashierId: owner.id,
        customerId: customerIds.get(customerCode), customerName: customer.name, customerPhone: customer.phone,
        subtotal, total: subtotal, status: 'COMPLETED', completedAt, note: 'Hóa đơn dữ liệu demo.',
        items: { create: lines.map(line => ({ skuId: line.skuId, productCode: line.item.code, skuCode: line.item.sku, productName: line.item.name, unit: line.item.unit, quantity: line.quantity, unitPrice: line.item.price, costPrice: line.item.cost, lineTotal: line.lineTotal })) },
        payments: { create: digitalAmount > 0 ? [{ method: 'CASH', amount: cashAmount }, { method: index % 2 ? 'QR' : 'CARD', amount: digitalAmount, reference: `PAY-DEMO-${index + 1}` }] : [{ method: 'CASH', amount: cashAmount }] },
      } });
      for (const line of lines) {
        const current = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId, skuId: line.skuId } } });
        await tx.inventory.update({ where: { id: current.id }, data: {
          onHand: { decrement: line.quantity },
          transactions: { create: { warehouseId, skuId: line.skuId, type: 'SALE', quantity: -line.quantity, beforeQuantity: current.onHand, afterQuantity: current.onHand - line.quantity, referenceType: 'INVOICE', referenceId: invoice.id, reason: `Bán hàng theo ${code}`, actorId: owner.id } },
        } });
      }
    }
    const creditInvoiceCode = 'HD-DEMO-CREDIT-001';
    const creditTotal = 156000;
    const creditAmount = 100000;
    shiftRevenue.get('CN001')!.cash += creditTotal - creditAmount;
    if (!await tx.invoice.findUnique({ where: { code: creditInvoiceCode } })) {
      const warehouseId = warehouses.get('KHO001')!;
      const skuId = skus.get('SKU-DEMO-008')!;
      const inventory = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId, skuId } } });
      const invoice = await tx.invoice.create({ data: {
        code: creditInvoiceCode, shiftId: shiftIds.get('CN001')!, warehouseId, storeId: storeIds.get('CN001')!, cashierId: owner.id,
        customerId: customerIds.get('CUS-00001')!, customerName: customers[0]!.name, customerPhone: customers[0]!.phone,
        subtotal: creditTotal, total: creditTotal, creditAmount, status: 'COMPLETED', completedAt: daysAgo(3, 15), note: 'Hóa đơn bán nợ dữ liệu demo.',
        items: { create: { skuId, productCode: readableProductCodes['PRD-DEMO-008'], skuCode: 'SKU-DEMO-008', productName: 'Sữa tươi TH True Milk ít đường 1L', unit: 'Hộp', quantity: 4, unitPrice: 39000, costPrice: 31500, lineTotal: creditTotal } },
        payments: { create: { method: 'CASH', amount: creditTotal - creditAmount } },
      } });
      await tx.inventory.update({ where: { id: inventory.id }, data: { onHand: { decrement: 4 }, transactions: { create: { warehouseId, skuId, type: 'SALE', quantity: -4, beforeQuantity: inventory.onHand, afterQuantity: inventory.onHand - 4, referenceType: 'INVOICE', referenceId: invoice.id, reason: `Bán hàng theo ${creditInvoiceCode}`, actorId: owner.id } } } });
      const receivable = await tx.receivable.create({ data: { code: 'PT-DEMO-001', invoiceId: invoice.id, customerId: customerIds.get('CUS-00001')!, storeId: storeIds.get('CN001')!, totalAmount: creditAmount, paidAmount: 30000, dueDate: daysAgo(-10), status: 'PARTIALLY_PAID' } });
      await tx.receivablePayment.create({ data: { code: 'TT-DEMO-001', receivableId: receivable.id, amount: 30000, method: 'BANK_TRANSFER', reference: 'CK-DEMO-001', note: 'Thu một phần công nợ khách hàng.', paidById: owner.id, paidAt: daysAgo(1) } });
    }
    for (const storeCode of ['CN001', 'CN002', 'CN003']) {
      const revenue = shiftRevenue.get(storeCode)!;
      await tx.workShift.update({ where: { id: shiftIds.get(storeCode)! }, data: { cashRevenue: revenue.cash, digitalRevenue: revenue.digital, closingCash: 1_000_000 + revenue.cash } });
    }

    const transferCode = 'DC-DEMO-001';
    if (!await tx.stockTransfer.findUnique({ where: { code: transferCode } })) {
      const skuId = skus.get('SKU-DEMO-007')!;
      const sourceWarehouseId = warehouses.get('KHO001')!;
      const destinationWarehouseId = warehouses.get('KHO002')!;
      const quantity = 5;
      const source = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId: sourceWarehouseId, skuId } } });
      const destination = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId: destinationWarehouseId, skuId } } });
      const transfer = await tx.stockTransfer.create({ data: {
        code: transferCode, sourceWarehouseId, destinationWarehouseId, createdById: owner.id, approvedById: owner.id,
        dispatchedById: owner.id, receivedById: owner.id, status: 'COMPLETED', reason: 'Cân đối tồn kho giữa hai chi nhánh.',
        decisionNote: 'Đã duyệt dữ liệu demo.', dispatchNote: 'Đã kiểm đếm khi xuất.', receiptNote: 'Đã nhận đủ hàng.',
        approvedAt: daysAgo(8), dispatchedAt: daysAgo(7), receivedAt: daysAgo(6), createdAt: daysAgo(9),
        items: { create: { skuId, requestedQuantity: quantity, approvedQuantity: quantity, dispatchedQuantity: quantity, receivedQuantity: quantity, discrepancy: 0, costPrice: 14500 } },
      } });
      await tx.inventory.update({ where: { id: source.id }, data: { onHand: { decrement: quantity }, transactions: { create: { warehouseId: sourceWarehouseId, skuId, type: 'TRANSFER_OUT', quantity: -quantity, beforeQuantity: source.onHand, afterQuantity: source.onHand - quantity, referenceType: 'TRANSFER', referenceId: transfer.id, reason: `Xuất chuyển theo ${transferCode}`, actorId: owner.id } } } });
      await tx.inventory.update({ where: { id: destination.id }, data: { onHand: { increment: quantity }, transactions: { create: { warehouseId: destinationWarehouseId, skuId, type: 'TRANSFER_IN', quantity, beforeQuantity: destination.onHand, afterQuantity: destination.onHand + quantity, referenceType: 'TRANSFER', referenceId: transfer.id, reason: `Nhận chuyển theo ${transferCode}`, actorId: owner.id } } } });
    }
    const pendingTransferCode = 'DC-DEMO-002';
    if (!await tx.stockTransfer.findUnique({ where: { code: pendingTransferCode } })) {
      await tx.stockTransfer.create({ data: {
        code: pendingTransferCode, sourceWarehouseId: warehouses.get('KHO003')!, destinationWarehouseId: warehouses.get('KHO001')!, createdById: owner.id,
        status: 'PENDING_APPROVAL', reason: 'Bổ sung hàng bán nhanh cho chi nhánh Ba Đình.', createdAt: daysAgo(1),
        items: { create: { skuId: skus.get('SKU-DEMO-011')!, requestedQuantity: 12, costPrice: 14500 } },
      } });
    }

    for (const [index, status] of ['COUNTING', 'PENDING_APPROVAL'].entries()) {
      const code = `KK-DEMO-00${index + 1}`;
      if (await tx.stocktake.findUnique({ where: { code } })) continue;
      const warehouseId = warehouses.get(index === 0 ? 'KHO001' : 'KHO003')!;
      const inventoryRows = await tx.inventory.findMany({ where: { warehouseId, skuId: { in: [skus.get('SKU-DEMO-015')!, skus.get('SKU-DEMO-020')!, skus.get('SKU-DEMO-030')!] } }, orderBy: { skuId: 'asc' } });
      await tx.stocktake.create({ data: {
        code, warehouseId, createdById: owner.id, type: index === 0 ? 'PERIODIC' : 'SPOT', area: index === 0 ? 'Khu A' : 'Kệ bán nhanh', status,
        note: 'Phiếu kiểm kho dữ liệu demo.', submittedAt: index === 1 ? daysAgo(1) : null, createdAt: daysAgo(2 + index),
        items: { create: inventoryRows.map((inventory, itemIndex) => ({ inventoryId: inventory.id, skuId: inventory.skuId, systemQuantity: inventory.onHand, actualQuantity: index === 1 ? Math.max(0, inventory.onHand + (itemIndex === 0 ? -2 : itemIndex === 1 ? 1 : 0)) : null, difference: index === 1 ? (itemIndex === 0 ? -2 : itemIndex === 1 ? 1 : 0) : null, costPrice: products.find(item => skus.get(item.sku) === inventory.skuId)!.cost, reason: index === 1 ? 'Kiểm đếm thực tế tại quầy.' : null })) },
      } });
    }

    const requestDefinitions = [
      { code: 'PR-DEMO-001', store: 'CN001', sku: 'SKU-DEMO-025', quantity: 40, status: 'PENDING_APPROVAL' },
      { code: 'PR-DEMO-002', store: 'CN002', sku: 'SKU-DEMO-008', quantity: 30, status: 'APPROVED' },
      { code: 'PR-DEMO-003', store: 'CN003', sku: 'SKU-DEMO-019', quantity: 50, status: 'CONVERTED_TO_PO' },
    ];
    const requestIds = new Map<string, string>();
    for (const definition of requestDefinitions) {
      const request = await tx.purchaseRequest.upsert({ where: { code: definition.code }, update: {}, create: {
        code: definition.code, storeId: storeIds.get(definition.store)!, createdById: owner.id,
        approvedById: definition.status === 'PENDING_APPROVAL' ? null : owner.id, status: definition.status,
        reason: 'Bổ sung tồn kho phục vụ bán hàng.', decisionNote: definition.status === 'PENDING_APPROVAL' ? null : 'Đã duyệt số lượng đề nghị.',
        approvedAt: definition.status === 'PENDING_APPROVAL' ? null : daysAgo(4), createdAt: daysAgo(5),
        items: { create: { skuId: skus.get(definition.sku)!, requestedQuantity: definition.quantity, approvedQuantity: definition.status === 'PENDING_APPROVAL' ? null : definition.quantity } },
      } });
      requestIds.set(definition.code, request.id);
    }
    const poCode = 'PO-DEMO-001';
    if (!await tx.purchaseOrder.findUnique({ where: { code: poCode } })) {
      const skuId = skus.get('SKU-DEMO-019')!;
      const orderedQuantity = 50;
      const receivedQuantity = 35;
      const unitCost = 38500;
      const totalAmount = orderedQuantity * unitCost;
      const po = await tx.purchaseOrder.create({ data: {
        code: poCode, purchaseRequestId: requestIds.get('PR-DEMO-003')!, supplierId: supplierIds.get('SUP-0045')!, warehouseId: warehouses.get('KHO003')!, createdById: owner.id,
        status: 'PARTIALLY_RECEIVED', expectedAt: daysAgo(-3), paymentDueAt: daysAgo(-25), note: 'Đơn mua hàng demo nhận nhiều lần.', totalAmount, createdAt: daysAgo(4),
        items: { create: { skuId, orderedQuantity, receivedQuantity, unitCost, lineTotal: totalAmount } },
      }, include: { items: true } });
      const receipt = await tx.goodsReceipt.create({ data: {
        code: 'GR-DEMO-001', purchaseOrderId: po.id, receivedById: owner.id, note: 'Nhận lần 1: còn 15 đơn vị chưa giao.', receivedAt: daysAgo(2),
        items: { create: { purchaseOrderItemId: po.items[0]!.id, skuId, quantity: receivedQuantity, unitCost } },
      } });
      const inventory = await tx.inventory.findUniqueOrThrow({ where: { warehouseId_skuId: { warehouseId: warehouses.get('KHO003')!, skuId } } });
      await tx.inventory.update({ where: { id: inventory.id }, data: { onHand: { increment: receivedQuantity }, transactions: { create: { warehouseId: warehouses.get('KHO003')!, skuId, type: 'PURCHASE_RECEIPT', quantity: receivedQuantity, beforeQuantity: inventory.onHand, afterQuantity: inventory.onHand + receivedQuantity, referenceType: 'GOODS_RECEIPT', referenceId: receipt.id, reason: 'Nhận hàng PO demo', actorId: owner.id } } } });
      const receivedAmount = receivedQuantity * unitCost;
      const paidAmount = 400000;
      const payable = await tx.payable.create({ data: { code: 'CN-DEMO-001', supplierId: supplierIds.get('SUP-0045')!, purchaseOrderId: po.id, totalAmount: receivedAmount, paidAmount, dueDate: daysAgo(-25), status: 'PARTIALLY_PAID' } });
      await tx.payablePayment.create({ data: { code: 'PC-DEMO-001', payableId: payable.id, amount: paidAmount, method: 'BANK_TRANSFER', reference: 'UNC-DEMO-001', note: 'Thanh toán một phần công nợ demo.', paidById: owner.id, paidAt: daysAgo(1) } });
      await tx.supplier.update({ where: { id: supplierIds.get('SUP-0045')! }, data: { currentDebt: { increment: receivedAmount - paidAmount } } });
    }

    const forecastStoreId = storeIds.get('CN001')!;
    let forecastRun = await tx.forecastRun.findFirst({ where: { storeId: forecastStoreId, model: 'seed_weekday_demo_v1' } });
    if (!forecastRun) {
      const forecastFrom = daysAgo(-1);
      const forecastTo = daysAgo(-7);
      forecastRun = await tx.forecastRun.create({ data: {
        storeId: forecastStoreId, horizonDays: 7, historyDays: 60, model: 'seed_weekday_demo_v1', forecastFrom, forecastTo, generatedAt: demoNow,
        forecasts: { create: products.slice(6, 18).map((item, index) => ({ skuId: skus.get(item.sku)!, predictedQuantity: 18 + index * 3, observedQuantity: 8 + index, dataQuality: 'GOOD', availableAtRun: index % 4 === 0 ? 5 : 45 + index, safetyStockAtRun: 20 + index })) },
      } });
      await tx.inventoryRecommendation.createMany({ data: [
        { dedupeKey: `SEED-${forecastRun.id}-TRANSFER`, forecastRunId: forecastRun.id, targetStoreId: forecastStoreId, skuId: skus.get('SKU-DEMO-007')!, type: 'TRANSFER', status: 'PENDING', suggestedQuantity: 18, sourceWarehouseId: warehouses.get('KHO002')!, destinationWarehouseId: warehouses.get('KHO001')!, generatedById: owner.id },
        { dedupeKey: `SEED-${forecastRun.id}-PURCHASE`, forecastRunId: forecastRun.id, targetStoreId: forecastStoreId, skuId: skus.get('SKU-DEMO-011')!, type: 'PURCHASE', status: 'PENDING', suggestedQuantity: 25, destinationWarehouseId: warehouses.get('KHO001')!, generatedById: owner.id },
      ] });
    }
  }, { timeout: 60_000 });
  const [categoryCount, productCount, skuCount, inventoryCount, customerCount, supplierCount] = await Promise.all([
    prisma.category.count(), prisma.product.count(), prisma.sku.count(), prisma.inventory.count(), prisma.customer.count(), prisma.supplier.count(),
  ]);
  console.log(`Seed completed: ${categoryCount} categories, ${productCount} products, ${skuCount} SKUs, ${inventoryCount} inventory rows, ${customerCount} customers, ${supplierCount} suppliers. Existing passwords, transactions and customized roles were preserved.`);
}
seed().catch(error => {
  console.error('Seed failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
})
  .finally(() => prisma.$disconnect());
