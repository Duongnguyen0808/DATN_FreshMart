const secured = { security: [{ bearerAuth: [] }] };
const error = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const responses = (description: string) => ({
  '200': { description }, '400': { description: 'Dữ liệu không hợp lệ.', ...error }, '401': { description: 'Chưa đăng nhập.', ...error },
  '403': { description: 'Không có quyền hoặc ngoài phạm vi chi nhánh.', ...error }, '404': { description: 'Không tìm thấy ca, chi nhánh hoặc nhân viên.', ...error },
  '409': { description: 'Trạng thái ca đã thay đổi hoặc thu ngân/POS đang có ca mở.', ...error },
});
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const shift = { type: 'object', properties: {
  id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, status: { type: 'string', enum: ['OPEN', 'PENDING_REVIEW', 'CLOSED'] },
  posCode: { type: 'string' }, name: { type: 'string' }, openingCash: { type: 'number' }, cashRevenue: { type: 'number' }, digitalRevenue: { type: 'number' },
  cashExpenses: { type: 'number' }, closingCash: { type: 'number', nullable: true }, cashDiscrepancy: { type: 'number', nullable: true }, discrepancyReason: { type: 'string', nullable: true },
  openedAt: { type: 'string', format: 'date-time' }, closedAt: { type: 'string', format: 'date-time', nullable: true },
  store: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' } } },
  cashier: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, email: { type: 'string' } } },
} };
const openBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['storeId', 'cashierId', 'posCode', 'name', 'openingCash'], properties: {
  storeId: { type: 'string', format: 'uuid' }, cashierId: { type: 'string', format: 'uuid' }, posCode: { type: 'string', example: 'POS-01' }, name: { type: 'string', example: 'Ca sáng' }, openingCash: { type: 'number', minimum: 0, example: 1500000 },
} } } } };
const closeBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['closingCash'], properties: {
  closingCash: { type: 'number', minimum: 0 }, cashExpenses: { type: 'number', minimum: 0, default: 0 }, discrepancyReason: { type: 'string', nullable: true, maxLength: 500 },
  denominations: { type: 'array', maxItems: 30, items: { type: 'object', required: ['value', 'count'], properties: { value: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 0 } } } },
} } } } };

export const shiftPaths = {
  '/api/v1/shift-staff': { get: { tags: ['Ca làm việc'], summary: 'Danh sách nhân viên có thể được mở ca', description: 'Lọc theo phạm vi chi nhánh của người dùng hiện tại.', ...secured, parameters: [{ name: 'storeId', in: 'query', schema: { type: 'string', format: 'uuid' } }], responses: responses('Danh sách nhân viên.') } },
  '/api/v1/shifts': {
    get: { tags: ['Ca làm việc'], summary: 'Danh sách và thống kê ca làm việc', description: 'Người quản lý xem các ca trong phạm vi; thu ngân chỉ xem ca của mình.', ...secured, parameters: [
      { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'OPEN', 'PENDING_REVIEW', 'CLOSED'] } },
      { name: 'storeId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'cashierId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } }, { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100 } },
    ], responses: responses('Danh sách ca làm việc.') },
    post: { tags: ['Ca làm việc'], summary: 'Mở ca mới', description: 'Mỗi thu ngân và mỗi máy POS chỉ có một ca OPEN. Nhân viên phải thuộc chi nhánh.', ...secured, requestBody: openBody, responses: { ...responses('Đã mở ca.'), '201': { description: 'Đã mở ca.', content: { 'application/json': { schema: shift } } } } },
  },
  '/api/v1/shifts/{id}': { get: { tags: ['Ca làm việc'], summary: 'Chi tiết ca làm việc', ...secured, parameters: id, responses: responses('Chi tiết ca.') } },
  '/api/v1/shifts/{id}/close': { post: { tags: ['Ca làm việc'], summary: 'Kiểm đếm và chốt ca', description: 'Tự tính: chênh lệch = tiền thực tế - (tiền đầu ca + doanh thu tiền mặt - chi tiền mặt). Có chênh lệch bắt buộc nhập lý do và chuyển sang chờ duyệt.', ...secured, parameters: id, requestBody: closeBody, responses: responses('Đã chốt ca.') } },
  '/api/v1/shifts/{id}/approve': { post: { tags: ['Ca làm việc'], summary: 'Duyệt chênh lệch và khóa sổ ca', description: 'Chỉ người có shifts.approve và đúng phạm vi chi nhánh.', ...secured, parameters: id, requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, properties: { managerNote: { type: 'string', nullable: true, maxLength: 500 } } } } } }, responses: responses('Đã duyệt và khóa sổ ca.') } },
};
