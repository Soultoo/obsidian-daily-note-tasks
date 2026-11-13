import { App, MarkdownView, Notice, TFile, WorkspaceLeaf, moment } from 'obsidian';
import {
	createDailyNote,
	getAllDailyNotes,
	getDailyNote,
} from 'obsidian-daily-notes-interface';
import type { Moment, PluginSettings } from './types';

interface LeafWithParentTab {
	parent?: {
		selectTab?: (leaf: WorkspaceLeaf) => void;
	};
}

export class DailyNoteManager {
	private app: App;
	private getSettings?: () => PluginSettings;

	constructor(app: App, getSettings?: () => PluginSettings) {
		this.app = app;
		this.getSettings = getSettings;
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

		const settings = this.getSettings?.();
		const newHeaderLevel = settings?.newHeaderLevel ?? 2;
		const addCodeBlock = settings?.addCodeBlockUnderNewHeaders ?? false;

		let insertedLine = -1;
		await this.app.vault.process(dailyFile, (data) => {
			const result = this.insertTaskUnderHeader(
				data,
				headerName,
				taskContent,
				newHeaderLevel,
				addCodeBlock
			);
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

		const settings = this.getSettings?.();
		const newHeaderLevel = settings?.newHeaderLevel ?? 2;
		const addCodeBlock = settings?.addCodeBlockUnderNewHeaders ?? false;
		const effectiveHeader = headerName || settings?.defaultCustomNoteHeader || 'Todos';

		let insertedLine = -1;
		await this.app.vault.process(targetFile, (data) => {
			const result = this.insertTaskUnderHeader(
				data,
				effectiveHeader,
				taskContent,
				newHeaderLevel,
				addCodeBlock
			);
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
		taskContent?: string,
		openInNewTab = false,
		swapToNewTab = true
	): Promise<void> {
		try {
			// Record currently active leaf before creating new tab
			const previousActiveLeaf: WorkspaceLeaf | null =
				(typeof this.app.workspace?.getActiveViewOfType === 'function'
					? this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf
					: null) ??
				(typeof this.app.workspace?.getMostRecentLeaf === 'function'
					? this.app.workspace.getMostRecentLeaf()
					: null);

			let leaf: WorkspaceLeaf;

			if (openInNewTab) {
				leaf = this.app.workspace.getLeaf('tab');
				await leaf.openFile(file, {
					active: swapToNewTab,
					state: { mode: 'source' },
				});

				if (!swapToNewTab && previousActiveLeaf && previousActiveLeaf !== leaf) {
					this.app.workspace.setActiveLeaf(previousActiveLeaf, { focus: true });
					const parentTabs = (previousActiveLeaf as unknown as LeafWithParentTab).parent;
					if (parentTabs && typeof parentTabs.selectTab === 'function') {
						parentTabs.selectTab(previousActiveLeaf);
					}
				}
			} else {
				// Find existing leaf displaying this file or open/reuse one
				const existing = this.app.workspace.getLeavesOfType('markdown').find((l) => {
					return l.view instanceof MarkdownView && l.view.file?.path === file.path;
				});

				leaf = existing ?? this.app.workspace.getLeaf(false);
				if (!existing) {
					await leaf.openFile(file, { active: true });
				}
				this.app.workspace.setActiveLeaf(leaf, { focus: true });
			}

			// Brief wait in case view is initializing
			if (!(leaf.view instanceof MarkdownView)) {
				await new Promise((resolve) => window.setTimeout(resolve, 80));
			}

			if (leaf.view instanceof MarkdownView) {
				const view = leaf.view;
				const editor = view.editor;
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

					if (swapToNewTab) {
						this.app.workspace.setActiveLeaf(leaf, { focus: true });
						editor.scrollIntoView(
							{
								from: { line: targetLine, ch: 0 },
								to: { line: targetLine, ch: lineLength },
							},
							true
						);

						// Apply accent pulse animation to the active line element
						const activeLineEl = view.containerEl.querySelector('.cm-activeLine');
						if (activeLineEl) {
							activeLineEl.classList.add('dnt-highlight-flash');
							window.setTimeout(() => {
								activeLineEl.classList.remove('dnt-highlight-flash');
							}, 2000);
						}
					} else {
						// Background tab: ensure we do NOT scrollIntoView or steal focus!
						if (previousActiveLeaf && previousActiveLeaf !== leaf) {
							this.app.workspace.setActiveLeaf(previousActiveLeaf, { focus: true });
							const parentTabs = (previousActiveLeaf as unknown as LeafWithParentTab).parent;
							if (parentTabs && typeof parentTabs.selectTab === 'function') {
								parentTabs.selectTab(previousActiveLeaf);
							}
						}
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
		taskContent: string,
		newHeaderLevel = 2,
		addCodeBlock = false
	): { content: string; insertedLine: number } {
		const formattedTask = taskContent.startsWith('- [ ]')
			? taskContent
			: `- [ ] ${taskContent}`;

		const lines = content.split('\n');
		const cleanTargetHeader = headerName.toLowerCase().replace(/[*_`#[\]@]/g, '').trim();

		// Find target header line:
		// Pass 1: exact match
		let headerLineIndex = -1;

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (!line) continue;
			const match = line.match(/^(#{1,6})\s+(.+)$/);
			if (match && match[1] && match[2]) {
				const cleanHeading = match[2].toLowerCase().replace(/[*_`#[\]@]/g, '').trim();
				if (cleanHeading === cleanTargetHeader) {
					headerLineIndex = i;
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
					const cleanHeading = match[2].toLowerCase().replace(/[*_`#[\]@]/g, '').trim();
					if (wordRegex.test(cleanHeading)) {
						headerLineIndex = i;
						break;
					}
				}
			}
		}

		// If header not found anywhere, append header and task at bottom
		if (headerLineIndex === -1) {
			const trimmedContent = content.trimEnd();
			const hashes = '#'.repeat(Math.max(1, Math.min(6, newHeaderLevel)));
			const codeBlockPart = addCodeBlock ? '```task-add\n```\n' : '';
			const newSection = `\n\n${hashes} ${headerName}\n${codeBlockPart}${formattedTask}\n`;
			const newContent = trimmedContent ? `${trimmedContent}${newSection}` : `${hashes} ${headerName}\n${codeBlockPart}${formattedTask}\n`;
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
