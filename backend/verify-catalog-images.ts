import 'dotenv/config';
import { prisma } from './src/common/database.js';
const products = await prisma.product.findMany({where:{archivedAt:null},select:{code:true,name:true,imageUrl:true}});
const failures=[];
for(const product of products) {
 try {
  if(!product.imageUrl) throw Error('Missing URL');
  const response=await fetch(new URL(product.imageUrl,'http://localhost:5000'),{signal:AbortSignal.timeout(5000)});
  if(!response.ok || !response.headers.get('content-type')?.startsWith('image/')) throw Error(`HTTP ${response.status}`);
 } catch(error) { failures.push({code:product.code,error:String(error)}); }
}
const test=await prisma.product.findUnique({where:{code:'100042'},select:{name:true,active:true,archivedAt:true}});
console.log(JSON.stringify({products:products.length,imagesLoaded:products.length-failures.length,failures,test},null,2));
await prisma.$disconnect();
if(failures.length || (test && !test.archivedAt)) process.exitCode=1;
