// Bundles the Node entry points and the browser client with esbuild.
import { build } from 'esbuild';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const nodeOnly = process.argv.includes('--node-only');
const node = { bundle: true, platform: 'node', format: 'esm', target: 'node20', sourcemap: true, packages: 'external', logLevel: 'warning' };

const jobs = [build({ ...node, entryPoints: ['src/sim/cli.ts'], outfile: 'dist/sim.js' })];
if (existsSync('src/server/server.ts')) jobs.push(build({ ...node, entryPoints: ['src/server/server.ts'], outfile: 'dist/server.js' }));
if (!nodeOnly && existsSync('src/web/main.ts')) {
  jobs.push(
    build({ bundle: true, platform: 'browser', format: 'esm', target: 'es2020', sourcemap: true, minify: true, entryPoints: ['src/web/main.ts'], outfile: 'dist/web/app.js', logLevel: 'warning' }),
  );
}
await Promise.all(jobs);

if (!nodeOnly && existsSync('src/web/main.ts')) {
  mkdirSync('dist/web', { recursive: true });
  cpSync('src/web/index.html', 'dist/web/index.html');
  cpSync('src/web/style.css', 'dist/web/style.css');
  // A single self-contained HTML file (styles and script inlined) for static hosting.
  const html = readFileSync('src/web/index.html', 'utf8');
  const css = readFileSync('src/web/style.css', 'utf8');
  const js = readFileSync('dist/web/app.js', 'utf8').replace(/\/\/# sourceMappingURL=.*$/m, '');
  if (/<\/script/i.test(js)) throw new Error('bundle contains </script>; cannot inline');
  const single = html
    .replace('<link rel="stylesheet" href="style.css" />', () => `<style>\n${css}\n</style>`)
    .replace('<script type="module" src="app.js"></script>', () => `<script type="module">\n${js}\n</script>`);
  writeFileSync('dist/saltmarket.html', single);
}
console.log('build ok');
