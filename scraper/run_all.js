/**
 * FlyFast V2 — Master Adapter Runner
 * 
 * Auto-discovers and runs every adapter in the /adapters directory.
 * The workflow YAML never needs to change when new airports are added.
 */

const fs = require('fs');
const path = require('path');

const ADAPTERS_DIR = path.join(__dirname, '..', 'adapters');

async function runAll() {
  const files = fs.readdirSync(ADAPTERS_DIR).filter(f => f.endsWith('.js'));
  
  console.log(`\n========================================`);
  console.log(`[Runner] Found ${files.length} adapters: ${files.join(', ')}`);
  console.log(`========================================\n`);

  let success = 0;
  let failed = 0;

  for (const file of files) {
    const adapterPath = path.join(ADAPTERS_DIR, file);
    const airportCode = file.replace('.js', '');
    
    console.log(`\n--- [Runner] Starting ${airportCode} ---`);
    const startTime = Date.now();

    try {
      // Clear require cache to ensure fresh load
      delete require.cache[require.resolve(adapterPath)];
      const adapter = require(adapterPath);
      
      // Find the exported scrape function (e.g., scrapeATL, scrapeLAX)
      const scrapeFn = Object.values(adapter).find(fn => typeof fn === 'function');
      
      if (!scrapeFn) {
        console.error(`[Runner] ${airportCode}: No scrape function exported. Skipping.`);
        failed++;
        continue;
      }

      await scrapeFn();
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`--- [Runner] ${airportCode} completed in ${elapsed}s ---`);
      success++;
    } catch (err) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.error(`--- [Runner] ${airportCode} FAILED after ${elapsed}s: ${err.message} ---`);
      failed++;
    }
  }

  console.log(`\n========================================`);
  console.log(`[Runner] Finished: ${success} succeeded, ${failed} failed out of ${files.length} total.`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exitCode = 1; // Signal partial failure but don't crash
  }
}

runAll();
