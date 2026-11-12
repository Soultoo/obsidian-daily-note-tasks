import { Editor, MarkdownFileInfo, MarkdownView, Notice, Plugin, TFile, moment } from 'obsidian';
import { getDateFromFile } from 'obsidian-daily-notes-interface';
import { DailyNoteTasksSettingTab } from './settings';
import { TaskCaptureModal } from './capture-modal';
import { MoveTaskModal } from './move-modal';
import { RecurringTasksModal } from './recurring-modal';
import { InsertButtonModal } from './insert-button-modal';
import { DailyNoteManager } from './daily-note-manager';
import { TemplateParser } from './template-parser';
import { TaskAstParser } from './task-ast';
import { RecurringManager } from './recurring-manager';
import { DEFAULT_SETTINGS, PluginSettings, RecurringBlueprint } from './types';

export default class DailyNoteTasksPlugin extends Plugin {
	settings!: PluginSettings;
	templateParser!: TemplateParser;
	dailyNoteManager!: DailyNoteManager;
	taskAstParser!: TaskAstParser;
	recurringManager!: RecurringManager;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.templateParser = new TemplateParser(this.app);
		this.dailyNoteManager = new DailyNoteManager(this.app);
		this.taskAstParser = new TaskAstParser(this.app);
		this.recurringManager = new RecurringManager(
			this.app,
			this.dailyNoteManager,
			() => this.settings.recurringBlueprints,
			async (blueprints: RecurringBlueprint[]) => {
				this.settings.recurringBlueprints = blueprints;
				await this.saveSettings();
			},
			() => this.settings.italicizeRecurringTasks !== false
		);

		this.app.workspace.onLayoutReady(async () => {
			await this.templateParser.loadHeaders();
		});

		// Listen for metadata cache updates to keep template headers updated
		this.registerEvent(
			this.app.metadataCache.on('changed', (file) => {
				if (file.name.includes('template')) {
					void this.templateParser.loadHeaders();
				}
			})
		);

