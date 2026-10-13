# Benchmark: one model or the council?

Programs with traps, and one question: *what exactly does this program print?* Each question goes to **Codex alone**, **Claude alone** and **the council**, and every answer is graded against what the program really prints.

| Set | Questions | What's in it |
|---|---|---|
| **hard** (default) | 24, in [`hard.mjs`](hard.mjs) | longer programs where several traps interact: the event loop across nested promises and timers, class fields overriding the parent constructor, `yield from` return values, `raise … from None`, mutation while iterating, `NULL` in joins and `GROUP BY`. The output is right only if every trap is. |
| **classic** | 24, in [`questions.mjs`](questions.mjs) | one well-known trap each: `sort()`, `parseInt`, mutable defaults, late binding, banker's rounding, `NOT IN` with `NULL`. Today's models mostly get these right on their own. |

```bash
node bench/run.mjs --verify --set all            # check both answer keys by running every program (no models)
node bench/run.mjs --effort low                  # the hard set; the result table is printed and saved in results/
node bench/run.mjs --set classic --effort high
node bench/run.mjs --only h-js-loop-mix,h-sql-group-null
```

- **Fair:** every call starts fresh sessions, so no member remembers another call. It runs in an empty folder, so no member can read the answer key, and without web search. The models are asked not to run the code.
- **Honest key:** the expected answers were not written by hand. `--verify` runs each program with Node.js and Python and fails if the key is wrong.
- **Your plans:** it runs your own Codex and Claude Code CLIs. A council is several calls per question, so a full run takes a while (about an hour for 24 questions at low effort) and uses a fair share of both plans. Start with `--only`.

## Results

| Run | Models (effort) | Codex alone | Claude alone | Council |
|---|---|---|---|---|
| [hard set, 2026-10-13](results/2026-10-13-03-15-hard-low.json) | Codex `gpt-6.1-sol`, Claude Sonnet 5.5 (low) | 24 / 24 | 23 / 24 | **24 / 24** |

The council was right on the one question a model alone got wrong (`h-py-dunder`, Claude), and wrong on none that a model alone got right. Median time per question: Codex 18 s, Claude 11 s, council 59 s.

A run counts only if every call completed: when a plan's usage limit is reached, the CLI fails at once and that answer is graded wrong, so such runs are not published.

To add a question, put a program, its language and what it prints into a set, then run `--verify`.
