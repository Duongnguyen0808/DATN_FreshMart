'use client';
import { useEffect, useState } from 'react';
import { useAuth, Protected } from './auth-provider';
import { api, errorMessage, type User, type Role, type Permission, type Store } from '../lib/auth-api';
import { useToast } from './ui/toast-provider';
import { ActionButton } from './ui/action-button';
import { StatusBadge } from './ui/status-badge';
import { permissionLabel } from '../lib/permission-labels';

type Kind = 'users' | 'roles' | 'permissions';
const titles = { users: 'Người dùng', roles: 'Vai trò', permissions: 'Danh sách quyền' };
function Panel({ kind }: { kind: Kind }) {
  const { showToast, confirmAction } = useToast();
  const { user } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [editing, setEditing] = useState<User | Role | 'new' | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const canManage = user?.permissions.includes(`${kind}.manage`) && (kind !== 'roles' || user.globalAccess);
  useEffect(() => {
    let active = true;
    setLoading(true); setError('');
    const load = async () => {
      if (kind === 'users') {
        const result = await api<User[]>('users');
        if (active) setUsers(result);
        if (canManage) {
          const [roleData, storeData] = await Promise.all([api<Role[]>('roles'), api<Store[]>('stores')]);
          if (active) { setRoles(roleData); setStores(storeData); }
        }
      } else if (kind === 'roles') {
        const result = await api<Role[]>('roles');
        if (active) setRoles(result);
        if (canManage) { const values = await api<Permission[]>('permissions'); if (active) setPermissions(values); }
      } else { const values = await api<Permission[]>('permissions'); if (active) setPermissions(values); }
    };
    load().catch(reason => { if (active) setError(errorMessage(reason)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [kind, revision, canManage]);
  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = new FormData(event.currentTarget);
    const existing = editing && editing !== 'new' ? editing : null;
    const body = kind === 'users' ? {
      name: data.get('name'), email: data.get('email'), active: data.get('active') === 'on',
      ...(data.get('password') ? { password: data.get('password') } : {}),
      roleIds: data.getAll('roleIds'), storeIds: data.getAll('storeIds'),
    } : { name: data.get('name'), code: data.get('code'), permissionCodes: data.getAll('permissionCodes') };
    try { await api(`${kind}${existing ? `/${existing.id}` : ''}`, existing ? 'PUT' : 'POST', body); setEditing(null); showToast(existing ? 'Đã cập nhật thay đổi.' : 'Đã tạo mới thành công.'); setRevision(value => value + 1); }
    catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  }
  const editedUser = editing && editing !== 'new' && kind === 'users' ? editing as User : null;
  const editedRole = editing && editing !== 'new' && kind === 'roles' ? editing as Role : null;
  return <div className="suite-page admin-page"><header className="suite-heading"><div><div className="breadcrumb">Thiết lập hệ thống <span>›</span> {titles[kind]}</div><h1>{titles[kind]}</h1><p>{kind === 'users' ? 'Quản lý tài khoản, trạng thái và phạm vi chi nhánh.' : kind === 'roles' ? 'Hệ thống sử dụng ba vai trò chuẩn: Chủ hệ thống, Quản lý chi nhánh và Nhân viên.' : 'Tra cứu các quyền nghiệp vụ đang được hệ thống hỗ trợ.'}</p></div>{canManage && kind !== 'roles' && !editing && <ActionButton tone="approve" onClick={() => { setEditing('new'); setError(''); }}>＋ Thêm người dùng</ActionButton>}</header>
    {error && <p role="alert" className="error">{error} <button className="secondary" onClick={() => setRevision(v => v + 1)}>Tải lại</button></p>}
    {editing && <article className="editor"><h2>{editing === 'new' ? 'Tạo mới' : 'Chỉnh sửa'}</h2><form onSubmit={save} key={editing === 'new' ? 'new' : editing.id}>
      <fieldset disabled={busy}>
        <label>Tên<input name="name" required maxLength={100} defaultValue={editedUser?.name ?? editedRole?.name ?? ''} /></label>
        {kind === 'users' ? <>
          <label>Email<input name="email" type="email" required maxLength={254} autoComplete="off" defaultValue={editedUser?.email ?? ''} /></label>
          <label>{editedUser ? 'Mật khẩu mới (để trống nếu giữ nguyên)' : 'Mật khẩu'}<input name="password" type="password" autoComplete="new-password" required={!editedUser} minLength={10} maxLength={128} /></label>
          <label className="check"><input type="checkbox" name="active" defaultChecked={editedUser?.active ?? true} />Tài khoản hoạt động</label>
          <fieldset><legend>Vai trò</legend>{roles.map(role => <label className="check" key={role.id}><input type="checkbox" name="roleIds" value={role.id} defaultChecked={editedUser?.roles.some(r => r.id === role.id)} />{role.name}</label>)}</fieldset>
          <fieldset><legend>Chi nhánh được phân công</legend>{stores.map(store => <label className="check" key={store.id}><input type="checkbox" name="storeIds" value={store.id} defaultChecked={editedUser?.stores.some(s => s.id === store.id)} />{store.code} — {store.name}</label>)}</fieldset>
          <p className="hint">Nhân viên cần ít nhất một chi nhánh. Lưu thay đổi sẽ yêu cầu người dùng đăng nhập lại.</p>
        </> : <>
          <label>Mã vai trò<input name="code" required pattern="[A-Z][A-Z0-9_]{1,49}" maxLength={50} readOnly={editedRole?.system} defaultValue={editedRole?.code ?? ''} /></label>
          <fieldset><legend>Quyền được cấp</legend>{permissions.map(permission => <label className="check" key={permission.code}><input type="checkbox" name="permissionCodes" value={permission.code} defaultChecked={editedRole?.permissions.some(p => p.permissionCode === permission.code)} />{permissionLabel(permission.code)}</label>)}</fieldset>
          <p className="hint">Quản lý vai trò toàn hệ thống chỉ dành cho chủ doanh nghiệp. Quyền người dùng quản lý trong phạm vi chi nhánh được cấp.</p>
        </>}
        <div className="actions"><ActionButton tone="approve" type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</ActionButton><ActionButton tone="more" onClick={() => setEditing(null)}>Hủy</ActionButton></div>
      </fieldset>
    </form></article>}
    {loading ? <p role="status">Đang tải dữ liệu…</p> : <div className="table-wrap"><table>
      {kind === 'users' ? <><thead><tr><th>Người dùng</th><th>Vai trò</th><th>Chi nhánh</th><th>Trạng thái</th>{canManage && <th>Thao tác</th>}</tr></thead><tbody>{users.map(value => <tr key={value.id}><td><strong>{value.name}</strong><br />{value.email}</td><td>{value.roles.map(r => r.name).join(', ')}</td><td>{value.globalAccess ? 'Toàn hệ thống' : value.stores.map(s => s.name).join(', ')}</td><td><StatusBadge tone={value.active ? 'green' : 'red'}>{value.active ? 'Hoạt động' : 'Đã khóa'}</StatusBadge></td>{canManage && <td><div className="row-actions"><ActionButton tone="edit" onClick={() => setEditing(value)}>Chỉnh sửa</ActionButton></div></td>}</tr>)}</tbody></> : kind === 'roles' ? <><thead><tr><th>Vai trò</th><th>Quyền</th><th>Người dùng</th>{canManage && <th>Thao tác</th>}</tr></thead><tbody>{roles.map(value => <tr key={value.id}><td><strong>{value.name}</strong></td><td>{value.permissions.length ? <div className="permission-summary">{value.permissions.slice(0, 5).map(p => <span key={p.permissionCode}>{permissionLabel(p.permissionCode)}</span>)}{value.permissions.length > 5 && <span>+{value.permissions.length - 5}</span>}</div> : 'Chưa cấp quyền'}</td><td>{value._count.users}</td>{canManage && <td><div className="row-actions">{value.code !== 'OWNER' && <ActionButton tone="edit" onClick={() => setEditing(value)}>Sửa quyền</ActionButton>}{!value.system && value._count.users === 0 && <ActionButton tone="danger" disabled={busy} onClick={async () => {
        if (!await confirmAction(`Xóa vai trò ${value.name}?`)) return;
        setBusy(true); setError('');
        try { await api(`roles/${value.id}`, 'DELETE'); showToast('Đã xóa vai trò.'); setRevision(v => v + 1); } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
      }}>Xóa</ActionButton>}</div></td>}</tr>)}</tbody></> : <><thead><tr><th>{'Ch\u1ee9c n\u0103ng \u0111\u01b0\u1ee3c ph\u00e2n quy\u1ec1n'}</th></tr></thead><tbody>{permissions.map(value => <tr key={value.code}><td>{permissionLabel(value.code)}</td></tr>)}</tbody></>}
    </table></div>}
    {kind === 'permissions' && <p className="hint">Danh mục quyền tương ứng với chức năng Backend đã triển khai. Gán hoặc thu hồi quyền tại trang Vai trò.</p>}
  </div>;
}
export default function AdminPanel({ kind }: { kind: Kind }) { return <Protected permission={`${kind}.read`}><Panel kind={kind} /></Protected>; }
