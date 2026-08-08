# Architecture

One page on how LeetLens is put together and why. Setup lives in the [README](README.md); contributor workflow in [CONTRIBUTING.md](CONTRIBUTING.md).

## The two-repo model

This repo is **the tool only**. Every user's data — session JSON, solution files, the generated index — lives in a repo *they* own (new, or an existing LeetHub repo; the layouts are compatible).

The extension's **Set up repo** button turns any repo into a data repo by committing two things (source of truth: `extension/src/lib/repo-setup.js`):

- `.github/workflows/publish.yml` — on each push, checks out this tool repo at `.leetlens/`, rebuilds `data/index.json` with the indexer, commits it, and deploys the dashboard + index to GitHub Pages.
- `data/sessions/.gitkeep` — the folder session records land in.

Data repos pin the toolchain with `LEETLENS_REF: v1`, a **moving major tag**:

- Compatible change (indexer, dashboard, MCP): move `v1` forward — every data repo picks it up on its next push, no action needed.
- Breaking change (session schema, index shape, dashboard data contract): cut `v2` and leave `v1` alone — users upgrade by editing one line when ready.

**Sharp edge:** the workflow file is *copied* into each data repo at setup time, so moving the tag ships fixes to the toolchain under `.leetlens/` but **not** to the workflow itself. A workflow bug means every existing data repo must re-run Set up repo. Keep the workflow thin; put logic where the tag can carry it.

## Extension layout

The split below is not a style choice — **Chrome's extension worlds force it**. A MAIN-world script can touch the page's JavaScript (Monaco, `fetch`) but no `chrome.*` APIs and no ES imports; an isolated-world content script is the reverse; only the service worker outlives the tab.

| File | World | Role |
|---|---|---|
| `src/inject/main-world.js` | MAIN (page) | Eyes and hands inside LeetCode: intercepts run/submit network traffic, injects the thinking area into Monaco, answers editor-read requests |
| `src/content/content.js` | isolated | Controller: session lifecycle, bridges MAIN-world events, persistence, hands finished sessions to the service worker |
| `src/state/session-machine.js` | isolated | Model: phase state machine, pure data — no DOM, no `chrome.*`, snapshot/restorable |
| `src/content/panel.js` + `panel.css.js` | isolated | View: closed-shadow-DOM panel — live timer and the save form |
| `src/lib/leetcode-endpoints.js` | isolated | Every LeetCode selector/API shape the isolated world depends on, plus `extractThinkingArea` |
| `src/lib/github.js`, `src/lib/repo-setup.js` | worker | GitHub Contents API client; one-click data-repo setup |
| `src/background/service-worker.js` | worker | Commits sessions + solutions; queues and retries failures across restarts |

## Message flows

Two `postMessage` source tags keep the channel loop-free: the MAIN world emits events tagged `leetlens`, and listens only for requests tagged `leetlens-req`.

```mermaid
sequenceDiagram
    participant LC as LeetCode page
    participant MW as main-world.js
    participant CS as content.js
    participant SW as service-worker.js
    participant GH as GitHub

    Note over MW: run/submit interception
    LC->>MW: fetch /interpret_solution/ or /submit/
    MW->>CS: RUN_STARTED / SUBMIT_STARTED {code, lang}
    MW->>CS: RUN_RESULT / SUBMIT_RESULT {passed}

    Note over CS: user clicks Finish / Give up
    CS->>MW: GET_EDITOR_CODE {id}  (leetlens-req)
    MW->>CS: EDITOR_CODE {id, code, cursorInNotes}
    CS->>CS: extractThinkingArea → notes + clean code
    CS->>SW: COMMIT_SESSION {record, code}
    SW->>GH: PUT session JSON, then solution file
```

The Finish-time read times out after 250 ms and falls back to the last run/submit capture, so finishing never hangs on a missing injector. The reply also reports whether the caret is inside the thinking block — typing there stays in the *thinking* phase instead of flipping the timer to *writing*.

## The thinking-area contract

The block injected at the top of the editor **must be a block comment** (`r"""…"""`, `/* … */`, `=begin/=end`, `#|…|#`): Monaco does not re-insert a line-comment token on Enter, so a `#`-prefixed region turns into live code on the second line of notes. Languages with no block-comment form (Erlang, Elixir, Bash) get no block.

Two invariants, both pinned by `test/thinking-area.test.mjs`:

- `THINK_HEADER_RE` exists **twice** — in `main-world.js` (can't import) and `leetcode-endpoints.js`. They must recognise the same openers, or a cloud-save-restored block goes undetected and a duplicate is prepended on every reload.
- The pattern must **never** match `/**` — LeetCode's own `/** Definition for ListNode … */` template docblock would otherwise be stripped from committed solutions.

## Data flow

```
extension ──commit──▶ data repo ──workflow──▶ data/index.json ──▶ Pages dashboard
   (session JSON + solution)         │
                                     └──▶ MCP server (local clone or GitHub fetch)
```

- `data/index.json` is **generated, never authored**. When a concurrent run wins the push race, the workflow re-runs the indexer on top of what landed (`fetch` + `reset --hard`) — never `git pull --rebase`, which conflicts with itself on a generated file.
- The extension pushes **two commits per save** (session, then solution), so data-repo CI must tolerate `main` moving mid-run.
- `data/schema/session.schema.json` is the contract every component builds against, with `additionalProperties: false` throughout — new fields require a schema change, which is a **breaking** change per the tag policy above.
