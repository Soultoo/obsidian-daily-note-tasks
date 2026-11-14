import { App, Editor, Modal, Notice, moment } from 'obsidian';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
	createCaptureEditorExtensions,
	getVaultNoteSuggestions,
	insertSymbolAtCursor,
} from './editor-extensions';
import { parseTaskInput } from './parser';
import { DailyNoteManager } from './daily-note-manager';
import { TemplateParser } from './template-parser';
import { ExtractedTaskBlock } from './task-ast';
import { ParsedTask, PluginSettings } from './types';

export function applyTimeToMovedTask(
	fullText: string,
	timeStr: string,
	position: string = 'prefix'
): string {
	const lines = fullText.split('\n');
	let firstLine = lines[0] || '';

	const timeRegex = /\b\d{1,2}[:.]\d{2}\b|\b\d{1,2}\s*(?:am|pm)\b/i;
	if (timeRegex.test(firstLine)) {
		firstLine = firstLine.replace(timeRegex, timeStr);
	} else {
		if (position === 'suffix') {
			firstLine = `${firstLine} ${timeStr}`;
		} else {
			if (/^\s*[-*+]\s+\[.\]\s+/.test(firstLine)) {
				firstLine = firstLine.replace(/^(\s*[-*+]\s+\[.\]\s+)/, `$1${timeStr} `);
			} else {
				firstLine = `${timeStr} ${firstLine}`;
			}
		}
	}

	lines[0] = firstLine;
	return lines.join('\n');
}

export class MoveTaskModal extends Modal {
	private editor: Editor;
	private taskBlock: ExtractedTaskBlock;
	private dailyNoteManager: DailyNoteManager;
	private templateParser: TemplateParser;
	private settings: PluginSettings;
	private onSaveSettings: () => Promise<void>;
	private editorView: EditorView | null = null;
	private dateBadgeEl!: HTMLElement;
	private headerBadgeEl!: HTMLElement;
	private currentParsed: ParsedTask | null = null;

