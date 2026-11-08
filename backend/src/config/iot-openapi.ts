const response = (description: string) => ({
  description,
  content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'object' } } } } },
});

export const iotPaths = {
  '/api/v1/iot/events/{id}/confirm': {
    post: { tags: ['IoT'], summary: 'Xác nhận kiện đã quét QR; cần purchase_orders.receive', security: [{ bearerAuth: [] }], parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false } } } }, responses: { '200': response('Đã nhận hoặc kiện đã nhận trước đó'), '403': response('Không có quyền nhận tại kho'), '409': response('Kiện hoặc đơn mua hàng không hợp lệ') } },
  },
  '/api/v1/iot/inbound-parcels': {
    get: { tags: ['IoT'], summary: 'Danh sách kiện RFID đã đăng ký trong kho', security: [{ bearerAuth: [] }], parameters: [{ in: 'query', name: 'warehouseId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': response('200 kiện gần nhất'), '403': response('Ngoài phạm vi kho') } },
    post: { tags: ['IoT'], summary: 'Đăng ký kiện RFID theo đơn mua hàng; mã kiện và mã lô nội bộ tự tạo từ UID', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tagId', 'deviceId', 'purchaseOrderItemId', 'quantity', 'expiresAt', 'noExpiry'], properties: { tagId: { type: 'string' }, palletCode: { type: 'string', description: 'Không bắt buộc; mặc định tự tạo từ UID thẻ.' }, deviceId: { type: 'string' }, purchaseOrderItemId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 }, lotCode: { type: 'string', description: 'Không bắt buộc; mặc định tự tạo từ UID thẻ.' }, expiresAt: { type: 'string', format: 'date', nullable: true }, noExpiry: { type: 'boolean' } } } } } }, responses: { '201': response('Đã đăng ký; chưa tăng tồn'), '409': response('Thẻ trùng, vượt số lượng đơn mua hàng hoặc hàng hết hạn') } },
  },
  '/api/v1/iot/inbound-parcels/{id}/cancel': {
    post: { tags: ['IoT'], summary: 'Hủy đăng ký kiện chưa nhận', security: [{ bearerAuth: [] }], parameters: [{ in: 'path', name: 'id', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': response('Đã hủy; không thay đổi tồn'), '409': response('Kiện đã nhận hoặc đã hủy') } },
  },
  '/api/v1/iot/events': {
    get: { tags: ['IoT'], summary: 'Liệt kê sự kiện quét kiện trong phạm vi kho được cấp quyền', security: [{ bearerAuth: [] }], responses: { '200': response('Danh sách sự kiện'), '401': response('Chưa đăng nhập') } },
    post: {
      tags: ['IoT'], summary: 'Nhận mã QR kiện từ ESP32-CAM; RFID kiện cũ trả 410', parameters: [{ in: 'header', name: 'x-iot-device-token', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['eventId', 'deviceId', 'eventType', 'tagId', 'warehouseId', 'timestamp', 'payload'], properties: { eventId: { type: 'string', maxLength: 128 }, deviceId: { type: 'string', maxLength: 100 }, eventType: { type: 'string', enum: ['CAMERA_CODE_DETECTED'] }, tagId: { type: 'string' }, warehouseId: { type: 'string', format: 'uuid' }, timestamp: { type: 'string', format: 'date-time' }, payload: { type: 'object', additionalProperties: true } } } } } },
      responses: { '202': response('Event đã lưu; đang chờ nhân viên xác nhận'), '200': response('Event lặp đã nhận trước đó'), '401': response('Token thiết bị không hợp lệ'), '503': response('Chưa cấu hình token thiết bị') },
    },
  },
  '/api/v1/iot/tag-mappings': {
    get: { tags: ['IoT'], summary: 'Liệt kê mapping tag RFID', security: [{ bearerAuth: [] }], responses: { '200': response('Danh sách mapping') } },
    post: { tags: ['IoT'], summary: 'Gán tag RFID cho SKU/pallet/kho', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tagId', 'skuId', 'warehouseId'], properties: { tagId: { type: 'string' }, skuId: { type: 'string', format: 'uuid' }, warehouseId: { type: 'string', format: 'uuid' }, palletCode: { type: 'string', nullable: true } } } } } }, responses: { '201': response('Mapping đã lưu'), '403': response('Cần quyền warehouses.manage') } },
  },
  '/api/v1/iot/access/monitor': { get: { tags: ['IoT'], summary: 'Trạng thái thiết bị, cửa, thẻ, sự kiện và cảnh báo kho', security: [{ bearerAuth: [] }], parameters: [{ in: 'query', name: 'warehouseId', required: true, schema: { type: 'string', format: 'uuid' } }], responses: { '200': response('Ảnh chụp trạng thái truy cập cửa kho'), '403': response('Ngoài phạm vi kho') } } },
  '/api/v1/iot/access/devices': { post: { tags: ['IoT'], summary: 'Đăng ký thiết bị ESP32 cho kho; cần warehouses.manage', security: [{ bearerAuth: [] }], responses: { '201': response('Đã lưu thiết bị') } } },
  '/api/v1/iot/access/doors': { post: { tags: ['IoT'], summary: 'Đăng ký cửa và cảm biến cho thiết bị', security: [{ bearerAuth: [] }], responses: { '201': response('Đã lưu cửa') } } },
  '/api/v1/iot/access/cards': { post: { tags: ['IoT'], summary: 'Gán hoặc khóa UID thẻ nhân viên kho', security: [{ bearerAuth: [] }], responses: { '201': response('Đã lưu thẻ') } } },
  '/api/v1/iot/access/rfid': { post: { tags: ['IoT'], summary: 'RC522 báo UID thẻ nhân viên; backend xác thực', parameters: [{ in: 'header', name: 'x-iot-device-token', required: true, schema: { type: 'string' } }], responses: { '202': response('Đã ghi nhận và xác thực'), '200': response('Sự kiện lặp đã bỏ qua') } } },
  '/api/v1/iot/door/event': { post: { tags: ['IoT'], summary: 'Reed Switch báo OPEN/CLOSED; backend kiểm tra quyền và cảnh báo', parameters: [{ in: 'header', name: 'x-iot-device-token', required: true, schema: { type: 'string' } }], responses: { '202': response('Đã ghi nhận trạng thái cửa'), '200': response('Trạng thái lặp đã bỏ qua'), '409': response('Đổi trạng thái quá nhanh, gửi lại sau') } } },
  '/api/v1/iot/access/heartbeat': { post: { tags: ['IoT'], summary: 'ESP32 báo còn trực tuyến', parameters: [{ in: 'header', name: 'x-iot-device-token', required: true, schema: { type: 'string' } }], responses: { '200': response('Đã cập nhật thời gian hoạt động') } } },
  '/api/v1/iot/access/simulate': { post: { tags: ['IoT'], summary: 'Mô phỏng quét thẻ/mở cửa khi ESP32 offline; cần warehouses.manage', security: [{ bearerAuth: [] }], responses: { '202': response('Sự kiện mô phỏng đi qua cùng backend'), '409': response('Thiết bị thật đang trực tuyến') } } },
  '/api/v1/iot/access/alerts/{id}/resolve': { post: { tags: ['IoT'], summary: 'Đánh dấu đã xử lý cảnh báo cửa kho', security: [{ bearerAuth: [] }], responses: { '200': response('Đã xử lý cảnh báo') } } },
};
