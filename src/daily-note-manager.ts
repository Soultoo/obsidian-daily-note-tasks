import { App, MarkdownView, Notice, TFile, moment } from 'obsidian';
import {
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from 'obsidian-daily-notes-interface';
import { Moment } from 'moment';

export class DailyNoteManager {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Ensures a daily note exists for the given date (creating it from template if necessary),
	 * and appends the task under the specified header.
	 */
	public async addTask(
		date: Moment,
		headerName: string,
		taskContent: string
	): Promise<{ file: TFile; line: number }> {
		const targetDate = date.isValid() ? date : moment();
		let allDailyNotes = getAllDailyNotes();
		let dailyFile = getDailyNote(targetDate, allDailyNotes);

		if (!dailyFile) {
			try {
				const created = await createDailyNote(targetDate);
				if (created instanceof TFile) {
					dailyFile = created;
				} else {
					allDailyNotes = getAllDailyNotes();
					dailyFile = getDailyNote(targetDate, allDailyNotes);
				}
			} catch (err) {
				console.error('Error creating daily note:', err);
				new Notice(`Failed to create daily note for ${targetDate.format('YYYY-MM-DD')}`);
				throw err;
			}
		}

		if (!dailyFile) {
			throw new Error(`Could not find or create daily note for ${targetDate.format('YYYY-MM-DD')}`);
		}

		let insertedLine = -1;
		await this.app.vault.process(dailyFile, (data) => {
			const result = this.insertTaskUnderHeader(data, headerName, taskContent);
			insertedLine = result.insertedLine;
			return result.content;
		});

		return { file: dailyFile, line: insertedLine };
	}

	/**
	 * Appends a task to an arbitrary target note in the vault (e.g. "groceries").
	 * If the note doesn't exist, it creates it.
	 * If no header is present, it appends under '## Todos'.
	 */
	public async addTaskToNote(
		targetNoteName: string,
		headerName: string,
		taskContent: string
	): Promise<{ file: TFile; line: number }> {
		const cleanName = targetNoteName.replace(/^\/+|\/+$/g, '').trim();
		const files = this.app.vault.getMarkdownFiles();

		let targetFile = files.find(
			(f) =>
				f.basename.toLowerCase() === cleanName.toLowerCase() ||
				f.path.toLowerCase() === cleanName.toLowerCase() ||
				f.name.toLowerCase() === cleanName.toLowerCase()
		);

		if (!targetFile) {
			try {
				const path = cleanName.endsWith('.md') ? cleanName : `${cleanName}.md`;
				targetFile = await this.app.vault.create(path, '');
			} catch (err) {
				console.error('Error creating target note:', err);
				new Notice(`Failed to create note: ${cleanName}`);
				throw err;
			}
		}

		let insertedLine = -1;
		const effectiveHeader = headerName || 'Todos';

		await this.app.vault.process(targetFile, (data) => {
			const result = this.insertTaskUnderHeader(data, effectiveHeader, taskContent);
			insertedLine = result.insertedLine;
			return result.content;
		});

		return { file: targetFile, line: insertedLine };
	}

	/**
	 * Opens the given file and highlights (selects) the task at the given line, scrolling it into view.
	 */
	public async openAndHighlightTask(
		file: TFile,
		line: number,
		taskContent?: string
	): Promise<void> {
		try {
			// Find existing leaf displaying this file or open/reuse one
			let leaf = this.app.workspace.getLeavesOfType('markdown').find((l) => {
				return l.view instanceof MarkdownView && l.view.file?.path === file.path;
			});

			if (!leaf) {
				leaf = this.app.workspace.getLeaf(false);
				await leaf.openFile(file);
			} else {
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			}

			// Brief wait in case view is initializing
			if (!(leaf.view instanceof MarkdownView)) {
				await new Promise((resolve) => setTimeout(resolve, 80));
			}

			if (leaf.view instanceof MarkdownView) {
				const editor = leaf.view.editor;
				let targetLine = line;

				const lineCount = editor.lineCount();
				if (taskContent) {
					const firstLine = taskContent
						.replace(/^[-*+\s[\]]+/, '')
						.split('\n')[0] ?? '';
					const cleanTask = firstLine.trim();

					if (
						targetLine < 0 ||
						targetLine >= lineCount ||
						!editor.getLine(targetLine).includes(cleanTask)
					) {
						for (let i = 0; i < lineCount; i++) {
							if (editor.getLine(i).includes(cleanTask)) {
								targetLine = i;
								break;
							}
						}
					}
				}

				if (targetLine >= 0 && targetLine < editor.lineCount()) {
					const lineLength = editor.getLine(targetLine).length;
					editor.setSelection(
						{ line: targetLine, ch: 0 },
						{ line: targetLine, ch: lineLength }
					);
					editor.scrollIntoView(
						{
							from: { line: targetLine, ch: 0 },
							to: { line: targetLine, ch: lineLength },
						},
						true
					);

					// Apply accent pulse animation to the active line element
					const activeLineEl = leaf.view.containerEl.querySelector('.cm-activeLine');
					if (activeLineEl) {
						activeLineEl.classList.add('dnt-highlight-flash');
						setTimeout(() => {
							activeLineEl.classList.remove('dnt-highlight-flash');
						}, 2000);
					}
				}
			}
		} catch (err) {
			console.error('Failed to open and highlight task:', err);
		}
	}

	/**
	 * Inserts a task item under a specific header.
	 */
	public insertTaskUnderHeader(
		content: string,
		headerName: string,
		taskContent: string
	): { content: string; insertedLine: number } {
		const formattedTask = taskContent.startsWith('- [ ]')
			? taskContent
			: `- [ ] ${taskContent}`;

		const lines = content.split('\n');
		const cleanTargetHeader = headerName.toLowerCase().replace(/[*_`#[\]@]/g, '').trim();

		// Find target header line:
		// Pass 1: exact match
		let headerLineIndex = -1;
		let headerLevel = 0;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const match = line.match(/^(#{1,6})\s+(.+)$/);
			if (match && match[1] && match[2]) {
				const headingLevel = match[1].length;
				const cleanHeading = match[2].toLowerCase().replace(/[*_`#[\]@]/g, '').trim();
				if (cleanHeading === cleanTargetHeader) {
					headerLineIndex = i;
					headerLevel = headingLevel;
					break;
				}
			}
		}

		// Pass 2: word boundary match if no exact match found
		if (headerLineIndex === -1) {
			const escaped = cleanTargetHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const wordRegex = new RegExp(`\\b${escaped}\\b`, 'i');
			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (!line) continue;
				const match = line.match(/^(#{1,6})\s+(.+)$/);
				if (match && match[1] && match[2]) {
					const headingLevel = match[1].length;
					const cleanHeading = match[2].toLowerCase().replace(/[*_`#[\]@]/g, '').trim();
					if (wordRegex.test(cleanHeading)) {
						headerLineIndex = i;
						headerLevel = headingLevel;
						break;
					}
				}
			}
		}

		// If header not found anywhere, append header (## Header) and task at bottom
		if (headerLineIndex === -1) {
			const trimmedContent = content.trimEnd();
			const newSection = `\n\n## ${headerName}\n${formattedTask}\n`;
			const newContent = trimmedContent ? `${trimmedContent}${newSection}` : `## ${headerName}\n${formattedTask}\n`;
			return {
				content: newContent,
				insertedLine: newContent.split('\n').length - 2,
			};
		}

		// Find the end of this direct section:
		let directSectionEnd = lines.length;
		for (let i = headerLineIndex + 1; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const match = line.match(/^(#{1,6})\s+(.+)$/);
			if (match && match[1]) {
				directSectionEnd = i;
				break;
			}
			if (line.trim() === '___' || line.trim() === '---') {
				directSectionEnd = i;
				break;
			}
		}

		// Check if there is an empty "- [ ] " placeholder under this header to replace
		for (let i = headerLineIndex + 1; i < directSectionEnd; i++) {
			const line = lines[i];
			if (line && line.trim() === '- [ ]') {
				lines[i] = formattedTask;
				return {
					content: lines.join('\n'),
					insertedLine: i,
				};
			}
		}

		// Look for existing list items directly in this section to append after the last one
		let lastListItemIndex = -1;
		for (let i = headerLineIndex + 1; i < directSectionEnd; i++) {
			const line = lines[i];
			if (line && /^\s*[-*+]\s+/.test(line)) {
				lastListItemIndex = i;
			}
		}

		let insertAt = headerLineIndex + 1;
		if (lastListItemIndex !== -1) {
			insertAt = lastListItemIndex + 1;
		}

		lines.splice(insertAt, 0, formattedTask);

		return {
			content: lines.join('\n'),
			insertedLine: insertAt,
		};
	}
}
