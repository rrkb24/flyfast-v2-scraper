/**
 * FlyFast V2 — Master Adapter Runner
 * 
 * Auto-discovers and runs every adapter in the /adapters directory.
 * After all adapters finish, dumps Firestore data to public/wait_times_v2.json
 * for the static HTML dashboard.
 */

const fs = require('fs');
const path = require('path');

const ADAPTERS_DIR = path.join(__dirname, '..', 'adapters');
const OUTPUT_FILE = path.join(__dirname, '..', 'public', 'wait_times_v2.json');

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

  // Dump Firestore data to static JSON for the dashboard
  try {
    console.log(`[Runner] Exporting Firestore data to ${OUTPUT_FILE}...`);
    const { getAllWaitTimes } = require('./db');
    const data = await getAllWaitTimes();

    const payload = {
      updated_at: new Date().toISOString(),
      airport_count: Object.keys(data).length,
      airports: data
    };

    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(payload, null, 2));
    console.log(`[Runner] Exported ${Object.keys(data).length} airports to wait_times_v2.json`);
  } catch (err) {
    console.error(`[Runner] JSON export failed: ${err.message}`);
  }

  if (failed > 0) {
    process.exitCode = 1; // Signal partial failure but don't crash
  }
}

runAll();
