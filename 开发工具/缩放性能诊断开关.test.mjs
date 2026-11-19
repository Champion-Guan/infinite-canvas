import test from 'node:test';
import assert from 'node:assert/strict';
import { isLocalCanvasDiagnosticHost } from '../扩展功能/画布交互/缩放性能记录.ts';

test('performance probe only installs on loopback workbench origins', () => {
  assert.equal(isLocalCanvasDiagnosticHost('localhost'), true);
  assert.equal(isLocalCanvasDiagnosticHost('127.0.0.1'), true);
  assert.equal(isLocalCanvasDiagnosticHost('workbench.example'), false);
});
