import { chromium } from 'playwright';

async function checkMap() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  // Capture console errors
  const consoleErrors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });
  
  // Capture network failures
  const failedRequests = [];
  page.on('requestfailed', request => {
    failedRequests.push({ url: request.url(), failure: request.failure()?.errorText });
  });
  
  // Navigate to the map page (page 2)
  console.log('Navigating to homepage...');
  await page.goto('http://localhost:3000', { waitUntil: 'networkidle', timeout: 30000 });
  
  // Wait for carousel to be ready
  await page.waitForTimeout(1000);
  
  // Swipe/navigate to page 2 (index 2 = Weather Map)
  console.log('Navigating to Weather Map (page 2)...');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(500);
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(1500); // Wait for map to initialize and resize
  
  // Check for map tiles loading
  const mapContainer = await page.locator('.maplibregl-canvas').first();
  const mapVisible = await mapContainer.isVisible().catch(() => false);
  console.log('Map canvas visible:', mapVisible);
  
  // Check for error banner
  const errorBanner = await page.locator('text=Failed to load map tiles').first();
  const hasErrorBanner = await errorBanner.isVisible().catch(() => false);
  console.log('Error banner visible:', hasErrorBanner);
  
  // Check for tile images loaded
  const tileImages = await page.locator('.maplibregl-layer img').all();
  console.log('Number of tile images:', tileImages.length);
  
  // Check for overlapping elements - pagination bubbles position vs map header
  const paginationBubbles = await page.locator('fixed.top-8').first();
  const paginationBox = await paginationBubbles.boundingBox().catch(() => null);
  
  const mapHeader = await page.locator('text=Open-Meteo Model Estimates').first();
  const mapHeaderBox = await mapHeader.boundingBox().catch(() => null);
  
  console.log('Pagination bubbles position:', paginationBox);
  console.log('Map header position:', mapHeaderBox);
  
  // Check if they overlap
  if (paginationBox && mapHeaderBox) {
    const overlap = paginationBox.y + paginationBox.height > mapHeaderBox.y;
    console.log('OVERLAP DETECTED:', overlap);
    console.log('Pagination bottom:', paginationBox.y + paginationBox.height);
    console.log('Map header top:', mapHeaderBox.y);
  }
  
  // Check for keyboard hints bar (should be removed)
  const keyboardHints = await page.locator('text=← Previous').first();
  const hasKeyboardHints = await keyboardHints.isVisible().catch(() => false);
  console.log('Keyboard hints bar visible:', hasKeyboardHints);
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/map-check.png', fullPage: true });
  console.log('Screenshot saved to /tmp/map-check.png');
  
  // Check map tiles network requests
  const tileRequests = failedRequests.filter(r => r.url.includes('cartocdn') || r.url.includes('tile.openstreetmap'));
  console.log('Failed tile requests:', tileRequests.length);
  tileRequests.forEach(r => console.log('  -', r.url, r.failure));
  
  console.log('\nConsole errors:', consoleErrors.length);
  consoleErrors.forEach(e => console.log('  -', e));
  
  await browser.close();
  
  return {
    mapVisible,
    hasErrorBanner,
    tileCount: tileImages.length,
    overlap: paginationBox && mapHeaderBox ? paginationBox.y + paginationBox.height > mapHeaderBox.y : null,
    hasKeyboardHints,
    failedTiles: tileRequests.length
  };
}

checkMap().then(result => {
  console.log('\n=== RESULT ===');
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.hasErrorBanner || result.failedTiles > 0 || result.overlap || result.hasKeyboardHints ? 1 : 0);
}).catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
