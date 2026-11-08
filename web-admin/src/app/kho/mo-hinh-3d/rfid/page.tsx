import { redirect } from 'next/navigation';

// RC522 now authenticates employees at the warehouse door; parcels use QR/ESP32-CAM.
export default function Page() { redirect('/kho/mo-hinh-3d'); }
