'use client';
import { Protected } from '../components/auth-provider';
import OperationsDashboard from '../components/operations-dashboard';
export default function Home() { return <Protected permission="dashboard.read"><OperationsDashboard /></Protected>; }
