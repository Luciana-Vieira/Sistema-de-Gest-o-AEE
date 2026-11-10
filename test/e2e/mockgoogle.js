// Servidor falso do Google (OAuth + Calendar) para testar a integração sem credenciais reais.
const http = require('http');
const calls = [];
http.createServer((req, res) => {
  let body = ''; req.on('data', c => body += c); req.on('end', () => {
    const u = new URL(req.url, 'http://x'); calls.push([req.method, u.pathname, body.slice(0, 400)]);
    const j = (o, s = 200) => { res.writeHead(s, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (u.pathname === '/auth') { res.writeHead(302, { Location: u.searchParams.get('redirect_uri') + '?code=abc&state=' + u.searchParams.get('state') }); return res.end(); }
    if (u.pathname === '/token') { const idt = 'x.' + Buffer.from(JSON.stringify({ email: 'prof.demo@gmail.com' })).toString('base64url') + '.y'; return j({ access_token: 'AT' + Date.now(), refresh_token: 'RT1', expires_in: 3600, scope: 'calendar.events', id_token: idt }); }
    if (u.pathname === '/calendar/v3/calendars/primary/events') { const b = JSON.parse(body); return j({ id: 'evt' + calls.length, htmlLink: 'https://calendar.google.com/event?eid=1', hangoutLink: 'https://meet.google.com/abc-defg-hij', summary: b.summary, start: b.start, conferenceData: { entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc-defg-hij' }] } }); }
    if (u.pathname === '/_calls') return j(calls);
    if (u.pathname === '/revoke') return j({});
    j({ error: 'nf' }, 404);
  });
}).listen(3299, () => console.log('mock google on 3299'));
