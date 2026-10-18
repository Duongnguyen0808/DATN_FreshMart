export function TablePagination({ page, totalPages, shown, total, noun, onChange }: { page: number; totalPages: number; shown: number; total: number; noun: string; onChange: (page: number) => void }) {
  return <footer className="ui-table-footer"><span>Hiển thị {shown} trên {total} {noun}</span><div className="suite-pagination"><button type="button" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹ Trước</button><span>Trang {page}/{totalPages}</span><button type="button" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>Sau ›</button></div></footer>;
}