	constructor(
		app: App,
		editor: Editor,
		taskBlock: ExtractedTaskBlock,
		dailyNoteManager: DailyNoteManager,
		templateParser: TemplateParser,
		settings: PluginSettings,
		onSaveSettings: () => Promise<void>
	) {
		super(app);
		this.editor = editor;
		this.taskBlock = taskBlock;
		this.dailyNoteManager = dailyNoteManager;
		this.templateParser = templateParser;
		this.settings = settings;
		this.onSaveSettings = onSaveSettings;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('dnt-capture-modal');
		contentEl.empty();

		const titleEl = contentEl.createDiv({ cls: 'dnt-modal-title' });
		titleEl.createEl('h3', { text: 'Move task (zero click)' });

		// Display snippet of task being moved
		const taskSnippetEl = contentEl.createDiv({ cls: 'dnt-task-snippet' });
		taskSnippetEl.createDiv({
			cls: 'dnt-task-preview-label',
			text: 'Task to move:',
		});
		const firstLine = this.taskBlock.fullText.split('\n')[0] || '';
		taskSnippetEl.createEl('code', {
			cls: 'dnt-task-code',
			text: firstLine.length > 70 ? firstLine.slice(0, 70) + '...' : firstLine,
		});

		// Quick preset date chips
		const presetsEl = contentEl.createDiv({ cls: 'dnt-presets-row' });
		this.createPresetChip(presetsEl, 'Today', 'tod');
		this.createPresetChip(presetsEl, 'Tomorrow', 'tom');
		this.createPresetChip(presetsEl, 'Next Monday', 'next monday');
		this.createPresetChip(presetsEl, 'In 1 Week', 'in 1 week');

		// Quick Sign Buttons Toolbar (/ # @)
		const toolbarEl = contentEl.createDiv({ cls: 'dnt-symbols-toolbar' });

		const addSignBtn = (
			char: string,
			label: string,
			cls: string,
			tooltip: string,
			onClick: () => void
		) => {
			const btn = toolbarEl.createEl('button', {
				cls: `dnt-symbol-btn ${cls}`,
				attr: { 'aria-label': tooltip, title: tooltip },
			});
			btn.type = 'button';
			btn.tabIndex = -1;
			btn.createSpan({ cls: 'dnt-symbol-char', text: char });
			if (label) {
				btn.createSpan({ text: ` ${label}` });
			}
			btn.addEventListener('click', (e) => {
				e.preventDefault();
				onClick();
			});
			return btn;
		};

		addSignBtn('/', 'Note', 'dnt-symbol-note', 'Target note (/)', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, '/', true);
		});

		addSignBtn('@', 'Section', 'dnt-symbol-header', 'Section header (@)', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, '@', true);
		});

		addSignBtn('#', 'Tag', 'dnt-symbol-tag', 'Tag (#)', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, '#', false);
		});

		addSignBtn('[[', 'Link', 'dnt-symbol-link', 'Note link ([[]])', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, '[[', true);
		});

		// CodeMirror 6 Editor Container
		const editorContainerEl = contentEl.createDiv({
			cls: 'dnt-editor-container',
		});

		// Target Date and Section preview badges
		const previewContainerEl = contentEl.createDiv({
			cls: 'dnt-preview-container',
		});

		this.dateBadgeEl = previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-date-badge',
		});

		this.headerBadgeEl = previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-header-badge',
		});

		const defaultTargetHeader =
			this.taskBlock.headerName || this.settings.defaultHeader;

		// Initialize CodeMirror 6 Single-Line Editor with full syntax highlighting
		const extensions = createCaptureEditorExtensions({
			getHeaders: () => this.templateParser.getHeaders(this.settings.recentHeaders),
			getVaultNotes: () => getVaultNoteSuggestions(this.app, this.settings.recentNotes),
			defaultHeader: defaultTargetHeader,
			timeFormat: this.settings.timeFormat,
			timePosition: this.settings.timePosition,
			onParsedChange: (parsed) => {
				this.currentParsed = parsed;
				this.updateBadges(parsed, defaultTargetHeader);
			},
			onSubmit: () => void this.executeMove(),
			onCancel: () => this.close(),
		});

		const initialText = 'tom';
		const state = EditorState.create({
			doc: initialText,
			extensions,
		});

		this.editorView = new EditorView({
			state,
			parent: editorContainerEl,
		});

		const initialParsed = parseTaskInput(
			initialText,
			this.templateParser.getHeaderNames(this.settings.recentHeaders),
			defaultTargetHeader
		);
		this.updateBadges(initialParsed, defaultTargetHeader);

		// Action buttons row
		const buttonsEl = contentEl.createDiv({ cls: 'dnt-button-row' });
		buttonsEl.createSpan({
			cls: 'dnt-hint-text',
			text: 'Enter to move • esc to cancel • "tod"/"tom" • @section',
		});

		const actionsEl = buttonsEl.createDiv({ cls: 'dnt-actions' });
		const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const moveBtn = actionsEl.createEl('button', {
			cls: 'mod-cta',
			text: 'Move task',
		});
		moveBtn.addEventListener('click', () => void this.executeMove());

		window.setTimeout(() => {
			if (this.editorView) {
				this.editorView.focus();
				this.editorView.dispatch({
					selection: { anchor: 0, head: this.editorView.state.doc.length },
				});
			}
		}, 30);
	}

	private createPresetChip(
		container: HTMLElement,
		label: string,
		dateInputText: string
	): void {
		const chip = container.createEl('button', {
			cls: 'dnt-chip-button',
			text: label,
		});
		chip.addEventListener('click', () => {
			if (this.editorView) {
				this.editorView.dispatch({
					changes: {
						from: 0,
						to: this.editorView.state.doc.length,
						insert: dateInputText,
					},
					selection: { anchor: dateInputText.length },
				});
				this.editorView.focus();
				void this.executeMove();
			}
		});
	}

	private updateBadges(parsed: ParsedTask, fallbackHeader: string): void {
		this.currentParsed = parsed;

		const targetDate = parsed.date || moment().add(1, 'day');
		const isToday = targetDate.isSame(moment(), 'day');
		const isTomorrow = targetDate.isSame(moment().add(1, 'day'), 'day');

		let label = targetDate.format('ddd, MMM D, YYYY');
		if (isToday) label = `Today (${targetDate.format('MMM D, YYYY')})`;
		else if (isTomorrow) label = `Tomorrow (${targetDate.format('MMM D, YYYY')})`;
		else label = targetDate.format('ddd, MMM D, YYYY');

		if (parsed.hasTime && parsed.timeStr) {
			label += ` at ${parsed.timeStr}`;
		}

		this.dateBadgeEl.setText(`📅 Move to: ${label}`);

		const header = parsed.header || fallbackHeader;
		this.headerBadgeEl.setText(`🏷️ Section: @${header}`);
	}

	private async executeMove(): Promise<void> {
		if (!this.editorView) return;

		const text = this.editorView.state.doc.toString().trim();
		const fallbackHeader = this.taskBlock.headerName || this.settings.defaultHeader;

		const parsed =
			this.currentParsed ||
			parseTaskInput(
				text,
				this.templateParser.getHeaderNames(this.settings.recentHeaders),
				fallbackHeader,
				this.settings.timeFormat,
				this.settings.timePosition
			);

		const targetDate = parsed.date || moment().add(1, 'day');
		const targetHeader = parsed.header || fallbackHeader;

		try {
			if (targetHeader) {
				const filtered = this.settings.recentHeaders.filter(
					(h) => h.toLowerCase() !== targetHeader.toLowerCase()
				);
				this.settings.recentHeaders = [targetHeader, ...filtered].slice(0, 10);
				await this.onSaveSettings();
			}

			// If user specified a time in the move dialog, apply the timestamp to the task text!
			let taskTextToMove = this.taskBlock.fullText;
			if (parsed.hasTime && parsed.timeStr) {
				taskTextToMove = applyTimeToMovedTask(
					this.taskBlock.fullText,
					parsed.timeStr,
					this.settings.timePosition
				);
			}

			// 1. Add task block to target daily note under target header
			const res = await this.dailyNoteManager.addTask(
				targetDate,
				targetHeader,
				taskTextToMove
			);

			// 2. Slice out from active editor
			const { startLine, endLine } = this.taskBlock;
			const lineCount = this.editor.lineCount();

			if (endLine + 1 < lineCount) {
				this.editor.replaceRange(
					'',
					{ line: startLine, ch: 0 },
					{ line: endLine + 1, ch: 0 }
				);
			} else if (startLine > 0) {
				const prevLineLen = this.editor.getLine(startLine - 1).length;
				this.editor.replaceRange(
					'',
					{ line: startLine - 1, ch: prevLineLen },
					{ line: endLine, ch: this.editor.getLine(endLine).length }
				);
			} else {
				this.editor.setValue('');
			}

			new Notice(
				`Moved task to ${targetDate.format('YYYY-MM-DD')} under @${targetHeader}`
			);

			if (this.settings.openNoteOnTaskAdd && res?.file) {
				await this.dailyNoteManager.openAndHighlightTask(
					res.file,
					res.line,
					taskTextToMove,
					this.settings.openNoteInNewTab,
					this.settings.swapToNewTab
				);
			}

			this.close();
		} catch (err) {
			console.error('Failed to move task:', err);
			new Notice('Failed to move task. Check console.');
		}
	}

	onClose(): void {
		if (this.editorView) {
			this.editorView.destroy();
			this.editorView = null;
		}
		this.contentEl.empty();
	}
}
