import { prisma } from '../src/common/database.js';
try {
 const parcels = await prisma.iotInboundParcel.findMany({where:{tagId:{startsWith:'QR-6456949A'}},select:{tagId:true,warehouseId:true,deviceId:true,status:true}});
 const events = await prisma.iotEvent.findMany({where:{eventType:'CAMERA_CODE_DETECTED'},orderBy:{receivedAt:'desc'},take:8,select:{tagId:true,warehouseId:true,deviceId:true,timestamp:true,receivedAt:true,automationStatus:true,automationMessage:true}});
 console.log(JSON.stringify({parcels,events},null,2));
} finally { await prisma.$disconnect(); }
