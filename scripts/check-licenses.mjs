#!/usr/bin/env node
/**
 * CI license gate: fails when any production dependency carries a license
 * outside the permissive allowlist (see docs/license-compliance-review-2026-07-14.md).
 * A future `pnpm add` of a GPL/AGPL/unknown-licensed package breaks the build
 * here instead of surfacing during store certification.
 *
 * Usage: node scripts/check-licenses.mjs
 */
import { collectPackages, ALLOWED_LICENSES } from './generate-third-party-notices.mjs';

const packages = collectPackages();
const violations = packages.filter((p) => !ALLOWED_LICENSES.has(p.license));

if (violations.length > 0) {
  console.error('Disallowed licenses in the production dependency tree:');
  for (const p of violations) {
    console.error(`  - ${p.name}@${p.version}: ${p.license}`);
  }
  console.error(
    '\nIf a license is genuinely permissive, add it to ALLOWED_LICENSES in',
    'scripts/generate-third-party-notices.mjs; if a package misdeclares its',
    'license, verify its shipped license file and pin it in LICENSE_OVERRIDES.',
  );
  process.exit(1);
}
console.log(`License check passed: ${packages.length} production packages, all within the ${ALLOWED_LICENSES.size}-license allowlist.`);
