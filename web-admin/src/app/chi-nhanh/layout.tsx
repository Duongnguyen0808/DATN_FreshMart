import { Protected } from '../../components/auth-provider';
export default function Layout({ children }: { children: React.ReactNode }) {
  return <Protected permission="stores.read"><div className="business-screen">{children}</div></Protected>;
}
