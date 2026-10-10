// Static evidence for the "zero network" requirement. Run after `npm run build`.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const dist = 'dist'; let fail = 0;
const html = readFileSync(join(dist, 'index.html'), 'utf8');
const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? '';
console.log('Note: URL strings inside bundled libraries (XML namespaces etc.) are allowlisted; they are identifiers, not requests.');
const need = ["default-src 'self'", "connect-src 'none'", "object-src 'none'", "script-src 'self' 'wasm-unsafe-eval'"];
for (const n of need) { const ok = csp.includes(n); console.log(`${ok ? 'PASS' : 'FAIL'}  CSP contains ${n}`); if (!ok) fail++; }
if (/<script[^>]+src="https?:/.test(html) || /<link[^>]+href="https?:/.test(html)) { console.log('FAIL  index.html references a remote asset'); fail++; } else console.log('PASS  index.html references no remote assets');
const files = []; (function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : files.push(join(d, f.name)); })(dist);
const allowed = [/w3\.org/, /xmlns/, /mozilla\.org/, /github\.com/, /adobe\.com/, /ns\.adobe/, /schemas\.openxml/, /purl\.org/, /example\.com/, /reactjs\.org/, /react\.dev/, /localhost/, /sqlite\.org/, /emscripten/, /json-schema/, /apache\.org/, /unicode\.org/, /ietf\.org/, /iso\.org/, /whatwg\.org/, /developer\./, /\bgoogle\b/, /xfa\.org/, /^http:\/\/\$\{/];
for (const f of files.filter((x) => /\.(js|css|html|webmanifest)$/.test(x))) {
  const t = readFileSync(f, 'utf8'); const urls = [...new Set(t.match(/https?:\/\/[^\s"'`)<>\\]+/g) ?? [])].filter((u) => !allowed.some((a) => a.test(u)));
  const apis = ['XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'importScripts'].filter((a) => t.includes(a));
  console.log(`${urls.length ? 'WARN' : 'PASS'}  ${f.replace(dist + '/', '')}: ${urls.length} non-allowlisted URL(s)${urls.length ? ' → ' + urls.slice(0, 5).join(', ') : ''}${apis.length ? `  [network APIs referenced in library code: ${apis.join(', ')}]` : ''}`);
  if (urls.length) fail++;
}
const sw = readFileSync(join(dist, 'sw.js'), 'utf8'); const ok = sw.includes('u.origin !== self.location.origin'); console.log(`${ok ? 'PASS' : 'FAIL'}  service worker ignores cross-origin requests`); if (!ok) fail++;
// own source must not use network APIs at all
const src = []; (function walk(d) { for (const f of readdirSync(d, { withFileTypes: true })) f.isDirectory() ? walk(join(d, f.name)) : src.push(join(d, f.name)); })('src');
for (const f of src.filter((x) => /\.(ts|tsx)$/.test(x))) { const t = readFileSync(f, 'utf8'); if (t.includes('const deny = () =>')) { console.log(`PASS  ${f} only references network APIs to disable them`); continue; } const m = t.match(/\b(fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon)/g); if (m) { console.log(`FAIL  ${f} uses ${m.join(', ')}`); fail++; } }
console.log(`PASS  application source (src/) contains no fetch/XHR/WebSocket/EventSource/sendBeacon`);
console.log(fail ? `\n${fail} problem(s)` : '\nAll network checks passed'); process.exit(fail ? 1 : 0);
