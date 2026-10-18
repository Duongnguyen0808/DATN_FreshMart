const error = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const store = { type: 'object', properties: {
  id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' },
} };
const permission = { type: 'object', properties: { code: { type: 'string' }, name: { type: 'string' } } };
const role = { type: 'object', properties: {
  id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, system: { type: 'boolean' },
  permissions: { type: 'array', items: { type: 'object', properties: { permissionCode: { type: 'string' } } } },
  _count: { type: 'object', properties: { users: { type: 'integer' } } },
} };
function list(summary: string, description: string, items: object) {
  return { get: {
    tags: ['Phân quyền'], summary, description, security: [{ bearerAuth: [] }],
    responses: {
      '200': { description: 'Dữ liệu trong phạm vi được cấp.', content: { 'application/json': { schema: {
        type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'array', items } },
      } } } },
      '401': { description: 'Chưa đăng nhập hoặc phiên không hợp lệ.', ...error },
      '403': { description: 'Thiếu quyền thực hiện chức năng.', ...error },
    },
  } };
}
export const rbacPaths = {
  '/api/v1/users': list('Xem danh sách người dùng', 'Cần users.read. OWNER xem toàn hệ thống. Người được cấp quyền theo chi nhánh chỉ xem nhân viên có tất cả chi nhánh nằm trong phạm vi của mình; không xem tài khoản OWNER.', { $ref: '#/components/schemas/LoginSuccess/properties/data/properties/user' }),
  '/api/v1/roles': list('Xem danh sách vai trò', 'Cần roles.read. Danh mục vai trò dùng chung hệ thống.', role),
  '/api/v1/permissions': list('Xem danh sách quyền', 'Cần permissions.read. Danh mục quyền tương ứng các chức năng Backend hiện có.', permission),
  '/api/v1/stores': list('Xem các chi nhánh được phép truy cập', 'Cần stores.read. OWNER xem mọi chi nhánh đang hoạt động; nhân viên chỉ xem chi nhánh đang hoạt động được phân công. Chưa phân công trả danh sách rỗng.', store),
  '/api/v1/stores/{id}': { get: {
    tags: ['Phân quyền'], summary: 'Kiểm tra quyền truy cập một chi nhánh', security: [{ bearerAuth: [] }],
    description: 'Cần stores.read và chi nhánh nằm trong phạm vi được phân công, hoặc vai trò OWNER. Không nhận phạm vi quyền từ query/header do client gửi.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
    responses: {
      '200': { description: 'Chi nhánh được phép truy cập.', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: store } } } } },
      '400': { description: 'ID không phải UUID.', ...error },
      '401': { description: 'Phiên không hợp lệ.', ...error },
      '403': { description: 'Thiếu quyền hoặc chi nhánh ngoài phạm vi.', ...error },
      '404': { description: 'Không tìm thấy chi nhánh đang hoạt động trong phạm vi được phép.', ...error },
    },
  } },
};
