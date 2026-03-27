# privacy policy

**last updated:** march 26, 2026

## what claudemot does

claudemot is a chrome extension that lets you annotate text on claude.ai chat pages. you highlight text, write notes, and view them as margin sticky notes.

## what data is stored

- **annotations you create**: highlighted text, your notes, tags, and annotation type. stored locally in your browser using chrome's built-in storage (`chrome.storage.local`).
- **notion api key** (optional): if you choose to enable notion sync, your api key is stored locally in your browser's extension storage. it is never sent anywhere except directly to notion's official api (`api.notion.com`).

## what data is NOT collected

- no personal information
- no browsing history
- no analytics or tracking
- no cookies
- no data shared with third parties
- no remote servers or databases (everything stays in your browser)

## external connections

- **notion api** (optional, user-initiated only): if you configure notion sync, the extension sends your annotations directly to notion's api using your own api key. this only happens when you explicitly pin an annotation to notion.
- **google fonts**: the extension loads orbitron and press start 2p fonts from google's font cdn for styling purposes. no user data is sent to google.

## data deletion

all your data lives in your browser. to delete everything:
1. right-click the claudemot icon → "remove from chrome"
2. or go to `chrome://extensions`, find claudemot, and click "remove"

this permanently deletes all stored annotations and settings.

## contact

questions? open an issue at [github.com/apollinej/claudemot](https://github.com/apollinej/claudemot)
