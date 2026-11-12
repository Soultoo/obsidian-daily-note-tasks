import { App, PluginSettingTab, Setting, SettingDefinitionItem } from 'obsidian';
import type DailyNoteTasksPlugin from './main';
import { RecurringTasksModal } from './recurring-modal';

export class DailyNoteTasksSettingTab extends PluginSettingTab {
	plugin: DailyNoteTasksPlugin;

	constructor(app: App, plugin: DailyNoteTasksPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		this.renderSettings();
	}

	private renderSettings(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl).setName('Sections & templates').setHeading();

		// Default Section Header (Daily Notes)
		const headerNames = this.plugin.templateParser.getHeaderNames();

		new Setting(containerEl)
			.setName('Default daily note section header')
			.setDesc('Tasks without a specified @section will be added under this header in daily notes.')
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
			.setName('Default custom note header')
			.setDesc('Header used when targeting a custom note (/note) without a specified @section (e.g. "todos" creates "## todos").')
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
		new Setting(containerEl).setName('Time formatting').setHeading();

		new Setting(containerEl)
			.setName('Time format')
			.setDesc('Format used when a natural language time is typed (e.g. "hh:mm" for 17:00 or "h:mm a" for 5:00 pm).')
			.addText((text) =>
				text
					.setPlaceholder('Hh:mm')
					.setValue(this.plugin.settings.timeFormat || 'HH:mm')
					.onChange(async (value) => {
						this.plugin.settings.timeFormat = value.trim() || 'HH:mm';
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Time placement')
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
		new Setting(containerEl).setName('Capture behavior').setHeading();

		let inNewTabSetting: Setting | null = null;
		let swapToNewTabSetting: Setting | null = null;

		const updateSubSettingsVisibility = () => {
			const isOpenNote = this.plugin.settings.openNoteOnTaskAdd === true;
			const isInNewTab = this.plugin.settings.openNoteInNewTab === true;

			if (inNewTabSetting !== null) {
				inNewTabSetting.settingEl.classList.toggle('dnt-hidden', !isOpenNote);
			}
			if (swapToNewTabSetting !== null) {
				swapToNewTabSetting.settingEl.classList.toggle(
					'dnt-hidden',
					!(isOpenNote && isInNewTab)
				);
			}
		};

		new Setting(containerEl)
			.setName('Open note on task add')
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
			.setName('Reopen capture for code block button')
			.setDesc(
				'When adding a task via an inline "+ add task" code block button, automatically reopen the capture pane after adding each task to allow rapid sequential task entry.'
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
		new Setting(containerEl).setName('Recurring tasks').setHeading();

		new Setting(containerEl)
			.setName('Italicize recurring tasks')
			.setDesc('Format recurring tasks in italics (cursive), matching vault template style (e.g. - [ ] *task name*).')
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.italicizeRecurringTasks !== false)
					.onChange(async (value) => {
						this.plugin.settings.italicizeRecurringTasks = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Manage recurring tasks')
			.setDesc(
				`Manage active recurring blueprints (${this.plugin.settings.recurringBlueprints.length} active). Injects tasks when daily notes are created and sweeps future notes upon cancellation.`
			)
			.addButton((button) => {
				button.setButtonText('Open manager').onClick(() => {
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
		new Setting(containerEl).setName('Autocomplete & recents').setHeading();

		const recentsCount = this.plugin.settings.recentHeaders.length;
		new Setting(containerEl)
			.setName('Recent sections (@)')
			.setDesc(
				recentsCount > 0
					? `Recently used: ${this.plugin.settings.recentHeaders.join(', ')}`
					: 'No recent sections recorded yet.'
			)
			.addButton((button) => {
				button.setButtonText('Clear recent sections').onClick(async () => {
					this.plugin.settings.recentHeaders = [];
					await this.plugin.saveSettings();
					this.renderSettings();
				});
			});

		const recentNotesCount = (this.plugin.settings.recentNotes || []).length;
		new Setting(containerEl)
			.setName('Recent target notes (/)')
			.setDesc(
				recentNotesCount > 0
					? `Recently used: ${this.plugin.settings.recentNotes.join(', ')}`
					: 'No recent target notes recorded yet.'
			)
			.addButton((button) => {
				button.setButtonText('Clear recent notes').onClick(async () => {
					this.plugin.settings.recentNotes = [];
					await this.plugin.saveSettings();
					this.renderSettings();
				});
			});

		new Setting(containerEl)
			.setName('Reload template headers')
			.setDesc('Re-scans the daily note template file to update available section headers.')
			.addButton((button) => {
				button.setButtonText('Reload headers').onClick(async () => {
					await this.plugin.templateParser.loadHeaders();
					this.renderSettings();
				});
			});
	}

	/**
	 * Declarative settings definitions used by Obsidian v1.13+ settings search indexing.
	 * Exposes all settings titles, descriptions, and controls directly to Obsidian's native search bar.
	 */
	getSettingDefinitions(): SettingDefinitionItem[] {
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
				type: 'group',
				heading: 'Sections & templates',
				items: [
					{
						name: 'Default daily note section header',
						desc: 'Tasks without a specified @section will be added under this header in daily notes.',
						control: {
							type: 'dropdown',
							key: 'defaultHeader',
							options: headerOptions,
						},
					},
					{
						name: 'Default custom note header',
						desc: 'Header used when targeting a custom note (/note) without a specified @section (e.g. "todos" creates "## todos").',
						control: {
							type: 'text',
							key: 'defaultCustomNoteHeader',
							placeholder: 'Todos',
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Time formatting',
				items: [
					{
						name: 'Time format',
						desc: 'Format used when a natural language time is typed (e.g. "hh:mm" for 17:00 or "h:mm a" for 5:00 pm).',
						control: {
							type: 'text',
							key: 'timeFormat',
							placeholder: 'Hh:mm',
						},
					},
					{
						name: 'Time placement',
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
				],
			},
			{
				type: 'group',
				heading: 'Capture behavior',
				items: [
					{
						name: 'Open note on task add',
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
							this.plugin.settings.openNoteOnTaskAdd &&
							this.plugin.settings.openNoteInNewTab,
						control: {
							type: 'toggle',
							key: 'swapToNewTab',
						},
					},
					{
						name: 'Reopen capture for code block button',
						desc: 'When adding a task via an inline "+ add task" code block button, automatically reopen the capture pane after adding each task to allow rapid sequential task entry.',
						control: {
							type: 'toggle',
							key: 'reopenCaptureOnCodeBlock',
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'Recurring tasks',
				items: [
					{
						name: 'Italicize recurring tasks',
						desc: 'Format recurring tasks in italics (cursive), matching vault template style (e.g. - [ ] *task name*).',
						control: {
							type: 'toggle',
							key: 'italicizeRecurringTasks',
						},
					},
				],
			},
		];
	}
}
