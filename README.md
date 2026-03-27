
                                        (
                                   (   (
        )              )\  )\ (            (
     ( /(  `  )    (  ((_)((_))\   (      ))\
     )(_)) /(/(    )\  _   _ ((_)  )\ )  /((_)
    ((_)_ ((_)_\  ((_)| | | | (_) _(_/( (_))
    / _` || '_ \)/ _ \| | | | | || ' \))/ -_)
    \__,_|| .__/ \___/|_| |_| |_||_||_| \___|
          |_|


# claudemot

> annotate your claude chats like a book. highlight text, write margin notes, bookmark your thinking.

every claude conversation gets a structured collection of your reactions, questions, and insights that you can bring back into future conversations or use to index your chats.

[![license](https://img.shields.io/badge/license-MIT-a78bfa?style=flat-square)](LICENSE)


·  ˚  ✦  .  ·  ˚  ✦  .  ·  ˚  ✦  .  ·  ˚  ✦  .  ·  ˚  ✦  .


## developer note

**the why:** wanted to annotate while reading claude, especially when you had multiple things to reply to or ask about

**the friction:** claude search across chats is a$$ and i wanted to keep a backend record of notables for learning topics or flags for interesting things to come back to

**the motivation:** our everyday tools should spark delight and have some whimsy

**the name:** «mot» means "word" in french to ref words-driven purpose, but pronounced like infamous "clawdbot"

**the moment:** my first code project and open-source project so keep your expectations low &  give feedback

☕ [buy me a coffee](https://ko-fi.com/apollineproduction)

---

## what it does

hold **Option** and **select any text** in a claude conversation → a cute pixel-art popup appears → pick an annotation type, add your note → it stays pinned to that text as a highlighted overlay with a sticky note in the margin.

at the end of a session, export all your annotations as structured markdown you can paste into a new claude chat, or sync them to notion.

---

## features

### highlight + annotate
hold **Option** (Alt on Windows) and select text on any claude.ai chat page. a draggable popup window (annotate.exe) appears where you can pick a type, write a note, and add tags. normal text selection (without Option) works as usual for copy/paste.

### 7 annotation types

| icon | type | use it for... |
|------|------|---------------|
| 🐬 | insight | things that resonated |
| 〰️ | question | things to dig deeper on |
| 👉 | action item | things to address |
| 👤 | idea | thoughts that were sparked |
| 💾 | reference | things to explore later |
| 🖥️ | issue | disagreements or bugs |
| 💿 | pattern | recurring themes you notice |

### margin notes
google docs-style sticky notes appear on the right side of the chat. click a highlight to expand its card. each annotation gets a sequential number (001, 002, 003...) so you can track the order of your thinking.

### sidebar
press `cmd+shift+s` (or click the floating button at the bottom-right) to open the full annotation sidebar. see all your notes for the current chat, multi-select to pin or export, and click any annotation to scroll to its highlight.

### export to clipboard
exports your annotations as structured markdown organized by type — ready to paste into a new claude chat.

### pin to notion
sync annotations to notion automatically — no manual database setup required. just paste your api key and the extension handles the rest (see below).

### resolve
when you're done with an annotation, resolve it. it disappears from your local view. if it was pinned to notion, it gets marked "resolved" there but stays in your database for reference.

---

## how to install as chrome extension

1. clone this repo:
   ```bash
   git clone https://github.com/apollinej/claudemot.git
   cd claudemot
   ```

2. install dependencies and build:
   ```bash
   npm install
   npm run build
   ```

3. load in chrome:
   - go to `chrome://extensions`
   - enable "developer mode" (top right toggle)
   - click "load unpacked"
   - select the `dist/` folder

4. navigate to any `claude.ai/chat/*` page — the extension activates automatically

---

## how to create notion backend integration

> notion integration lets you pin annotations to a database for long-term reference. claudemot **auto-creates the databases** for you or you can manually set up database IDs.

### setup (3 steps)

**step 1 — open claudemot settings**
click the claudemot icon in your chrome toolbar → options

**step 2 — add your notion api key**
if you already have one (starts with ntn_), paste it and skip to step 3.

if you don't have one yet:
- go to notion.so/my-integrations → "new integration"
- name it something like "claudemot api" and pick your workspace
- go to [configure integration settings] → [content access] tab → [edit access]
- add the page you want your databases to live under
- copy the api key and paste it into claudemot settings

**step 3 — connect**
claudemot will then automatically:
- validate your key
- auto-connect to existing "chat sessions" and "annotations" databases if it finds them
- or ask you to pick a host page, then create and store the databases there

### what gets created

two databases under the page you selected:

**chat sessions**
tracks each claude conversation that has pinned annotations. properties: session title, chat url, project, status (active / archived / reviewed).

**annotations**
one row per annotation. properties: highlight (the selected text), session (linked to chat sessions), type, note, tags, source (claude response / user message / artifact), message index, status (active / resolved).

### how syncing works

- annotations are **local-only by default** — they live in your browser's extension storage
- toggle "📌 pin to notion" in the annotation popup to sync that annotation
- or: open the sidebar → select annotations → click "pin" to batch-sync
- or: enable "automatically pin new annotations to notion" in settings to always sync

when an annotation is pinned, the extension:
1. creates a session page in "chat sessions" if one doesn't exist yet
2. creates the annotation page in "annotations" with a relation to the session
3. rebuilds a summary in the session page — a formatted markdown view of all annotations for that chat

### reconnecting / changing workspaces

click **disconnect** in settings — this clears the database IDs but keeps your api key for easy reconnect. your databases in notion are untouched. click **connect** again to re-detect them (or create new ones in a different parent page).

### manual configuration (advanced)

if you want to point the extension at databases you created yourself, use the "advanced" toggle at the bottom of the notion settings section. you can enter database IDs directly. the extension expects these exact property names (capitalization matters):

**chat sessions** must have: `Session Title` (title), `Chat ID` (text), `Chat URL` (url), `Project` (select), `Status` (select)

**annotations** must have: `Highlight` (title), `Session` (relation), `Type` (select), `Note` (text), `Full Highlight` (text), `Tags` (multi-select), `Source` (select), `Message Index` (number), `Status` (select)

### privacy

your api key is stored locally in your browser's extension storage (`chrome.storage.local`). it is never transmitted anywhere except directly to `api.notion.com` when syncing. you can clear everything from the extension popup → "clear all data".

---

## settings

### default project
tag all annotations from a given browser with a project label (kyma, personal, learning, other). useful if you use claude for multiple contexts and want to filter your notion database by project.

### auto-pin
when enabled, every annotation you create is automatically synced to notion. when disabled (the default), annotations are local-only until you explicitly pin them.

---

## how to use each feature

### creating an annotation
1. hold **Option** (Alt on Windows) and **select any text** in a claude conversation
2. the annotate.exe popup appears near your selection
3. pick an annotation type (click one of the 7 pixel icons)
4. write your note in the text area
5. optionally add tags (comma-separated)
6. toggle "pin to notion" if you want it synced
7. click "save" (or press `cmd+enter`)

### using the sidebar
- press `cmd+shift+s` or click the floating "view all" button in the bottom-right corner
- see all annotations for the current chat in sequential order
- click any annotation card to scroll to its highlight in the chat
- use multi-select mode to pin or export multiple annotations at once

### exporting to clipboard
- open the sidebar → click "export" in the header (exports all)
- or: check specific annotations → click "export" in the action bar
- paste the markdown into a new claude chat to continue the conversation with context

### resolving annotations
- in the margin rail: click the checkmark button on a card → confirm "yes"
- resolved annotations are removed from your local view
- if pinned to notion, they're marked "resolved" but preserved

---

## development

```bash
# install dependencies
npm install

# build for production
npm run build

# the build outputs to dist/ — reload the extension in chrome after building
```

the build uses three separate vite configs:
- `vite.config.ts` — popup + options pages (es modules)
- `vite.config.content.ts` — content script (iife bundle)
- `vite.config.sw.ts` — service worker (iife bundle)

### project structure
```
src/
  content/
    content-script.ts       — main entry, mouseup listener, save/resolve/pin
    annotation-popup.ts     — draggable creation window (annotate.exe)
    highlight-renderer.ts   — wraps text in <mark>, renders margin rail cards
    sidebar.ts              — cmd+shift+s panel with annotation list
    session-tracker.ts      — extracts chat id from url, spa navigation
  background/
    service-worker.ts       — chrome storage crud, notion sync, message routing
  lib/
    types.ts, constants.ts, storage.ts, export.ts, notion-client.ts, icons.ts
  styles/
    content.css             — all extension styles (pixel font, chrome palette)
  popup/                    — extension toolbar popup
  options/                  — settings page
```

---

## contributing

contributions welcome! this is a small passion project, so:

1. fork it
2. create your branch (`git checkout -b feat/cool-thing`)
3. make your changes
4. build and test locally (`npm run build`, reload extension in chrome)
5. open a pr

---

## aesthetic

claudemot uses a y2k desktop-core aesthetic:
- **fonts**: press start 2p (pixel) for headers, orbitron for body text
- **palette**: silver / chrome / iridescent purple
- **style**: pixel-art icons, retro window chrome, glass morphism
- everything lowercase, always

---

## license

[MIT](LICENSE)

<div align="center">

```
˚ . ✦ · ;] · ✦ . ˚
```

made with 💿 by [apolline](https://ko-fi.com/apollineproduction)

*every routine tool needs a little whimsy*

</div>
