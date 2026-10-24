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

async function testClause(scanClause, label) {
  const pageResponse = await fetchPage(SCREENER_URL);
  const csrfMatch = pageResponse.body.match(/<meta name="csrf-token" content="([^"]+)"/);
  const csrf = csrfMatch ? csrfMatch[1] : '';
  const cookies = (pageResponse.headers['set-cookie'] || []).map(c => c.split(';')[0]).join('; ');

  const formData = { scan_clause: scanClause, max_rows: 5 };
  const headers = {
    'X-Requested-With': 'XMLHttpRequest',
    'X-CSRF-TOKEN': csrf,
    'Referer': SCREENER_URL,
    'Origin': 'https://chartink.com',
    'Cookie': cookies,
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  };

  const response = await postForm(PROCESS_URL, formData, headers);
  
  try {
    const data = JSON.parse(response.body);
    console.log(`${label}: ${data.recordsTotal} results`);
    return data.recordsTotal;
  } catch (e) {
    console.log(`${label}: Error - ${response.body.substring(0, 100)}`);
    return 0;
  }
}

async function runTests() {
  console.log('Testing Shariah IslamicStock criteria combinations...\n');
  
  const clauses = [
    { clause: '( {cash} ( debt to equity < 0.33 and book value > 0 and net profit > 0 ) )', label: 'D/E<0.33 + BV>0 + NP>0' },
    { clause: '( {cash} ( debt to equity < 0.33 and book value > 0 ) )', label: 'D/E<0.33 + BV>0' },
    { clause: '( {cash} ( debt to equity < 0.33 and net profit > 0 ) )', label: 'D/E<0.33 + NP>0' },
    { clause: '( {cash} ( debt to equity < 0.5 and book value > 0 and net profit > 0 ) )', label: 'D/E<0.5 + BV>0 + NP>0' },
    { clause: '( {cash} ( book value > 0 and net profit > 0 and dividend yield > 0 ) )', label: 'BV>0 + NP>0 + DY>0' },
    { clause: '( {cash} ( debt to equity < 0.33 and book value > 0 and dividend yield > 0 ) )', label: 'D/E<0.33 + BV>0 + DY>0' },
    { clause: '( {cash} ( debt to equity < 0.33 and net profit > 0 and dividend yield > 0 ) )', label: 'D/E<0.33 + NP>0 + DY>0' },
    { clause: '( {cash} ( market cap > 5800 and debt to equity < 0.33 ) )', label: 'MC>5800 + D/E<0.33' },
    { clause: '( {cash} ( market cap > 5800 and book value > 0 ) )', label: 'MC>5800 + BV>0' },
    { clause: '( {cash} ( market cap > 5800 and net profit > 0 ) )', label: 'MC>5800 + NP>0' },
  ];

  for (const item of clauses) {
    await testClause(item.clause, item.label);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
}

runTests().catch(console.error);
