// Strict type check of a bundled script against the official NovelAI types
// (guideline 16: the script editor rejects scripts with type errors).
// Usage: node tools/typecheck.js <bundle.naiscript> [more bundles...]
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TYPES = path.resolve(__dirname, '..', 'types', 'NovelAI_Script_Types.d.ts');

function findTsc() {
    try {
        return require.resolve('typescript/bin/tsc', { paths: [path.resolve(__dirname, '..')] });
    } catch {
        return null;
    }
}

function typecheck(bundlePath) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nai-check-'));
    fs.copyFileSync(TYPES, path.join(dir, 'types.d.ts'));
    // `export {}` makes the check copy a module so top-level await is accepted
    fs.writeFileSync(path.join(dir, 'script.ts'), 'export {};\n' + fs.readFileSync(bundlePath, 'utf-8'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({
        compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ES2022', lib: ['ES2022'], skipLibCheck: true },
        files: ['types.d.ts', 'script.ts']
    }));
    const tsc = findTsc();
    try {
        if (tsc) {
            execFileSync(process.execPath, [tsc, '-p', dir], { stdio: 'pipe' });
        } else {
            execFileSync('npx', ['-y', '-p', 'typescript', 'tsc', '-p', dir], { stdio: 'pipe', shell: process.platform === 'win32' });
        }
        console.log(`Typecheck OK: ${path.basename(bundlePath)}`);
        return true;
    } catch (err) {
        const out = String((err.stdout || '') + (err.stderr || '')).replace(/script\.ts/g, path.basename(bundlePath));
        console.error(`Typecheck FAILED: ${path.basename(bundlePath)}\n${out}`);
        return false;
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}

if (require.main === module) {
    const files = process.argv.slice(2);
    if (files.length === 0) {
        console.error('Usage: node tools/typecheck.js <bundle.naiscript> [...]');
        process.exit(1);
    }
    const ok = files.map(typecheck).every(Boolean);
    process.exit(ok ? 0 : 1);
}

module.exports = { typecheck };
