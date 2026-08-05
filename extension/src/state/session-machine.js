// The phase state machine. Pure data + transitions, no DOM and no chrome.* —
// which keeps it trivially testable and restorable from a snapshot.

export const PHASES = ['thinking', 'writing', 'reviewing', 'debugging'];

export class SessionMachine {
  constructor(problem, now = Date.now()) {
    this.problem = problem; // { frontend_id, dir_key, slug, title, difficulty, url }
    this.sessionId = SessionMachine.randomId();
    this.startedAt = now;
    this.endedAt = null;
    this.outcome = null; // 'accepted' | 'gave_up' | 'abandoned'
    this.segments = []; // closed { phase, start, end, source }
    this.currentPhase = 'thinking';
    this.currentSource = 'auto';
    this.currentStart = now;
    this.hasWritten = false;
    this.runCount = 0;
    this.failedRunCount = 0;
    this.submitCount = 0;
    this.pausedAt = null;
    this.typedCode = null;
    this.codeLang = null;
  }

  static randomId() {
    return Array.from(crypto.getRandomValues(new Uint8Array(4)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  get ended() {
    return this.outcome !== null;
  }

  get paused() {
    return this.pausedAt !== null;
  }

  // -- transitions ---------------------------------------------------

  pause(now = Date.now()) {
    if (this.ended || this.paused) return;
    this._closeSegment(now);
    this.pausedAt = now;
  }

  resume(now = Date.now()) {
    if (this.ended || !this.paused) return;
    this.pausedAt = null;
    this.currentStart = now;
  }

  setPhase(phase, source = 'manual', now = Date.now()) {
    if (this.ended) return;
    if (this.paused) {
      // Picking a phase while paused resumes straight into it; the segment
      // up to the pause is already closed.
      this.pausedAt = null;
      this.currentPhase = phase;
      this.currentSource = source;
      this.currentStart = now;
      return;
    }
    if (phase === this.currentPhase) return;
    this._closeSegment(now);
    this.currentPhase = phase;
    this.currentSource = source;
    this.currentStart = now;
  }

  editorInput(now = Date.now()) {
    this.resume(now); // typing means you're back
    if (!this.hasWritten && this.currentPhase === 'thinking') {
      this.setPhase('writing', 'auto', now);
    }
    this.hasWritten = true;
  }

  runStarted(now = Date.now()) {
    if (this.ended) return;
    this.resume(now);
    this.runCount += 1;
  }

  runResult(passed, now = Date.now()) {
    if (this.ended) return;
    this.resume(now);
    if (!passed) {
      this.failedRunCount += 1;
      this.setPhase('debugging', 'auto', now);
    } else if (this.currentPhase === 'debugging') {
      this.setPhase('reviewing', 'auto', now);
    }
  }

  /** Latest editor contents, captured from a run/submit request body. */
  captureCode(code, lang) {
    if (typeof code !== 'string' || !code.trim()) return;
    this.typedCode = code;
    if (lang) this.codeLang = lang;
  }

  submitStarted(now = Date.now()) {
    if (this.ended) return;
    this.resume(now);
    this.submitCount += 1;
  }

  submitResult(accepted, now = Date.now()) {
    if (this.ended) return;
    this.resume(now);
    if (accepted) {
      this.end('accepted', now);
    } else {
      this.setPhase('debugging', 'auto', now);
    }
  }

  end(outcome, now = Date.now()) {
    if (this.ended) return;
    this._closeSegment(now);
    this.pausedAt = null;
    this.outcome = outcome;
    this.endedAt = now;
  }

  _closeSegment(now) {
    if (this.paused) return; // segment was already closed at pause time
    if (now > this.currentStart) {
      this.segments.push({
        phase: this.currentPhase,
        start: this.currentStart,
        end: now,
        source: this.currentSource,
      });
    }
  }

  // -- derived -------------------------------------------------------

  phaseTotalsSec(now = Date.now()) {
    const totals = { thinking: 0, writing: 0, reviewing: 0, debugging: 0 };
    for (const seg of this.segments) {
      totals[seg.phase] += (seg.end - seg.start) / 1000;
    }
    if (!this.ended && !this.paused) {
      totals[this.currentPhase] += (now - this.currentStart) / 1000;
    }
    for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k]);
    return totals;
  }

  elapsedSec(now = Date.now()) {
    const totals = this.phaseTotalsSec(now);
    return PHASES.reduce((sum, p) => sum + totals[p], 0);
  }

  /** Final session record matching data/schema/session.schema.json. */
  toRecord({ logicIdea, tags, comments, phaseTotalsOverride, extensionVersion }) {
    const iso = (ms) => new Date(ms).toISOString();
    const totals = phaseTotalsOverride ?? this.phaseTotalsSec(this.endedAt);
    return {
      schema_version: 1,
      session_id: this.sessionId,
      problem: this.problem,
      language: this.language ?? 'unknown',
      started_at: iso(this.startedAt),
      ended_at: iso(this.endedAt),
      outcome: this.outcome,
      phases: this.segments.map((s) => ({
        phase: s.phase,
        start: iso(s.start),
        end: iso(s.end),
        source: s.source,
      })),
      phase_totals_sec: totals,
      total_active_sec: PHASES.reduce((sum, p) => sum + totals[p], 0),
      run_count: this.runCount,
      failed_run_count: this.failedRunCount,
      submit_count: this.submitCount,
      logic_idea: logicIdea ?? '',
      tags: tags ?? [],
      comments: comments ?? '',
      client: { extension_version: extensionVersion },
    };
  }

  // -- persistence -----------------------------------------------------

  snapshot(now = Date.now()) {
    return {
      problem: this.problem,
      sessionId: this.sessionId,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      outcome: this.outcome,
      segments: this.segments,
      currentPhase: this.currentPhase,
      currentSource: this.currentSource,
      currentStart: this.currentStart,
      hasWritten: this.hasWritten,
      runCount: this.runCount,
      failedRunCount: this.failedRunCount,
      submitCount: this.submitCount,
      language: this.language,
      typedCode: this.typedCode,
      codeLang: this.codeLang,
      pausedAt: this.pausedAt,
      heartbeat: now,
    };
  }

  static fromSnapshot(snap, now = Date.now()) {
    const m = new SessionMachine(snap.problem, snap.startedAt);
    Object.assign(m, {
      sessionId: snap.sessionId,
      endedAt: snap.endedAt,
      outcome: snap.outcome,
      segments: snap.segments,
      currentPhase: snap.currentPhase,
      currentSource: snap.currentSource,
      hasWritten: snap.hasWritten,
      runCount: snap.runCount,
      failedRunCount: snap.failedRunCount,
      submitCount: snap.submitCount,
      language: snap.language,
      typedCode: snap.typedCode ?? null,
      codeLang: snap.codeLang ?? null,
    });
    if (snap.outcome) {
      // Ended sessions restore verbatim; every segment is already closed.
      m.currentStart = snap.currentStart;
      return m;
    }
    if (snap.pausedAt) {
      // Paused sessions restore paused; segments closed at pause time.
      m.pausedAt = snap.pausedAt;
      m.currentStart = snap.currentStart;
      return m;
    }
    // The gap between the last heartbeat and now is dead time: don't bill it
    // to any phase. Restart the open segment at resume time.
    m.currentStart = now;
    if (snap.heartbeat > snap.currentStart) {
      m.segments = [
        ...snap.segments,
        {
          phase: snap.currentPhase,
          start: snap.currentStart,
          end: snap.heartbeat,
          source: snap.currentSource,
        },
      ];
    }
    return m;
  }
}
