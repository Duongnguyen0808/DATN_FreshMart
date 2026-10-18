const secured = { security: [{ bearerAuth: [] }] };
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const responses = (description: string) => ({
  '200': { description },
  '400': { description: 'Dữ liệu thu tiền không hợp lệ hoặc vượt quá số dư.' },
  '401': { description: 'Chưa đăng nhập.' },
  '403': { description: 'Không có quyền hoặc ngoài phạm vi chi nhánh.' },
  '404': { description: 'Không tìm thấy khoản phải thu.' },
  '409': { description: 'Khoản phải thu đã được thanh toán hoặc vừa thay đổi.' },
});

export const receivablePaths = {
  '/api/v1/receivables': { get: {
    tags: ['Công nợ'], summary: 'Danh sách công nợ phải thu khách hàng',
    description: 'Theo dõi công nợ phát sinh từ hóa đơn bán chịu và tự giới hạn theo phạm vi chi nhánh.',
    ...secured,
    parameters: [
      { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
      { name: 'status', in: 'query', schema: { type: 'string', enum: ['all', 'OPEN', 'PARTIALLY_PAID', 'PAID', 'DUE_SOON', 'OVERDUE'], default: 'all' } },
      { name: 'customerId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      { name: 'storeId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    ],
    responses: responses('Danh sách phải thu và tổng hợp đã thu, sắp đến hạn, quá hạn.'),
  } },
  '/api/v1/receivables/{id}': { get: {
    tags: ['Công nợ'], summary: 'Chi tiết khoản phải thu và lịch sử thu tiền',
    ...secured, parameters: id, responses: responses('Chi tiết khoản phải thu.'),
  } },
  '/api/v1/receivables/{id}/payments': { post: {
    tags: ['Công nợ'], summary: 'Thu một phần hoặc toàn bộ công nợ khách hàng',
    description: 'Mỗi lần thu được lưu thành một giao dịch riêng; trạng thái công nợ được cập nhật tự động.',
    ...secured, parameters: id,
    requestBody: { required: true, content: { 'application/json': { schema: {
      type: 'object', additionalProperties: false, required: ['amount', 'method'], properties: {
        amount: { type: 'number', exclusiveMinimum: 0 },
        method: { type: 'string', enum: ['CASH', 'QR', 'CARD'] },
        reference: { type: 'string', nullable: true, description: 'Bắt buộc với QR và CARD.' },
        note: { type: 'string', nullable: true },
      },
    } } } },
    responses: { ...responses('Đã thu tiền và cập nhật số dư.'), '201': { description: 'Đã lưu giao dịch thu tiền.' } },
  } },
};
