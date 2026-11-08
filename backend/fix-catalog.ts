import 'dotenv/config';
import { prisma } from './src/common/database.js';
import { existsSync } from 'node:fs';
await prisma.$transaction(async tx => {
 const danisa = await tx.product.findUniqueOrThrow({where:{code:'100043'}});
 if(!/danisa/i.test(danisa.name)) throw Error('Product mismatch');
 await tx.product.update({where:{id:danisa.id},data:{imageUrl:'/products/prd-demo-042.png',imagePublicId:null}});
 const test = await tx.product.findUniqueOrThrow({where:{code:'100042'}});
 if(test.name !== 'Nước uống test E2E05') throw Error('Test product mismatch');
 if(!test.archivedAt) {
  await tx.product.update({where:{id:test.id},data:{active:false,archivedAt:new Date()}});
  await tx.sku.updateMany({where:{productId:test.id},data:{active:false}});
  await tx.auditLog.create({data:{action:'product.archive.user_requested_test_cleanup',targetId:test.id}});
 }
});
const products=await prisma.product.findMany({where:{archivedAt:null},select:{code:true,imageUrl:true}});
const broken=products.filter(p=>!p.imageUrl || (p.imageUrl.startsWith('/products/')&&!existsSync('../web-admin/public'+p.imageUrl)));
console.log(JSON.stringify({remainingProducts:products.length,missingImages:broken}));
await prisma.$disconnect();
