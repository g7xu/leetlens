import assert from 'node:assert/strict';
import { test } from 'node:test';

import { encodePath } from '../extension/src/lib/github.js';

test('Contents API paths keep their slashes and escape everything else', () => {
  assert.equal(encodePath('data/sessions/0001-two-sum/2026-08-01T10-00-00Z_ab12cd34.json'),
    'data/sessions/0001-two-sum/2026-08-01T10-00-00Z_ab12cd34.json');
  assert.equal(encodePath('.github/workflows/publish.yml'), '.github/workflows/publish.yml');
  assert.equal(encodePath('0042-c++ trick/0042-c++ trick.cpp'), '0042-c%2B%2B%20trick/0042-c%2B%2B%20trick.cpp');
});
