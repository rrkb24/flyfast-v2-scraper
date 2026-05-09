const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeLAX() {
  const airportCode = 'LAX';
  const sourceUrl = 'https://www.flylax.com/wait-times';

  console.log(`[LAX Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[LAX Adapter] Page loaded successfully. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      // LAX uses a clean HTML table: table.wait-time-table tbody tr
      const rows = document.querySelectorAll('table.wait-time-table tbody tr');

      rows.forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 3) {
          const terminal = cells[0].innerText.trim();
          const boardingType = cells[1].innerText.trim();
          const waitText = cells[2].innerText.trim();

          // Extract the number from strings like "3 minutes"
          const waitMatch = waitText.match(/(\d+)/);
          const waitMinutes = waitMatch ? parseInt(waitMatch[1], 10) : null;

          if (waitMinutes !== null) {
            data.push({
              name: `${terminal} - ${boardingType}`,
              waitMinutes: waitMinutes,
              status: 'Active'
            });
          }
        }
      });

      return data;
    });

    console.log(`[LAX Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[LAX Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[LAX Adapter] No wait time rows found. Page structure may have changed.");
    }

  } catch (err) {
    console.error(`[LAX Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

// Allow running standalone for testing
if (require.main === module) {
  scrapeLAX().then(() => process.exit(0));
}

module.exports = { scrapeLAX };
