const secured = { security: [{ bearerAuth: [] }] };
const error = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const responses = (description: string) => ({ '200': { description }, '400': { description: 'Dữ liệu khách hàng không hợp lệ.', ...error }, '401': { description: 'Chưa đăng nhập.', ...error }, '403': { description: 'Không có quyền thực hiện.', ...error }, '404': { description: 'Không tìm thấy khách hàng.', ...error }, '409': { description: 'Số điện thoại đã được sử dụng.', ...error } });
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const body = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['name', 'phone'], properties: { name: { type: 'string', minLength: 2, maxLength: 120 }, phone: { type: 'string', minLength: 8, maxLength: 20 }, email: { type: 'string', format: 'email', nullable: true }, note: { type: 'string', maxLength: 500, nullable: true } } } } } };
const statusBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['active'], properties: { active: { type: 'boolean' } } } } } };

export const customerPaths = {
  '/api/v1/customers': {
    get: { tags: ['Khách hàng'], summary: 'Danh sách và tìm kiếm khách hàng', ...secured, parameters: [{ name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } }, { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'all' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } }], responses: responses('Danh sách khách hàng cùng tổng số đơn và chi tiêu.') },
    post: { tags: ['Khách hàng'], summary: 'Thêm khách hàng', description: 'Mã khách hàng được hệ thống tự sinh; số điện thoại không được trùng.', ...secured, requestBody: body, responses: { ...responses('Đã thêm khách hàng.'), '201': { description: 'Đã thêm khách hàng.' } } },
  },
  '/api/v1/customers/{id}': {
    get: { tags: ['Khách hàng'], summary: 'Chi tiết khách hàng và lịch sử hóa đơn', ...secured, parameters: id, responses: responses('Chi tiết khách hàng.') },
    put: { tags: ['Khách hàng'], summary: 'Cập nhật khách hàng', ...secured, parameters: id, requestBody: body, responses: responses('Đã cập nhật khách hàng.') },
  },
  '/api/v1/customers/{id}/status': { patch: { tags: ['Khách hàng'], summary: 'Ngừng hoặc mở lại hồ sơ khách hàng', ...secured, parameters: id, requestBody: statusBody, responses: responses('Đã đổi trạng thái khách hàng.') } },
};
