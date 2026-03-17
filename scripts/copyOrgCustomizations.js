/**
 * Backward-compatible wrapper for org copy command.
 *
 * Preferred:
 *   node scripts/copyCustomizations.js org <sourceOrgId> <targetOrgId>
 */

import { runCopyFromCli } from './copyCustomizations.js';

runCopyFromCli('org');
