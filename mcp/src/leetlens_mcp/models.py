"""Return types of the MCP tools, with per-field descriptions.

Annotating a tool with one of these makes the server advertise (and validate)
a structured output schema, so a client knows the fields before its first
call. The shapes mirror what stats.py and documents.py produce; a model here
documents that output, it does not transform it.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Difficulty = Literal["Easy", "Medium", "Hard"]
Outcome = Literal["accepted", "gave_up", "abandoned"]
Phase = Literal["thinking", "writing", "reviewing", "debugging"]


class PhaseSeconds(BaseModel):
    thinking: int = Field(description="Seconds spent sketching the approach before coding")
    writing: int = Field(description="Seconds spent typing the solution")
    reviewing: int = Field(description="Seconds re-reading code before running or submitting")
    debugging: int = Field(description="Seconds after a failed run, before the next run")


class Problem(BaseModel):
    frontend_id: str = Field(description="LeetCode's displayed problem number, e.g. '1'")
    dir_key: str = Field(description="Zero-padded number + slug, e.g. '0001-two-sum'; the id used across all tools")
    slug: str = Field(description="URL slug, e.g. 'two-sum'")
    title: str
    difficulty: Difficulty
    url: str = Field(description="Canonical problem URL on leetcode.com")
    topics: list[str] = Field(default=[], description="LeetCode's own topic tags, recorded automatically for every problem")


class PhaseSegment(BaseModel):
    phase: Phase
    start: str = Field(description="ISO 8601 UTC")
    end: str = Field(description="ISO 8601 UTC")
    source: Literal["auto", "manual"] = Field(description="auto = detected from editor/run activity; manual = user set the phase")


class _SessionCore(BaseModel):
    session_id: str
    started_at: str = Field(description="ISO 8601 UTC")
    outcome: Outcome = Field(description="accepted = solved; gave_up = explicit give-up; abandoned = left open and flushed later")
    attempt_number: int = Field(description="1 for the first session on this problem, 2 for the next, and so on")
    total_active_sec: int = Field(description="Sum of the four phase totals; pauses excluded")
    phase_totals_sec: PhaseSeconds
    run_count: int = Field(description="Times the code was run against the examples")
    failed_run_count: int = Field(description="Runs that did not pass")
    submit_count: int
    tags: list[str] = Field(description="User-created kebab-case tags")


class SessionSummary(_SessionCore):
    """One row per session with the problem flattened in; what list_sessions returns."""

    dir_key: str = Field(description="Problem id; pass to get_problem_details or fetch")
    title: str
    difficulty: Difficulty
    date: str = Field(description="YYYY-MM-DD of started_at")
    topics: list[str] = Field(default=[], description="The problem's LeetCode topics")


class SessionRecord(_SessionCore):
    """A full session as committed to the data repo, plus attempt_number."""

    model_config = ConfigDict(extra="allow")

    schema_version: int
    problem: Problem
    language: str | None = Field(default=None, description="LeetCode language slug, e.g. python3")
    ended_at: str
    phases: list[PhaseSegment] = Field(description="Ordered, non-overlapping segments; gaps allowed")
    logic_idea: str | None = Field(default=None, description="The user's approach in their own words")
    comments: str | None = Field(default=None, description="Free-form notes from the save form")


class ProblemDetails(BaseModel):
    problem: Problem
    sessions: list[SessionRecord] = Field(description="Every attempt, oldest first")
    solution_source: str | None = Field(description="Committed solution file, or null if none was captured")


class GroupStats(BaseModel):
    session_count: int
    problem_count: int = Field(description="Distinct problems in the group")
    accepted: int
    gave_up: int
    give_up_rate: float = Field(description="gave_up / session_count, 0..1")
    avg_total_sec: int
    median_total_sec: int
    avg_phase_sec: PhaseSeconds = Field(description="Mean seconds per phase across the group's sessions")
    avg_run_count: float
    avg_failed_run_count: float
    last_seen: str = Field(description="YYYY-MM-DD of the group's most recent session")


class TrendPoint(BaseModel):
    period: str = Field(description="ISO week ('2026-W35') or month ('2026-08')")
    value: float = Field(description="The requested metric for that period: seconds, a 0..1 share or rate, or a mean run count")
    sessions: int = Field(description="Sessions in the period; small counts make the value noisy")


class WeakArea(BaseModel):
    label: str = Field(description="The tag or topic being ranked")
    kind: Literal["tag", "topic"] = Field(description="Which vocabulary `label` comes from")
    score: float = Field(description="0.4*give_up_rate + 0.3*slowness + 0.2*debugging_share + 0.1*run_factor; higher is weaker")
    give_up_rate: float
    avg_total_sec: int
    global_median_sec: int = Field(description="Median session length over all sessions, the baseline for slowness")
    debugging_share: float = Field(description="Share of the tag's average session spent debugging, 0..1")
    avg_run_count: float
    session_count: int
    problem_count: int
    last_seen: str


class TagUsage(BaseModel):
    label: str
    kind: Literal["tag", "topic"]
    session_count: int
    problem_count: int
    last_seen: str = Field(description="YYYY-MM-DD")


class RevengeProblem(BaseModel):
    dir_key: str
    slug: str
    title: str
    difficulty: Difficulty
    url: str
    attempts: int
    gave_up_count: int
    last_tried: str = Field(description="YYYY-MM-DD of the most recent session, whatever its outcome")
    tags: list[str]
    topics: list[str] = []


class StaleTag(BaseModel):
    label: str
    kind: Literal["tag", "topic"]
    last_seen: str = Field(description="YYYY-MM-DD")
    days_since: int
    session_count: int
    give_up_rate: float


class Recommendation(BaseModel):
    type: Literal["revenge", "weak_tag", "weak_topic", "stale_tag", "stale_topic"] = Field(
        description="Which signal produced the suggestion"
    )
    action: str = Field(description="Imperative one-liner, e.g. 'Re-attempt Coin Change (Medium)'")
    target: str = Field(description="Problem URL for revenge, otherwise the tag name")
    reason: str = Field(description="The numbers behind the suggestion, ready to quote")


class NoteHit(SessionSummary):
    matched: dict[str, str] = Field(description="The field(s) that matched ('logic_idea', 'comments') with their full text")


class PeriodStats(BaseModel):
    spec: str = Field(description="The period as requested, e.g. 'this_month' or '2026-08'")
    date_from: str = Field(description="First day, YYYY-MM-DD, inclusive")
    date_to: str = Field(description="Last day, YYYY-MM-DD, inclusive")
    session_count: int
    problem_count: int | None = None
    accepted: int | None = None
    gave_up: int | None = None
    give_up_rate: float | None = None
    avg_total_sec: int | None = None
    median_total_sec: int | None = None
    avg_phase_sec: PhaseSeconds | None = None
    avg_run_count: float | None = None
    avg_failed_run_count: float | None = None
    last_seen: str | None = None
    debugging_share: float | None = Field(default=None, description="Mean per-session debugging share, 0..1; absent when the period has no sessions")


class PeriodComparison(BaseModel):
    period_a: PeriodStats
    period_b: PeriodStats
    delta_a_minus_b: dict[str, float] = Field(description="period_a minus period_b for each metric both periods report")


class SearchHit(BaseModel):
    id: str = Field(description="Pass to fetch: a problem dir_key, or 'tag:<tag>'")
    title: str
    url: str


class SearchResults(BaseModel):
    results: list[SearchHit] = Field(description="Best match first")


class Document(BaseModel):
    id: str
    title: str
    text: str = Field(description="Markdown: every attempt with phases, runs, and notes, then the solution; or a tag's stats and sessions")
    url: str
    metadata: dict[str, Any] = Field(description="Structured counterpart of the headline numbers in text")
