import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
  const page=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:2});
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const url='https://gioop92z.github.io/control-bodega/team.html?qa='+Date.now();
  const response=await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(response?.status(),200,'The shared inventory page must be served');
  await page.waitForFunction(()=>document.querySelector('#teamLoginSection')?.hidden===false,{timeout:25000});
  assert.equal(await page.locator('#teamUnavailable').isVisible(),false,'Live backend must be configured');
  assert.equal(await page.locator('#teamLoginSection').isVisible(),true,'Login form must be accessible');
  await page.locator('.team-setup summary').click();
  assert.equal(await page.locator('#teamSetupForm input[name=key]').isVisible(),true,'First-time admin activation must be available');
  assert.equal(await page.locator('#teamSetupForm input[name=employee]').isVisible(),true);
  assert.equal(await page.locator('#teamSetupForm input[name=pin]').isVisible(),true);
  assert.deepEqual(errors,[],'No unhandled browser JS errors');
  const api=await page.evaluate(async()=>{
    const {TEAM_API_URL}=await import('./team-config.mjs');
    return TEAM_API_URL;
  });
  assert.equal(api,'https://uphnzyembyrouvqohwys.supabase.co/functions/v1/vantis-inventory');
  const local=await page.goto('https://gioop92z.github.io/control-bodega/local.html',{waitUntil:'domcontentloaded'});
  assert.equal(local?.status(),200,'Existing isolated local mode remains published');
  console.log('PASS: live mobile frontend renders, shared backend configured, secure admin setup visible, isolated local edition preserved.');
} finally { await browser.close(); }
