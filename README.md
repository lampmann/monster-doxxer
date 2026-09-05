# monster-doxxer

Have you ever had a Redditor GM who despises metagaming, and actively obfuscates the monsters' stat blocks to prevent you from doing so? monster-doxxer takes the description of a monster - appearances, attacks, damage types, and more - and ranks the D&D 5e bestiary (both 2014 and 2024 content work) by the best matches.

**PLEASE DM YOUR FEEDBACK AND FEATURE IDEAS TO @lampmann ON DISCORD!!!**

## How to use

**Windows**
1. **Install prerequisites:** git, Python or Node.js, and a browser.
2. **Get the repo:** `git clone <repo-url>` (via Git Bash, PowerShell, or GitHub Desktop), then open the folder.
3. **Get the bestiary data**: download a 5etools-src mirror from GitHub and copy the `data/bestiary/` folder into `monster-doxxer/data/bestiary/`.
4. **Run it:**
   * From cmd.exe or PowerShell: `doxxer`.
   * From Git Bash: `./doxx`.
5. **Other commands:** `doxxer stop`, `doxxer test`, `doxxer phone` (prints the LAN address so you can open the tool on a phone on the same Wi-Fi. If Windows Firewall blocks `doxxer phone`, allow Python (or Node) on private networks when prompted).
6. **Optional - put it on PATH so `doxxer` works from any directory. In PowerShell:**
   ```powershell
   [Environment]::SetEnvironmentVariable(
     "Path", [Environment]::GetEnvironmentVariable("Path", "User") + ";C:\path\to\monster-doxxer", "User")
   ```
   Then open a new terminal - PATH is read at startup.
7. **Optional - book titles:** copy `books.json` and `adventures.json` into `monster-doxxer/data/`. Without these the Sources module still works, it just shows abbreviations instead of full titles, and loses the Books/Adventures/Other split.
8. **Optional - artwork:** `python3 build/fetch_images.py --tokens` for just the small per-monster tokens (a few MB), or `python3 build/fetch_images.py` for full art.
9. **Optional - spell list:** copy 5e.tools' `spells/` folder into `monster-doxxer/data/`. It makes the Spellcasting module autocomplete every spell in the game (not just the ~400 some bestiary monster casts) and fixes capitalization. Without it, typing any spell name still works.

**macOS**
1. **Install prerequisites:** git (`xcode-select --install` if missing) and a browser. Python 3 usually ships with macOS; if not, `brew install python3`.
2. **Get the repo:** `git clone <repo-url> && cd monster-doxxer`.
3. **Get the bestiary data**: download a 5etools-src mirror from GitHub and copy the `data/bestiary/` folder into `monster-doxxer/data/bestiary/`.
4. **Make sure the launcher is executable:** `chmod +x doxx` (git preserves this bit on a normal clone, but it's worth checking if it was zipped/re-downloaded).
5. **Run it:** `./doxx` starts a local server on port 8932 and opens the tool in your default browser.
6. **Other commands:** `./doxx stop`, `./doxx test`, `./doxx test-ui` (needs `npm install --no-save playwright && npx playwright install chromium` first).
7. **Optional - put it on PATH so `doxx` works from any directory:** add the repo folder to PATH in your shell profile (`~/.zshrc` or `~/.bash_profile`), e.g. `export PATH="$PATH:/path/to/monster-doxxer"`, then open a new terminal.
8. **Optional - book titles:** copy `books.json` and `adventures.json` into `monster-doxxer/data/`. Without these the Sources module still works, it just shows abbreviations instead of full titles, and loses the Books/Adventures/Other split.
9. **Optional - artwork:** `python3 build/fetch_images.py --tokens` for just the small per-monster tokens (a few MB), or `python3 build/fetch_images.py` for full art.
10. **Optional - spell list:** copy 5e.tools' `spells/` folder into `monster-doxxer/data/`. It makes the Spellcasting module autocomplete every spell in the game (not just the ~400 some bestiary monster casts) and fixes capitalization. Without it, typing any spell name still works.

**Linux**

Identical to macOS. The only difference is it uses `xdg-open` instead of `open` to launch the browser (handled automatically). Steps 1-10 above apply as-is; use your distro's package manager for git/python3 if needed.

**Fallback**

If none of the launcher's auto-detected servers are available, any static file server over the repo root works: `python -m http.server 8932`, then open `http://localhost:8932/index.html` manually.

## How to update

**monster-doxxer:** just `git pull` lul

**5e.tools data:** re-copy the new `bestiary/` folder over your existing `data/bestiary/`.
