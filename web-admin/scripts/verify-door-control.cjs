// Actual React controller, mocked transport and motion completion; no business DB writes.
const http = require('node:http');
const path = require('node:path');
const { build } = require('esbuild');
const { chromium, expect } = require('@playwright/test');
(async () => {
  const bundle = await build({ stdin: { resolveDir: path.resolve(__dirname, '..'), loader: 'tsx', contents: `
    import React from 'react'; import {createRoot} from 'react-dom/client';
    import {useWarehouseDoor} from './src/app/kho/mo-hinh-3d/warehouse-door-experience';
    function App(){const a=useWarehouseDoor('wh'); window.access=a;
      React.useEffect(()=>{if(['APPROACH','GRANTED','OPENING','ENTERING','CLOSING'].includes(a.phase)) {
        const timer=setTimeout(()=>a.motionComplete(a.phase),100);return ()=>clearTimeout(timer);
      }},[a.phase]); return <div id="phase">{a.phase}</div>}
    createRoot(document.getElementById('root')).render(<App/>);` },
    bundle: true, write: false, jsx: 'automatic', loader: { '.css': 'empty' },
    define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'mocks', setup(b) {
      b.onResolve({ filter: /lib\/auth-api$/ }, () => ({path:'api',namespace:'fixture'}));
      b.onResolve({ filter: /lib\/iot-realtime$/ }, () => ({path:'realtime',namespace:'fixture'}));
      b.onResolve({ filter: /components\/auth-provider$/ }, () => ({path:'auth',namespace:'fixture'}));
      b.onLoad({filter:/.*/,namespace:'fixture'}, ({path:p}) => ({loader:'js',contents:p==='auth'
        ? `export const useAuth=()=>({user:{permissions:['*']}});`
        : p==='realtime' ? `export const subscribeWarehouseAccess=()=>()=>{};`
        : `export const errorMessage=e=>e.message; export const api=(...args)=>window.transport(...args);`}));
    }}] });
  const server=http.createServer((req,res)=>{if(req.url==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(bundle.outputFiles[0].contents)}else res.end('<div id="root"></div><script src="/app.js"></script>')});
  await new Promise(r=>server.listen(0,'127.0.0.1',r)); let browser;
  try {
    browser=await chromium.launch({channel:'msedge',headless:true}); const page=await browser.newPage(); const errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>{
      window.actions=[]; window.failScan=false; let serial=0;
      window.data={mode:'SIMULATION',accessWindowSeconds:10,devices:[{id:'device',code:'SIM-ACCESS-WH',online:false}],doors:[{id:'door',code:'SIM-DOOR-WH',name:'Door',state:'CLOSED',device:{code:'SIM-ACCESS-WH'}}],cards:[],employees:[],events:[],alerts:[]};
      window.event=(eventType)=>{const e={id:String(++serial),doorId:'door',deviceId:'device',source:window.data.mode==='REAL_IOT'?'IOT_DEVICE':'SIMULATION',eventType,occurredAt:new Date().toISOString(),employee:{name:'Employee'},payload:{uid:'D00C330C'}};window.data.events.unshift(e);return e};
      window.transport=async(path,method,body)=>{
        if(path.startsWith('iot/access/monitor'))return structuredClone(window.data);
        if(path==='iot/access/simulate'){
          window.actions.push(body.action+':'+(body.state||''));
          if(window.failScan && body.action==='RFID')throw new Error('Backend unavailable');
          if(body.action==='DOOR')window.data.doors[0].state=body.state;
          return {event:window.event(body.action==='RFID'?'ACCESS_GRANTED':'DOOR_'+body.state)};
        } throw new Error('Unexpected API '+path);
      };
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await expect.poll(()=>page.evaluate(()=>window.access?.door.id)).toBe('door');
    await page.evaluate(()=>{void window.access.start('authorized')});
    await expect(page.locator('#phase')).toHaveText('COMPLETE');
    expect(await page.evaluate(()=>window.actions)).toEqual(['RFID:','DOOR:OPEN','DOOR:CLOSED']);
    console.log('PASS simulation uses backend grant, opens and closes without checkout');
    await page.evaluate(()=>{window.failScan=true; void window.access.start('authorized')});
    await expect.poll(()=>page.evaluate(()=>window.access.error)).toBe('Backend unavailable');
    expect(await page.evaluate(()=>window.actions.filter(a=>a==='DOOR:OPEN').length)).toBe(1);
    console.log('PASS failed RFID request cannot open door');
    await page.evaluate(async()=>{window.actions=[];window.data.mode='REAL_IOT';window.data.events=[];window.data.devices[0].code='ESP';window.data.doors[0].device.code='ESP';await window.access.refresh()});
    await page.evaluate(async()=>{window.event('ACCESS_GRANTED');await window.access.refresh()});
    await expect(page.locator('#phase')).toHaveText('GRANTED');
    await page.waitForTimeout(2800);
    await expect(page.locator('#phase')).toHaveText('GRANTED');
    expect(await page.evaluate(()=>window.actions)).toEqual([]);
    console.log('PASS real grant alone never opens door, including after former 2.2s timer');
    await page.evaluate(async()=>{window.data.doors[0].state='OPEN';window.event('DOOR_OPEN');await window.access.refresh()});
    await expect(page.locator('#phase')).toHaveText('WAITING_CLOSE');
    await page.evaluate(async()=>{window.data.doors[0].state='CLOSED';window.event('DOOR_CLOSED');await window.access.refresh()});
    await expect(page.locator('#phase')).toHaveText('COMPLETE');
    expect(await page.evaluate(()=>window.actions)).toEqual([]);
    console.log('PASS real open/close events complete access with zero simulation calls');
    expect(errors).toEqual([]);
  } finally { if(browser)await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1});
