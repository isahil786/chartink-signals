const https = require('https');
const querystring = require('querystring');

const SCREENER_URL = 'https://chartink.com/screener/shariah-islamicstock';
const PROCESS_URL = 'https://chartink.com/screener/process';

function fetchPage(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
    }).on('error', reject);
  });
}

function postForm(url, formData, headers) {
  return new Promise((resolve, reject) => {
    const postData = querystring.stringify(formData);
    const options = {
      hostname: new URL(url).hostname,
      path: new URL(url).pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(postData),
        ...headers,
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ statusCode: res.statusCode, body, headers: res.headers }));
    });

    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function runScreener() {
  try {
    // Step 1: Fetch the screener page to get CSRF token and cookies
    console.log('Fetching screener page...');
    const pageResponse = await fetchPage(SCREENER_URL);
    
    if (pageResponse.statusCode !== 200) {
      console.error('Failed to fetch screener page:', pageResponse.statusCode);
      return;
    }

    // Extract CSRF token
    const csrfMatch = pageResponse.body.match(/<meta name="csrf-token" content="([^"]+)"/);
    const csrf = csrfMatch ? csrfMatch[1] : '';
    
    if (!csrf) {
      console.error('CSRF token not found');
      return;
    }
    
    console.log('CSRF token found');

    // Extract scan_run_token from scan-json
    const scanJsonMatch = pageResponse.body.match(/scan-json="([^"]+)"/);
    if (!scanJsonMatch) {
      console.error('scan-json not found');
      return;
    }
    
    const decoded = scanJsonMatch[1].replace(/&quot;/g, '"');
    const parsed = JSON.parse(decoded);
    const scanRunToken = parsed.scan_run_token;
    
    console.log('Scan run token found');
    console.log('Scanner name:', parsed.name);

    // Build cookie header from response
    const cookies = (pageResponse.headers['set-cookie'] || [])
      .map(c => c.split(';')[0])
      .join('; ');

    // Step 2: Post to the process endpoint
    console.log('\\nRunning screener...');
    const formData = {
      scan_run_token: scanRunToken,
      max_rows: 20,
    };

    const headers = {
      'X-Requested-With': 'XMLHttpRequest',
      'X-CSRF-TOKEN': csrf,
      'Referer': SCREENER_URL,
      'Origin': 'https://chartink.com',
      'Cookie': cookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    };

    const processResponse = await postForm(PROCESS_URL, formData, headers);
    
    console.log('Response status:', processResponse.statusCode);
    
    if (processResponse.statusCode === 200) {
      const data = JSON.parse(processResponse.body);
      
      console.log('\\n=== SCAN RESULTS ===');
      console.log('Total records:', data.recordsTotal);
      console.log('Filtered records:', data.recordsFiltered);
      console.log('\\nTop 20 results:\\n');
      
      console.log('Sr. | Symbol | Name | Close | Change % | Volume');
      console.log('-----|--------|------|-------|----------|--------');
      
      data.data.forEach((stock, index) => {
        console.log(
          `${String(stock.sr || index + 1).padStart(4)} | ` +
          `${stock.nsecode.padEnd(6)} | ` +
          `${stock.name.substring(0, 35).padEnd(35)} | ` +
          `${String(stock.close).padStart(10)} | ` +
          `${String(stock.per_chg).padStart(8)} | ` +
          `${String(stock.volume).padStart(10)}`
        );
      });
    } else {
      console.error('Error:', processResponse.body);
    }
  } catch (error) {
    console.error('Error:', error.message);
  }
}

runScreener();
