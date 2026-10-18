const error = { content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } };
const secured = { security: [{ bearerAuth: [] }] };
const id = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const responses = (description: string) => ({
  '200': { description },
  '400': { description: 'Dữ liệu không hợp lệ.', ...error },
  '401': { description: 'Chưa đăng nhập.', ...error },
  '403': { description: 'Không có quyền thực hiện.', ...error },
  '404': { description: 'Không tìm thấy dữ liệu.', ...error },
  '409': { description: 'Trùng mã, barcode hoặc vi phạm quy tắc nghiệp vụ.', ...error },
});
const statusBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['active'], properties: { active: { type: 'boolean' } } } } } };
const skuProperties = {
  code: { type: 'string', example: 'SKU-YM-410' }, barcode: { type: 'string', pattern: '^\\d{8,14}$', example: '8934567891201' },
  sellingPrice: { type: 'number', minimum: 0, example: 32000 }, costPrice: { type: 'number', minimum: 0, example: 24500 },
};
const imageDataUrl = { type: 'string', format: 'byte', description: 'Ảnh JPG, PNG, WEBP hoặc AVIF dạng data URL; tối đa 5 MB. Ảnh được lưu trên Cloudinary.' };
const productCreateBody = { required: true, content: { 'application/json': { schema: {
  type: 'object', additionalProperties: false, required: ['name', 'unit', 'categoryId', 'sku'],
  properties: {
    code: { type: 'string', example: '10225873544', description: 'Không gửi trường này để hệ thống tự tăng mã hàng hóa.' }, name: { type: 'string', example: 'Sữa chua uống Yomost Cam 170ml' }, unit: { type: 'string', example: 'Lốc 4 hộp' },
    categoryId: { type: 'string', format: 'uuid' }, imageDataUrl, sku: { type: 'object', additionalProperties: false, required: ['barcode', 'sellingPrice', 'costPrice'], properties: skuProperties },
  },
} } } };
const productUpdateBody = { required: true, content: { 'application/json': { schema: {
  type: 'object', additionalProperties: false, required: ['name', 'unit', 'categoryId', 'sku'],
  properties: {
    name: { type: 'string' }, unit: { type: 'string' }, categoryId: { type: 'string', format: 'uuid' }, imageDataUrl, removeImage: { type: 'boolean', default: false, description: 'Xóa ảnh hiện tại. Không gửi cùng imageDataUrl.' },
    sku: { type: 'object', additionalProperties: false, required: ['id', 'code', 'barcode', 'sellingPrice', 'costPrice'], properties: { id: { type: 'string', format: 'uuid' }, ...skuProperties } },
  },
} } } };
const skuBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['code', 'barcode', 'sellingPrice', 'costPrice'], properties: skuProperties } } } };
const categoryBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['code', 'name'], properties: { code: { type: 'string', example: 'DO_UONG' }, name: { type: 'string', example: 'Đồ uống & Sữa' }, description: { type: 'string', nullable: true } } } } } };
const categoryUpdateBody = { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['name'], properties: { name: { type: 'string', example: 'Đồ uống & Sữa' }, description: { type: 'string', nullable: true } } } } } };

export const productPaths = {
  '/api/v1/categories': {
    get: { tags: ['Sản phẩm'], summary: 'Danh sách danh mục sản phẩm', ...secured, parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'all' } }], responses: responses('Danh sách danh mục.') },
    post: { tags: ['Sản phẩm'], summary: 'Thêm danh mục', ...secured, requestBody: categoryBody, responses: { ...responses('Đã thêm danh mục.'), '201': { description: 'Đã thêm danh mục.' } } },
  },
  '/api/v1/categories/{id}': { put: { tags: ['Sản phẩm'], summary: 'Cập nhật danh mục', ...secured, parameters: id, requestBody: categoryUpdateBody, responses: responses('Đã cập nhật danh mục.') } },
  '/api/v1/categories/{id}/status': { patch: { tags: ['Sản phẩm'], summary: 'Đổi trạng thái danh mục', description: 'Không thể ngừng danh mục còn sản phẩm đang kinh doanh.', ...secured, parameters: id, requestBody: statusBody, responses: responses('Đã đổi trạng thái danh mục.') } },
  '/api/v1/products': {
    get: { tags: ['Sản phẩm'], summary: 'Tìm kiếm và phân trang sản phẩm', ...secured, parameters: [
      { name: 'q', in: 'query', schema: { type: 'string' } }, { name: 'active', in: 'query', schema: { type: 'string', enum: ['true', 'false', 'all'], default: 'all' } },
      { name: 'categoryId', in: 'query', schema: { type: 'string', format: 'uuid' } }, { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    ], responses: responses('Danh sách sản phẩm cùng thông tin phân trang.') },
    post: { tags: ['Sản phẩm'], summary: 'Thêm sản phẩm và SKU đầu tiên', description: 'Mã sản phẩm, mã SKU và barcode phải duy nhất. Giá bán không nhỏ hơn giá vốn.', ...secured, requestBody: productCreateBody, responses: { ...responses('Đã thêm sản phẩm.'), '201': { description: 'Đã thêm sản phẩm.' } } },
  },
  '/api/v1/products/{id}': {
    get: { tags: ['Sản phẩm'], summary: 'Chi tiết sản phẩm và lịch sử giá', ...secured, parameters: id, responses: responses('Chi tiết sản phẩm.') },
    put: { tags: ['Sản phẩm'], summary: 'Cập nhật sản phẩm và SKU chính', description: 'Tự động ghi lịch sử khi giá bán hoặc giá vốn thay đổi.', ...secured, parameters: id, requestBody: productUpdateBody, responses: responses('Đã cập nhật sản phẩm.') },
  },
  '/api/v1/products/{id}/status': { patch: { tags: ['Sản phẩm'], summary: 'Ngừng hoặc mở lại kinh doanh', ...secured, parameters: id, requestBody: statusBody, responses: responses('Đã đổi trạng thái sản phẩm.') } },
  '/api/v1/products/{id}/skus': { post: { tags: ['Sản phẩm'], summary: 'Thêm SKU vào sản phẩm', description: 'Tự động tạo dòng tồn bằng 0 tại các kho đang hoạt động và ghi lịch sử giá đầu tiên.', ...secured, parameters: id, requestBody: skuBody, responses: { ...responses('Đã thêm SKU.'), '201': { description: 'Đã thêm SKU và tồn kho ban đầu.' } } } },
  '/api/v1/products/{id}/skus/{skuId}': { put: { tags: ['Sản phẩm'], summary: 'Cập nhật SKU và giá', description: 'Tự động ghi lịch sử khi giá bán hoặc giá vốn thay đổi.', ...secured, parameters: [...id, { name: 'skuId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: skuBody, responses: responses('Đã cập nhật SKU.') } },
  '/api/v1/products/{id}/skus/{skuId}/status': { patch: { tags: ['Sản phẩm'], summary: 'Bật hoặc ngừng SKU', description: 'Sản phẩm đang kinh doanh phải còn ít nhất một SKU hoạt động.', ...secured, parameters: [...id, { name: 'skuId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }], requestBody: statusBody, responses: responses('Đã đổi trạng thái SKU.') } },
  '/api/v1/products/barcode/{barcode}': { get: { tags: ['Sản phẩm'], summary: 'Tìm sản phẩm đang kinh doanh bằng barcode', ...secured, parameters: [{ name: 'barcode', in: 'path', required: true, schema: { type: 'string', pattern: '^\\d{8,14}$' } }], responses: responses('SKU khớp barcode.') } },
};
