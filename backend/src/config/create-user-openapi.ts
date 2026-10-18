const error = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
export const createUserOperation = {
  tags: ['Người dùng'], operationId: 'createUser', summary: 'Tạo người dùng và gán vai trò, chi nhánh',
  security: [{ bearerAuth: [] }],
  description: 'Cần users.manage. Lấy roleIds từ GET /roles và storeIds từ GET /stores. Nhân viên cần ít nhất một chi nhánh hoạt động. OWNER có thể không gán chi nhánh. Người quản lý theo chi nhánh chỉ cấp được các quyền và chi nhánh trong phạm vi của mình, không được cấp vai trò OWNER. Mật khẩu tối thiểu 10 ký tự; email được chuẩn hóa chữ thường. User, phân công và audit được lưu trong cùng transaction.',
  requestBody: { required: true, content: { 'application/json': { schema: {
    type: 'object', additionalProperties: false, required: ['email', 'name', 'password', 'roleIds', 'storeIds'],
    properties: {
      email: { type: 'string', format: 'email', maxLength: 254, example: 'nhanvien01@smartstore.local' },
      name: { type: 'string', minLength: 1, maxLength: 100, example: 'Nhân viên 01' },
      password: { type: 'string', format: 'password', writeOnly: true, minLength: 10, maxLength: 128, description: 'Tự nhập mật khẩu riêng cho tài khoản mới.' },
      active: { type: 'boolean', default: true },
      roleIds: { type: 'array', minItems: 1, maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'uuid' }, description: 'UUID của vai trò Chủ hệ thống, Quản lý chi nhánh hoặc Nhân viên.' },
      storeIds: { type: 'array', maxItems: 100, uniqueItems: true, items: { type: 'string', format: 'uuid' }, description: 'UUID của chi nhánh, không dùng mã CN001.' },
    },
  } } } },
  responses: {
    '201': { description: 'Tạo thành công, không trả mật khẩu hoặc passwordHash.', content: { 'application/json': { schema: {
      type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { $ref: '#/components/schemas/LoginSuccess/properties/data/properties/user' } },
    } } } },
    '400': { description: 'Dữ liệu sai, thiếu chi nhánh, role/chi nhánh không tồn tại hoặc chi nhánh ngưng hoạt động.', ...error },
    '401': { description: 'Chưa đăng nhập hoặc phiên không hợp lệ.', ...error },
    '403': { description: 'Thiếu users.manage hoặc cấp quyền/chi nhánh vượt phạm vi.', ...error },
    '409': { description: 'Email đã tồn tại hoặc dữ liệu thay đổi đồng thời; tải lại trước khi thử lại.', ...error },
    '500': { description: 'Lỗi máy chủ; rollback toàn bộ thao tác tạo.', ...error },
  },
};
