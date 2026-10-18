import { Protected } from '../../components/auth-provider';
export default function Layout({ children }: { children: React.ReactNode }) { return <Protected permission="purchase_orders.read"><div className="business-screen">{children}</div></Protected>; }
