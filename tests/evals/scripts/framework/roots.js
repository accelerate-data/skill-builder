const path = require('node:path');

const EVAL_ROOT = path.resolve(__dirname, '..', '..');
const REPO_ROOT = path.resolve(EVAL_ROOT, '..', '..');

module.exports = { EVAL_ROOT, REPO_ROOT };
