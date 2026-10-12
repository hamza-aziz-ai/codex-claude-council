# Benchmark: one model or the council?

24 short programs, each with a well-known trap: JavaScript's event loop, `sort()` and `parseInt`, Python's mutable defaults, late-binding closures, banker's rounding and `finally`, SQL's `NULL` logic. The question is always the same: *what exactly does this program print?*

Each question goes to **Codex alone**, **Claude alone** and **the council**, and every answer is graded against what the program really prints.

```bash
node bench/run.mjs --verify                        # check the answer key: runs every program (no models)
node bench/run.mjs --effort low                    # all 24 questions; the result table is printed and saved
node bench/run.mjs --effort high --only js-event-loop,sql-null
```

- **Fair:** every call starts fresh sessions, so no member remembers another call. It runs in an empty folder, so no member can read the answer key, and without web search. The models are asked not to run the code.
- **Honest key:** the expected answers were not written by hand; `--verify` runs each program with Node.js and Python and fails if the key is wrong.
- **Your plans:** it runs your own Codex and Claude Code CLIs. A council is several calls per question, so a full run at high effort takes a while and uses a fair share of both plans. Start with `--effort low` or `--only`.

Results are saved in [`results/`](results). Add questions to [`questions.mjs`](questions.mjs): a program, its language, and what it prints (then run `--verify`).
