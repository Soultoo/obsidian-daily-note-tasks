import { App, Editor, Modal, Notice, Setting, TFile, moment } from 'obsidian';
import { getDateFromFile } from 'obsidian-daily-notes-interface';
import { TemplateParser } from './template-parser';

export class InsertButtonModal extends Modal {
	private editor: Editor;
	private currentFile: TFile | null;
	private currentHeader: string;
	private templateParser: TemplateParser;
	private defaultHeader: string;

	private targetNoteInput = '';
	private targetHeaderInput = '';
	private customLabelInput = '';

	private previewBtnEl!: HTMLButtonElement;
	private previewCodeEl!: HTMLElement;

	constructor(
		app: App,
		editor: Editor,
		currentFile: TFile | null,
		currentHeader: string,
		templateParser: TemplateParser,
		defaultHeader: string
	) {
		super(app);
		this.editor = editor;
		this.currentFile = currentFile;
		this.currentHeader = currentHeader;
		this.templateParser = templateParser;
		this.defaultHeader = defaultHeader;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('dnt-insert-button-modal');
		contentEl.empty();

		contentEl.createEl('h3', { text: 'Insert "+ add task" button code block' });

		const currentNoteName = this.currentFile?.basename || 'Current Note';
		const fallbackHeader = this.currentHeader || this.defaultHeader || 'Todos';

		// Datalist for vault notes
		const noteListId = 'dnt-note-suggestions';
		const noteDatalist = contentEl.createEl('datalist', { attr: { id: noteListId } });
		noteDatalist.createEl('option', { attr: { value: 'today' }, text: "Today's daily note" });
		noteDatalist.createEl('option', { attr: { value: 'tomorrow' }, text: "Tomorrow's daily note" });
		for (const f of this.app.vault.getMarkdownFiles()) {
			noteDatalist.createEl('option', { attr: { value: f.basename } });
		}

		// 1. Target Note Setting
		let noteInputEl: HTMLInputElement;
		new Setting(contentEl)
			.setName('Target note')
			.setDesc(`Where tasks will be added. Leave empty for this note (${currentNoteName}).`)
			.addText((text) => {
				noteInputEl = text.inputEl;
				text.inputEl.setAttribute('list', noteListId);
				text.setPlaceholder(`This note (${currentNoteName})`);
				text.onChange((val) => {
					this.targetNoteInput = val.trim();
					this.updatePreview();
				});
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.submitAndInsert();
					}
				});
			});

		// Quick chips for Target Note
		const noteChipsContainer = contentEl.createDiv({ cls: 'dnt-chips-container' });
		const addNoteChip = (label: string, value: string) => {
			const chip = noteChipsContainer.createEl('button', {
				cls: 'dnt-chip-btn',
				text: label,
			});
			chip.addEventListener('click', (e) => {
				e.preventDefault();
				this.targetNoteInput = value;
				if (noteInputEl) noteInputEl.value = value;
				this.updatePreview();
			});
		};

		const noteBtn = noteChipsContainer.createEl('button', {
			cls: 'dnt-symbol-btn dnt-symbol-note',
			attr: { title: 'Target note (/)' },
		});
		noteBtn.createSpan({ cls: 'dnt-symbol-char', text: '/' });
		noteBtn.createSpan({ text: ' Note' });
		noteBtn.addEventListener('click', (e) => {
			e.preventDefault();
			if (noteInputEl) noteInputEl.focus();
		});

		addNoteChip(`📍 This note (${currentNoteName})`, '');
		addNoteChip(`📅 Today's note`, 'today');
		addNoteChip(`🌅 Tomorrow's note`, 'tomorrow');

		// Datalist for template and note headers
		const headerListId = 'dnt-header-suggestions';
		const headerDatalist = contentEl.createEl('datalist', { attr: { id: headerListId } });
		const templateHeaders = this.templateParser.getHeaderNames();
		for (const h of templateHeaders) {
			headerDatalist.createEl('option', { attr: { value: h } });
		}

		// 2. Target Section / Header Setting
		let headerInputEl: HTMLInputElement;
		new Setting(contentEl)
			.setName('Target section / header')
			.setDesc(`The heading to insert tasks under. Leave empty for current heading (${fallbackHeader}).`)
			.addText((text) => {
				headerInputEl = text.inputEl;
				text.inputEl.setAttribute('list', headerListId);
				text.setPlaceholder(`Current heading (${fallbackHeader})`);
				text.onChange((val) => {
					this.targetHeaderInput = val.trim();
					this.updatePreview();
				});
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.submitAndInsert();
					}
				});
			});

		// Quick chips for Target Header
		const headerChipsContainer = contentEl.createDiv({ cls: 'dnt-chips-container' });
		const addHeaderChip = (label: string, value: string) => {
			const chip = headerChipsContainer.createEl('button', {
				cls: 'dnt-chip-btn',
				text: label,
			});
			chip.addEventListener('click', (e) => {
				e.preventDefault();
				this.targetHeaderInput = value;
				if (headerInputEl) headerInputEl.value = value;
				this.updatePreview();
			});
		};

		const headerBtn = headerChipsContainer.createEl('button', {
			cls: 'dnt-symbol-btn dnt-symbol-header',
			attr: { title: 'Section header (@)' },
		});
		headerBtn.createSpan({ cls: 'dnt-symbol-char', text: '@' });
		headerBtn.createSpan({ text: ' Header' });
		headerBtn.addEventListener('click', (e) => {
			e.preventDefault();
			if (headerInputEl) headerInputEl.focus();
		});

		if (this.currentHeader) {
			addHeaderChip(`📍 Current (@${this.currentHeader})`, '');
		}
		const uniqueHeaders = Array.from(new Set(['Written plan', 'Todos', '2 minute stuff', '20 minute stuff', ...templateHeaders])).slice(0, 5);
		for (const h of uniqueHeaders) {
			if (h !== this.currentHeader) {
				addHeaderChip(`@${h}`, h);
			}
		}

		// 3. Custom Button Label (Optional)
		new Setting(contentEl)
			.setName('Custom button label')
			.setDesc('Optional custom text on the button (e.g. "+ add to groceries"). Leave empty for auto.')
			.addText((text) => {
				text.setPlaceholder('Auto-generated from note and header');
				text.onChange((val) => {
					this.customLabelInput = val.trim();
					this.updatePreview();
				});
				text.inputEl.addEventListener('keydown', (e) => {
					if (e.key === 'Enter') {
						e.preventDefault();
						this.submitAndInsert();
					}
				});
			});

		// 4. Live Preview Section
		const previewBox = contentEl.createDiv({ cls: 'dnt-preview-box' });
		previewBox.createDiv({ cls: 'dnt-preview-title', text: 'Live button & code block preview:' });

		const previewBtnWrapper = previewBox.createDiv({ cls: 'dnt-add-btn-wrapper' });
		this.previewBtnEl = previewBtnWrapper.createEl('button', {
			cls: 'dnt-inline-add-btn',
			text: '+ add task',
		});
		this.previewBtnEl.disabled = true;

		this.previewCodeEl = previewBox.createEl('pre', { cls: 'dnt-preview-code' });

		// Initial preview render
		this.updatePreview();

		// Action Buttons
		const actionRow = contentEl.createDiv({ cls: 'dnt-button-row' });
		actionRow.createSpan({ cls: 'dnt-hint-text', text: 'Press Enter to insert • Esc to cancel' });

		const actions = actionRow.createDiv({ cls: 'dnt-actions' });
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const insertBtn = actions.createEl('button', {
			cls: 'mod-cta',
			text: 'Insert button',
		});
		insertBtn.addEventListener('click', () => this.submitAndInsert());

		// Auto-focus the first input
		window.setTimeout(() => {
			if (noteInputEl) noteInputEl.focus();
		}, 40);
	}

	private updatePreview(): void {
		const effectiveHeader = this.targetHeaderInput || this.currentHeader || this.defaultHeader || 'Todos';
		const note = this.targetNoteInput;

		let computedLabel = '';
		if (this.customLabelInput) {
			computedLabel = this.customLabelInput;
		} else if (note.toLowerCase() === 'today') {
			computedLabel = `+ Add Task (@${effectiveHeader} • Today)`;
		} else if (note.toLowerCase() === 'tomorrow') {
			computedLabel = `+ Add Task (@${effectiveHeader} • Tomorrow)`;
		} else if (note) {
			computedLabel = `+ Add Task (/${note} @${effectiveHeader})`;
		} else {
			// Current file context
			let isDaily = false;
			let dailyMoment: moment.Moment | null = null;
			let customNoteName = '';

			if (this.currentFile instanceof TFile) {
				const parsedDate = getDateFromFile(this.currentFile, 'day');
				if (parsedDate && parsedDate.isValid()) {
					isDaily = true;
					dailyMoment = parsedDate;
				} else {
					customNoteName = this.currentFile.basename;
				}
			}

			if (isDaily && dailyMoment) {
				computedLabel = `+ Add Task (@${effectiveHeader} • ${dailyMoment.format('MMM D')})`;
			} else if (customNoteName) {
				computedLabel = `+ Add Task (/${customNoteName} @${effectiveHeader})`;
			} else {
				computedLabel = `+ Add Task (@${effectiveHeader})`;
			}
		}

		if (this.previewBtnEl) {
			this.previewBtnEl.setText(computedLabel);
		}

		// Compute generated code block text
		const codeBlock = this.generateCodeBlockText();
		if (this.previewCodeEl) {
			this.previewCodeEl.setText(codeBlock);
		}
	}

	private generateCodeBlockText(): string {
		const lines = ['```task-add'];

		if (this.targetNoteInput) {
			lines.push(`note: ${this.targetNoteInput}`);
		}

		if (this.targetHeaderInput) {
			lines.push(`header: ${this.targetHeaderInput}`);
		}

		if (this.customLabelInput) {
			lines.push(`label: ${this.customLabelInput}`);
		}

		lines.push('```');
		return lines.join('\n');
	}

	private submitAndInsert(): void {
		const codeBlockText = `${this.generateCodeBlockText()}\n`;
		const cursor = this.editor.getCursor();

		this.editor.replaceRange(codeBlockText, cursor);

		// Place cursor cleanly below the inserted code block
		const lineDelta = codeBlockText.split('\n').length - 1;
		this.editor.setCursor({
			line: cursor.line + lineDelta,
			ch: 0,
		});

		new Notice('Inserted "+ add task" button code block.');
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
