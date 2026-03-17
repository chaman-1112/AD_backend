/**
 * Backward-compatible wrapper for company copy command.
 *
 * Preferred:
 *   node scripts/copyCustomizations.js company <sourceCompanyId> <targetCompanyId>
 */

import { runCopyFromCli } from './copyCustomizations.js';

runCopyFromCli('company');
