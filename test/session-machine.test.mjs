// The machine produces every number the dashboard reports. Time is injected
// everywhere, so these run with a fake clock and no timers.

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { PHASES, SessionMachine } from '../extension/src/state/session-machine.js';

const PROBLEM = {
  frontend_id: '1', dir_key: '0001-two-sum', slug: 'two-sum', title: 'Two Sum',
  difficulty: 'Easy', url: 'https://leetcode.com/problems/two-sum/',
};
const T0 = 1_000_000;
const sec = (n) => T0 + n * 1000;

test('a fresh session is thinking, unpaused, and has an 8-hex id', () => {
  const m = new SessionMachine(PROBLEM, T0);
  assert.equal(m.currentPhase, 'thinking');
  assert.equal(m.paused, false);
  assert.equal(m.ended, false);
  assert.match(m.sessionId, /^[a-f0-9]{8}$/);
  assert.deepEqual(m.phaseTotalsSec(sec(10)), { thinking: 10, writing: 0, reviewing: 0, debugging: 0 });
});

test('the first keystroke flips thinking to writing, once', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.editorInput(sec(30));
  assert.equal(m.currentPhase, 'writing');
  assert.deepEqual(m.segments, [{ phase: 'thinking', start: T0, end: sec(30), source: 'auto' }]);
  m.setPhase('thinking', 'manual', sec(40));
  m.editorInput(sec(50)); // hasWritten: no second automatic flip
  assert.equal(m.currentPhase, 'thinking');
});

test('a failed run enters debugging; a passing run afterwards moves to reviewing', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.editorInput(sec(10));
  m.runStarted(sec(60));
  m.runResult(false, sec(65));
  assert.equal(m.currentPhase, 'debugging');
  assert.equal(m.failedRunCount, 1);
  m.runStarted(sec(120));
  m.runResult(true, sec(125));
  assert.equal(m.currentPhase, 'reviewing');
  assert.equal(m.runCount, 2);
  assert.deepEqual(m.phaseTotalsSec(sec(125)), { thinking: 10, writing: 55, reviewing: 0, debugging: 60 });
});

test('pause stops the clock and resume restarts the open segment', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.pause(sec(20));
  assert.equal(m.paused, true);
  assert.equal(m.elapsedSec(sec(500)), 20);
  m.resume(sec(500));
  assert.equal(m.elapsedSec(sec(510)), 30);
  // Picking a phase while paused resumes straight into it.
  m.pause(sec(520));
  m.setPhase('reviewing', 'manual', sec(600));
  assert.equal(m.paused, false);
  assert.equal(m.currentPhase, 'reviewing');
  assert.equal(m.elapsedSec(sec(610)), 50);
});

test('an accepted submit ends the session; nothing changes after that', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.editorInput(sec(10));
  m.submitStarted(sec(90));
  m.submitResult(true, sec(95));
  assert.equal(m.ended, true);
  assert.equal(m.outcome, 'accepted');
  assert.equal(m.endedAt, sec(95));
  m.editorInput(sec(100));
  m.runStarted(sec(100));
  assert.equal(m.runCount, 0);
  assert.equal(m.elapsedSec(sec(1000)), 95);
});

test('toRecord matches the session schema shape', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.editorInput(sec(10));
  m.captureCode('print(1)', 'python3');
  m.runStarted(sec(50));
  m.runResult(false, sec(55));
  m.end('gave_up', sec(100));
  m.language = 'python3';
  const rec = m.toRecord({ logicIdea: 'hash map', tags: ['hash-map'], comments: 'meh', extensionVersion: '9.9.9' });
  assert.deepEqual(Object.keys(rec), [
    'schema_version', 'session_id', 'problem', 'language', 'started_at', 'ended_at', 'outcome',
    'phases', 'phase_totals_sec', 'total_active_sec', 'run_count', 'failed_run_count',
    'submit_count', 'logic_idea', 'tags', 'comments', 'client',
  ]);
  assert.equal(rec.started_at, new Date(T0).toISOString());
  assert.equal(rec.outcome, 'gave_up');
  assert.deepEqual(rec.phases.map((p) => p.phase), ['thinking', 'writing', 'debugging']);
  assert.deepEqual(rec.phase_totals_sec, { thinking: 10, writing: 45, reviewing: 0, debugging: 45 });
  assert.equal(rec.total_active_sec, 100);
  assert.deepEqual(rec.client, { extension_version: '9.9.9' });
  const override = m.toRecord({ phaseTotalsOverride: { thinking: 1, writing: 2, reviewing: 3, debugging: 4 } });
  assert.equal(override.total_active_sec, 10);
  assert.deepEqual(override.tags, []);
});

test('snapshot round-trips, and the gap since the last heartbeat is not billed', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.editorInput(sec(10));
  m.captureCode('x', 'cpp');
  m.notes = 'sketch';
  const snap = m.snapshot(sec(40)); // heartbeat at 40s while writing since 10s
  const back = SessionMachine.fromSnapshot(snap, sec(900));
  assert.equal(back.sessionId, m.sessionId);
  assert.equal(back.currentPhase, 'writing');
  assert.equal(back.notes, 'sketch');
  assert.equal(back.codeLang, 'cpp');
  // 10s thinking + 30s writing up to the heartbeat; the 860s away are dropped.
  assert.deepEqual(back.phaseTotalsSec(sec(905)), { thinking: 10, writing: 35, reviewing: 0, debugging: 0 });
});

test('paused and ended sessions restore verbatim', () => {
  const m = new SessionMachine(PROBLEM, T0);
  m.pause(sec(20));
  const paused = SessionMachine.fromSnapshot(m.snapshot(sec(30)), sec(999));
  assert.equal(paused.paused, true);
  assert.equal(paused.elapsedSec(sec(999)), 20);

  m.resume(sec(30));
  m.end('accepted', sec(50));
  const ended = SessionMachine.fromSnapshot(m.snapshot(sec(60)), sec(999));
  assert.equal(ended.ended, true);
  assert.equal(ended.elapsedSec(sec(999)), 40);
});

test('PHASES is the schema order', () => {
  assert.deepEqual(PHASES, ['thinking', 'writing', 'reviewing', 'debugging']);
});
