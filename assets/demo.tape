# A demo of a council in the terminal, for the README and posts. Record with VHS (https://github.com/charmbracelet/vhs):
#   vhs assets/demo.tape        -> assets/demo.gif
# It runs a real council through your own Codex and Claude CLIs (a few minutes at low effort). The GIF plays at normal
# speed: the start is shown live, the wait is skipped, and the exchanges and the answer stay on screen to read.
# The question splits the two models at first (in trials they argued for three to five exchanges).
Output assets/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1400
Set Height 860
Set Padding 24
Set Theme "GitHub Dark"
Set TypingSpeed 30ms

# Off camera: quiet npm's "npm notice run ..." lines, and start from a clean screen.
Hide
Type "export npm_config_loglevel=error && clear"
Enter
Sleep 1s
Show

Type `npx -y codex-claude-council ask "UUIDv7 or auto-increment integer primary keys for a new multi-tenant SaaS on PostgreSQL? Pick one and justify it in under 60 words." --no-workspace --codex-effort low --claude-effort low --max-rounds 8`
Sleep 600ms
Enter

# Live: the sign-in check, the two independent answers and the first exchange starting.
Sleep 12s

# Skip the waiting until the council has finished (the shell prompt is back, whatever the outcome),
# then show every exchange and the answer.
Hide
Wait@1200s /\$\s*$/
Show
Sleep 18s
