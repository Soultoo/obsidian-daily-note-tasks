import { App, Modal, Notice, TFile, moment } from 'obsidian';
import { getAllDailyNotes, getDailyNote } from 'obsidian-daily-notes-interface';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createCaptureEditorExtensions, insertSymbolAtCursor } from './editor-extensions';
import { parseTaskInput } from './parser';
import { DailyNoteManager } from './daily-note-manager';
import { TemplateParser } from './template-parser';
import { RecurringManager, formatCursiveTask } from './recurring-manager';
import { formatRecurrenceLabel } from './recurrence-parser';
import { ParsedTask, PluginSettings, TemplateHeader, VaultNoteSuggestion } from './types';

export class TaskCaptureModal extends Modal {
	private editorView: EditorView | null = null;
	private dailyNoteManager: DailyNoteManager;
	private templateParser: TemplateParser;
	private recurringManager: RecurringManager;
	private settings: PluginSettings;
	private onSaveSettings: () => Promise<void>;
	private initialDoc: string;
	private defaultDateMoment: moment.Moment | null;
	private onReopen?: () => void;
	private previewContainerEl!: HTMLElement;
	private noteBadgeEl!: HTMLElement;
	private dateBadgeEl!: HTMLElement;
	private recurrenceBadgeEl!: HTMLElement;
	private timeBadgeEl!: HTMLElement;
	private headerBadgeEl!: HTMLElement;
	private textBadgeEl!: HTMLElement;
	private submitBtn!: HTMLButtonElement;
	private currentParsed: ParsedTask | null = null;

