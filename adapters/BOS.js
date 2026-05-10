const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeBOS() {
  const airportCode = 'BOS';
  const sourceUrl = 'https://www.massport.com/logan-airport/at-the-airport/security-wait-times';
  
  console.log(`[BOS Adapter] Launching Stealth Browser for ${sourceUrl}...`);
  
  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  
  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });
    
    console.log(`[BOS Adapter] Page loaded. Looking for Zensors iframe...`);
    
    // Wait for the Zensors iframe to load
    await page.waitForSelector('iframe', { timeout: 15000 });
    
    // Find the iframe with zensors.live in the src
    const iframeHandle = await page.evaluateHandle(() => {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        if (iframe.src && iframe.src.includes('zensors.live')) return iframe;
      }
      return null;
    });
    
    if (!iframeHandle || iframeHandle.constructor.name === 'JSHandle') {
      // Fallback: try navigating directly to the Zensors embed
      console.warn('[BOS Adapter] Could not find Zensors iframe, trying direct text extraction...');
    }
    
    const frame = await iframeHandle.contentFrame();
    if (!frame) {
      console.warn('[BOS Adapter] Could not access iframe content frame.');
      return;
    }
    
    console.log(`[BOS Adapter] Inside Zensors iframe. Extracting checkpoint data...`);
    
    // Wait for the dropdown to be present
    await frame.waitForSelector('select', { timeout: 10000 });
    
    // Get all checkpoint options from the dropdown
    const options = await frame.evaluate(() => {
      const select = document.querySelector('select');
      if (!select) return [];
      return Array.from(select.options).map((opt, i) => ({
        index: i,
        value: opt.value,
        text: opt.text.trim()
      }));
    });
    
    console.log(`[BOS Adapter] Found ${options.length} checkpoints in dropdown.`);
    
    const checkpointsData = [];
    
    for (const opt of options) {
      // Select this checkpoint from dropdown
      await frame.select('select', opt.value);
      // Wait for the data to update
      await new Promise(r => setTimeout(r, 2000));
      
      // Extract wait times from the cards
      const waitData = await frame.evaluate(() => {
        const results = [];
        // Look for all divs containing "min" text to find wait time values
        const allDivs = Array.from(document.querySelectorAll('div'));
        
        // Find Standard and PreCheck sections
        const standardHeader = allDivs.find(d => d.innerText.trim() === 'Standard');
        const precheckHeader = allDivs.find(d => d.innerText.trim().includes('TSA PreCheck'));
        
        function extractMinutes(headerEl) {
          if (!headerEl) return null;
          const parent = headerEl.closest('[role="heading"]')?.parentElement || headerEl.parentElement;
          if (!parent) return null;
          // Look for a sibling or child with just a number
          const minDiv = Array.from(parent.querySelectorAll('div')).find(d => d.innerText.trim() === 'min');
          if (minDiv && minDiv.parentElement) {
            const numEl = minDiv.parentElement.querySelector('div');
            if (numEl) {
              const num = parseInt(numEl.innerText.trim(), 10);
              if (!isNaN(num)) return num;
            }
          }
          // Fallback: look for any number near "min"
          const parentText = parent.innerText;
          const match = parentText.match(/(\d+)\s*min/);
          return match ? parseInt(match[1], 10) : null;
        }
        
        const standardMin = extractMinutes(standardHeader);
        const precheckMin = extractMinutes(precheckHeader);
        
        if (standardMin !== null) results.push({ type: 'Standard', minutes: standardMin });
        if (precheckMin !== null) results.push({ type: 'TSA PreCheck', minutes: precheckMin });
        
        return results;
      });
      
      for (const wd of waitData) {
        checkpointsData.push({
          name: `${opt.text} - ${wd.type}`,
          waitMinutes: wd.minutes,
          status: 'Active'
        });
      }
    }

    console.log(`[BOS Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[BOS Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[BOS Adapter] No checkpoints found. Zensors widget may have changed.");
    }
    
  } catch (err) {
    console.error(`[BOS Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeBOS().then(() => process.exit(0));
}

module.exports = { scrapeBOS };
