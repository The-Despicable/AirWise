import { chromium } from 'playwright';

async function checkMap() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  const consoleErrors = [];
  page.on('console', msg => {
    console.log('CONSOLE:', msg.type(), msg.text());
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  const failedRequests = [];
  page.on('requestfailed', request => {
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  
  page.on('response', response => {
    if (response.status() >= 400) {
      console.log('HTTP ERROR:', response.status(), response.url());
    }
  });
  
  console.log('Navigating to homepage...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  
  await page.waitForTimeout(2000);
  
  console.log('Pressing ArrowRight twice...');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(3000);
  
  // Check all elements
  console.log('\n--- Element checks ---');
  
  const mapCanvas = await page.locator('canvas.maplibregl-canvas').count();
  console.log('maplibregl-canvas count:', mapCanvas);
  
  const anyCanvas = await page.locator('canvas').count();
  console.log('All canvas count:', anyCanvas);
  
  const mapContainer = await page.locator('[class*="map"]').count();
  console.log('Elements with "map" in class:', mapContainer);
  
  // Check for error
  const errorText = await page.locator('text=Failed to load map tiles').count();
  console.log('Error banner count:', errorText);
  
  // Check all fixed position elements
  const fixedElements = await page.locator('[style*="fixed"]').count();
  console.log('Fixed position elements:', fixedElements);
  
  // Get all visible text elements near top
  const topTexts = await page.locator('body >> visible=true').allTextContents();
  console.log('\nAll visible text (first 200 chars each):');
  topTexts.slice(0, 20).forEach((t, i) => console.log(i, t.slice(0, 200)));
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/map-check2.png', fullPage: true });
  console.log('\nScreenshot saved');
  
  await browser.close();
}

checkMap().catch(err => console.error('Error:', err));
