import { createUserOperation } from './create-user-openapi.js';
import { rbacPaths } from './rbac-openapi.js';

const user = { $ref: '#/components/schemas/LoginSuccess/properties/data/properties/user' };
const error = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const response = { description: 'Thành công. Các phân công chi nhánh bao gồm trạng thái active để quản trị.', content: { 'application/json': { schema: {
  type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: user },
} } } };
const errors = {
  '400': { description: 'Dữ liệu không hợp lệ; PUT cần đầy đủ email, name, active, roleIds, storeIds.', ...error },
  '401': { description: 'Phiên không hợp lệ hoặc tài khoản bị khóa.', ...error },
  '403': { description: 'Thiếu quyền, ngoài phạm vi chi nhánh hoặc người đích có quyền cao hơn người thực hiện.', ...error },
  '404': { description: 'Người dùng không tồn tại.', ...error },
  '409': { description: 'Email trùng, xung đột đồng thời hoặc LAST_OWNER: không được khóa/hạ vai trò chủ doanh nghiệp cuối cùng.', ...error },
};
const parameters = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const base = { tags: ['Người dùng'], security: [{ bearerAuth: [] }], parameters };
const createSchema = createUserOperation.requestBody.content['application/json'].schema;
export const usersPaths = {
  '/api/v1/users': {
    post: createUserOperation,
    get: {
      ...rbacPaths['/api/v1/users'].get, tags: ['Người dùng'], operationId: 'listUsers',
      parameters: [
        { name: 'q', in: 'query', description: 'Tìm tên/email, không phân biệt hoa thường.', schema: { type: 'string', maxLength: 100 } },
        { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false'] } },
        ...['roleId', 'storeId'].map(name => ({ name, in: 'query', schema: { type: 'string', format: 'uuid' } })),
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100000, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 25 } },
      ],
      responses: { ...errors, '200': { description: 'Danh sách theo phạm vi, có pagination. Bộ lọc không mở rộng quyền truy cập.', content: { 'application/json': { schema: {
        type: 'object', properties: {
          success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'array', items: user },
          pagination: { type: 'object', properties: { page: { type: 'integer' }, pageSize: { type: 'integer' }, total: { type: 'integer' }, totalPages: { type: 'integer' } } },
        },
      } } } } },
    },
  },
  '/api/v1/users/{id}': {
    get: { ...base, operationId: 'getUser', summary: 'Xem chi tiết người dùng', description: 'Cần users.read. Áp dụng cùng phạm vi như danh sách; không trả mật khẩu/hash.', responses: { ...errors, '200': response } },
    put: {
      ...base, operationId: 'updateUser', summary: 'Sửa thông tin, vai trò và chi nhánh',
      description: 'Cần users.manage. Gửi đầy đủ thông tin; roleIds/storeIds thay thế phân công cũ. Bỏ password để giữ mật khẩu. Không bỏ active để tránh vô tình mở khóa tài khoản. Thu hồi mọi phiên của người dùng sau khi lưu. Nếu tự sửa mình, đăng nhập lại. Không được cấp quyền vượt phạm vi hoặc hạ vai trò OWNER cuối cùng.',
      requestBody: { required: true, content: { 'application/json': { schema: { ...createSchema, required: ['email', 'name', 'active', 'roleIds', 'storeIds'] } } } },
      responses: { ...errors, '200': response },
    },
  },
  '/api/v1/users/{id}/status': { patch: {
    ...base, operationId: 'changeUserStatus', summary: 'Khóa hoặc mở khóa tài khoản',
    description: 'Cần users.manage. active=false khóa, active=true mở khóa. Khóa thu hồi mọi phiên; mở khóa không khôi phục phiên cũ. Gửi lại trạng thái hiện tại không tạo audit trùng. Không thể khóa OWNER cuối cùng.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['active'], properties: { active: { type: 'boolean' } } }, example: { active: false } } } },
    responses: { ...errors, '200': response },
  } },
  '/api/v1/users/{id}/password': { put: {
    ...base, operationId: 'resetUserPassword', summary: 'Quản trị đặt lại mật khẩu người dùng',
    description: 'Cần users.manage và quyền quản lý người đích. Đây là thao tác quản trị, không phải luồng quên mật khẩu công khai. Thu hồi toàn bộ phiên sau khi đổi; không tự mở khóa tài khoản.',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['password'], properties: { password: createSchema.properties.password } } } } },
    responses: { ...errors, '200': { description: 'Đã đổi mật khẩu, cần đăng nhập lại.', content: { 'application/json': { example: { success: true, message: 'Đã đổi mật khẩu. Người dùng cần đăng nhập lại.', data: null } } } } },
  } },
};
