import { redirect } from 'next/navigation';

// Existing bookmarks lead to the IoT controls embedded in the warehouse 3D scene.
export default function Page() { redirect('/kho/mo-hinh-3d'); }
