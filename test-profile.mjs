import { chromium } from 'playwright';

async function testProfile() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`CONSOLE ERROR: ${msg.text()}`);
  });
  page.on('pageerror', e => errors.push(`PAGE ERROR: ${e.message}`));
  
  // Set up profile first
  await page.goto('http://localhost:3000/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('airwise.profile.v1', JSON.stringify({
      version: 1,
      name: 'Test User',
      contexts: ['parent', 'commuter'],
      location: {
        lat: 19.076,
        lon: 72.8777,
        name: 'Mumbai, Maharashtra',
        elevation: 14,
        source: 'manual'
      },
      updatedAt: new Date().toISOString()
    }));
    window.dispatchEvent(new Event('airwise:profile-changed'));
  });
  
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  
  // Check header
  const header = await page.locator('h4:has-text("AI Assistant, Test User")').isVisible({ timeout: 5000 }).catch(() => false);
  console.log('Header shows name:', header);
  
  // Check profile in useProfile
  const profileData = await page.evaluate(() => {
    return localStorage.getItem('airwise.profile.v1');
  });
  console.log('Profile in localStorage:', !!profileData);
  
  // Check if MorphingNav sees it - look for any element with the name
  const anyName = await page.locator('text=Test User').count();
  console.log('Elements with "Test User":', anyName);
  
  console.log('Errors:', errors.length);
  errors.forEach(e => console.log(' ', e));
  
  await browser.close();
}

testProfile().catch(console.error);