// Build helper for UCCDS (same tool as Editorial/shared/tools/bundle.js, rooted at the UCCDS folder).
// Concatenates source parts in order into one .naiscript file.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** Reads `version:` from the /*--- ... ---*\/ frontmatter block of a header file */
function readHeaderVersion(headerPath) {
    const header = fs.readFileSync(headerPath, 'utf-8');
    const frontmatter = header.match(/\/\*---([\s\S]*?)---\*\//);
    const match = (frontmatter ? frontmatter[1] : header).match(/^version:\s*["']?([^\s"']+)["']?\s*$/m);
    return match ? match[1] : null;
}

/**
 * Bundles parts into one string. Each part is a path relative to the UCCDS folder.
 * BOMs are stripped: a BOM in front of the /*--- header stops NovelAI from reading it.
 */
function bundleParts(parts) {
    let bundle = '';
    for (const part of parts) {
        // resolve (not join) so absolute paths work too
        const filePath = path.resolve(ROOT, part);
        if (!fs.existsSync(filePath)) {
            throw new Error(`Missing source file: ${filePath}`);
        }
        const content = fs.readFileSync(filePath, 'utf-8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
        bundle += content.trimEnd() + '\n\n';
    }
    return bundle.trimEnd() + '\n';
}

/**
 * Builds a project. `project` = { name, dir, parts } where dir and parts are relative to the UCCDS folder.
 * Writes "<name>_v<version>.naiscript" into the project folder unless outputPath is given.
 */
function buildProject(project, outputPath) {
    const headerPart = project.parts[0];
    const version = readHeaderVersion(path.resolve(ROOT, headerPart));
    if (!version) throw new Error(`No version: field in ${headerPart}`);
    const bundle = bundleParts(project.parts);
    const target = outputPath || path.resolve(ROOT, project.dir, `${project.name}_v${version}.naiscript`);
    fs.writeFileSync(target, bundle, 'utf-8');
    console.log(`Built ${path.relative(ROOT, target)} (${Buffer.byteLength(bundle, 'utf-8')} bytes)`);
    return { target, bundle, version };
}

module.exports = { ROOT, readHeaderVersion, bundleParts, buildProject };
