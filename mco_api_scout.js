const https = require('https');

https.get('https://flymco.com/security/', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const urls = data.match(/https?:\/\/[^\s"'><]+/g);
    const apiUrls = urls ? urls.filter(u => u.includes('api') || u.includes('wait')) : [];
    console.log("Found API/Wait URLs:", Array.from(new Set(apiUrls)));
    
    // Also look for wait time data in the initial HTML
    const nextData = data.match(/self\.__next_f\.push\((.*?)\)/g);
    if(nextData) {
        nextData.forEach(d => {
            if(d.includes('wait') || d.includes('Wait') || d.includes('API')) {
                //console.log(d.substring(0, 100));
            }
        })
    }
  });
}).on('error', err => console.log(err));
