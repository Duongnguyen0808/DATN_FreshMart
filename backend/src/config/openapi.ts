import { rbacPaths } from './rbac-openapi.js';
import { usersPaths } from './users-openapi.js';
import { organizationPaths } from './organization-openapi.js';
import { productPaths } from './products-openapi.js';
import { shiftPaths } from './shifts-openapi.js';
import { invoicePaths } from './invoices-openapi.js';
import { inventoryPaths } from './inventory-openapi.js';
import { stocktakePaths } from './stocktakes-openapi.js';
import { transferPaths } from './transfers-openapi.js';
import { supplierPaths } from './suppliers-openapi.js';
import { purchaseRequestPaths } from './purchase-requests-openapi.js';
import { purchaseOrderPaths } from './purchase-orders-openapi.js';
import { payablePaths } from './payables-openapi.js';
import { receivablePaths } from './receivables-openapi.js';
import { reconciliationPaths } from './reconciliations-openapi.js';
import { dashboardPaths } from './dashboard-openapi.js';
import { reportPaths } from './reports-openapi.js';
import { customerPaths } from './customers-openapi.js';
import { forecastPaths } from './forecasts-openapi.js';
import { recommendationPaths } from './recommendations-openapi.js';
import { notificationPaths } from './notifications-openapi.js';
import { iotPaths } from './iot-openapi.js';

