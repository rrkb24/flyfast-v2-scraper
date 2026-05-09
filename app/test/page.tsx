import admin from 'firebase-admin';

// Initialize Firebase Admin safely for Next.js hot-reloading
function initFirebase() {
  if (admin.apps.length > 0) return admin.firestore();
  
  try {
    let serviceAccount = null;
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      if (serviceAccount.private_key) {
        serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
      }
    }

    if (serviceAccount) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      return admin.firestore();
    }
  } catch (err) {
    console.error("Firebase init error:", err);
  }
  return null;
}

export default async function TestDashboard() {
  const db = initFirebase();
  let displayData = [];

  if (db) {
    try {
      const snapshot = await db.collection('wait_times')
                               .where('airport', '==', 'ATL')
                               .orderBy('timestampMs', 'desc')
                               .limit(20)
                               .get();
                               
      const atlData: any[] = [];
      snapshot.forEach(doc => {
        atlData.push({ id: doc.id, ...doc.data() });
      });

      // Deduplicate by terminal name to get the absolute latest status
      const uniqueTerminals: Record<string, any> = {};
      atlData.forEach(d => {
        if (!uniqueTerminals[d.terminal] || uniqueTerminals[d.terminal].timestampMs < d.timestampMs) {
          uniqueTerminals[d.terminal] = d;
        }
      });
      
      displayData = Object.values(uniqueTerminals);
    } catch (error) {
      console.error("Firebase fetch error:", error);
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white p-10 font-sans">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-4xl font-bold mb-2 text-emerald-400 tracking-tight">FlyFast v2</h1>
        <p className="text-slate-400 mb-10 text-lg">Adapter Scraper Validation Dashboard</p>
        
        <div className="bg-slate-800 p-8 rounded-2xl border border-slate-700/50 shadow-2xl">
          <div className="flex justify-between items-center mb-8 border-b border-slate-700 pb-4">
            <h2 className="text-3xl font-semibold text-slate-100">Atlanta (ATL)</h2>
            <div className="flex items-center space-x-2 bg-emerald-500/10 text-emerald-400 px-4 py-2 rounded-full border border-emerald-500/20">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></div>
              <span className="text-sm font-semibold tracking-wide uppercase">Live Data</span>
            </div>
          </div>

          {displayData.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-slate-400 text-lg italic">No data found in flyfast-v2 Firebase.</p>
              <p className="text-slate-500 mt-2">Run the `adapters/ATL.js` script to populate this dashboard.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {displayData.map((item: any) => (
                <div key={item.id} className="flex justify-between items-center p-5 bg-slate-700/30 hover:bg-slate-700/50 transition-colors rounded-xl border border-slate-600/30">
                  <div>
                    <h3 className="font-semibold text-lg text-slate-200">{item.terminal}</h3>
                    <p className="text-xs text-slate-400 mt-1.5 font-mono">
                      Synced: {new Date(item.timestampMs).toLocaleTimeString()}
                    </p>
                  </div>
                  <div className="text-right flex items-baseline space-x-1">
                    <span className={`text-4xl font-bold tracking-tighter ${item.waitTime > 20 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {item.waitTime}
                    </span>
                    <span className="text-sm font-medium text-slate-500 uppercase tracking-wider">min</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
