const { chromium, expect } = require('@playwright/test');
(async () => {
 const browser = await chromium.launch({channel:'msedge', headless:true});
 try {
 const mobile = process.argv.includes('--mobile');
 const width = mobile ? 390 : 1400;
 const page = await browser.newPage({viewport:{width,height:900}});
 const reactErrors=[];
 page.on('console', message=>{if(message.type()==='error' && /synchronously unmount|race condition/.test(message.text()))reactErrors.push(message.text());});
 const user={id:'u',name:'RFID test',active:true,globalAccess:true,roles:[],stores:[],permissions:['warehouses.read','inventory.read','purchase_orders.read','purchase_orders.receive']};
 const warehouse={id:'w',code:'KHO001',name:'Kho kiểm thử',active:true,store:{name:'FreshMart'}};
 const parcel={id:'p',tagId:'F31B93DC',palletCode:'PL002',deviceId:'TEST',skuId:'s',quantity:30,lotCode:'LOT-01',expiresAt:'2099-12-31',status:'READY',purchaseOrderId:'po'};
 let event={id:'e',eventId:'test',source:'DEVICE',eventType:'RFID_DETECTED',warehouseId:'w',tagId:parcel.tagId,palletCode:parcel.palletCode,deviceId:'TEST',timestamp:new Date().toISOString(),receivedAt:new Date().toISOString(),inboundParcelId:'p',mappedSkuId:'s',mappedSku:{code:'SKU',product:{name:'Xúc xích CP',unit:'gói'}},processed:false,automationStatus:'WAITING_CONFIRMATION',automationMessage:'Chờ xác nhận; tồn kho chưa thay đổi.'};
 let confirms=0;
 await page.route('**/api/v1/**',async route=>{
  const path=new URL(route.request().url()).pathname; let data={};
  if(path.endsWith('/auth/refresh')) data={user,accessToken:'test'};
  else if(path.endsWith('/warehouses')) data=[warehouse];
  else if(path.endsWith('/iot/inbound-parcels')) data=[parcel];
  else if(path.endsWith('/iot/events/e/confirm')) {confirms++;parcel.status='RECEIVED';event={...event,processed:true,automationStatus:'RECEIVED',goodsReceiptId:'receipt',automationMessage:'Đã nhập 30 gói'};data=event;}
  else if(path.endsWith('/iot/events')) data=[event];
  else if(path.endsWith('/purchase-orders')) data={items:[{id:'po',code:'PO-TEST',status:'OPEN',items:[{id:'line',skuId:'s',remainingQuantity:50,sku:{product:{name:'Xúc xích CP',unit:'gói',imageUrl:'/logo.png'}}}]}],pagination:{totalPages:1,page:1,total:1}};
  else if(path.endsWith('/inventory')) data={items:[],pagination:{totalPages:1,page:1,total:0}};
  await route.fulfill({json:{success:true,data}});
 });
 await page.goto('http://localhost:3000/kho/mo-hinh-3d');
 await page.getByRole('button',{name:'Dùng UID vừa quét: F31B93DC',exact:true}).click();
 await expect(page.locator('input[name="tagId"]')).toHaveValue('F31B93DC');
 await expect(page.locator('input[name="deviceId"]')).toHaveValue('TEST');
 await page.getByLabel('PO / sản phẩm').selectOption('line');
 await expect(page.locator('.iot-product-preview')).toContainText('Xúc xích CP');
 await expect(page.locator('.iot-product-preview img')).toHaveAttribute('src','/logo.png');
 if(!mobile){
   const scene=page.locator('.live-scene');
   const panel=page.locator('.iot-operation-panel');
   if((await scene.boundingBox()).y >= (await panel.boundingBox()).y)throw new Error('Scene must precede extra controls');
   await page.getByRole('button',{name:'▶ Chạy demo',exact:true}).click();
   await expect(page.locator('.live-scene-status')).toContainText('Chờ quét thẻ / xác nhận thật',{timeout:45000});
   if(confirms!==0)throw new Error('Demo wrote receipt');
 }
 await expect(page.getByRole('heading',{name:/Kiện chờ xác nhận/})).toContainText('(1,');
 if (mobile) await expect(page.locator('.live-scene')).toHaveCount(0);
 await page.getByRole('button',{name:'Kiểm tra kiện'}).click();
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();
 await expect(dialog).toContainText('30 gói');
 const box=await dialog.boundingBox();if(Math.abs(box.x+box.width/2-width/2)>3 || box.width>width)throw new Error('Dialog not centered or overflowing');
 await dialog.getByRole('button',{name:'Để sau'}).click();if(confirms!==0)throw new Error('Dismiss confirmed stock');
 await page.getByRole('button',{name:'Xem / xác nhận'}).click();
 await dialog.getByRole('button',{name:'Xác nhận nhập kho',exact:true}).click();
 await expect(dialog).toContainText('Kiện đã được nhận');if(confirms!==1)throw new Error('Wrong confirm count');
 await expect(page.getByRole('heading',{name:/Kiện chờ xác nhận/})).toContainText('(0,');
 await page.screenshot({path:mobile ? 'web-admin/rfid-mobile-check.png' : 'web-admin/rfid-confirmation-check.png'});
 console.log('PASS: centered popup, quantity, dismiss without POST, confirmation and received state');
 if(reactErrors.length)throw new Error(reactErrors.join('\n'));
 console.log('PASS: UID capture, scene layout, demo waits for real confirmation; no React unmount error');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
