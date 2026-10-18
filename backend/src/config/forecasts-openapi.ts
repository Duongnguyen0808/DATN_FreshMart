const input = {
  type: 'object', additionalProperties: false, required: ['storeId', 'horizonDays'],
  properties: { storeId: { type: 'string', format: 'uuid' }, horizonDays: { type: 'integer', enum: [7, 14, 30] } },
};
const security = [{ bearerAuth: [] }];
export const forecastPaths = {
  '/api/v1/forecasts/demand/runs': {
    get: {
      tags: ['Dự báo nhu cầu'], summary: 'Lịch sử các lần dự báo đã lưu của một chi nhánh', security,
      parameters: [
        { name: 'storeId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 10 } },
      ],
      responses: { '200': { description: 'Danh sách lần dự báo, số SKU, tổng lượng dự báo và phân trang.' }, '403': { description: 'Ngoài phạm vi chi nhánh hoặc thiếu quyền xem báo cáo.' } },
    },
  },
  '/api/v1/forecasts/demand/{id}': {
    get: {
      tags: ['Dự báo nhu cầu'], summary: 'Xem chi tiết một lần dự báo đã lưu', security,
      parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
      responses: { '200': { description: 'Chi tiết lần dự báo và các SKU theo dữ liệu đã lưu.' }, '403': { description: 'Ngoài phạm vi chi nhánh hoặc thiếu quyền xem báo cáo.' }, '404': { description: 'Không tìm thấy lần dự báo.' } },
    },
  },
  '/api/v1/forecasts/demand': {
    get: {
      tags: ['Dự báo nhu cầu'], summary: 'Xem kết quả dự báo mới nhất của chi nhánh và kỳ dự báo', security,
      parameters: [
        { name: 'storeId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'horizonDays', in: 'query', required: true, schema: { type: 'integer', enum: [7, 14, 30] } },
      ],
      responses: { '200': { description: 'Lần dự báo đã lưu, hoặc run=null khi chưa có kết quả.' }, '403': { description: 'Ngoài phạm vi chi nhánh hoặc thiếu quyền xem báo cáo.' } },
    },
    post: {
      tags: ['Dự báo nhu cầu'], summary: 'Dự báo từ 56 ngày doanh số thật và lưu kết quả', security,
      requestBody: { required: true, content: { 'application/json': { schema: input } } },
      responses: { '201': { description: 'Đã lưu dự báo theo SKU. Không tự tạo phiếu mua hoặc điều chuyển.' }, '409': { description: 'Chi nhánh chưa có SKU trong kho.' }, '503': { description: 'AI service chưa sẵn sàng.' } },
    },
  },
  '/api/v1/forecasts/shortages': {
    get: {
      tags: ['Dự báo nhu cầu'], summary: 'Cảnh báo thiếu hàng theo dự báo, tồn khả dụng, hàng chuyển đến và PO dự kiến về trong kỳ', security,
      parameters: [
        { name: 'storeId', in: 'query', required: true, schema: { type: 'string', format: 'uuid' } },
        { name: 'horizonDays', in: 'query', required: true, schema: { type: 'integer', enum: [7, 14, 30] } },
      ],
      responses: { '200': { description: 'Cảnh báo cao, trung bình, thấp từ dự báo mới nhất của chi nhánh; không tự tạo phiếu nghiệp vụ.' }, '403': { description: 'Thiếu quyền xem báo cáo hoặc ngoài phạm vi chi nhánh.' } },
    },
  },
};
