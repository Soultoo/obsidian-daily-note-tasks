import { App, Modal, Notice, Setting } from 'obsidian';
import { RecurringManager, formatCursiveTask } from './recurring-manager';
import { RecurringBlueprint } from './types';
import { formatRecurrenceLabel, parseRecurrenceFromText } from './recurrence-parser';
import { TemplateParser } from './template-parser';

export class RecurringTasksModal extends Modal {
	private recurringManager: RecurringManager;
	private templateParser: TemplateParser;
	private defaultHeader: string;
	private getBlueprints: () => RecurringBlueprint[];

	constructor(
		app: App,
		recurringManager: RecurringManager,
		templateParser: TemplateParser,
		defaultHeader: string,
		getBlueprints: () => RecurringBlueprint[]
	) {
		super(app);
		this.recurringManager = recurringManager;
		this.templateParser = templateParser;
		this.defaultHeader = defaultHeader;
		this.getBlueprints = getBlueprints;
	}

	onOpen(): void {
		this.render();
	}

	private render(): void {
		const { contentEl, modalEl } = this;
		modalEl.addClass('dnt-capture-modal');
		contentEl.empty();

		const titleEl = contentEl.createDiv({ cls: 'dnt-modal-title' });
		titleEl.createEl('h3', { text: 'Recurring task blueprints' });

		// Add new recurring task form
		const formContainer = contentEl.createDiv({ cls: 'dnt-recurring-form' });
		formContainer.createEl('h4', { text: 'Add new recurring task' });

		let taskName = '';
		let targetHeader = this.defaultHeader;
		let recurrencePattern = 'every day';

		new Setting(formContainer)
			.setName('Task description')
			.addText((text) =>
				text
					.setPlaceholder('E.g. Water plants, dagbok!')
					.onChange((val) => (taskName = val.trim()))
			);

		const headerNames = this.templateParser.getHeaderNames();
		new Setting(formContainer)
			.setName('Target header')
			.addDropdown((dropdown) => {
				for (const h of headerNames) {
					dropdown.addOption(h, h);
				}
				dropdown.setValue(targetHeader).onChange((val) => (targetHeader = val));
			});

		new Setting(formContainer)
			.setName('Recurrence rule (every X y)')
			.setDesc('E.g. "every day", "every 2 days", "every weekday", "every 3 weeks on friday"')
			.addText((text) => {
				text
					.setPlaceholder('Every 2 days')
					.setValue(recurrencePattern)
					.onChange((val) => (recurrencePattern = val.trim()));
			});

		new Setting(formContainer).addButton((btn) => {
			btn
				.setButtonText('Add blueprint & inject')
				.setCta()
				.onClick(async () => {
					if (!taskName) {
						new Notice('Please provide a task description.');
						return;
					}

					const parsedRec = parseRecurrenceFromText(recurrencePattern);
					if (!parsedRec.rule) {
						new Notice('Could not understand recurrence pattern. Try "every 2 days" or "every weekday".');
						return;
					}

					const res = await this.recurringManager.addBlueprint({
						name: taskName,
						header: targetHeader,
						rule: parsedRec.rule,
					});

					new Notice(
						`Added recurring blueprint "${taskName}" (${formatRecurrenceLabel(parsedRec.rule)}). Injected into ${res.injectedCount} daily note(s).`
					);
					this.render();
				});
		});

		// Existing blueprints list
		const listContainer = contentEl.createDiv({ cls: 'dnt-recurring-list' });
		listContainer.createEl('h4', { text: 'Active blueprints' });

		const blueprints = this.getBlueprints();
		if (blueprints.length === 0) {
			listContainer.createEl('p', {
				cls: 'dnt-hint-text',
				text: 'No recurring blueprints registered yet. Add one above or via nlp capture!',
			});
			return;
		}

		for (const bp of blueprints) {
			const label = formatRecurrenceLabel(bp.rule);
			const cursivePreview = formatCursiveTask(bp.name);

			const itemSetting = new Setting(listContainer)
				.setName(`- [ ] ${cursivePreview}`)
				.setDesc(`Section: @${bp.header} • Schedule: ${label}`);

			itemSetting.addButton((btn) => {
				btn
					.setButtonText('Delete & sweep future')
					.setClass('mod-warning')
					.onClick(async () => {
						const res = await this.recurringManager.cancelBlueprint(bp.id);
						new Notice(
							`Removed "${bp.name}". Swept and deleted ${res.removedCount} future orphaned instance(s).`
						);
						this.render();
					});
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
