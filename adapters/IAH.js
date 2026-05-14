const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeIAH() {
  const airportCode = 'IAH';
  const sourceUrl = 'https://www.fly2houston.com/iah/security/';

  console.log(`[IAH Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    
    // CRITICAL: Block all tracking scripts, media, and fonts to prevent network timeouts
    await page.setRequestInterception(true);
    page.on('request', (req) => {
      const type = req.resourceType();
      if (['image', 'stylesheet', 'font', 'media'].includes(type) || req.url().includes('google-analytics') || req.url().includes('googletag')) {
        req.abort();
      } else {
        req.continue();
      }
    });

    try {
      // Force a short timeout and proceed even if the page doesn't "fully" finish loading background trackers
      await page.goto(sourceUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch (e) {
      console.log(`[IAH Adapter] Page goto timed out at 15s, but DOM is likely ready. Proceeding...`);
    }

    console.log(`[IAH Adapter] Page loaded. Extracting data...`);
    
    // Brief wait for any JS-injected elements
    await new Promise(r => setTimeout(r, 4000));

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const parsedKeys = new Set();
      
      // Houston's site uses heavily obfuscated Next.js CSS classes that break traditional selectors.
      // We rely on the raw rendered text which maintains a predictable structure:
      // Line 1: "IAH Terminal A North Standard"
      // Line 2: "Hours: ..."
      // Line 3: "3 min"
      
      const lines = document.body.innerText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line.startsWith('IAH Terminal')) {
          const cpNameRaw = line; // e.g., "IAH Terminal A North Standard"
          
          let waitMinutes = null;
          let status = 'Active';
          
          // Look ahead up to 3 lines to find the minutes or closed status
          for (let j = 1; j <= 3; j++) {
            if (i + j < lines.length) {
              const nextLine = lines[i + j].toUpperCase();
              if (nextLine.includes('MIN')) {
                const match = nextLine.match(/(\d+)/);
                if (match) {
                  waitMinutes = parseInt(match[1], 10);
                }
                break;
              } else if (nextLine.includes('CLOSED') || nextLine.includes('X')) {
                status = 'Closed';
                break;
              }
            }
          }
          
          // Clean up and standardize the checkpoint name
          let cleanName = cpNameRaw.replace('IAH ', '').trim();
          
          if (cleanName.includes('Standard')) {
            cleanName = cleanName.replace('Standard', '- Standard').trim();
          } else if (cleanName.includes('PreCheck')) {
            cleanName = cleanName.replace('PreCheck', '- TSA PreCheck').trim();
          } else if (cleanName.includes('Premier')) {
            cleanName = cleanName.replace('Premier', '- Premier').trim();
          } else {
             // Fallback default
             cleanName = cleanName + ' - Standard';
          }
          
          if (!parsedKeys.has(cleanName)) {
            parsedKeys.add(cleanName);
            data.push({
              name: cleanName,
              waitMinutes,
              status
            });
          }
        }
      }

      return data;
    });

    console.log(`[IAH Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[IAH Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[IAH Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[IAH Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeIAH().then(() => process.exit(0));
}

module.exports = { scrapeIAH };
