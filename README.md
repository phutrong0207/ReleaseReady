# ReleaseReady

**Make UAT feedback easy to give and easy to act on, with a human approving every decision.**

ReleaseReady follows a bug all the way through user acceptance testing (UAT): from the test script, to a tester's comment, to duplicate checks, to a clear ticket, to the fix, and back to the tester with a message saying what happened.

> Demo video: _add your link here_

---

## What it does

ReleaseReady has two interfaces, switched at the top of the page.

### Tester interface
- **Pick your name** from the testers the UAT manager set up (no password in this version).
- **My test script:** only your steps, one at a time, with a progress stepper.
- **Pass or Fail** for every step. A Pass needs no comment: just click Save result. A Fail needs a short reason in your own words. The step, screen, browser and system are filled in automatically.
- **AI comment check (guided tester app), on one button:** clicking Save runs the check. A helpful comment saves at once. If something is missing, the AI asks one kind question. **It never writes or changes your words.**
- **Catches mix-ups:** a Fail whose comment says it worked asks "Did you mean Pass?"; a bug comment on a passed step offers to change the step to Fail.
- **Save anyway:** not sure what to add? Save it as it is. It is marked *Needs more detail*, and the manager sees the flag with the question box already open.
- **Attach a screenshot** to any step.
- **Extra comments** on any step, marked *bug feedback* or *non-bug feedback* (ideas and suggestions).
- **My updates:** questions from the manager (you can reply), decisions about your feedback, and thank-you messages. Every comment shows its status: Received → Checked → Ticket or idea → Fixed.

### UAT manager interface
| Section | What you do there |
|---|---|
| **My updates** | Notifications: new feedback, answers to your questions, testers who finished. |
| **1 · Test script** | Add scenarios and steps, add testers, assign testers to steps. |
| **2 · Testing progress** | Each tester's progress, results, comments and screenshots. Ask a question under any comment. Send a thank-you summary. |
| **3 · Bugs and comments** | The **duplicate finder** groups comments about the same bug (with a score and reasons). The **already-known check** compares comments with existing tickets. **Good ideas** are flagged. You decide each one: Merge / Don't merge, Link / New problem, Add to Good ideas / Not for now / It's a bug. |
| **4 · Unique problems** | What's left after merging and removing known problems. **Make a ticket** asks the AI **ticket drafter** to write the ticket from every linked comment. A **clarity check** blocks vague tickets. |
| **5 · Existing tickets** | All tickets. Add tickets you already have. Change a status (In progress, Done) and the testers who reported it are told. |

### Human control and trust
- No "approve all" and no automatic tickets: every decision is one click by a person, one at a time.
- Every suggestion shows **how sure it is** (a % and High / Medium / Low) and **why** (ticks and crosses).
- Every decision sends the tester a kind, specific message, with a 10-second **Undo** before it is sent and a polite correction if a decision changes later.

---

## Where AI is used

| Function | How it works |
|---|---|
| Guided comment check | **AI (Google Gemini).** Judges if a comment is helpful and asks one question. Never rewrites the tester's words. |
| Ticket drafter | **AI (Google Gemini).** Writes one ticket from all linked comments, using only reported facts. |
| Duplicate finder | **Rules**, so every point is visible: same step (35) + same screen (20) + wording alike (up to 30) + both show an error or screenshot (15). |
| Already-known check | **Rules:** similar words, same area, ticket status. |
| Clarity check | **Rules:** summary length, numbered steps, no "didn't work", and so on. |

The prompts are in [`server/prompts.js`](server/prompts.js). Tester text is always passed as data inside `"""` quotes, and the model is told not to follow instructions inside it.

If no AI key is set, or the AI is busy, the app uses a basic rule check instead and says so on screen.

---
## Run it on Render

**Try it now: https://releaseready-0yvz.onrender.com**

No install or account needed. Just open the link in your browser. The AI features use Google Gemini, and the data is saved in Supabase.

- **First load can take about a minute.** The app runs on Render's free plan, which sleeps when nobody is using it. After the first load it is fast.
- **If you see the setup screen,** enter the app name, the number of testers and their names, then start. Everyone who opens the link shares the same test cycle, and **Reset demo** clears it for everyone.
- **Try both sides.** Use **Switch interface** at the top to move between the UAT manager and a tester.
- **If the AI is busy** (free usage limit), the app switches to a basic rule check and says so on screen. Everything else keeps working.
## Run it on your computer

You need **[Node.js](https://nodejs.org) 18 or newer**. There are no other packages to install.

1. Download or clone this repository.
2. Copy `.env.example` to a new file called `.env`.
3. *(Optional, for AI)* Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey) and paste it after `GEMINI_API_KEY=`.
4. *(Optional, for a shared database)* Create a free [Supabase](https://supabase.com) project, run [`supabase/schema.sql`](supabase/schema.sql) in its SQL editor, then paste the project URL and publishable key into `SUPABASE_URL` and `SUPABASE_KEY`.
5. Open a terminal in the project folder and run:
   ```
   npm start
   ```
6. Open **http://localhost:3000**.

The terminal tells you which database and AI are being used.

| You set | What happens |
|---|---|
| Nothing | Works fully. Data is saved in `data/local-db.json`. Basic checks instead of AI. |
| `GEMINI_API_KEY` | The comment check and ticket drafter use AI. |
| `SUPABASE_URL` + `SUPABASE_KEY` | Data is saved in Supabase, so several computers can use the same test cycle. |

**First run:** the app asks for the name of the app being tested, the number of testers and their names. **Reset demo** deletes all data and asks again.

---


## Limits of this prototype
- **No logins.** Anyone who can open the app can act as any tester or as the manager. The database rules allow full access for the app's key. A real version would add company login, roles, and stricter database rules.
- **Duplicate matching uses word overlap**, not meaning. A real version could use text embeddings while keeping the visible score breakdown.
- **Screenshots** are resized and stored in the database. A real version would use file storage.
- **Free Gemini limits** are small. If the limit is reached, use the "Use basic check" button or wait a minute.

---

AI: Google Gemini. Database: Supabase.
