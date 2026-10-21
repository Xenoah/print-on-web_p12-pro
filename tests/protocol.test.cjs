const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'),'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
new vm.Script(script);
const elements = new Map();
const defaults = {labelText:'テスト',fontFamily:'sans',alignment:'center',fontSize:'5',length:'50',margin:'2',threshold:'160',copies:'2'};
const document = {querySelectorAll(){return [];},getElementById(id){if(!elements.has(id))elements.set(id,{value:defaults[id]||'',checked:false,style:{},classList:{toggle(){}},setAttribute(){},textContent:'',hidden:false});return elements.get(id);}};
const tests = `
(async()=>{
  let passed=0;
  const check=(name,fn)=>{fn();console.log('PASS '+name);passed++;};
  function bitmap(w,points=[]){const p=new Uint8ClampedArray(w*96*4).fill(255);for(const [x,y] of points)p[(y*w+x)*4]=0;return {width:w,height:96,getContext:()=>({getImageData:()=>({data:p})})};}
  check('P12 clockwise rotation and MSB-first packing',()=>{const r=buildRaster(bitmap(3,[[0,0],[1,95],[2,87]]));const expected=new Uint8Array(36);expected[11]=1;expected[12]=128;expected[25]=128;assert.deepEqual(r.bytes,expected);assert.deepEqual([...r.header],[27,64,29,118,48,0,12,0,3,0]);});
  check('blank raster remains blank',()=>assert.equal(buildRaster(bitmap(17)).bytes.some(Boolean),false));
  check('maximum label has 12 bytes per scan line, little-endian row count',()=>{const r=buildRaster(bitmap(1598));assert.equal(r.bytes.length,1598*12);assert.deepEqual([...r.header.slice(-2)],[62,6]);});
  check('invalid head width rejected',()=>assert.throws(()=>buildRaster({width:400,height:128}),/不正/));
  const channel=new ResponseChannel();channel.send=async()=>channel.receive(new Uint8Array([26,8,80]));
  assert.deepEqual([...(await channel.query([31,17,9],10))],[26,8,80]);assert.equal(channel.waiters.size,0);console.log('PASS synchronous reply is not lost');passed++;
  channel.send=async()=>{};assert.equal(await channel.query([31,17,9],5),null);assert.equal(channel.waiters.size,0);console.log('PASS reply timeout releases waiter');passed++;
  channel.send=async()=>{throw new Error('write failure');};await assert.rejects(channel.query([31,17,9],5),/write failure/);assert.equal(channel.waiters.size,0);console.log('PASS failed write releases waiter');passed++;
  let controller;let serialClosed=false;
  const port={open:async()=>{},readable:new ReadableStream({start(c){controller=c;}}),writable:new WritableStream({write(data){controller.enqueue(new Uint8Array([26,8,80]));}}),close:async()=>{serialClosed=true;}};
  const serial=new SerialTransport(port);await serial.open();assert.equal(serial.connected,true);assert.deepEqual([...(await serial.query([31,17,9],100))],[26,8,80]);await serial.close();assert.equal(serialClosed,true);assert.equal(serial.connected,false);assert.equal(port.readable.locked,false);assert.equal(port.writable.locked,false);console.log('PASS serial stream receives and disconnects without locked handles');passed++;
  const pendingPort={...port,open:null,readable:null,writable:null};let resolveOpen;pendingPort.open=()=>new Promise(r=>resolveOpen=r);let lateClosed=false;pendingPort.close=async()=>{lateClosed=true;};const pendingSerial=new SerialTransport(pendingPort);const pending=pendingSerial.open();await pendingSerial.close();resolveOpen();await assert.rejects(pending,/中止/);assert.equal(lateClosed,true);console.log('PASS timed-out serial opening closes late connection');passed++;
  const expectedInit=[[31,17,56],[31,17,17,31,17,18,31,17,9,31,17,19],[31,17,9],[31,17,25,31,17,17],[31,17,25],[31,17,7]];
  const canvas=bitmap(400,[[0,0],[399,95]]);elements.set('preview',canvas);
  render=()=>{};const realTimer=setTimeout;setTimeout=(fn,ms)=>realTimer(fn,Math.min(ms,1));hasInk=true;renderValid=true;
  function fakeTransport(){return {name:'Test printer',connected:true,chunkSize:128,chunkDelay:0,queries:[],writes:[],closed:false,async query(data){this.queries.push([...data]);return new Uint8Array([1]);},async send(data){this.writes.push([...data]);},async close(){this.closed=true;this.connected=false;}};}
  transport=fakeTransport();let tx=transport;await printLabels();assert.equal(tx.queries.length,12);assert.deepEqual(tx.queries.slice(0,6),expectedInit);assert.deepEqual(tx.writes[0],[27,64,29,118,48,0,12,0,144,1]);assert.equal(tx.writes.filter(w=>w.length===3&&w[0]===27&&w[1]===100).length,4);assert.equal(tx.writes.slice(1,39).flat().length,4800);assert.equal(busy,false);console.log('PASS two labels: initialization, 96-dot raster, two feeds each');passed++;
  transport=fakeTransport();tx=transport;tx.send=async function(data){this.writes.push([...data]);stopAfterLabel=true;};await printLabels();assert.equal(tx.queries.length,6);assert.equal(tx.writes.filter(w=>w.length===3&&w[1]===100).length,2);console.log('PASS stop finishes current label and skips remaining copies');passed++;
  transport=fakeTransport();tx=transport;tx.send=async function(data){this.writes.push([...data]);if(this.writes.length===3)throw new Error('disconnected');};await printLabels();assert.equal(transport,null);assert.equal(tx.closed,true);assert.equal(tx.queries.length,6);assert.equal(tx.writes.length,3);assert.equal(tx.writes.some(w=>w.length===3&&w[1]===100),false);assert.equal(busy,false);console.log('PASS mid-raster failure disconnects, never feeds or retries');passed++;
  transport=fakeTransport();tx=transport;hasInk=false;await printLabels();assert.equal(tx.writes.length,0);console.log('PASS blank label cannot be sent');passed++;
  hasInk=true;connecting=true;syncUI();assert.equal(elements.get('print').disabled,true);assert.equal(elements.get('probe').disabled,true);assert.equal(elements.get('disconnect').disabled,true);await printLabels();await probe();await disconnect();assert.equal(tx.writes.length,0);assert.equal(tx.queries.length,0);assert.equal(tx.closed,false);assert.equal(transport,tx);connecting=false;console.log('PASS connection handshake blocks overlapping print, query and disconnect');passed++;
  console.log(passed+' checks passed');
})().catch(e=>{console.error(e);process.exitCode=1;});
`;
const context = vm.createContext({document,elements,console,assert,process,navigator:{serial:{}},isSecureContext:true,Uint8Array,Uint8ClampedArray,ReadableStream,WritableStream,setTimeout,clearTimeout});
vm.runInContext(script.slice(0,script.indexOf('for(const id of SETTING_IDS)$(id)'))+tests,context);
