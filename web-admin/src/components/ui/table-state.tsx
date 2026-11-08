import { Icon } from './icon';

export function TableState({ message, loading = false }: { message: string; loading?: boolean }) {
  return <div className={`record-table-state${loading ? ' loading' : ''}`} role="status">
    {loading ? <div className="record-skeleton" aria-hidden="true"><i/><i/><i/></div> : <span className="record-empty-mark" aria-hidden="true"><Icon name="search" size={24}/></span>}
    <strong>{message}</strong>
    {!loading && <span>Kiểm tra bộ lọc hoặc thêm bản ghi để bắt đầu.</span>}
  </div>;
}
