# ReleaseReady

**Make UAT feedback easy to give and easy to act on, with a human approving every decision.**

ReleaseReady follows a bug all the way through user acceptance testing (UAT): from the test script, to a tester's comment, to duplicate checks, to a clear ticket, to the fix, and back to the tester with a message saying what happened.

> Demo video: _add your link here_

---

## What it does

**Many test cycles.** The app opens on *Hi UAT manager*, with three tabs: **Test Cycles In Progress**, **Completed Test Cycles** and **Add a new test cycle**. Open any test cycle to work on it, and use *← All test cycles* to switch. **End test cycle** moves it to Completed, where it can be viewed (read only) or reopened. In the Tester interface, a tester picks their name from everyone in every test cycle, then sees *Hi tester (name)* with their **Test Cycles In Progress** and **Completed Test Cycles**.

Inside a test cycle, the tester's **Inbox** drop-down lists only the comments the UAT manager has written about, each with its chat. The UAT manager has a **Chats** drop-down at the top of every section of a test cycle: every chat in that test cycle, newest first, with the ones waiting for a reply marked. Merged comments share one **group chat** with the UAT manager and every tester who reported the problem.

**My updates is on the first screen**, for the UAT manager and for each tester: notifications from every test cycle, with one drop-down per test cycle. Clicking one opens that test cycle at the comment or chat it is about.

ReleaseReady has two interfaces, switched at the top of the page.

### Tester interface
- **Pick your name** from the testers the UAT manager set up (no password in this version).
- **My test script:** only your steps, one at a time, with a progress stepper.
- **Pass or Fail** for every step. A Pass needs no comment: just click Save result. A Fail needs a short reason in your own words. The step, screen, browser and system are filled in automatically.
- **AI comment check (guided tester app), on one button:** clicking Save runs the check. A helpful comment saves at once. If something is missing, the AI asks one kind question. **It never writes or changes your words.**
- **Catches mix-ups:** a Fail whose comment says it worked asks "Did you mean Pass?"; a bug comment on a passed step offers to change the step to Fail.
- **Save anyway:** not sure what to add? After the AI's question, the main button becomes *Save anyway*. The comment is marked *Needs more detail*, and the manager sees the flag with the question box already open.
- **Attach a screenshot** to any step. The UAT manager sees it with the comment in Bugs and comments and Unique problems, and can click it to see it full size.
- **Photos in chats:** both sides can send a photo in any chat.
- **Edit your own comments** at any time, to fix them or add detail. The edit goes through the same AI check, and the UAT manager is told and sees an *Edited* tag.
- **Extra comments** on any step, marked *bug feedback* or *non-bug feedback* (ideas and suggestions).
- **One chat per comment, in a side panel:** the tester can open it from their test script or My updates, and the manager sees the same chat in Bugs and comments and in Unique problems. When comments are merged into one problem, their chats join, so the manager and every tester who reported it talk in one place. The comment and its step are pinned at the top of the chat.
- **My updates:** questions from the manager (you can reply), decisions about your feedback, thank-you messages, and the chat about each of your comments. Every comment shows its status: Received → Checked → Ticket or idea → Fixed.

### UAT manager interface
| Section | What you do there |
|---|---|
| **My updates** | Notifications: new feedback, answers to your questions, testers who finished. |
| **1 · Test script** | Add scenarios and steps, add testers, assign testers to steps. |
| **2 · Testing progress** | Each tester's progress, results, comments and screenshots. Ask a question under any comment. **End test cycle** sends every tester one thank-you summary. |
| **3 · Bugs and comments** | Every comment waits here until you decide. The count boxes at the top are filters (duplicates, already known, good ideas, unique, need your decision), and each scenario can be shown or hidden. The **duplicate finder** groups comments about the same bug (with a score and reasons). The **already-known check** compares comments with tickets already made in this test cycle. **Good ideas** are flagged. Merging makes one **merged comment** that you then approve; unticked comments become separate comments. You decide each one: Merge / Don't merge, Link / New problem, Approve / Don't approve, Add to Good ideas / Not for now / It's a bug. Approving a comment marked *Needs more detail* asks you to confirm, or to ask the tester first. The tester gets a kind message either way. |
| **4 · Unique problems** | Approved problems and good ideas. The **chat** of each problem is the same chat as its comments' chats, so nothing asked earlier is lost. **Make a ticket** asks the AI **ticket drafter** to write the ticket from every linked comment, the testers' answers and the chat. A **clarity check** blocks vague tickets. |
| **5 · Existing tickets** | Every ticket made in this test cycle. Change a status (In progress, Done) and the testers who reported it are told. |

### Human control and trust
- No "approve all" and no automatic tickets: every decision is one click by a person, one at a time.
- Every suggestion shows **how sure it is** (a % and High / Medium / Low) and **why** (ticks and crosses).
- Every decision sends the tester a kind, specific message, with a 10-second **Undo** before it is sent and a polite correction if a decision changes later.

---

## Where AI is used

| Function | How it works |
|---|---|
| Guided comment check | **AI (Google Gemini).** Judges if a comment is helpful and asks one question. Never rewrites the tester's words. |
| Ticket drafter | **AI (Google Gemini).** Writes one ticket from all linked comments and the problem chat, using only reported facts. Thinking is set low, so drafts come back in seconds. If Gemini is overloaded or takes over 22 s, it tries again with the faster Flash-Lite model before giving up. |
| Duplicate finder | **Rules**, so every point is visible: same step (35) + same screen (20) + wording alike (up to 30) + both show an error or screenshot (15). |
| Already-known check | **Rules:** similar words, same area, ticket status. |
| Clarity check | **Rules that read the meaning, not the word count:** the summary says what goes wrong and where, the actual result matches what testers reported, the expected result comes from the test script. Every cross says why and what would fix it. |

The prompts are in [`server/prompts.js`](server/prompts.js). Tester text is always passed as data inside `"""` quotes, and the model is told not to follow instructions inside it.

If no AI key is set, or the AI is busy, the app uses a basic rule check instead and says so on screen.

---

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

**First run:** the app shows *Hi UAT manager*. Add a new test cycle: its name, the app being tested, the number of testers and their names. **Reset demo** deletes every test cycle.

---

## How it is built

```
server.js            Small Node.js server: serves the page, keeps keys secret, stores data
server/ai.js         Calls the Gemini API (picks the newest Flash-Lite / Flash models)
server/prompts.js    The two AI prompts
server/db.js         Supabase (REST API) or a local JSON file
public/index.html    The page
public/app.js        The whole interface: tester and manager views, duplicate finder, messages
public/styles.css    Styles
supabase/schema.sql  Database tables
```

- **Keys stay on the server.** The browser never sees the Gemini key or the database key.
- **Saving:** the page keeps its state in memory and sends only what changed to the server a moment after each action. The header shows "All changes saved". Other browsers pick up changes every few seconds.

---

## Limits of this prototype
- **No logins.** Anyone who can open the app can act as any tester or as the manager. The database rules allow full access for the app's key. A real version would add company login, roles, and stricter database rules.
- **Duplicate matching uses word overlap**, not meaning. A real version could use text embeddings while keeping the visible score breakdown.
- **Screenshots** are resized and stored in the database. A real version would use file storage.
- **Free Gemini limits** are small, and the free tier is sometimes overloaded (error 503). The server retries and falls back to Flash-Lite; if it still fails, use "Use basic check" / "Use a basic draft" or wait a minute. The Render logs show how long each AI call took.

---

AI: Google Gemini. Database: Supabase. Built for the "UAT, Untangled" challenge.
