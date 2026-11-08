const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
(async () => {
  const bundle = await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {PrepareCameraDemo} from './src/app/kho/mo-hinh-3d/prepare-camera-demo';const warehouses=[{id:'wh1',name:'Kho Ba Đình',store:{name:'Chi nhánh Ba Đình'}},{id:'wh2',name:'Kho Hải Châu',store:{name:'Chi nhánh Hải Châu'}}];function App(){const [id,setId]=React.useState('wh1');return <PrepareCameraDemo orders={[]} parcels={[]} warehouses={warehouses} warehouseId={id} onWarehouseChange={setId} onClose={()=>{}} onStart={()=>{window.demoStarted=true}}/>};createRoot(document.getElementById('root')).render(<App/>);`,resolveDir:path.resolve(__dirname,'..'),loader:'tsx'},bundle:true,write:false,jsx:'automatic',define:{'process.env':'{}','process.env.NODE_ENV':'"production"','process.env.NEXT_PUBLIC_API_BASE_URL':'"http://localhost:4000/api/v1"'},plugins:[{name:'auth-context',setup(b){b.onResolve({filter:/components\/auth-provider$/},()=>({path:'auth',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:`export const useAuth=()=>({user:{permissions:['*']}});`,loader:'js'}));}}]});
  const css=['globals.css','auth-loading.css','interaction-overrides.css','retail-ui.css','workspaces.css','records.css','polish.css','visual-emphasis.css','analytics-studio.css','turquoise-theme.css','login.css','kho/mo-hinh-3d/live-inbound.css'].map(file=>fs.readFileSync(path.resolve(__dirname,'../src/app',file),'utf8')).join('\n');
  const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents);}else res.end(`<!doctype html><meta charset="utf-8"><style>body{font:14px Arial;color:#173d3c;background:#e8f8f5}*{box-sizing:border-box}button{border:0;cursor:pointer}label{font-size:14px}a{color:#087f78}.product-image{display:inline-grid;place-items:center;background:#e8f8f5;width:48px;height:48px;flex:none;border-radius:8px}p{line-height:1.6}${css}</style><body class="retail-ui"><div id="root"></div><script src="/app.js"></script>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;let posts=0,created=false;const errors=[];
  try{
    browser=await chromium.launch({channel:'msedge',headless:true});const page=await browser.newPage({viewport:{width:1366,height:900}});page.on('pageerror',e=>{errors.push(e.message);console.log('Browser error: '+e.message)});page.on('console',m=>{if(m.type()==='error')console.log(m.text())});
    await page.route('**/api/v1/**',async route=>{if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'http://127.0.0.1:'+server.address().port,'access-control-allow-credentials':'true','access-control-allow-methods':'GET,POST,OPTIONS','access-control-allow-headers':'content-type'}});const url=new URL(route.request().url());const resource=url.pathname.split('/api/v1/')[1];let data;
      const row={skuId:'sku1',productName:'Bột cacao nguyên chất 250g',unit:'Gói',available:0,pendingQuantity:0,shortageQuantity:42,suggestedQuantity:42,unitCost:35000,imageUrl:null};
      const parcel={id:'parcel-new',tagId:'QR-11111111-1111-4111-8111-111111111111',deviceId:'FRESHMART-CAMERA-IN-01',status:'READY',quantity:42,purchaseOrderId:'po-new',purchaseOrderCode:'PO-NEW',purchaseOrderStatus:'OPEN',product:{name:row.productName,unit:row.unit}};
      if(resource==='purchase-orders/forecast-replenishment'){
        if(route.request().method()==='POST'){const body=route.request().postDataJSON();expect(body.warehouseId).toBe('wh2');expect(body.items[0].quantity).toBe(42);expect(body.supplierId).toBe('supplier');expect(body.requestId).toBeTruthy();posts++;created=true;data={id:'po-new',code:'PO-NEW'};}
        else data={forecastRunId:'run',horizonDays:7,storeName:url.searchParams.get('warehouseId')==='wh2'?'Chi nhánh Hải Châu':'Chi nhánh Ba Đình',suppliers:[{id:'supplier',code:'SUP-001',name:'Nhà cung cấp thực phẩm'}],items:[row,{...row,skuId:'covered',productName:'Hàng đã đặt',suggestedQuantity:0,pendingQuantity:42}]};
      }else if(resource==='iot/inbound-parcels/prepare-orders'||resource==='iot/inbound-parcels')data=created?[parcel]:[];
      else if(resource==='iot/camera-demo-session')data={sessionId:'session'};
      else throw new Error('Unexpected API '+resource);
      await route.fulfill({json:{success:true,data},headers:{'access-control-allow-origin':'http://127.0.0.1:'+server.address().port,'access-control-allow-credentials':'true'}});
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await expect(page.locator('.li-replenishment-list article')).toHaveCount(2);
    expect(posts).toBe(0);
    await page.getByLabel('Chi nhánh · kho nhận').selectOption('wh2');
    await expect(page.locator('.li-replenishment>p').first()).toContainText('Hải Châu');
    await expect(page.locator('.li-replenishment input[type=checkbox]').nth(1)).toBeDisabled();
    await page.locator('.li-replenishment input[type=checkbox]').first().check();
    await expect(page.getByRole('button',{name:'Xác nhận tạo đơn mua hàng'})).toBeDisabled();
    await page.getByLabel('Nhà cung cấp cho các mặt hàng đã chọn').selectOption('supplier');
    const dir=path.resolve(__dirname,'../artifacts/replenishment-review');fs.mkdirSync(dir,{recursive:true});
    for(const width of [1366,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:path.join(dir,`before-${width}.png`)});expect(await page.locator('dialog').evaluate(d=>d.scrollWidth<=d.clientWidth+1)).toBe(true);}
    await page.getByRole('button',{name:'Xác nhận tạo đơn mua hàng'}).click();
    await expect(page.getByRole('status')).toContainText('PO-NEW');
    await expect(page.getByLabel('Kiện chờ nhận')).toHaveValue('parcel-new');
    expect(posts).toBe(1);
    await page.getByRole('button',{name:'Bắt đầu xe vào kho'}).click();
    await expect.poll(()=>page.evaluate(()=>window.demoStarted)).toBe(true);
    if(errors.length)throw new Error(errors.join('\n'));
    console.log('PASS branch selection, shortage suggestion, covered PO, explicit confirmation, automatic QR selection, start demo, desktop/mobile overflow. Screenshots: '+dir);
  }finally{if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
