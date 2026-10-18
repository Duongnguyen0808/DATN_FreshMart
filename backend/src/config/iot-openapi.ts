const response = (description: string) => ({
  description,
  content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'object' } } } } },
});

export const iotPaths = {
  '/api/v1/iot/events': {
    get: { tags: ['IoT'], summary: 'Liệt kê sự kiện RFID trong phạm vi kho được cấp quyền', security: [{ bearerAuth: [] }], responses: { '200': response('Danh sách sự kiện'), '401': response('Chưa đăng nhập') } },
    post: {
      tags: ['IoT'], summary: 'Nhận event từ thiết bị RFID; không cập nhật tồn kho', parameters: [{ in: 'header', name: 'x-iot-device-token', required: true, schema: { type: 'string' } }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['eventId', 'deviceId', 'eventType', 'tagId', 'warehouseId', 'timestamp', 'payload'], properties: { eventId: { type: 'string', maxLength: 128 }, deviceId: { type: 'string', maxLength: 100 }, eventType: { type: 'string', enum: ['RFID_DETECTED'] }, tagId: { type: 'string' }, warehouseId: { type: 'string', format: 'uuid' }, timestamp: { type: 'string', format: 'date-time' }, payload: { type: 'object', additionalProperties: true } } } } } },
      responses: { '202': response('Event đã lưu; đang chờ nhân viên xác nhận'), '200': response('Event lặp đã nhận trước đó'), '401': response('Token thiết bị không hợp lệ'), '503': response('Chưa cấu hình token thiết bị') },
    },
  },
  '/api/v1/iot/simulate': {
    post: { tags: ['IoT'], summary: 'Tạo event RFID giả lập cho DEMO MODE', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['eventType', 'tagId', 'warehouseId', 'timestamp'], properties: { eventId: { type: 'string' }, deviceId: { type: 'string' }, eventType: { type: 'string', enum: ['RFID_DETECTED'] }, tagId: { type: 'string' }, warehouseId: { type: 'string', format: 'uuid' }, timestamp: { type: 'string', format: 'date-time' }, payload: { type: 'object' } } } } } }, responses: { '202': response('Event giả lập đã lưu; tồn kho chưa đổi') } },
  },
  '/api/v1/iot/tag-mappings': {
    get: { tags: ['IoT'], summary: 'Liệt kê mapping tag RFID', security: [{ bearerAuth: [] }], responses: { '200': response('Danh sách mapping') } },
    post: { tags: ['IoT'], summary: 'Gán tag RFID cho SKU/pallet/kho', security: [{ bearerAuth: [] }], requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', required: ['tagId', 'skuId', 'warehouseId'], properties: { tagId: { type: 'string' }, skuId: { type: 'string', format: 'uuid' }, warehouseId: { type: 'string', format: 'uuid' }, palletCode: { type: 'string', nullable: true } } } } } }, responses: { '201': response('Mapping đã lưu'), '403': response('Cần quyền warehouses.manage') } },
  },
};
