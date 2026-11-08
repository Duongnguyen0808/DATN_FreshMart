export function TablePagination({ page, totalPages, shown, total, noun, onChange }: { page: number; totalPages: number; shown: number; total: number; noun: string; onChange: (page: number) => void }) {
  const pages = Math.max(1, totalPages);
  return <footer className="ui-table-footer"><span>Hiển thị <strong>{shown}</strong> trên <strong>{total}</strong> {noun}</span><div className="suite-pagination"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Trước</button><span className="pagination-position">Trang <b>{page}</b> / {pages}</span><button type="button" disabled={page >= pages} onClick={() => onChange(page + 1)}>Sau ›</button></div></footer>;
}
