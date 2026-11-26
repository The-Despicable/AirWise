import { chromium } from 'playwright';

async function testOnboarding() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  const errors = [];
  const consoleMessages = [];
  
  page.on('console', msg => {
    consoleMessages.push({ type: msg.type(), text: msg.text() });
    if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`);
  });
  page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
  
  // Clear storage first
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.removeItem('airwise.profile.v1');
  });
  
  // Reload to trigger onboarding
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1000);
  
  console.log('=== HYDRATION CHECK ===');
  const hydrationErrors = errors.filter(e => e.includes('hydrat'));
  console.log('Hydration errors:', hydrationErrors.length);
  if (hydrationErrors.length) hydrationErrors.forEach(e => console.log('  ', e));
  
  // Check for Start panel
  const startButton = page.locator('button:has-text("Start")');
  const startVisible = await startButton.isVisible({ timeout: 5000 }).catch(() => false);
  console.log('Start panel visible:', startVisible);
  
  if (!startVisible) {
    console.log('No start panel - checking for existing profile...');
    const hasProfile = await page.evaluate(() => !!localStorage.getItem('airwise.profile.v1'));
    console.log('Profile exists:', hasProfile);
  }
  
  if (startVisible) {
    console.log('=== START PANEL INTERACTION ===');
    await startButton.click();
    await page.waitForTimeout(500);
    
    // Check greeting audio played
    const audio = page.locator('audio');
    const audioExists = await audio.count();
    console.log('Audio elements:', audioExists);
    
    // Check setup step visible
    const nameInput = page.locator('input[id="aw-name"]');
    const nameVisible = await nameInput.isVisible({ timeout: 3000 }).catch(() => false);
    console.log('Setup step visible (name input):', nameVisible);
    
    if (nameVisible) {
      console.log('=== FILLING SETUP ===');
      // Fill name
      await nameInput.fill('Test User');
      
      // Search for city
      const cityInput = page.locator('input[placeholder="Search a city in India"]');
      await cityInput.fill('Mumbai');
      await page.waitForTimeout(1000);
      
      // Pick first result
      const firstResult = page.locator('ul li button').first();
      const resultExists = await firstResult.isVisible({ timeout: 3000 }).catch(() => false);
      if (resultExists) {
        await firstResult.click();
        await page.waitForTimeout(500);
        console.log('City selected');
      }
      
      // Select contexts (parent, commuter)
      const parentChip = page.locator('button:has-text("Parent with children")');
      const commuterChip = page.locator('button:has-text("Daily commuter")');
      await parentChip.click();
      await commuterChip.click();
      console.log('Contexts selected');
      
      // Continue
      const continueButton = page.locator('button:has-text("Continue")');
      await continueButton.click();
      await page.waitForTimeout(1000);
      
      console.log('=== OVERLAY SHOULD BE GONE ===');
      const overlayGone = await page.locator('.fixed.inset-0.z-\\[100\\]').isHidden({ timeout: 3000 }).catch(() => false);
      console.log('Overlay hidden:', overlayGone);
      
      // Check profile saved
      const saved = await page.evaluate(() => localStorage.getItem('airwise.profile.v1'));
      console.log('Profile saved:', !!saved);
      if (saved) {
        const p = JSON.parse(saved);
        console.log('  Name:', p.name);
        console.log('  Contexts:', p.contexts);
        console.log('  Location:', p.location?.name);
      }
      
      // Reload
      console.log('=== RELOAD CHECK ===');
      await page.reload({ waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(1000);
      
      const overlayAfterReload = await page.locator('.fixed.inset-0.z-\\[100\\]').isHidden({ timeout: 3000 }).catch(() => false);
      console.log('Overlay hidden after reload:', overlayAfterReload);
      
      // Check chat header has name
      const headerName = await page.locator('h4:has-text("AI Assistant, Test User")').isVisible({ timeout: 3000 }).catch(() => false);
      console.log('Chat header shows name:', headerName);
    }
  }
  
  // Test chat with profile
  console.log('=== CHAT TEST WITH PROFILE ===');
  const chatInput = page.locator('input[placeholder*="Ask"]');
  if (await chatInput.isVisible({ timeout: 3000 }).catch(() => false)) {
    await chatInput.fill('Is it good for my child to play outside?');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(8000);
    
    const lastMessage = page.locator('.flex.flex-col > div').last();
    const replyText = await lastMessage.textContent({ timeout: 3000 }).catch(() => '');
    console.log('Reply preview:', replyText?.slice(0, 100));
  }
  
  // Test map and carousel
  console.log('=== MAP & CAROUSEL CHECK ===');
  const mapCanvas = page.locator('canvas');
  const mapExists = await mapCanvas.count();
  console.log('Map canvas count:', mapExists);
  
  // Check carousel pagination
  const pagination = page.locator('.fixed.top-8 button');
  const paginationCount = await pagination.count();
  console.log('Pagination buttons:', paginationCount);
  
  console.log('=== SUMMARY ===');
  console.log('Total console errors:', errors.length);
  errors.forEach(e => console.log('  ', e));
  
  await browser.close();
}

testOnboarding().catch(console.error);