const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const { syncAirportData } = require('../scraper/db');

async function scrapeBWI() {
  const airportCode = 'BWI';
  const sourceUrl = 'https://bwiairport.com/';

  console.log(`[BWI Adapter] Launching Stealth Browser for ${sourceUrl}...`);

  const browser = await puppeteer.launch({
    headless: "new",
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();
    await page.goto(sourceUrl, { waitUntil: 'networkidle2', timeout: 45000 });

    console.log(`[BOS Adapter] Page loaded. Extracting data...`);

    const checkpointsData = await page.evaluate(() => {
      const data = [];
      
      const targets = [
        { name: 'Checkpoint A', rowClass: '.hud_security_table_row_A', prefix: '.js-security-a' },
        { name: 'Checkpoint B', rowClass: '.hud_security_table_row_B', prefix: '.js-security-b' },
        { name: 'Checkpoint C', rowClass: '.hud_security_table_row_C', prefix: '.js-security-c' },
        { name: 'Checkpoint D/E', rowClass: '.hud_security_table_row_DE', prefix: '.js-security-de' }
      ];
      
      targets.forEach(target => {
        const row = document.querySelector(target.rowClass);
        if (!row) return;

        // General / Standard
        const generalEl = row.querySelector(`${target.prefix}-general`);
        if (generalEl) {
          const text = generalEl.innerText.trim().toUpperCase();
          let val = null;
          let stat = 'Active';
          if (text === 'X' || text.includes('CLOSED')) {
            stat = 'Closed';
          } else {
            const match = text.match(/(\d+)/);
            if (match) val = parseInt(match[1], 10);
          }
          data.push({
            name: `${target.name} - Standard`,
            waitMinutes: val,
            status: stat
          });
        }
        
        // TSA PreCheck
        const preEl = row.querySelector(`${target.prefix}-tsa_pre`);
        if (preEl) {
          const text = preEl.innerText.trim().toUpperCase();
          let val = null;
          let stat = 'Active';
          if (text === 'X' || text.includes('CLOSED')) {
            stat = 'Closed';
          } else {
            const match = text.match(/(\d+)/);
            if (match) val = parseInt(match[1], 10);
          }
          data.push({
            name: `${target.name} - TSA PreCheck`,
            waitMinutes: val,
            status: stat
          });
        }
      });
      
      return data;
    });

    console.log(`[BWI Adapter] Extracted ${checkpointsData.length} checkpoints:`);
    console.log(checkpointsData);

    if (checkpointsData.length > 0) {
      await syncAirportData(airportCode, checkpointsData);
      console.log(`[BWI Adapter] Successfully pushed to flyfast-v2 Firebase!`);
    } else {
      console.warn("[BWI Adapter] No checkpoints found. DOM verification failed.");
    }

  } catch (err) {
    console.error(`[BWI Adapter] Fatal Error:`, err.message);
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  scrapeBWI().then(() => process.exit(0));
}

module.exports = { scrapeBWI };