const healthResponse = {
  description: 'Service status',
  content: { 'application/json': { schema: {
    type: 'object', required: ['success', 'message', 'data'],
    properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'object' } },
  } } },
};
export const openapi = {
  openapi: '3.0.3',
  info: { title: 'Smart Store API', version: '0.2.1', description: 'Đăng nhập với client: mobile, sao chép accessToken vào Authorize (không thêm chữ Bearer). Dùng GET /auth/me để kiểm tra phiên trước và sau POST /auth/logout.' },
  tags: [{ name: 'Auth', description: 'Đăng nhập, đăng xuất và làm mới phiên' }, { name: 'Phân quyền', description: 'Đổi accessToken trong Authorize để so sánh OWNER và thu ngân.' }, { name: 'Người dùng', description: 'Tạo tài khoản và phân công vai trò, chi nhánh.' }, { name: 'Khách hàng', description: 'Hồ sơ khách hàng và lịch sử mua hàng.' }, { name: 'Sản phẩm', description: 'Danh mục, sản phẩm, SKU, barcode và lịch sử giá.' }, { name: 'Ca làm việc', description: 'Mở ca, kiểm đếm, chốt ca và duyệt chênh lệch.' }, { name: 'Hóa đơn', description: 'Bán hàng, thanh toán kết hợp và hủy hóa đơn.' }, { name: 'Tồn kho', description: 'Tồn theo SKU/kho và lịch sử biến động.' }, { name: 'Kiểm kho', description: 'Kiểm đếm, chênh lệch và phê duyệt điều chỉnh.' }, { name: 'Nhà cung cấp', description: 'Hồ sơ, liên hệ, trạng thái hợp tác và công nợ hiện tại.' }, { name: 'Đề nghị mua', description: 'Tạo, điều chỉnh, phê duyệt và từ chối nhu cầu mua hàng.' }, { name: 'Đơn mua hàng', description: 'Tạo PO, theo dõi và nhận hàng nhiều lần.' }],
  components: {
    securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Dán accessToken nhận từ đăng nhập, không thêm tiền tố Bearer.' } },
    schemas: {
      LoginInput: {
        type: 'object', additionalProperties: false, required: ['email', 'password', 'client'],
        properties: {
          email: { type: 'string', format: 'email', maxLength: 254, example: 'owner@smartstore.local' },
          password: { type: 'string', format: 'password', minLength: 1, maxLength: 128, description: 'Mật khẩu tài khoản ứng dụng, không phải mật khẩu PostgreSQL.' },
          client: { type: 'string', enum: ['mobile', 'web'], default: 'mobile', description: 'mobile: refresh token trong JSON. web: refresh token trong cookie HttpOnly, yêu cầu Origin được cấu hình.' },
        },
      },
      LoginSuccess: {
        type: 'object', required: ['success', 'message', 'data'],
        properties: {
          success: { type: 'boolean', enum: [true] }, message: { type: 'string', example: 'Success' },
          data: {
            type: 'object', required: ['accessToken', 'user'],
            properties: {
              accessToken: { type: 'string', description: 'JWT có thời hạn 15 phút.' },
              refreshToken: { type: 'string', description: 'Chỉ trả trong JSON cho client mobile; phiên có thời hạn 7 ngày.' },
              user: {
                type: 'object', required: ['id', 'email', 'name', 'active', 'globalAccess', 'roles', 'permissions', 'stores'],
                properties: {
                  id: { type: 'string', format: 'uuid' }, email: { type: 'string', format: 'email' },
                  name: { type: 'string' }, active: { type: 'boolean' }, globalAccess: { type: 'boolean' },
                  roles: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' } } } },
                  permissions: { type: 'array', items: { type: 'string' } },
                  stores: { type: 'array', items: { type: 'object', properties: { id: { type: 'string', format: 'uuid' }, code: { type: 'string' }, name: { type: 'string' }, active: { type: 'boolean' } } } },
                },
              },
            },
          },
        },
      },
      Error: {
        type: 'object', required: ['success', 'message', 'code'],
        properties: { success: { type: 'boolean', enum: [false] }, message: { type: 'string' }, code: { type: 'string' } },
      },
    },
  },
  paths: {
    ...iotPaths,
    ...rbacPaths,
    ...usersPaths,
    ...organizationPaths,
    ...productPaths,
    ...shiftPaths,
    ...invoicePaths,
    ...inventoryPaths,
    ...stocktakePaths,
    ...transferPaths,
    ...supplierPaths,
    ...purchaseRequestPaths,
    ...purchaseOrderPaths,
    ...payablePaths,
    ...receivablePaths,
    ...reconciliationPaths,
    ...dashboardPaths,
    ...reportPaths,
    ...forecastPaths,
    ...recommendationPaths,
    ...notificationPaths,
    ...customerPaths,
    '/api/v1/auth/refresh': { post: {
      tags: ['Auth'], operationId: 'refreshSession', summary: 'Làm mới access token bằng refresh token', security: [],
      description: 'Không cần access token còn hạn. Mobile gửi refreshToken trong JSON; Web gửi client: web và cookie HttpOnly. Mỗi lần thành công phải lưu refresh token mới. Dùng lại token cũ hoặc gửi hai yêu cầu refresh đồng thời sẽ thu hồi phiên đó, kể cả token mới vừa cấp; các phiên khác không bị ảnh hưởng. Thời hạn phiên vẫn là 7 ngày kể từ đăng nhập, không được kéo dài khi refresh.',
      requestBody: { required: true, content: { 'application/json': {
        schema: { type: 'object', additionalProperties: false, required: ['client'], properties: {
          client: { type: 'string', enum: ['mobile', 'web'], default: 'mobile' },
          refreshToken: { type: 'string', maxLength: 100, description: 'Cần cho mobile; lấy từ response đăng nhập hoặc lần refresh gần nhất. Web dùng cookie.' },
        } },
        examples: {
          mobile: { summary: 'Thử trên Swagger', value: { client: 'mobile', refreshToken: 'DAN_REFRESH_TOKEN_MOI_NHAT_VAO_DAY' } },
          web: { summary: 'Web dùng cookie từ đăng nhập', value: { client: 'web' } },
        },
      } } },
      responses: {
        '200': { description: 'Token mới và thông tin người dùng hiện tại. Web thay cookie HttpOnly, không trả refreshToken trong JSON.', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginSuccess' } } } },
        '400': { description: 'Body không hợp lệ hoặc client không được hỗ trợ.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '401': { description: 'Thiếu/sai/token cũ; phiên hết hạn, đã đăng xuất hoặc tài khoản bị khóa.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', code: 'UNAUTHENTICATED' } } } },
        '403': { description: 'Origin không được phép hoặc Web thiếu Origin.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '500': { description: 'Lỗi máy chủ; không tự xóa cookie đăng nhập khi gặp lỗi tạm thời.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    } },
    '/api/v1/auth/logout': { post: {
      tags: ['Auth'], operationId: 'logout', summary: 'Đăng xuất phiên hiện tại',
      security: [{ bearerAuth: [] }],
      description: 'Không cần body (hoặc gửi {}). Phiên được xác định từ access token, không nhận userId/sessionId từ client. Thu hồi cả access token và refresh token của phiên này; giữ nguyên các phiên khác. Xóa cookie refresh của trình duyệt. Cần access token còn hạn; token thiếu, hết hạn hoặc đã thu hồi trả 401. Hai yêu cầu đồng thời có thể cùng trả 200 nhưng chỉ ghi một audit log.',
      responses: {
        '200': { description: 'Đã thu hồi phiên hiện tại.', content: { 'application/json': { schema: {
          type: 'object', required: ['success', 'message', 'data'], properties: {
            success: { type: 'boolean', enum: [true] }, message: { type: 'string' }, data: { type: 'object', nullable: true },
          },
        }, example: { success: true, message: 'Đã đăng xuất.', data: null } } } },
        '400': { description: 'Body có trường không được hỗ trợ.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '401': { description: 'Thiếu token, token sai/hết hạn, phiên đã thu hồi hoặc tài khoản bị khóa.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Phiên đăng nhập không hợp lệ hoặc đã hết hạn.', code: 'UNAUTHENTICATED' } } } },
        '403': { description: 'Origin không được phép.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '500': { description: 'Lỗi máy chủ. Việc thu hồi phiên và ghi audit được rollback cùng nhau.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    } },
    '/api/v1/auth/me': { get: {
      tags: ['Auth'], operationId: 'currentUser', summary: 'Kiểm tra phiên đăng nhập hiện tại', security: [{ bearerAuth: [] }],
      description: 'Dùng để kiểm tra token: trước đăng xuất trả 200; sau đăng xuất dùng lại token đó trả 401.',
      responses: {
        '200': { description: 'Thông tin người dùng của phiên hợp lệ.', content: { 'application/json': { schema: {
          type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { $ref: '#/components/schemas/LoginSuccess/properties/data/properties/user' } },
        } } } },
        '401': { description: 'Phiên không hợp lệ.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    } },
    '/api/v1/auth/login': { post: {
      tags: ['Auth'], operationId: 'login', summary: 'Đăng nhập bằng email và mật khẩu',
      description: 'Tài khoản không tồn tại, sai mật khẩu và tài khoản bị khóa đều trả cùng lỗi 401. Giới hạn 10 lần thất bại trong 15 phút cho mỗi IP. Không nhập mật khẩu thật vào ví dụ lưu trong mã nguồn.',
      requestBody: { required: true, content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginInput' } } } },
      responses: {
        '200': { description: 'Đăng nhập thành công. Với client web, refresh token nằm trong cookie HttpOnly SameSite=Strict.', content: { 'application/json': { schema: { $ref: '#/components/schemas/LoginSuccess' } } } },
        '400': { description: 'Thiếu trường, email sai định dạng hoặc dữ liệu không hợp lệ.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Invalid input', code: 'VALIDATION_ERROR' } } } },
        '401': { description: 'Sai thông tin đăng nhập hoặc tài khoản bị khóa.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' }, example: { success: false, message: 'Email hoặc mật khẩu không đúng, hoặc tài khoản đã bị khóa.', code: 'INVALID_CREDENTIALS' } } } },
        '403': { description: 'Origin không được phép hoặc client web thiếu Origin.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '429': { description: 'Quá số lần đăng nhập thất bại. Thử lại sau thời gian Retry-After.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
        '500': { description: 'Lỗi máy chủ.', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } },
      },
    } },
    '/health': { get: { summary: 'Process health', responses: { '200': healthResponse } } },
    '/api/v1/health': { get: { summary: 'Process health (versioned)', responses: { '200': healthResponse } } },
    '/api/v1/health/ready': { get: { summary: 'PostgreSQL readiness', responses: {
      '200': healthResponse, '503': { description: 'Database unavailable' },
    } } },
  },
};
