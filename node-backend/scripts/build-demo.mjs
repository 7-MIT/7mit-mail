// Bundles public/ into ONE self-contained HTML file (styles + icons + demo data + app) for sharing a preview.
// Usage: node scripts/build-demo.mjs out.html
import fs from 'node:fs';
const r = (f) => fs.readFileSync('public/' + f, 'utf8');
const app = r('app.js').replace(/^import \{ icon as I \} from '\.\/icons\.js';\n/m, '');
const icons = r('icons.js').replace('export function', 'function').replace(/^const ICONS/m, 'const ICONS');
if (/<\/script/i.test(app + icons + r('demo.js'))) throw new Error('script terminator inside bundle');
fs.writeFileSync(process.argv[2] || 'demo-bundle.html', `<title>7 MIT Mail</title>
<style>
${r('styles.css')}
html,body{height:100%}
</style>
<div id="app"></div>
<script>
${r('demo.js')}
</script>
<script type="module">
${icons}
${app}
</script>
`);
