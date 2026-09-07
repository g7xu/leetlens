// Where everything lands in a data repo. These paths are a contract, not an
// implementation detail: the indexer globs data/sessions/*/*.json, the MCP
// server reads solutions back, and LeetHub-compatible tooling expects the
// canonical <dir_key>/<dir_key>.<ext> layout.

import { LANG_EXT } from './languages.js';

/** Filesystem-safe form of a session's start time; also its sort key. */
function stamp(record) {
  return record.started_at.replace(/[:]/g, '-').replace(/\.\d+/, '');
}

export function sessionPath(record) {
  return `data/sessions/${record.problem.dir_key}/${stamp(record)}_${record.session_id}.json`;
}

/** The newest solution for a problem; overwritten on every attempt. */
export function codePath(record, lang) {
  const dir = record.problem.dir_key;
  return `${dir}/${dir}.${LANG_EXT[lang] ?? 'txt'}`;
}

/** This attempt's own copy, so the overwrite above loses nothing. */
export function attemptPath(record, lang) {
  const dir = record.problem.dir_key;
  return `${dir}/attempts/${stamp(record)}_${record.session_id}.${LANG_EXT[lang] ?? 'txt'}`;
}
