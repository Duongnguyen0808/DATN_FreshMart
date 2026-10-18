export const reconciliationPaths = {
  '/api/v1/reconciliations/debt': { get: {
    tags: ['Công nợ'],
    summary: 'Đối soát công nợ phải trả và phải thu',
    description: 'So sánh số đã thanh toán trên khoản nợ với tổng giao dịch, đồng thời kiểm tra trạng thái và số dư. API chỉ phát hiện sai lệch, không sửa trực tiếp công nợ.',
    security: [{ bearerAuth: [] }],
    parameters: [
      { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
      { name: 'type', in: 'query', schema: { type: 'string', enum: ['all', 'PAYABLE', 'RECEIVABLE'], default: 'all' } },
      { name: 'result', in: 'query', schema: { type: 'string', enum: ['all', 'MATCHED', 'DISCREPANCY'], default: 'all' } },
      { name: 'storeId', in: 'query', schema: { type: 'string', format: 'uuid' } },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
    ],
    responses: {
      '200': { description: 'Kết quả đối soát, các sai lệch và tổng hợp theo phạm vi chi nhánh.' },
      '401': { description: 'Chưa đăng nhập.' },
      '403': { description: 'Không có quyền xem báo cáo hoặc ngoài phạm vi chi nhánh.' },
    },
  } },
};
