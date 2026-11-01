// Keeps the header parser the same in UCCDS and in the Editorial scripts' shared folder
// (NAI_Dev/Editorial/shared/chapter-headers.ts, used by Chapter Linter, Markdown Manager, ChatGLM).
// UCCDS is the source of truth: src/chapter-headers.ts is pushed OUT to Editorial. Only each
// file's leading // comment block differs, and each side keeps its own.
// Usage: node scripts/sync-shared.js          copy the UCCDS parser into Editorial/shared
//        node scripts/sync-shared.js --check  report drift, change nothing (exit 1 on drift)
// Outside the author's dev folder (e.g. a GitHub clone) there is nothing to sync; it says so and exits 0.
// After pushing, rebuild and test the Editorial scripts (`npm run check` in the Editorial folder).
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'chapter-headers.ts');
const TARGET = process.env.UCCDS_SHARED_PARSER || path.resolve(ROOT, '..', '..', 'Editorial', 'shared', 'chapter-headers.ts');

function split(text) {
    const lines = text.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
    let i = 0;
    while (i < lines.length && lines[i].startsWith('//')) i++;
    return { comment: lines.slice(0, i).join('\n'), body: lines.slice(i).join('\n').replace(/^\n+/, '') };
}

function sync(checkOnly) {
    if (!fs.existsSync(TARGET)) {
        console.log(`sync: no Editorial parser at ${TARGET}; nothing to sync.`);
        return true;
    }
    const want = split(fs.readFileSync(SOURCE, 'utf-8')).body;
    const target = split(fs.readFileSync(TARGET, 'utf-8'));
    if (want === target.body) {
        console.log('sync: Editorial/shared/chapter-headers.ts matches the UCCDS parser.');
        return true;
    }
    if (checkOnly) {
        console.warn('sync: Editorial/shared/chapter-headers.ts differs from the UCCDS parser. Run `npm run sync` to push UCCDS\'s parser to the Editorial scripts.');
        return false;
    }
    const comment = target.comment.replace(/^\/\/ Source of truth: [^\n]*$/m,
        '// Source of truth: Community Stuff/uccds/src/chapter-headers.ts (`npm run sync` there). Bundled into each script at build time,');
    fs.writeFileSync(TARGET, `${comment ? comment + '\n\n' : ''}${want}`);
    console.log('sync: pushed the UCCDS parser to Editorial/shared/chapter-headers.ts. Rebuild and test the Editorial scripts next.');
    return true;
}

if (require.main === module) {
    const ok = sync(process.argv.includes('--check'));
    if (!ok) process.exitCode = 1;
}

module.exports = { sync };
