const admin = require('firebase-admin');
const { firebaseServiceAccount, collectionName } = require('./config');

let db = null;

if (firebaseServiceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(firebaseServiceAccount)
    });
  }
  db = admin.firestore();
} else {
  console.warn("WARNING: Firebase service account not found. DB writes will be logged to console in DRY RUN mode.");
}

const fs = require('fs');
const path = require('path');

const CACHE_FILE = path.join(__dirname, 'delta_cache.json');
let localCache = {};
try {
  if (fs.existsSync(CACHE_FILE)) {
    localCache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
  }
} catch (e) {
  console.error('[DB] Cache load error:', e);
}

/**
 * Normalizes and batch writes airport arrays to Firestore using Zero-Read Local Caching.
 */
async function syncAirportData(airportCode, checkpointsData) {
  const currentMs = Date.now();
  console.log(`\n[${airportCode}] Synchronizing ${checkpointsData.length} checkpoints...`);

  if (!db) {
    console.log(`[DRY RUN DB Cache Write Block - ${airportCode}]`);
    return;
  }

  try {
    const logsRef = db.collection(collectionName);
    const batch = db.batch();
    let writesQueued = 0;
    let cacheChanged = false;

    for (const cp of checkpointsData) {
      if (cp.waitMinutes === null) continue; // Skip closed terminals
      
      const payload = {
        airport: airportCode,
        terminal: cp.name,
        waitTime: cp.waitMinutes,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        timestampMs: currentMs
      };

      const cacheKey = `${airportCode}_${cp.name}`;
      const lastRecord = localCache[cacheKey];

      let shouldWrite = true;

      if (lastRecord) {
        const timeDiffMinutes = (currentMs - (lastRecord.timestampMs || 0)) / (1000 * 60);
        // Ignore if waitTime hasn't changed AND it's been less than 15 mins
        if (lastRecord.waitTime === payload.waitTime && timeDiffMinutes < 15) {
          shouldWrite = false;
        }
      }

      if (shouldWrite) {
        // Create a predictable document ID (e.g., "ATL_Domestic_Main_Checkpoint")
        const docId = `${airportCode}_${cp.name.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const docRef = logsRef.doc(docId);
        batch.set(docRef, payload);
        writesQueued++;

        // Update local cache state
        localCache[cacheKey] = { waitTime: payload.waitTime, timestampMs: currentMs };
        cacheChanged = true;
      }
    }

    if (cacheChanged) {
      fs.writeFileSync(CACHE_FILE, JSON.stringify(localCache));
    }

    if (writesQueued > 0) {
      await batch.commit();
      console.log(`[${airportCode}] Committed ${writesQueued} new checkpoint records to Firestore.`);
    } else {
      console.log(`[${airportCode}] Cache hit for all checkpoints. Saved Firestore tier quota.`);
    }

  } catch (err) {
    console.error(`[${airportCode}] Error syncing to Firestore:`, err.message);
  }
}

module.exports = { syncAirportData };
