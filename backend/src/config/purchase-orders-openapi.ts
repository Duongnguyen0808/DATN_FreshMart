const secured = { security: [{ bearerAuth: [] }] };
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const body = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
const responses = (description: string) => ({
  '200': { description }, '400': { description: 'Dữ liệu hoặc số lượng không hợp lệ.' },
  '401': { description: 'Chưa đăng nhập.' }, '403': { description: 'Không có quyền hoặc ngoài phạm vi chi nhánh.' },
  '404': { description: 'Không tìm thấy dữ liệu.' }, '409': { description: 'Trạng thái hoặc số lượng vừa thay đổi.' },
});
const orderLine = { type: 'object', required: ['skuId', 'quantity', 'unitCost'], properties: { skuId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 }, unitCost: { type: 'number', exclusiveMinimum: 0 } } };
const receiptLine = { type: 'object', required: ['purchaseOrderItemId', 'quantity'], properties: { purchaseOrderItemId: { type: 'string', format: 'uuid' }, quantity: { type: 'integer', minimum: 1 } } };
export const purchaseOrderPaths = {
  '/api/v1/purchase-orders': {
    get: { tags: ['Đơn mua hàng'], summary: 'Danh sách và tiến độ đơn mua hàng', description: 'status=OVERDUE lọc PO chưa hoàn tất có hạn giao đã qua. Mỗi PO trả về isOverdue và overdueDays.', ...secured, parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'OPEN', 'PARTIALLY_RECEIVED', 'COMPLETED', 'OVERDUE'] } }, { name: 'supplierId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'warehouseId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'page', in: 'query', schema: { type: 'integer' } }], responses: responses('Danh sách PO theo phạm vi chi nhánh.') },
    post: { tags: ['Đơn mua hàng'], summary: 'Tạo PO từ đề nghị đã duyệt', ...secured, requestBody: body({ type: 'object', required: ['purchaseRequestId', 'supplierId', 'warehouseId', 'expectedAt', 'paymentDueAt', 'items'], properties: { purchaseRequestId: { type: 'string', format: 'uuid' }, supplierId: { type: 'string', format: 'uuid' }, warehouseId: { type: 'string', format: 'uuid' }, expectedAt: { type: 'string', format: 'date-time' }, paymentDueAt: { type: 'string', format: 'date-time' }, note: { type: 'string' }, items: { type: 'array', items: orderLine } } }), responses: { ...responses('Đã tạo PO.'), '201': { description: 'Đã tạo PO và đánh dấu đề nghị đã chuyển đổi.' } } },
  },
  '/api/v1/purchase-orders/{id}': { get: { tags: ['Đơn mua hàng'], summary: 'Chi tiết PO, số đã nhận và lịch sử phiếu nhập', ...secured, parameters: id, responses: responses('Chi tiết PO.') } },
  '/api/v1/purchase-orders/{id}/receipts': { post: { tags: ['Đơn mua hàng'], summary: 'Nhận hàng một phần hoặc toàn bộ PO', description: 'Có thể gọi nhiều lần. Mỗi lần tạo phiếu nhập, tăng tồn thực tế và tính lại số còn lại.', ...secured, parameters: id, requestBody: body({ type: 'object', required: ['items'], properties: { note: { type: 'string' }, evidence: { type: 'array', maxItems: 3, items: { type: 'string', description: 'Compressed JPG, PNG, WEBP, or AVIF data URL, maximum 1.7 MB each.' } }, items: { type: 'array', items: receiptLine } } }), responses: { ...responses('Đã nhận hàng và cập nhật tồn kho.'), '201': { description: 'Đã tạo phiếu nhập hàng.' } } } },
};
