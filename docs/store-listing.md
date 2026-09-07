# Chrome Web Store listing

What the submission form asks for, written out so a resubmission does not mean
rewriting it. Review usually takes a few days, and rejections are almost always
about permission justifications, so those are the part worth keeping exact.

## Basics

- **Name:** LeetLens
- **Category:** Developer Tools
- **Language:** English
- **Summary** (132 characters max, matches `manifest.json`):
  > Track how you solve LeetCode: thinking vs debugging time, run counts, notes and tags, committed to your own GitHub repo.

## Description

> LeetHub saves the code you got accepted. LeetLens saves how you got there.
>
> Every problem you open gets a small panel that times your session and splits
> it into thinking, writing, reviewing and debugging. A comment block at the top
> of the editor gives you somewhere to sketch your approach before you start
> typing code — time spent there counts as thinking, and the text becomes the
> session's notes. When you finish or give up, LeetLens commits a JSON record of
> the attempt plus your solution to a GitHub repo you own.
>
> What that gets you:
>
> • A dashboard on your repo's GitHub Pages: where your time goes, which topics
>   you give up on, which problems you never came back to.
> • Every attempt kept separately, so you can see what changed between the try
>   that failed and the one that worked.
> • Analysis in Claude or ChatGPT. Your repo comes with a connector URL, so you
>   can ask "what am I actually bad at" and get an answer from your own data.
> • Nothing to run and nowhere to sign up. The data is in your repo, in plain
>   JSON, and you can delete the extension without losing any of it.
>
> Open source: https://github.com/g7xu/leetlens

## Permission justifications

The form asks for one per permission. These are the answers.

| Permission | Justification |
|---|---|
| `storage` | Stores the user's GitHub connection and the in-progress session for the problem they have open, so a page reload does not lose their timing. Nothing is stored anywhere else. |
| `https://leetcode.com/*` | The extension only works on LeetCode problem pages. It reads the problem's title and difficulty, times the session, and observes the user's own run and submit requests to count attempts. |
| `https://api.github.com/*` | Commits the session record and solution file to the repository the user nominated, and reads that repository's index to suggest tags they have used before. |
| `https://github.com/login/*` | The OAuth device flow that signs the user in. Only the two device-flow endpoints are contacted. |

**Remote code:** none. Everything is bundled into the package; no script is
fetched or evaluated at runtime.

**Single purpose:** recording and analysing the user's own LeetCode practice
sessions.

## Privacy disclosure

- **Data collected:** none by the developer. There is no analytics, no
  telemetry, and no server operated by this extension.
- **Where data goes:** only to the GitHub repository the user chooses, using
  their own credential.
- **Stored locally:** the GitHub credential and the current session, in the
  browser profile's extension storage.
- **Sold or transferred:** no. The privacy policy is the Privacy section of the
  repository README.

Say plainly on the listing that a public data repo makes sessions, solutions
and the thinking-area notes public, since that is a consequence users should
choose rather than discover.

## Screenshots (1280×800)

1. The panel on a problem page, mid-session, with the phase timer running.
2. The thinking area at the top of the editor with an approach sketched in it.
3. The save form: logic idea, tags, per-phase totals.
4. The dashboard: weak areas and the revenge list.
5. Claude answering "what am I bad at" through the connector.

## Before submitting

- [ ] `npm run zip` from a clean checkout; load the unpacked build once and save a real session with it
- [ ] `manifest.json` version bumped, and the tag pushed so the release workflow attaches the same zip
- [ ] Screenshots retaken if the panel or dashboard changed
