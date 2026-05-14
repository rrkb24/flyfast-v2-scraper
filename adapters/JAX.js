const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeJAX() {
  const airportCode = 'JAX';
  const sourceUrl = 'https://www.flyjacksonville.com/content.aspx?id=3583';

  console.log(`[JAX Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[JAX Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      const cpName = 'JAX Checkpoint';
      
      const container = document.querySelector('.checkpoint-container');
      if (!container) return data;

      const labels = container.querySelectorAll('.label');
      const times = container.querySelectorAll('.time');

      for (let i = 0; i < labels.length; i++) {
        const labelText = labels[i].innerText.trim().toUpperCase();
        let laneType = '';

        if (labelText.includes('STANDARD')) {
          laneType = 'Standard';
        } else if (labelText.includes('PREMIER') || labelText.includes('PRIORITY')) {
          laneType = 'Priority';
        } else if (labelText.includes('TSA PRE')) {
          laneType = 'TSA PreCheck';
        }

        if (!laneType) continue;

        const timeBlock = times[i];
        if (!timeBlock) continue;

        const boldSpan = timeBlock.querySelector('.bold');
        let waitMinutes = null;
        let status = 'Active';

        if (boldSpan) {
          const numText = boldSpan.innerText.trim().toUpperCase();
          if (numText.includes('CLOSED') || numText === 'X') {
            status = 'Closed';
          } else {
            const match = numText.match(/(\d+)/);
            if (match) waitMinutes = parseInt(match[1], 10);
            else if (numText.includes('<')) waitMinutes = 0;
            else status = 'Closed';
          }
        } else {
          status = 'Closed';
        }

        data.push({
          name: `${cpName} - ${laneType}`,
          waitMinutes,
          status
        });
      }

      return data;
    });

    console.log(`[JAX Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[JAX Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[JAX Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[JAX Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeJAX().then(() => process.exit(0));
}

module.exports = { scrapeJAX };
