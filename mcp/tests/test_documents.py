from leetlens_mcp import documents


def ids(results):
    return [r["id"] for r in results]


def test_search_requires_every_term(records):
    assert ids(documents.search_documents(records, "coin greedy")) == ["0322-coin-change"]
    assert documents.search_documents(records, "coin islands") == []
    assert documents.search_documents(records, "   ") == []


def test_search_title_outranks_notes(records):
    # "two" is in Two Sum's title and only in a note ("two pointers") for 0003.
    assert ids(documents.search_documents(records, "two"))[:2] == [
        "0001-two-sum",
        "0003-longest-substring-without-repeating-characters",
    ]


def test_search_ties_go_to_most_recent(records):
    # Both carry the hash-map tag; 0003 was attempted later.
    hits = ids(documents.search_documents(records, "hash-map"))
    assert hits[:2] == ["0003-longest-substring-without-repeating-characters", "0001-two-sum"]
    assert hits[-1] == "tag:hash-map"


def test_search_finds_a_problem_by_its_leetcode_topic(records):
    # No session carries "depth-first-search" as a user tag; LeetCode does.
    assert ids(documents.search_documents(records, "depth-first-search")) == ["0200-number-of-islands"]


def test_search_matches_notes_and_tags(records):
    hits = documents.search_documents(records, "window")
    assert ids(hits) == ["0003-longest-substring-without-repeating-characters", "tag:sliding-window"]
    assert hits[0]["title"] == "3. Longest Substring Without Repeating Characters (Medium)"
    assert hits[0]["url"].startswith("https://leetcode.com/problems/")
    assert hits[1]["title"].startswith("Tag: sliding-window (2 sessions, 1 problems)")


def test_search_result_shape(records):
    for hit in documents.search_documents(records, "dp"):
        assert set(hit) == {"id", "title", "url"}


def test_problem_document(records):
    coin = [r for r in records if r["problem"]["dir_key"] == "0322-coin-change"]
    doc = documents.problem_document(coin, "def coinChange(): ...\n")
    assert set(doc) == {"id", "title", "text", "url", "metadata"}
    assert doc["id"] == "0322-coin-change"
    text = doc["text"]
    assert text.startswith("# 322. Coin Change (Medium)")
    assert "## Attempt 1 — 2026-08-15, gave_up, 25m00s active" in text
    assert "## Attempt 2 — 2026-08-20, gave_up, 30m00s active" in text
    assert "(debugging 67%)" in text  # attempt 2: 1200 of 1800 seconds
    assert "Logic idea: greedy by largest coin fails" in text
    assert "Comments: dp table right but forgot the -1" in text
    assert text.endswith("## Solution (python3)\n```python3\ndef coinChange(): ...\n```")
    assert doc["metadata"] == {
        "dir_key": "0322-coin-change",
        "difficulty": "Medium",
        "attempts": 2,
        "accepted": 0,
        "gave_up": 2,
        "solved": False,
        "tags": ["dp"],
        "topics": ["array", "dynamic-programming", "breadth-first-search"],
        "last_session_at": "2026-08-20T10:00:00Z",
        "has_solution": True,
        "attempts_with_code": [],
    }
    assert "LeetCode topics: array, dynamic-programming" in text


def test_problem_document_shows_each_attempt_s_own_code(records):
    coin = [r for r in records if r["problem"]["dir_key"] == "0322-coin-change"]
    sources = {coin[0]["session_id"]: "greedy = True", coin[1]["session_id"]: "dp = [0] * n"}
    doc = documents.problem_document(coin, "newest", sources)
    text = doc["text"]
    # Each attempt's code sits under that attempt, in order, so the two can be compared.
    assert text.index("greedy = True") < text.index("dp = [0] * n")
    assert text.index("Attempt 1") < text.index("greedy = True") < text.index("Attempt 2")
    # The canonical copy is redundant once every attempt is shown.
    assert "newest" not in text
    assert doc["metadata"]["attempts_with_code"] == sorted(sources)


def test_problem_document_without_solution(records):
    two_sum = [r for r in records if r["problem"]["dir_key"] == "0001-two-sum"]
    doc = documents.problem_document(two_sum, None)
    assert "## Solution" not in doc["text"]
    assert doc["metadata"]["has_solution"] is False


def test_tag_document(records):
    doc = documents.tag_document(records, "dp")
    assert doc["id"] == "tag:dp"
    assert doc["text"].startswith("# Tag: dp\nSessions: 2 over 1 problems · give-up rate 100%")
    # Newest session first.
    assert doc["text"].index("attempt 2") < doc["text"].index("attempt 1")
    assert doc["metadata"]["session_count"] == 2
    assert documents.tag_document(records, "nope") is None
