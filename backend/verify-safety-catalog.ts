import 'dotenv/config';
import assert from 'node:assert/strict';
import { prisma } from './src/common/database.js';
import { publicUser, userInclude } from './src/modules/auth/auth.repository.js';
import { createForecast, getShortageAlerts } from './src/modules/forecasts/forecasts.service.js';
const owner=await prisma.user.findFirstOrThrow({where:{active:true,roles:{some:{role:{code:'OWNER'}}}},include:userInclude});
const user=publicUser(owner);
const before=await prisma.inventory.findMany({orderBy:{id:'asc'}});
for(const store of await prisma.store.findMany({where:{active:true}})) {
 const result=await createForecast(user,{storeId:store.id,horizonDays:14});
 const alerts=await getShortageAlerts(user,{storeId:store.id,horizonDays:14});
 assert(result.items.length>0);
 assert(result.items.every(r=>r.safetyStockEvidence));
 for(const row of alerts.analysisItems) {
  assert.equal(row.safetyStock,row.safetyStockAtRun);
  assert.equal(row.shortageQuantity,Math.max(0,row.predictedQuantity+row.safetyStock-row.available-row.inTransfer-row.incomingPurchase));
 }
 console.log(JSON.stringify({store:store.code,items:result.items.length,evidence:result.items[0]?.safetyStockEvidence}));
}
assert.deepEqual(await prisma.inventory.findMany({orderBy:{id:'asc'}}),before);
const products=await prisma.product.findMany({where:{archivedAt:null},select:{imageUrl:true,code:true}});
for(const p of products) {
 assert(p.imageUrl?.startsWith('/products/'));
 const response=await fetch('http://localhost:5000'+p.imageUrl);
 assert.equal(response.status,200,p.code);
 assert(response.headers.get('content-type')?.startsWith('image/'),p.code);
}
assert.equal(await prisma.product.count({where:{code:'100042',archivedAt:null}}),0);
console.log(`Verified forecasts, unchanged inventory, archived test product, HTTP images ${products.length}/${products.length}`);
await prisma.$disconnect();
