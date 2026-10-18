import { Protected } from '../../components/auth-provider';
import { ModuleSubnav } from '../../components/module-subnav';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Protected permission="reports.read"><div className="business-screen"><ModuleSubnav kind="ai" /><p className="report-note">AI chỉ đưa ra đề xuất; người quản lý duyệt quyết định cuối cùng.</p>{children}</div></Protected>;
}
