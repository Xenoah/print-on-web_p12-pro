'use strict';
// Optional browser regression suite: Playwright + Chromium, no printer required.
const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const http=require('node:http');
const path=require('node:path');
const htmlPath=path.join(__dirname,'..','index.html');
(async()=>{
  const server=http.createServer(async(req,res)=>{try{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(await fs.readFile(htmlPath));}catch{res.statusCode=500;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  let browser;
  try{
    browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
    const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      window.drawnGlyphs=[];
      const original=CanvasRenderingContext2D.prototype.fillText;
      CanvasRenderingContext2D.prototype.fillText=function(text,x,y,...rest){
        if(this.canvas.id==='preview'){
          const m=this.getTransform();window.drawnGlyphs.push({text,x:m.a*x+m.c*y+m.e,y:m.b*x+m.d*y+m.f,a:m.a,b:m.b,c:m.c,d:m.d,font:this.font});
        }
        return original.call(this,text,x,y,...rest);
      };
    });
    await page.goto('http://127.0.0.1:'+server.address().port);
    await page.evaluate(()=>document.fonts.ready);
    let passed=0;
    const check=name=>{passed++;console.log('PASS '+name);};
    const apply=values=>page.evaluate(values=>{window.drawnGlyphs=[];restoreSettings(values);render();},values);
    const snapshot=()=>page.evaluate(()=>{
      const canvas=document.getElementById('preview'),data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
      let minX=canvas.width,minY=canvas.height,maxX=-1,maxY=-1,ink=0;
      for(let y=0;y<canvas.height;y++)for(let x=0;x<canvas.width;x++)if(data[(y*canvas.width+x)*4]===0){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);ink++;}
      return {width:canvas.width,height:canvas.height,minX,maxX,minY,maxY,ink,valid:renderValid,png:canvas.toDataURL(),glyphs:window.drawnGlyphs.slice(),transform:getComputedStyle(canvas).transform};
    });
    const defaults={labelText:'日月',writingMode:'horizontal',alignment:'center',fontFamily:'sans',fontSize:2.5,bold:true,autoFit:true,autoLength:false,length:50,margin:2,frame:false,invert:false,flip:false};
    await apply(defaults);const horizontal=await snapshot();
    await page.locator('#writingMode').selectOption('vertical');
    await page.waitForFunction(()=>document.getElementById('textDirectionHelp').textContent.includes('90°'));
    const vertical=await snapshot();assert.notEqual(vertical.png,horizontal.png);assert.equal(vertical.height,96);
    assert.equal(await page.locator('#autoLength').isChecked(),true);
    await page.locator('#autoLength').uncheck();
    await page.waitForFunction(()=>document.getElementById('preview').width===400);
    await page.locator('#writingMode').selectOption('horizontal');
    await page.waitForFunction(()=>document.getElementById('textDirectionHelp').textContent==='改行で複数行にできます。');
    assert.equal((await snapshot()).png,horizontal.png);
    check('vertical selection enables automatic length; manual mode and horizontal rendering remain available');

    for(const writingMode of ['horizontal','vertical']){
      const results=[];
      for(const alignment of ['left','center','right']){
        await apply({...defaults,writingMode,alignment});const s=await snapshot();
        assert.equal(s.valid,true);assert.equal(s.height,96);assert.equal(s.width,400);assert.equal(s.transform,'none');assert.ok(s.ink>0);results.push(s);
      }
      const centers=results.map(s=>(s.minX+s.maxX)/2);
      assert.ok(centers[0]<80&&Math.abs(centers[1]-200)<5&&centers[2]>320);
      assert.ok(results.every(s=>Math.abs(s.minY-results[0].minY)<=1&&Math.abs(s.maxY-results[0].maxY)<=1));
      check(writingMode+' left/center/right alignment moves ink horizontally without rotating the preview');
    }
    await apply({...defaults,writingMode:'vertical',labelText:'日月\n山川'});
    const columns=await snapshot();const [a,b,c,d]=columns.glyphs;
    assert.deepEqual(columns.glyphs.map(g=>g.text),['日','月','山','川']);assert.equal(a.y,b.y);assert.equal(c.y,d.y);assert.ok(a.x<b.x&&c.x<d.x);assert.ok(a.y<c.y);
    assert.ok(columns.glyphs.every(g=>Math.abs(g.a)<1e-12&&Math.abs(g.b+1)<1e-12&&Math.abs(g.c-1)<1e-12&&Math.abs(g.d)<1e-12));
    // Turn the landscape tape clockwise to its reading orientation: characters
    // must then go down and successive columns must go left, as in vertical-rl.
    const upright=columns.glyphs.map(g=>({x:96-g.y,y:g.x}));
    assert.equal(upright[0].x,upright[1].x);assert.ok(upright[0].y<upright[1].y);assert.ok(upright[0].x>upright[2].x);
    check('glyphs rotate left 90 degrees and advance right; turning the tape yields Japanese vertical-rl');

    for(const alignment of ['left','center','right']){
      await apply({...defaults,writingMode:'vertical',labelText:'日日日日\n日日',alignment});
      const g=(await snapshot()).glyphs;
      if(alignment==='left')assert.ok(Math.abs(g[0].x-g[4].x)<1e-9);
      else if(alignment==='right')assert.ok(Math.abs(g[3].x-g[5].x)<1e-9);
      else assert.ok(Math.abs((g[0].x+g[3].x)/2-(g[4].x+g[5].x)/2)<1e-9);
    }
    check('unequal input lines align independently at their left edge, center, or right edge');

    await apply({...defaults,writingMode:'vertical',labelText:'ー',fontSize:5});const longMark=await snapshot();
    assert.ok(longMark.maxX-longMark.minX>3*(longMark.maxY-longMark.minY));
    await apply({...defaults,writingMode:'vertical',labelText:'か\u3099👨‍👩‍👧‍👦'});
    assert.deepEqual((await snapshot()).glyphs.map(g=>g.text),['か\u3099','👨‍👩‍👧‍👦']);
    check('long-vowel mark follows the tape axis; combining characters and emoji stay in one cell');

    await apply({...defaults,writingMode:'horizontal',fontSize:5,labelText:'日日日日'});
    await page.locator('#writingMode').selectOption('vertical');
    await page.waitForFunction(()=>document.getElementById('measurement').textContent.startsWith('24 mm'));
    const short=await snapshot();
    await page.evaluate(()=>{window.drawnGlyphs=[];});
    await page.locator('#labelText').fill('日日日日日日日日');
    await page.waitForFunction(()=>document.getElementById('measurement').textContent.startsWith('44 mm'));
    const longer=await snapshot();
    assert.ok(longer.width>short.width);assert.equal(longer.height,96);assert.ok(longer.valid&&short.valid);
    assert.ok(longer.glyphs.every(g=>g.font===short.glyphs.at(-1).font));
    await page.locator('#labelText').fill('日日日日');
    await page.waitForFunction(()=>document.getElementById('measurement').textContent.startsWith('24 mm'));
    assert.equal((await snapshot()).width,short.width);
    await apply({...defaults,writingMode:'vertical',labelText:'文字が縦に並ぶ',fontSize:10,autoFit:false});assert.equal((await snapshot()).valid,false);
    await apply({writingMode:'vertical',autoFit:true});assert.equal((await snapshot()).valid,true);
    check('typing grows/shrinks tape length without reducing font size; manual overflow remains guarded');

    await apply({...defaults,writingMode:'vertical',autoLength:true,fontSize:10,labelText:'日'.repeat(600)});
    const capped=await snapshot();assert.equal(capped.width,15984);assert.equal(capped.height,96);assert.equal(capped.valid,true);
    assert.match(await page.locator('#renderNote').textContent(),/2000 mm/);
    await apply({writingMode:'vertical',autoLength:true,autoFit:false});assert.equal((await snapshot()).valid,false);
    check('vertical labels cap at 2000 mm; content is fitted or rejected instead of silently clipped');

    await apply({...defaults,writingMode:'vertical',labelText:'日月\n山川'});const unflipped=await page.evaluate(()=>[...document.getElementById('preview').getContext('2d').getImageData(0,0,400,96).data]);
    await apply({writingMode:'vertical',flip:true});const flipped=await page.evaluate(()=>[...document.getElementById('preview').getContext('2d').getImageData(0,0,400,96).data]);
    for(let i=0;i<unflipped.length;i+=4)assert.equal(flipped[i],unflipped[unflipped.length-4-i]);
    check('existing 180-degree rotation applies to the completed vertical label');

    await apply({...defaults,writingMode:'vertical',labelText:'日月\n山川'});
    await page.locator('#alignment').selectOption('right');
    await page.waitForFunction(()=>JSON.parse(localStorage.getItem('p12-studio-v1')).alignment==='right');
    await page.reload();await page.evaluate(()=>document.fonts.ready);
    assert.equal(await page.locator('#writingMode').inputValue(),'vertical');assert.equal(await page.locator('#alignment').inputValue(),'right');assert.ok((await snapshot()).minX>300);
    const designDownload=page.waitForEvent('download');await page.locator('#saveDesign').click();const design=JSON.parse(await fs.readFile(await(await designDownload).path(),'utf8'));
    assert.equal(design.settings.writingMode,'vertical');assert.equal(design.settings.alignment,'right');
    await apply({writingMode:'horizontal',alignment:'left'});
    await page.locator('#designFile').setInputFiles({name:'vertical.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(design))});
    await page.waitForFunction(()=>document.getElementById('writingMode').value==='vertical'&&document.getElementById('alignment').value==='right');
    delete design.settings.writingMode;
    await page.locator('#designFile').setInputFiles({name:'legacy.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(design))});
    await page.waitForFunction(()=>document.getElementById('writingMode').value==='horizontal');
    check('direction/alignment persist after reload and JSON round trip; legacy designs open horizontally');

    await apply({...defaults,writingMode:'vertical',labelText:'日月\n山川'});
    const pngDownload=page.waitForEvent('download');await page.locator('#savePng').click();const png=await fs.readFile(await(await pngDownload).path());
    assert.equal(png.subarray(1,4).toString(),'PNG');assert.equal(png.readUInt32BE(16),400);assert.equal(png.readUInt32BE(20),96);
    const matching=await page.evaluate(()=>{
      const c=document.getElementById('preview'),pixels=c.getContext('2d').getImageData(0,0,c.width,c.height).data,{bytes}=buildRaster(c);
      for(let x=0;x<c.width;x++)for(let head=0;head<96;head++)if(((bytes[x*12+(head>>3)]>>(7-(head&7)))&1)!==(pixels[((95-head)*c.width+x)*4]<128?1:0))return false;
      return true;
    });assert.equal(matching,true);
    check('PNG keeps landscape dimensions and independently decoded print bytes match every preview pixel');
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.locator('#writingMode').isVisible(),true);assert.equal(await page.locator('#alignment').isVisible(),true);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(errors,[]);
    check('mobile layout exposes both controls without horizontal page overflow or browser errors');
    console.log(passed+' browser checks passed');
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