		// Event listener for daily note creation: inject due recurring tasks
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					const date = getDateFromFile(file, 'day');
					if (date && date.isValid()) {
						window.setTimeout(() => {
							void (async () => {
								try {
									await this.recurringManager.injectDueTasksForDate(file, date);
								} catch (err) {
									console.error('Failed to inject recurring tasks on note create:', err);
								}
							})();
						}, 250);
					}
				}
			})
		);

		// Register code block processor for '+ Add Task' button
		const registerAddTaskBlock = (blockName: string) => {
			this.registerMarkdownCodeBlockProcessor(blockName, (source, el, ctx) => {
				el.empty();

				let targetHeader = '';
				let explicitNote = '';
				let customLabel = '';
				let explicitDate = '';

				const lines = source.split('\n');
				for (const l of lines) {
					const hMatch = l.match(/^\s*(?:header|section)\s*:\s*(.+)$/i);
					if (hMatch && hMatch[1]) {
						targetHeader = hMatch[1].trim();
					}

					const nMatch = l.match(/^\s*(?:note|file|target)\s*:\s*(.+)$/i);
					if (nMatch && nMatch[1]) {
						explicitNote = nMatch[1].trim();
					}

					const lMatch = l.match(/^\s*(?:label|button|text)\s*:\s*(.+)$/i);
					if (lMatch && lMatch[1]) {
						customLabel = lMatch[1].trim();
					}

					const dMatch = l.match(/^\s*date\s*:\s*(.+)$/i);
					if (dMatch && dMatch[1]) {
						explicitDate = dMatch[1].trim();
					}
				}

				// 1. Check enclosing header in note if not explicit
				if (!targetHeader) {
					const sectionInfo = ctx.getSectionInfo(el);
					if (sectionInfo) {
						const docLines = sectionInfo.text.split('\n');
						for (let i = sectionInfo.lineStart - 1; i >= 0; i--) {
							const line = docLines[i];
							if (!line) continue;
							const match = line.match(/^(#{1,6})\s+(.+)$/);
							if (match && match[2]) {
								targetHeader = match[2].replace(/[*_`#[\]@]/g, '').trim();
								break;
							}
						}
					}
				}

				if (!targetHeader) {
					targetHeader = this.settings.defaultHeader;
				}

				// 2. Resolve target note and date
				let isDaily = false;
				let dailyMoment: moment.Moment | null = null;
				let customNoteName = '';

				if (explicitNote) {
					const noteLower = explicitNote.toLowerCase();
					if (noteLower === 'today' || noteLower === 'tod' || noteLower === 'idag') {
						isDaily = true;
						dailyMoment = moment();
					} else if (
						noteLower === 'tomorrow' ||
						noteLower === 'tom' ||
						noteLower === 'imorgon' ||
						noteLower === 'imorn'
					) {
						isDaily = true;
						dailyMoment = moment().add(1, 'day');
					} else {
						const directMoment = moment(explicitNote, 'YYYY-MM-DD', true);
						if (directMoment.isValid()) {
							isDaily = true;
							dailyMoment = directMoment;
						} else {
							customNoteName = explicitNote.replace(/^\/+|\.md$/gi, '');
						}
					}
				} else if (explicitDate) {
					const dateLower = explicitDate.toLowerCase();
					if (dateLower === 'today' || dateLower === 'tod') {
						isDaily = true;
						dailyMoment = moment();
					} else if (dateLower === 'tomorrow' || dateLower === 'tom') {
						isDaily = true;
						dailyMoment = moment().add(1, 'day');
					} else {
						const directMoment = moment(explicitDate, 'YYYY-MM-DD', true);
						if (directMoment.isValid()) {
							isDaily = true;
							dailyMoment = directMoment;
						}
					}
				} else {
					// Fallback to current file where the code block sits
					const currentFile = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
					if (currentFile instanceof TFile) {
						const parsedDate = getDateFromFile(currentFile, 'day');
						if (parsedDate && parsedDate.isValid()) {
							isDaily = true;
							dailyMoment = parsedDate;
						} else {
							customNoteName = currentFile.basename;
						}
					}
				}

				// 3. Compute button label
				let buttonLabel = '';
				if (customLabel) {
					buttonLabel = customLabel;
				} else if (isDaily && dailyMoment) {
					buttonLabel = `+ Add Task (@${targetHeader} • ${dailyMoment.format('MMM D')})`;
				} else if (customNoteName) {
					buttonLabel = `+ Add Task (/${customNoteName} @${targetHeader})`;
				} else {
					buttonLabel = `+ Add Task (@${targetHeader})`;
				}

				const container = el.createDiv({ cls: 'dnt-add-btn-wrapper' });
				const btn = container.createEl('button', {
					cls: 'dnt-inline-add-btn',
					text: buttonLabel,
				});

				btn.addEventListener('click', (e) => {
					e.preventDefault();

					if (isDaily && dailyMoment) {
						this.openCaptureModal(`@${targetHeader} `, dailyMoment, true);
					} else if (customNoteName) {
						this.openCaptureModal(`/${customNoteName} @${targetHeader} `, null, true);
					} else {
						this.openCaptureModal(`@${targetHeader} `, null, true);
					}
				});
			});
		};

		registerAddTaskBlock('task-add');
		registerAddTaskBlock('dnt-add');

		// Ribbon icon for Quick Task Capture
		this.addRibbonIcon('check-square', 'Quick task capture (daily note tasks)', () => {
			this.openCaptureModal();
		});

		// Command 1: Quick Task Capture (NLP)
		this.addCommand({
			id: 'quick-task-capture',
			name: 'Quick task capture (nlp)',
			callback: () => {
				this.openCaptureModal();
			},
		});

		// Command 2: Move Task to Date (AST Caret Parsing with CM6 & Syntax Highlighting)
		this.addCommand({
			id: 'move-task-to-date',
			name: 'Move task to date (zero click)',
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const file = ctx.file;
				if (!file) {
					new Notice('No active file.');
					return;
				}

				const taskBlock = this.taskAstParser.extractTaskAtCursor(editor, file);
				if (!taskBlock) {
					new Notice('No task or list item found at Cursor position.');
					return;
				}

				new MoveTaskModal(
					this.app,
					editor,
					taskBlock,
					this.dailyNoteManager,
					this.templateParser,
					this.settings,
					() => this.saveSettings()
				).open();
			},
		});

		// Command 3: Manage Recurring Tasks
		this.addCommand({
			id: 'manage-recurring-tasks',
			name: 'Manage recurring tasks',
			callback: () => {
				new RecurringTasksModal(
					this.app,
					this.recurringManager,
					this.templateParser,
					this.settings.defaultHeader,
					() => this.settings.recurringBlueprints
				).open();
			},
		});

		// Command 4: Insert "+ Add Task" Button Code Block at Cursor
		this.addCommand({
			id: 'insert-add-task-button',
			name: 'Insert "+ add task" button code block',
			editorCallback: (editor: Editor, ctx: MarkdownView | MarkdownFileInfo) => {
				const cursor = editor.getCursor();
				let currentHeader = '';
				for (let i = cursor.line; i >= 0; i--) {
					const line = editor.getLine(i);
					if (!line) continue;
					const match = line.match(/^(#{1,6})\s+(.+)$/);
					if (match && match[2]) {
						currentHeader = match[2].replace(/[*_`#[\]@]/g, '').trim();
						break;
					}
				}

				const currentFile = ctx.file instanceof TFile ? ctx.file : this.app.workspace.getActiveFile();

				new InsertButtonModal(
					this.app,
					editor,
					currentFile,
					currentHeader,
					this.templateParser,
					this.settings.defaultHeader
				).open();
			},
		});

		// Add Settings tab
		this.addSettingTab(new DailyNoteTasksSettingTab(this.app, this));
	}

	onunload(): void {}

	openCaptureModal(
		initialDoc = '',
		defaultDateMoment: moment.Moment | null = null,
		fromCodeBlock = false
	): void {
		new TaskCaptureModal(
			this.app,
			this.dailyNoteManager,
			this.templateParser,
			this.recurringManager,
			this.settings,
			() => this.saveSettings(),
			initialDoc,
			defaultDateMoment,
			fromCodeBlock
				? () => this.openCaptureModal(initialDoc, defaultDateMoment, true)
				: undefined
		).open();
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<PluginSettings>
		);
		if (!this.settings.recentHeaders) {
			this.settings.recentHeaders = [];
		}
		if (!this.settings.recentNotes) {
			this.settings.recentNotes = [];
		}
		if (!this.settings.recurringBlueprints) {
			this.settings.recurringBlueprints = [];
		}
		if (!this.settings.timeFormat) {
			this.settings.timeFormat = 'HH:mm';
		}
		if (!this.settings.timePosition) {
			this.settings.timePosition = 'natural';
		}
		if (this.settings.italicizeRecurringTasks === undefined) {
			this.settings.italicizeRecurringTasks = true;
		}
		if (!this.settings.defaultCustomNoteHeader) {
			this.settings.defaultCustomNoteHeader = 'Todos';
		}
		if (this.settings.openNoteOnTaskAdd === undefined) {
			this.settings.openNoteOnTaskAdd = false;
		}
		if (this.settings.openNoteInNewTab === undefined) {
			this.settings.openNoteInNewTab = false;
		}
		if (this.settings.swapToNewTab === undefined) {
			this.settings.swapToNewTab = true;
		}
		if (this.settings.reopenCaptureOnCodeBlock === undefined) {
			this.settings.reopenCaptureOnCodeBlock = true;
		}
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
