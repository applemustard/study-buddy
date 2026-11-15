# Study Buddy

Turn your PDFs into quizzes, flashcards, notes and an exam study plan, with AI from Groq Cloud.

## Download

**[Download Study Buddy for Windows](https://github.com/applemustard/study-buddy/raw/main/download/StudyBuddy-Windows.zip)** (always the latest version)

1. Right-click the downloaded zip, choose **Extract All**, and put the folder somewhere you'll keep it, such as Documents.
2. Open the folder and double-click **Study Buddy.exe**. If Windows says "Windows protected your PC", click **More info**, then **Run anyway**. Windows shows this for any app that isn't from a big company.
3. Say yes to the desktop icon. From then on, open Study Buddy from that icon. It installs new versions by itself.
4. In the app, go to **Settings** and paste a free Groq API key from [console.groq.com](https://console.groq.com) (API Keys, then Create API Key).

**Mac or Linux:** download the same zip, unzip it, and open `app/index.html` in your browser. That copy doesn't update itself; download it again for new versions.

Your subjects, notes and cards are saved on your own computer, and updates never touch them. You need an internet connection while studying.

---

*Everything below is for working on the app itself.*

## Run it from this folder

No install needed. Either:

- double-click `Study Buddy.exe` (after running `build-launcher.ps1`) or `index.html`, or
- run `powershell -ExecutionPolicy Bypass -File serve.ps1` and open http://localhost:5178

An internet connection is needed (pdf.js, KaTeX, fonts and the Groq API load from the web).

## What it does

- **Subjects**: one per class. Upload PDFs (or paste notes). Text is extracted in the browser and split into chapters, from "Chapter N" headings first, then AI if there are none, then by page ranges as a fallback.
- **Quizzes**: AI multiple-choice questions, each tagged with its chapter. Graded out of 100 and shown as a percentage.
  - The results page shows a bar chart of score by chapter, an AI summary of where you went wrong, and the missed questions with explanations.
  - It then asks whether to create flashcards targeting the missed questions, with about a third broader questions mixed in.
- **Flashcards**:
  - Flip with a key you choose (Space by default; change it on the flashcard page or in Settings). Use ← → for back and next.
  - Mark cards **Again** (red) or **Got it** (green), by button or with the 1 / 2 keys.
  - Study all cards or one pile, shuffle all cards / the Again pile / the Got it pile, have the AI write new cards from the PDF, or add your own.
- **Calendar**: add exam dates. The AI picks the best day to start reviewing and schedules spaced sessions (read, flashcards, practice quiz, full mock test). Sessions show on the calendar and on the Today page, and start the right activity in one click.
- **Score trend** per subject across every attempt.
- **Notes**: the AI writes structured notes from the PDF in one of four styles: outline, Cornell, summary sheet, or questions and answers.
  - Add your own input: rough notes to clean up and correct, or what to focus on.
  - It builds the notes around your study guide: upcoming exam sessions, weakest chapters and the mistakes from your quiz reviews.
  - Notes can be edited (markdown), printed or saved as PDF, and turned into flashcards.
  - "Read" sessions in the calendar have a **Make notes** button.
- **Share with friends**: share a quiz, a flashcard deck (all cards or just the Again pile), notes, or a whole subject (optionally with the PDF text).
  - Send it with the system share sheet, as a short share code (`SB1.…`) to paste in any chat, or as a small `.txt` file.
  - Your friend clicks **Import from a friend** and pastes the code or picks the file. Scores and card progress are not shared.

## Launcher and automatic updates

`Study Buddy.exe` shows a splash screen, checks GitHub for a newer version, installs it, then opens the app in its own Edge window. Offline, it opens the version it has.

- **Friends' copies** have `Study Buddy.exe` next to an `app` folder, and they update themselves.
- **Your copy** (this folder) opens `index.html` here and never updates itself, so your edits are safe.
- The first time it runs, it offers to put an icon on the desktop.
- If something goes wrong, `launcher.log` next to the exe says what happened.

### Publishing an update

1. **First time only:** create an empty, **public** repository on github.com (for example `study-buddy`), then run:

   ```
   powershell -ExecutionPolicy Bypass -File publish-update.ps1 -Repo yourname/study-buddy
   ```

   Git may open a browser window to sign you in to GitHub.

2. **Every update after that:**

   ```
   powershell -ExecutionPolicy Bypass -File publish-update.ps1 -Notes "What changed"
   ```

   It raises the version number (1.0.0, then 1.0.1, and so on), rebuilds the export folder, commits, and pushes. Everyone's launcher installs it the next time they open Study Buddy, and the app shows them your notes. Add `-Version 2.0.0` to choose the number yourself, and `-Launcher` after editing `launcher\Launcher.cs` so the launcher updates too.

Other scripts:

- `build-launcher.ps1` rebuilds the exe with the C# compiler built into Windows.
- `build-export.ps1` rebuilds the export folder only.

## Send the app to other people

Easiest: send the repo link or the download link at the top of this page. `publish-update.ps1` refreshes `download/StudyBuddy-Windows.zip` with every release, so the link always gives the latest version.

The `export` folder (refreshed by `publish-update.ps1` or `build-export.ps1`, not uploaded) contains:

- `Study Buddy (Windows).zip`: the launcher and app. Send this to Windows users; it updates itself.
- `Study Buddy.html`: the whole app in one file, for Mac or Linux. It does not update itself.
- `READ ME FIRST.txt`: setup steps for your friend, including the "Windows protected your PC" prompt.

Your data and API key live in your browser, so they are never part of the export.

## Good to know

- Everything (PDF text, cards, results, your key) is saved in this browser's IndexedDB. Use **Settings → Export backup** to move it to another computer. The export leaves out your key.
- Your key is sent only to `api.groq.com`.
- If you hit Groq rate limits on the free tier, lower **Material sent per request** in Settings. Scanned PDFs without selectable text need OCR first, or use "Paste notes".
- Default model: `llama-3.3-70b-versatile`. Any chat model on your Groq account can be picked in Settings.

## Files

- `index.html`: the page shell.
- `css/styles.css`: all styles.
- `js/store.js`: storage and state.
- `js/groq.js`: Groq API calls and prompts.
- `js/docs.js`: PDF text and chapters.
- `js/charts.js`: the charts.
- `js/markdown.js`: safe markdown rendering for notes.
- `js/share.js`: share codes, share files and importing.
- `js/views/*`: one file per screen.
- `js/app.js`: routing, keyboard handling and the in-app update notice.
- `js/version.js`: version info, generated by `publish-update.ps1`.
- `launcher/`: the launcher and updater (`Launcher.cs`), its icon and the built exe.
- `download/`: the latest Windows package, linked from the top of this page.
