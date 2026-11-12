import { App, PluginSettingTab, Setting } from 'obsidian';
import type DailyNoteTasksPlugin from './main';
import { RecurringTasksModal } from './recurring-modal';

export class DailyNoteTasksSettingTab extends PluginSettingTab {
	plugin: DailyNoteTasksPlugin;

	constructor(app: App, plugin: DailyNoteTasksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl('h2', { text: 'Daily Note Tasks Settings' });

		// Default Section Header (Daily Notes)
		const headerNames = this.plugin.templateParser.getHeaderNames();

		new Setting(containerEl)
			.setName('Default Daily Note Section Header')
			.setDesc('Tasks without a specified @section will be added under this header in Daily Notes.')
			.addDropdown((dropdown) => {
				for (const header of headerNames) {
					dropdown.addOption(header, header);
				}
				if (!headerNames.includes(this.plugin.settings.defaultHeader)) {
					dropdown.addOption(
						this.plugin.settings.defaultHeader,
						this.plugin.settings.defaultHeader
					);
				}
				dropdown
					.setValue(this.plugin.settings.defaultHeader)
					.onChange(async (value) => {
						this.plugin.settings.defaultHeader = value;
						await this.plugin.saveSettings();
					});
			})
			.addText((text) => {
				text
					.setPlaceholder('Or type custom header...')
					.setValue(this.plugin.settings.defaultHeader)
					.onChange(async (value) => {
						if (value.trim()) {
							this.plugin.settings.defaultHeader = value.trim();
							await this.plugin.saveSettings();
						}
					});
			});

		// Default Section Header (Custom Notes e.g. /groceries)
		new Setting(containerEl)
			.setName('Default Custom Note Header')
			.setDesc('Header used when targeting a custom note (/note) without a specified @section (e.g. "Todos" creates "## Todos").')
			.addText((text) => {
				text
					.setPlaceholder('Todos')
					.setValue(this.plugin.settings.defaultCustomNoteHeader || 'Todos')
					.onChange(async (value) => {
						this.plugin.settings.defaultCustomNoteHeader = value.trim() || 'Todos';
						await this.plugin.saveSettings();
					});
			});

		// Time Options
		containerEl.createEl('h3', { text: 'Time Formatting' });

		new Setting(containerEl)
			.setName('Time Format')
			.setDesc('Format used when a natural language time is typed (e.g. "HH:mm" for 17:00 or "h:mm a" for 5:00 PM).')
			.addText((text) =>
				text
					.setPlaceholder('HH:mm')
					.setValue(this.plugin.settings.timeFormat || 'HH:mm')
					.onChange(async (value) => {
						this.plugin.settings.timeFormat = value.trim() || 'HH:mm';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Time Placement')
			.setDesc('Where parsed times should be placed in the task bullet.')
			.addDropdown((dropdown) => {
				dropdown
					.addOption('natural', 'Natural: keep where typed in sentence')
					.addOption('prefix', 'Prefix: - [ ] 17:00 Buy groceries')
					.addOption('suffix', 'Suffix: - [ ] Buy groceries 17:00')
					.setValue(this.plugin.settings.timePosition || 'natural')
					.onChange(async (value) => {
						this.plugin.settings.timePosition = value as 'natural' | 'prefix' | 'suffix';
						await this.plugin.saveSettings();
					});
			});

		// Capture Behavior
		containerEl.createEl('h3', { text: 'Capture Behavior' });

		let inNewTabSetting: Setting;
		let swapToNewTabSetting: Setting;

		const updateSubSettingsVisibility = () => {
			const isOpenNote = this.plugin.settings.openNoteOnTaskAdd === true;
			const isInNewTab = this.plugin.settings.openNoteInNewTab === true;

			if (inNewTabSetting) {
				inNewTabSetting.settingEl.style.display = isOpenNote ? '' : 'none';
			}
			if (swapToNewTabSetting) {
				swapToNewTabSetting.settingEl.style.display =
					isOpenNote && isInNewTab ? '' : 'none';
			}
		};

		new Setting(containerEl)
			.setName('Open Note on Task Add')
			.setDesc('Automatically open the target note and highlight (select) the newly added task.')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.openNoteOnTaskAdd === true)
					.onChange(async (value) => {
						this.plugin.settings.openNoteOnTaskAdd = value;
						await this.plugin.saveSettings();
						updateSubSettingsVisibility();
					});
			});

		inNewTabSetting = new Setting(containerEl)
			.setName('In new tab')
			.setDesc('Open the note in a new tab instead of the current active tab.')
			.setClass('dnt-sub-setting')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.openNoteInNewTab === true)
					.onChange(async (value) => {
						this.plugin.settings.openNoteInNewTab = value;
						await this.plugin.saveSettings();
						updateSubSettingsVisibility();
					});
			});

		swapToNewTabSetting = new Setting(containerEl)
			.setName('Swap to new tab')
			.setDesc('Automatically focus and switch to the newly opened tab.')
			.setClass('dnt-sub-setting-indent')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.swapToNewTab !== false)
					.onChange(async (value) => {
						this.plugin.settings.swapToNewTab = value;
						await this.plugin.saveSettings();
					});
			});

		updateSubSettingsVisibility();

		new Setting(containerEl)
			.setName('Reopen Capture for Code Block Button')
			.setDesc(
				'When adding a task via an inline "+ Add Task" code block button, automatically reopen the capture pane after adding each task to allow rapid sequential task entry.'
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.reopenCaptureOnCodeBlock !== false)
					.onChange(async (value) => {
						this.plugin.settings.reopenCaptureOnCodeBlock = value;
						await this.plugin.saveSettings();
					});
			});

		// Recurring Tasks
		containerEl.createEl('h3', { text: 'Recurring Tasks' });

		new Setting(containerEl)
			.setName('Italicize Recurring Tasks')
			.setDesc('Format recurring tasks in italics (cursive), matching vault template style (e.g. - [ ] *Task name*).')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.italicizeRecurringTasks !== false)
					.onChange(async (value) => {
						this.plugin.settings.italicizeRecurringTasks = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Manage Recurring Tasks')
			.setDesc(
				`Manage active recurring blueprints (${this.plugin.settings.recurringBlueprints.length} active). Injects tasks when daily notes are created and sweeps future notes upon cancellation.`
			)
			.addButton((button) => {
				button.setButtonText('Open Manager').onClick(() => {
					new RecurringTasksModal(
						this.app,
						this.plugin.recurringManager,
						this.plugin.templateParser,
						this.plugin.settings.defaultHeader,
						() => this.plugin.settings.recurringBlueprints
					).open();
				});
			});

		// Recent Sections & Notes
		containerEl.createEl('h3', { text: 'Autocomplete & Recents' });

		const recentsCount = this.plugin.settings.recentHeaders.length;
		new Setting(containerEl)
			.setName('Recent Sections (@)')
			.setDesc(
				recentsCount > 0
					? `Recently used: ${this.plugin.settings.recentHeaders.join(', ')}`
					: 'No recent sections recorded yet.'
			)
			.addButton((button) => {
				button.setButtonText('Clear Recent Sections').onClick(async () => {
					this.plugin.settings.recentHeaders = [];
					await this.plugin.saveSettings();
					this.display();
				});
			});

		const recentNotesCount = (this.plugin.settings.recentNotes || []).length;
		new Setting(containerEl)
			.setName('Recent Target Notes (/)')
			.setDesc(
				recentNotesCount > 0
					? `Recently used: ${this.plugin.settings.recentNotes.join(', ')}`
					: 'No recent target notes recorded yet.'
			)
			.addButton((button) => {
				button.setButtonText('Clear Recent Notes').onClick(async () => {
					this.plugin.settings.recentNotes = [];
					await this.plugin.saveSettings();
					this.display();
				});
			});

		new Setting(containerEl)
			.setName('Reload Template Headers')
			.setDesc('Re-scans the Daily Note Template file to update available section headers.')
			.addButton((button) => {
				button.setButtonText('Reload Headers').onClick(async () => {
					await this.plugin.templateParser.loadHeaders();
					this.display();
				});
			});
	}

	/**
	 * Declarative settings definitions used by Obsidian v1.13+ settings search indexing.
	 * Exposes all settings titles, descriptions, and controls directly to Obsidian's native search bar.
	 */
	getSettingDefinitions(): any[] {
		const headerNames = this.plugin.templateParser.getHeaderNames();
		const headerOptions: Record<string, string> = {};
		for (const h of headerNames) {
			headerOptions[h] = h;
		}
		if (!headerOptions[this.plugin.settings.defaultHeader]) {
			headerOptions[this.plugin.settings.defaultHeader] = this.plugin.settings.defaultHeader;
		}

		return [
			{
				type: 'heading',
				name: 'Sections & Templates',
			},
			{
				name: 'Default Daily Note Section Header',
				desc: 'Tasks without a specified @section will be added under this header in Daily Notes.',
				control: {
					type: 'dropdown',
					key: 'defaultHeader',
					options: headerOptions,
				},
			},
			{
				name: 'Default Custom Note Header',
				desc: 'Header used when targeting a custom note (/note) without a specified @section (e.g. "Todos" creates "## Todos").',
				control: {
					type: 'text',
					key: 'defaultCustomNoteHeader',
					placeholder: 'Todos',
				},
			},
			{
				type: 'heading',
				name: 'Time Formatting',
			},
			{
				name: 'Time Format',
				desc: 'Format used when a natural language time is typed (e.g. "HH:mm" for 17:00 or "h:mm a" for 5:00 PM).',
				control: {
					type: 'text',
					key: 'timeFormat',
					placeholder: 'HH:mm',
				},
			},
			{
				name: 'Time Placement',
				desc: 'Where parsed times should be placed in the task bullet.',
				control: {
					type: 'dropdown',
					key: 'timePosition',
					options: {
						natural: 'Natural: keep where typed in sentence',
						prefix: 'Prefix: - [ ] 17:00 Buy groceries',
						suffix: 'Suffix: - [ ] Buy groceries 17:00',
					},
				},
			},
			{
				type: 'heading',
				name: 'Capture Behavior',
			},
			{
				name: 'Open Note on Task Add',
				desc: 'Automatically open the target note and highlight (select) the newly added task.',
				control: {
					type: 'toggle',
					key: 'openNoteOnTaskAdd',
				},
			},
			{
				name: 'In new tab',
				desc: 'Open the note in a new tab instead of the current active tab.',
				visible: () => this.plugin.settings.openNoteOnTaskAdd,
				control: {
					type: 'toggle',
					key: 'openNoteInNewTab',
				},
			},
			{
				name: 'Swap to new tab',
				desc: 'Automatically focus and switch to the newly opened tab.',
				visible: () =>
					this.plugin.settings.openNoteOnTaskAdd && this.plugin.settings.openNoteInNewTab,
				control: {
					type: 'toggle',
					key: 'swapToNewTab',
				},
			},
			{
				name: 'Reopen Capture for Code Block Button',
				desc: 'When adding a task via an inline "+ Add Task" code block button, automatically reopen the capture pane after adding each task to allow rapid sequential task entry.',
				control: {
					type: 'toggle',
					key: 'reopenCaptureOnCodeBlock',
				},
			},
			{
				type: 'heading',
				name: 'Recurring Tasks',
			},
			{
				name: 'Italicize Recurring Tasks',
				desc: 'Format recurring tasks in italics (cursive), matching vault template style (e.g. - [ ] *Task name*).',
				control: {
					type: 'toggle',
					key: 'italicizeRecurringTasks',
				},
			},
		];
	}
}
