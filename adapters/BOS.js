const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeBOS() {
  const airportCode = 'BOS';
  // Massport embeds this Zensors iframe for their wait times
  const sourceUrl = 'https://embed.zensors.live/BOS/tSTQVPRW1/waitTimeExplorer?token=9uBjlxUu2dTQydGHYGtoDYxH5TE0vHOl';

  console.log(`[BOS Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[BOS Adapter] Zensors iframe loaded. Extracting dropdown options...`);

    // Wait for the select dropdown to appear
    await page.waitForSelector('select[aria-label="Select a journey"]', { timeout: 15000 });

    // Extract all option values and their corresponding text from the dropdown
    const dropdownOptions = await page.evaluate(() => {
      const select = document.querySelector('select[aria-label="Select a journey"]');
      const opts = [];
      for (const option of select.options) {
        opts.push({
          value: option.value,
          text: option.innerText.trim()
        });
      }
      return opts;
    });

    console.log(`[BOS Adapter] Found ${dropdownOptions.length} checkpoints in dropdown.`);
    const checkpointsData = [];

    // Iterate over each dropdown option, select it, and scrape the wait times
    for (const opt of dropdownOptions) {
      // Select the current checkpoint option
      await page.select('select[aria-label="Select a journey"]', opt.value);
      
      // Wait a moment for Zensors to render the new wait times
      await new Promise(r => setTimeout(r, 1500));

      // Extract the Standard and PreCheck values
      const laneData = await page.evaluate(() => {
        const results = [];
        const meters = document.querySelectorAll('div[role="meter"]');
        
        meters.forEach(meter => {
          const val = meter.getAttribute('aria-valuenow');
          
          // Walk up the DOM to find the container, then search for text
          let container = meter.parentElement;
          let laneType = null;
          
          // Go up a few levels and check textContent
          for (let i = 0; i < 5; i++) {
            if (!container) break;
            const text = container.textContent.toUpperCase();
            if (text.includes('PRECHECK')) {
              laneType = 'TSA PreCheck';
              break;
            } else if (text.includes('STANDARD')) {
              laneType = 'Standard';
              break;
            }
            container = container.parentElement;
          }
          
          if (laneType) {
            results.push({
              type: laneType,
              waitMinutes: val ? parseInt(val, 10) : null,
              status: val ? 'Active' : 'Closed'
            });
          }
        });

        return results;
      });

      // Normalize names and push to final array
      laneData.forEach(lane => {
        // e.g., "Checkpoint 1: A Gates - Standard"
        const finalName = `${opt.text} - ${lane.type}`;
        checkpointsData.push({
          name: finalName,
          waitMinutes: lane.waitMinutes,
          status: lane.status
        });
      });
    }

    console.log(`[BOS Adapter] Extracted ${checkpointsData.length} individual lanes:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[BOS Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[BOS Adapter] No checkpoints found. DOM verification failed.");
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
