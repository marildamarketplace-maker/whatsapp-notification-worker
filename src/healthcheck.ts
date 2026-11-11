import { checkHealth } from './utils/health.js';
process.exitCode = checkHealth() ? 0 : 1;
