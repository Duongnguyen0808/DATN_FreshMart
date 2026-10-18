import { Protected } from '../../components/auth-provider';
import { ModuleSubnav } from '../../components/module-subnav';
export default function Layout({children}:{children:React.ReactNode}){return <Protected><div className="business-screen"><ModuleSubnav kind="reports" />{children}</div></Protected>}