	constructor(
		app: App,
		dailyNoteManager: DailyNoteManager,
		templateParser: TemplateParser,
		recurringManager: RecurringManager,
		settings: PluginSettings,
		onSaveSettings: () => Promise<void>,
		initialDoc = '',
		defaultDateMoment: moment.Moment | null = null,
		onReopen?: () => void
	) {
		super(app);
		this.dailyNoteManager = dailyNoteManager;
		this.templateParser = templateParser;
		this.recurringManager = recurringManager;
		this.settings = settings;
		this.onSaveSettings = onSaveSettings;
		this.initialDoc = initialDoc;
		this.defaultDateMoment = defaultDateMoment;
		this.onReopen = onReopen;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('dnt-capture-modal');
		contentEl.empty();

		const titleEl = contentEl.createDiv({ cls: 'dnt-modal-title' });
		titleEl.createEl('h3', { text: 'Quick task capture' });

		// Quick Signs & Action Buttons Toolbar (/ # @)
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

		addSignBtn('📅', 'Today', 'dnt-symbol-date', 'Today (tod)', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, 'tod', false);
		});

		addSignBtn('🌅', 'Tomorrow', 'dnt-symbol-date', 'Tomorrow (tom)', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, 'tom', false);
		});

		addSignBtn('🔁', 'Every', 'dnt-symbol-recurrence', 'Recurrence (every X y)', () => {
			if (this.editorView) insertSymbolAtCursor(this.editorView, 'every ', false);
		});

		// CodeMirror 6 Editor Container
		const editorContainerEl = contentEl.createDiv({
			cls: 'dnt-editor-container',
		});

		// Preview & Metadata Badges Bar
		this.previewContainerEl = contentEl.createDiv({
			cls: 'dnt-preview-container',
		});

		this.noteBadgeEl = this.previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-note-badge',
		});

		this.dateBadgeEl = this.previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-date-badge',
		});

		this.recurrenceBadgeEl = this.previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-recurrence-badge',
		});

		this.timeBadgeEl = this.previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-time-badge',
		});

		this.headerBadgeEl = this.previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-header-badge',
		});

		this.textBadgeEl = this.previewContainerEl.createDiv({
			cls: 'dnt-badge dnt-text-badge',
		});

		// Action buttons row
		const buttonsEl = contentEl.createDiv({ cls: 'dnt-button-row' });
		buttonsEl.createSpan({
			cls: 'dnt-hint-text',
			text: 'Enter to save • /note • @section • "every X y" • "tod"/"tom" • #tags',
		});

		const actionsEl = buttonsEl.createDiv({ cls: 'dnt-actions' });
		const cancelBtn = actionsEl.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.submitBtn = actionsEl.createEl('button', {
			cls: 'mod-cta',
			text: 'Add task',
		});
		this.submitBtn.addEventListener('click', () => void this.submitTask());

		// Initial badge display
		const initialNoteMatch = this.initialDoc.match(/(?:^|\s)\/(?:"([^"]+)"|'([^']+)'|([^\s@#]+))/);
		const initialNote = initialNoteMatch ? (initialNoteMatch[1] || initialNoteMatch[2] || initialNoteMatch[3]) : null;
		const initialHeaders = this.getHeadersForNote(initialNote).map((h) => h.heading);

		this.updatePreviewBadges(
			parseTaskInput(
				this.initialDoc,
				initialHeaders,
				this.settings.defaultHeader,
				this.settings.timeFormat,
				this.settings.timePosition,
				this.settings.defaultCustomNoteHeader || 'Todos'
			)
		);

		// Initialize CodeMirror 6 Editor
		const extensions = createCaptureEditorExtensions({
			getHeaders: (noteName) => this.getHeadersForNote(noteName),
			getVaultNotes: () => this.getVaultNotes(),
			isHeaderExisting: (headerName, noteName) =>
				this.isHeaderExisting(headerName, noteName, this.currentParsed?.date),
			newHeaderLevel: this.settings.newHeaderLevel || 2,
			defaultHeader: this.settings.defaultHeader,
			defaultCustomNoteHeader: this.settings.defaultCustomNoteHeader || 'Todos',
			timeFormat: this.settings.timeFormat,
			timePosition: this.settings.timePosition,
			onParsedChange: (parsed) => {
				this.currentParsed = parsed;
				this.updatePreviewBadges(parsed);
			},
			onSubmit: () => void this.submitTask(),
			onCancel: () => this.close(),
		});

		const state = EditorState.create({
			doc: this.initialDoc,
			extensions,
		});

		this.editorView = new EditorView({
			state,
			parent: editorContainerEl,
		});

		window.setTimeout(() => {
			if (this.editorView) {
				this.editorView.focus();
				const len = this.editorView.state.doc.length;
				this.editorView.dispatch({
					selection: { anchor: len, head: len },
				});
			}
		}, 30);
	}

	private getHeadersForNote(targetNote?: string | null): TemplateHeader[] {
		if (!targetNote) {
			return this.templateParser.getHeaders(this.settings.recentHeaders);
		}

		const cleanName = targetNote.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
		const files = this.app.vault.getMarkdownFiles();
		const targetFile = files.find(
			(f) =>
				f.basename.toLowerCase() === cleanName ||
				f.path.toLowerCase() === cleanName
		);

		if (!targetFile) {
			return [];
		}

		const cache = this.app.metadataCache.getFileCache(targetFile);
		if (!cache || !cache.headings || cache.headings.length === 0) {
			return [];
		}

		const noteHeaders: TemplateHeader[] = cache.headings.map((h) => ({
			heading: h.heading.replace(/[*_`#[\]@]/g, '').trim(),
			level: h.level,
			fullText: `${'#'.repeat(h.level)} ${h.heading}`,
		}));

		const existingNames = new Set<string>();
		const combined: TemplateHeader[] = [];

		for (const h of noteHeaders) {
			const lower = h.heading.toLowerCase();
			if (!existingNames.has(lower)) {
				existingNames.add(lower);
				combined.push(h);
			}
		}

		return combined;
	}

	private isHeaderExisting(
		headerName: string,
		targetNote?: string | null,
		dateMoment?: moment.Moment | null
	): boolean {
		if (!headerName) return false;
		const cleanTargetHeader = headerName.toLowerCase().replace(/[*_`#[\]@]/g, '').trim();
		if (!cleanTargetHeader) return false;

		if (targetNote) {
			const cleanName = targetNote.replace(/^\/+|\/+$/g, '').trim().toLowerCase();
			const files = this.app.vault.getMarkdownFiles();
			const targetFile = files.find(
				(f) =>
					f.basename.toLowerCase() === cleanName ||
					f.path.toLowerCase() === cleanName
			);
			if (!targetFile) return false;

			const cache = this.app.metadataCache.getFileCache(targetFile);
			if (!cache || !cache.headings) return false;

			return cache.headings.some(
				(h) => h.heading.toLowerCase().replace(/[*_`#[\]@]/g, '').trim() === cleanTargetHeader
			);
		}

		// Daily note target:
		// Check 1: Does daily note for this date already exist in vault with this header?
		let dailyFile: TFile | null = null;
		try {
			const allDailyNotes = getAllDailyNotes();
			const targetDate = dateMoment || this.defaultDateMoment || moment();
			dailyFile = getDailyNote(targetDate, allDailyNotes);
		} catch {
			dailyFile = null;
		}

		if (dailyFile) {
			const cache = this.app.metadataCache.getFileCache(dailyFile);
			if (cache && cache.headings) {
				const inDailyNote = cache.headings.some(
					(h) => h.heading.toLowerCase().replace(/[*_`#[\]@]/g, '').trim() === cleanTargetHeader
				);
				if (inDailyNote) return true;
			}
		}

		// Check 2: Does daily note template contain this header?
		const templateHeaders = this.templateParser.getHeaderNames().map((h) =>
			h.toLowerCase().replace(/[*_`#[\]@]/g, '').trim()
		);
		return templateHeaders.includes(cleanTargetHeader);
	}

	private getVaultNotes(): VaultNoteSuggestion[] {
		const recents = this.settings.recentNotes || [];
		const files = this.app.vault.getMarkdownFiles();

		const fileMap = new Map<string, TFile>();
		for (const file of files) {
			fileMap.set(file.basename.toLowerCase(), file);
		}

		const recentSuggestions: VaultNoteSuggestion[] = [];
		const seen = new Set<string>();

		// 1. Valid recent notes first (in order of recency)
		for (const recentName of recents) {
			const lower = recentName.toLowerCase();
			const file = fileMap.get(lower);
			if (file && !seen.has(lower)) {
				seen.add(lower);
				recentSuggestions.push({
					name: file.basename,
					path: file.path,
					isRecent: true,
				});
			}
		}

		// 2. Remaining vault notes, sorted alphabetically (case-insensitive)
		const otherSuggestions: VaultNoteSuggestion[] = [];
		for (const file of files) {
			const lower = file.basename.toLowerCase();
			if (!seen.has(lower)) {
				seen.add(lower);
				otherSuggestions.push({
					name: file.basename,
					path: file.path,
					isRecent: false,
				});
			}
		}
		otherSuggestions.sort((a, b) =>
			a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
		);

		return [...recentSuggestions, ...otherSuggestions];
	}

	private updatePreviewBadges(parsed: ParsedTask): void {
		this.currentParsed = parsed;

		// 1. Target Note badge
		const hasTargetNote = Boolean(parsed.targetNote);
		this.noteBadgeEl.classList.toggle('dnt-hidden', !hasTargetNote);
		if (parsed.targetNote) {
			this.noteBadgeEl.setText(`📝 /${parsed.targetNote}`);
		}

		// 2. Recurrence vs One-off Date
		if (parsed.recurrence) {
			this.dateBadgeEl.classList.add('dnt-hidden');
			this.recurrenceBadgeEl.classList.remove('dnt-hidden');
			this.recurrenceBadgeEl.setText(`🔁 ${formatRecurrenceLabel(parsed.recurrence)}`);
			if (this.submitBtn) this.submitBtn.setText('Add recurring task');
		} else {
			this.recurrenceBadgeEl.classList.add('dnt-hidden');

			// If target note is specified, date badge is optional, but if date was parsed show it
			const hideDate = Boolean(parsed.targetNote && !parsed.date);
			this.dateBadgeEl.classList.toggle('dnt-hidden', hideDate);
			if (!hideDate) {
				const targetDate = parsed.date || this.defaultDateMoment || moment();
				const isToday = targetDate.isSame(moment(), 'day');
				const isTomorrow = targetDate.isSame(moment().add(1, 'day'), 'day');

				let dateLabel = targetDate.format('ddd, MMM D, YYYY');
				if (isToday) dateLabel = `Today (${targetDate.format('MMM D, YYYY')})`;
				else if (isTomorrow) dateLabel = `Tomorrow (${targetDate.format('MMM D, YYYY')})`;
				else dateLabel = targetDate.format('ddd, MMM D, YYYY');

				this.dateBadgeEl.setText(`📅 ${dateLabel}`);
			}

			if (this.submitBtn) this.submitBtn.setText('Add task');
		}

		// 3. Time badge
		const showTime = Boolean(parsed.hasTime && parsed.timeStr);
		this.timeBadgeEl.classList.toggle('dnt-hidden', !showTime);
		if (showTime && parsed.timeStr) {
			this.timeBadgeEl.setText(`⏰ ${parsed.timeStr}`);
		}

		// 4. Header badge
		const headerLabel =
			parsed.header ||
			(parsed.targetNote
				? this.settings.defaultCustomNoteHeader || 'Todos'
				: this.settings.defaultHeader);
		const exists = this.isHeaderExisting(headerLabel, parsed.targetNote, parsed.date);
		const hashes = '#'.repeat(Math.max(1, Math.min(6, this.settings.newHeaderLevel || 2)));

		if (!exists && headerLabel) {
			this.headerBadgeEl.setText(
				`🏷️ @${headerLabel} ✨ (will create ${hashes} ${headerLabel})`
			);
			this.headerBadgeEl.addClass('dnt-badge-new-header');
		} else {
			this.headerBadgeEl.setText(`🏷️ @${headerLabel}`);
			this.headerBadgeEl.removeClass('dnt-badge-new-header');
		}

		// 5. Clean task text result preview
		const taskContent = parsed.finalTaskText || parsed.cleanText;
		let previewContent = taskContent;
		if (parsed.recurrence && this.settings.italicizeRecurringTasks && taskContent) {
			previewContent = formatCursiveTask(taskContent);
		}

		const previewText = previewContent ? `- [ ] ${previewContent}` : 'Type task...';
		this.textBadgeEl.setText(previewText);
	}

	private async submitTask(): Promise<void> {
		if (!this.editorView) return;

		const currentText = this.editorView.state.doc.toString().trim();
		const prefix = this.initialDoc ? this.initialDoc.trim() : '';
		const effectiveTask = prefix ? currentText.replace(prefix, '').trim() : currentText;

		if (!currentText || !effectiveTask) {
			if (this.onReopen) {
				// Finished sequential entry from codeblock button
				this.close();
				return;
			}
			new Notice('Please enter a task description.');
			return;
		}

		const noteMatch = currentText.match(/(?:^|\s)\/(?:"([^"]+)"|'([^']+)'|([^\s@#]+))/);
		const noteName = noteMatch ? (noteMatch[1] || noteMatch[2] || noteMatch[3]) : null;
		const submitHeaders = this.getHeadersForNote(noteName).map((h) => h.heading);

		const parsed =
			this.currentParsed ||
			parseTaskInput(
				currentText,
				submitHeaders,
				this.settings.defaultHeader,
				this.settings.timeFormat,
				this.settings.timePosition,
				this.settings.defaultCustomNoteHeader || 'Todos'
			);

		const taskTextToInsert = parsed.finalTaskText || parsed.cleanText;
		if (!taskTextToInsert) {
			if (this.onReopen) {
				this.close();
				return;
			}
			new Notice('Task content cannot be empty.');
			return;
		}

		try {
			// If target note is specified (e.g. /groceries)
			if (parsed.targetNote) {
				const targetNoteName = parsed.targetNote;
				const header = parsed.header || this.settings.defaultCustomNoteHeader || 'Todos';

				// Track recent note
				const filteredNotes = (this.settings.recentNotes || []).filter(
					(n) => n.toLowerCase() !== targetNoteName.toLowerCase()
				);
				this.settings.recentNotes = [targetNoteName, ...filteredNotes].slice(0, 10);
				await this.onSaveSettings();

				const res = await this.dailyNoteManager.addTaskToNote(
					targetNoteName,
					header,
					taskTextToInsert
				);

				new Notice(`Added task to /${targetNoteName} under @${header}`);

				if (this.settings.openNoteOnTaskAdd && res?.file) {
					await this.dailyNoteManager.openAndHighlightTask(
						res.file,
						res.line,
						taskTextToInsert,
						this.settings.openNoteInNewTab,
						this.settings.swapToNewTab
					);
				}

				this.close();
				if (this.onReopen && this.settings.reopenCaptureOnCodeBlock !== false) {
					window.setTimeout(() => {
						this.onReopen?.();
					}, 120);
				}
				return;
			}

			const targetHeader = parsed.header || this.settings.defaultHeader;

			// Track recent headers
			if (targetHeader) {
				const filtered = this.settings.recentHeaders.filter(
					(h) => h.toLowerCase() !== targetHeader.toLowerCase()
				);
				this.settings.recentHeaders = [targetHeader, ...filtered].slice(0, 10);
				await this.onSaveSettings();
			}

			// If recurrence rule is present, register as recurring blueprint
			if (parsed.recurrence) {
				const res = await this.recurringManager.addBlueprint({
					name: taskTextToInsert,
					header: targetHeader,
					rule: parsed.recurrence,
				});

				new Notice(
					`Registered recurring task: "${taskTextToInsert}" (${formatRecurrenceLabel(parsed.recurrence)}). Injected into ${res.injectedCount} daily note(s).`
				);

				if (this.settings.openNoteOnTaskAdd && res?.todayFile) {
					await this.dailyNoteManager.openAndHighlightTask(
						res.todayFile,
						res.todayLine ?? 0,
						taskTextToInsert,
						this.settings.openNoteInNewTab,
						this.settings.swapToNewTab
					);
				}

				this.close();
				if (this.onReopen && this.settings.reopenCaptureOnCodeBlock !== false) {
					window.setTimeout(() => {
						this.onReopen?.();
					}, 120);
				}
				return;
			}

			// Standard Daily Note task
			const targetDate = parsed.date || this.defaultDateMoment || moment();
			const res = await this.dailyNoteManager.addTask(
				targetDate,
				targetHeader,
				taskTextToInsert
			);

			new Notice(`Added task to ${targetDate.format('YYYY-MM-DD')} under @${targetHeader}`);

			if (this.settings.openNoteOnTaskAdd && res?.file) {
				await this.dailyNoteManager.openAndHighlightTask(
					res.file,
					res.line,
					taskTextToInsert,
					this.settings.openNoteInNewTab,
					this.settings.swapToNewTab
				);
			}

			this.close();
			if (this.onReopen && this.settings.reopenCaptureOnCodeBlock !== false) {
				window.setTimeout(() => {
					this.onReopen?.();
				}, 120);
			}
		} catch (err) {
			console.error('Failed to add task:', err);
			new Notice('Failed to add task. Check console.');
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
