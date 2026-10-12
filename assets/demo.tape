# A demo of a council in the terminal, for the README and posts. Record with VHS (https://github.com/charmbracelet/vhs):
#   vhs assets/demo.tape        -> assets/demo.gif
# It runs a real council through your own Codex and Claude CLIs, so it takes a minute or two; the GIF plays faster.
Output assets/demo.gif

Set Shell "bash"
Set FontSize 18
Set Width 1400
Set Height 820
Set Padding 24
Set Theme "GitHub Dark"
Set TypingSpeed 35ms
Set PlaybackSpeed 4

Type `npx -y github:hamza-aziz-ai/codex-claude-council ask "Postgres or SQLite for a 20-user internal tool? Answer in under 60 words." --no-workspace --codex-effort low --claude-effort low`
Sleep 500ms
Enter
Wait+Screen@240s /both agree|did not fully agree/
Sleep 6s
