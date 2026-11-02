// Builds every UCCDS release file into dist/ and type-checks each one in strict mode.
//   dist/UCCDS_v<version>.naiscript        the dependency script (ScriptVault / Discord / GitHub)
//   dist/uccds-core.ts                     embeddable source: paste into a script after its header
//   dist/uccds-client.ts                   client for scripts that use the dependency
//   dist/uccds-dual.ts                     dual: embedded detector + the dependency when it's installed
//   dist/uccds-config-snippet.yaml         config options to paste into a script header
//   dist/examples/*.naiscript              one small example script for each way of using UCCDS
// Usage: node scripts/build.js
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ROOT, buildProject, bundleParts, readHeaderVersion } = require('../tools/bundle.js');
const { typecheck } = require('../tools/typecheck.js');
const { sync } = require('./sync-shared.js');

const DIST = path.join(ROOT, 'dist');
const SNIPPET = path.join(ROOT, 'src', 'config-snippet.yaml');

const PARSER = 'src/chapter-headers.ts';
const TYPES = 'src/uccds-types.ts';
const HELPERS = 'src/uccds-helpers.ts';
const CORE = 'src/uccds-core.ts';
const CLIENT = 'src/client/uccds-client.ts';
const DUAL = 'src/dual/uccds-dual.ts';
const CORE_PARTS = [PARSER, TYPES, HELPERS, CORE];
const CLIENT_PARTS = [TYPES, HELPERS, CLIENT];
// Dual = core + client (types and helpers once) + the dual layer
const DUAL_PARTS = [...CORE_PARTS, CLIENT, DUAL];

/** The config snippet without its comment lines, ready to sit under `config:` */
function configBlock() {
    return fs.readFileSync(SNIPPET, 'utf-8').replace(/\r\n/g, '\n').split('\n')
        .filter((line) => !/^\s*#/.test(line))
        .join('\n').replace(/\s+$/, '');
}

/** Copies a header to a temp file with `# @uccds-config` replaced by the config options */
function prepareHeader(relPath) {
    const text = fs.readFileSync(path.join(ROOT, relPath), 'utf-8').replace(/\r\n/g, '\n');
    const out = text.replace(/^[ \t]*# @uccds-config[ \t]*$/m, configBlock());
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'uccds-header-')), path.basename(relPath));
    fs.writeFileSync(tmp, out);
    return tmp;
}

function coreVersion() {
    const m = fs.readFileSync(path.join(ROOT, CORE), 'utf-8').match(/const UCCDS_VERSION = "([^"]+)"/);
    if (!m) throw new Error('UCCDS_VERSION not found in src/uccds-core.ts');
    return m[1];
}

function writePlain(name, banner, parts) {
    const target = path.join(DIST, name);
    fs.writeFileSync(target, `${banner}\n\n${bundleParts(parts)}`);
    console.log(`Built ${path.relative(ROOT, target)} (${fs.statSync(target).size} bytes)`);
    return target;
}

function build() {
    sync(true); // warns when Editorial/shared still has an older parser; never blocks the build
    const version = coreVersion();
    fs.mkdirSync(path.join(DIST, 'examples'), { recursive: true });

    const serviceHeader = prepareHeader('src/service/header.ts');
    if (readHeaderVersion(serviceHeader) !== version) {
        throw new Error(`Version mismatch: src/service/header.ts says ${readHeaderVersion(serviceHeader)}, UCCDS_VERSION is ${version}`);
    }

    const built = [];
    built.push(buildProject({
        name: 'UCCDS', dir: 'dist',
        parts: [serviceHeader, ...CORE_PARTS, 'src/service/service.ts', 'src/service/panel.ts', 'src/service/main.ts']
    }).target);
    built.push(buildProject({
        name: 'UCCDS Example (Embedded)', dir: 'dist/examples',
        parts: [prepareHeader('examples/embedded/header.ts'), ...CORE_PARTS, 'examples/embedded/main.ts']
    }).target);
    built.push(buildProject({
        name: 'UCCDS Example (Dependency)', dir: 'dist/examples',
        parts: ['examples/dependency/header.ts', ...CLIENT_PARTS, 'examples/dependency/main.ts']
    }).target);
    built.push(buildProject({
        name: 'UCCDS Example (Dual)', dir: 'dist/examples',
        parts: [prepareHeader('examples/dual/header.ts'), ...DUAL_PARTS, 'examples/dual/main.ts']
    }).target);

    built.push(writePlain('uccds-core.ts', [
        `// UCCDS v${version}: Universal Customizable Chapter Detection System (embedded version)`,
        '// Paste everything below into your script, after its /*--- ... ---*/ header and before your own code.',
        '// Add the options from uccds-config-snippet.yaml to your header so users can define what a chapter is.',
        '// Main calls: uccdsLoadSettings(), uccdsDetectDocument(settings), uccdsDetectChapters(sections, settings).',
        '// Free to use, share and change (MIT). By MidMeantime: https://storyscriptvault.com/users/MidMeantime'
    ].join('\n'), CORE_PARTS));
    built.push(writePlain('uccds-client.ts', [
        `// UCCDS v${version} client: use the UCCDS dependency script from your own script`,
        '// Paste everything below into your script, after its /*--- ... ---*/ header and before your own code.',
        '// Needs the "UCCDS: Universal Customizable Chapter Detection System" script installed and enabled.',
        '// Main calls: uccdsIsAvailable(), uccdsGetChapters(), uccdsGetChaptersIfChanged(prev), uccdsOnChaptersChanged(fn).',
        '// Do not paste this AND uccds-core.ts into the same script: they share type and helper names.',
        '// Want both (built in, and the UCCDS script when it is installed)? Use uccds-dual.ts instead.',
        '// Free to use, share and change (MIT). By MidMeantime: https://storyscriptvault.com/users/MidMeantime'
    ].join('\n'), CLIENT_PARTS));
    built.push(writePlain('uccds-dual.ts', [
        `// UCCDS v${version} dual: built-in chapter detection, plus the UCCDS dependency script when it's installed`,
        '// Paste everything below into your script, after its /*--- ... ---*/ header and before your own code.',
        '// Add the options from uccds-config-snippet.yaml to your header: they apply while the UCCDS script is not installed.',
        '// Main calls: uccdsDualStart({ onChange }), uccdsDualGetChapters(), uccdsDualGetChaptersIfChanged(prev), uccdsDualSource().',
        '// Contains uccds-core.ts and uccds-client.ts: paste this file INSTEAD of those, never alongside them.',
        '// Free to use, share and change (MIT). By MidMeantime: https://storyscriptvault.com/users/MidMeantime'
    ].join('\n'), DUAL_PARTS));
    fs.copyFileSync(SNIPPET, path.join(DIST, 'uccds-config-snippet.yaml'));
    console.log('Built dist/uccds-config-snippet.yaml');

    const ok = built.map(typecheck).every(Boolean);
    if (!ok) process.exitCode = 1;
    return { ok, version, built };
}

if (require.main === module) build();

module.exports = { build, CORE_PARTS, CLIENT_PARTS, DUAL_PARTS, prepareHeader };
