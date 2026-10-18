export const notificationPaths = {
  '/api/v1/notifications': { get: {
    tags: ['Thông báo'], summary: 'Việc chờ duyệt theo quyền và chi nhánh của người đăng nhập',
    description: 'Trả về tổng số việc đang chờ và tối đa 10 mục mới nhất. Dữ liệu được tính trực tiếp từ phiếu kiểm kho, điều chuyển, đề nghị mua và ca chờ duyệt chênh lệch; không có trạng thái đã đọc.',
    security: [{ bearerAuth: [] }],
    responses: {
      '200': { description: 'Danh sách việc cần xử lý', content: { 'application/json': { schema: { type: 'object', properties: { success: { type: 'boolean' }, message: { type: 'string' }, data: { type: 'object', properties: { total: { type: 'integer' }, items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, kind: { type: 'string' }, title: { type: 'string' }, description: { type: 'string' }, href: { type: 'string' }, createdAt: { type: 'string', format: 'date-time' } } } } } } } } } } },
      '401': { description: 'Chưa đăng nhập' },
    },
  } },
};
