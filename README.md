# Obsidian Daily Note Tasks

A powerful, Todoist-inspired task capture and management plugin for [Obsidian](https://obsidian.md). Capture tasks in natural language, route them instantly to daily notes or custom project files, schedule recurring tasks, and move existing tasks with zero friction.

![Quick Task Capture](https://raw.githubusercontent.com/Soultoo/obsidian-daily-note-tasks/main/manifest.json)

---

## Key Features

### 1. Todoist-Style Natural Language Task Capture
Quickly capture tasks anywhere in your vault using a streamlined CodeMirror 6 capture modal:
- **Shortcut Trigger**: Use the ribbon icon or command palette (`Quick task capture (nlp)`).
- **Interactive Syntax Highlighting**:
  - `blue` for dates (`today`, `tomorrow`, `tod`, `tom`, `Nov 15`, `in 2 days`, `next monday`).
  - `red` for section headers (`@Tasks`, `@"Written plan"`).
  - `green` for target notes (`/groceries`, `/"Project Apollo"`).
  - `purple` for recurrence schedules (`every day`, `every 2 days`, `every weekday`).
  - `cyan` for note wikilinks (`[[Project Apollo]]`, `[[Meeting Notes]]`).
- **Auto-Pairing & Atomic Backspace**:
  - Typing `/` or `@` automatically adds quotes (`/""` or `@""`) with the caret placed inside for effortless input with spaces.
  - Typing `[` automatically creates a paired wikilink (`[[]]`) with the caret inside.
  - Pressing `Backspace` while between empty carets (`/""`, `@""`, or `[[]]`) deletes the entire delimiter sequence atomically.
- **Wikilink Completion (`[[`)**: Suggests vault notes directly inside your task text without carrying special routing meaning. Multiple links are fully supported.
- **Live Preview Badges**: See real-time breakdown of destination note, date, time, section, and final clean formatted task bullet before saving.
- **Keyboard-First Workflow**: Press `Enter` to save, `Escape` to cancel. Use the quick toolbar to insert `/`, `@`, `[[`, `#`, `tod`, `tom`, or `every` with one click.

---

### 2. Context-Aware Section Autocomplete (`@`)
- **Daily Note Template Integration**: When adding tasks to your daily note, typing `@` autocompletes sections directly from your daily note template.
- **Note-Specific Autocomplete**: When a target note is specified with `/` (e.g. `/Groceries @`), `@` inspects and suggests only headers already present in that specific note.
- **Recently Used Sections**: Recent sections are boosted to the top of the autocomplete list and marked with `🕒 Recent • H#`.
- **New Section Detection**: If you type a section header that does not exist yet:
  - Highlighted with a distinct amber underline and preview tooltip (`✨ Will create ## <header>`).
  - Automatically creates the section at your configured heading level (H1–H6, default `##`).
  - Optional setting to automatically insert an inline `+ add task` button under newly created sections.

---

### 3. Vault Note Autocomplete & Recent Tracking (`/`)
- Type `/` to target any markdown file in your vault.
- **Recently Used Notes First**: Recent notes are saved and boosted to the top with a `🕒 Recent • Note` badge.
- **Alphabetical Vault Search**: Remaining notes in your vault are sorted alphabetically (A–Z) for rapid discovery.
- **Smart Quoting**: Note titles with spaces or special characters are automatically wrapped in quotes (e.g. `/"Obsidian plugin development"`).

---

### 4. Zero-Click Move Task (`Move task to date`)
Move existing tasks and multi-line task blocks with zero mouse clicks:
- Place the cursor on any task bullet and run `Move task to date (zero click)`.
- **Smart AST Parser**: Automatically extracts the full task item and all nested child bullets, notes, and sub-items, even across blank lines, without capturing sibling tasks.
- **Quick Date Chips**: One-click chips for `Today`, `Tomorrow`, `Next Monday`, or `In 1 Week`.
- **Target Anywhere**: Supports moving to any natural language date or target note/section.
- **Timestamp Handling**: Preserves or updates timestamps seamlessly based on your preferred format.

---

### 5. Automated Recurring Tasks Engine
Set up recurring tasks that automatically inject into your daily notes:
- **Natural Language Blueprints**: Create recurring tasks directly from the capture modal (e.g. `Water plants every 2 days @Todos`) or through the **Manage recurring tasks** modal.
- **Supported Patterns**:
  - `every day`, `every X days`
  - `every weekday` (Monday through Friday)
  - `every week`, `every X weeks on <day>` (e.g. `every 3 weeks on friday`)
  - `every month on the <ordinal>` (e.g. `every month on the 1st`, `every month on the 15th`)
  - `every year`
- **Daily Note Creation Hook**: When a daily note is created, all blueprints due on that day are automatically injected under their target sections.
- **Forward Sweeping & Safe Deletion**:
  - Adding a blueprint sweeps today and all already-created future daily notes.
  - Canceling/deleting a blueprint sweeps and removes future orphaned task instances.
- **Cursive Formatting**: Optional setting to format recurring tasks in italics matching vault template style (e.g. `- [ ] *Water plants* #home`).

---

### 6. Inline `+ Add Task` Code Block Buttons
Embed interactive "+ Add Task" buttons directly into your notes:
````markdown
```task-add
note: groceries
header: Produce
label: + Add Grocery Item
```
````

- **Context Detection**: If `header` or `note` is omitted, the button automatically detects the enclosing markdown heading and current file.
- **Rapid Sequential Entry**: Automatically reopens the capture modal after submitting a task so you can quickly capture multiple items in a row.
- **Insert Modal**: Run `Insert "+ add task" button code block` to configure and insert button blocks at cursor via an interactive preview dialog.

---

### 7. Configurable Navigation & Open Behavior
- **Open Note on Task Add**: Automatically open the target note and highlight (select) the newly inserted task line with an accent flash animation.
- **Tab Management**: Choose whether to open in the active tab or a new tab, and whether to switch focus (`Swap to new tab`) or keep working in the background.

---

## Quick Reference / Cheat Sheet

| Syntax | Description | Example |
| :--- | :--- | :--- |
| `/note` | Target vault note (auto-quotes) | `/groceries`, `/"Project Apollo"` |
| `@section` | Target heading/section (auto-quotes) | `@Todos`, `@"Written plan"` |
| `[[note]]` | Embedded vault link | `Review [[Project Apollo]] tod` |
| `#tag` | Preserve Obsidian tags | `#work`, `#errands` |
| `tod` / `tom` | Today or tomorrow | `Buy groceries tod`, `Prepare slides tom` |
| Natural date | Specific calendar date | `Submit taxes on April 15`, `next monday` |
| Natural time | Time of day | `14:00`, `at 5:30 pm`, `9am` |
| `every X Y` | Recurrence blueprint | `every day`, `every weekday`, `every 2 weeks on friday` |

---

## Installation

### From Community Plugins
*(Coming soon upon community listing approval)*

### Manual Installation
1. Download the latest release assets (`main.js`, `manifest.json`, and `styles.css`) from the [Releases](https://github.com/Soultoo/obsidian-daily-note-tasks/releases) page.
2. In your Obsidian vault, navigate to `.obsidian/plugins/` and create a folder named `obsidian-daily-note-tasks`.
3. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
4. In Obsidian, go to **Settings** → **Community plugins** and enable **Daily Note Tasks**.

---

## Development

```bash
# Clone repository
git clone https://github.com/Soultoo/obsidian-daily-note-tasks.git
cd obsidian-daily-note-tasks

# Install dependencies
npm install

# Run tests
npm test

# Run linter
npm run lint

# Build production bundle
npm run build
```

---

## License

MIT License. See [LICENSE](LICENSE) for details.
