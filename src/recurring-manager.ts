import { App, Notice, TFile, moment } from 'obsidian';
import { getAllDailyNotes, getDateFromFile } from 'obsidian-daily-notes-interface';
import { DailyNoteManager } from './daily-note-manager';
import { isRecurrenceDue } from './recurrence-parser';
import type { RecurringBlueprint } from './types';

type Moment = moment.Moment;

export type { RecurringBlueprint };

export function formatCursiveTask(text: string): string {
	const trimmed = text.trim();
	if (trimmed.startsWith('*') && trimmed.endsWith('*')) {
		return trimmed;
	}
	// Preserve trailing tags outside the asterisks: e.g. "*Task text* #mobile"
	const tagMatch = trimmed.match(/^(.*?)((\s+#[a-zA-Z0-9_\-/]+)+)$/);
	if (tagMatch && tagMatch[1] && tagMatch[2]) {
		const body = tagMatch[1].trim();
		const tags = tagMatch[2];
		return `*${body.replace(/^\*+|\*+$/g, '')}*${tags}`;
	}
	return `*${trimmed.replace(/^\*+|\*+$/g, '')}*`;
}

export class RecurringManager {
	private app: App;
	private dailyNoteManager: DailyNoteManager;
	private getBlueprints: () => RecurringBlueprint[];
	private saveBlueprints: (blueprints: RecurringBlueprint[]) => Promise<void>;
	private shouldItalicize: () => boolean;

	constructor(
		app: App,
		dailyNoteManager: DailyNoteManager,
		getBlueprints: () => RecurringBlueprint[],
		saveBlueprints: (blueprints: RecurringBlueprint[]) => Promise<void>,
		shouldItalicize: () => boolean = () => true
	) {
		this.app = app;
		this.dailyNoteManager = dailyNoteManager;
		this.getBlueprints = getBlueprints;
		this.saveBlueprints = saveBlueprints;
		this.shouldItalicize = shouldItalicize;
	}

	/**
	 * Determines if a blueprint is due on the specified date.
	 */
	public isDue(blueprint: RecurringBlueprint, date: Moment): boolean {
		return isRecurrenceDue(blueprint.rule, date);
	}

	/**
	 * Injects all due recurring tasks into a daily note file if they aren't already present.
	 */
	public async injectDueTasksForDate(file: TFile, date: Moment): Promise<number> {
		const blueprints = this.getBlueprints();
		if (blueprints.length === 0) return 0;

		const dueTasks = blueprints.filter((b) => this.isDue(b, date));
		if (dueTasks.length === 0) return 0;

		let injectedCount = 0;
		const italicize = this.shouldItalicize();

		await this.app.vault.process(file, (content) => {
			let updatedContent = content;

			for (const task of dueTasks) {
				const formattedName = italicize
					? formatCursiveTask(task.name)
					: task.name;

				// Avoid duplicate injection
				if (
					updatedContent.includes(task.name) ||
					updatedContent.includes(formattedName)
				) {
					continue;
				}

				const result = this.dailyNoteManager.insertTaskUnderHeader(
					updatedContent,
					task.header,
					formattedName
				);
				updatedContent = result.content;
				injectedCount++;
			}

			return updatedContent;
		});

		if (injectedCount > 0) {
			new Notice(`Injected ${injectedCount} recurring task(s) for ${date.format('YYYY-MM-DD')}`);
		}

		return injectedCount;
	}

	/**
	 * Adds a new recurring blueprint to the registry AND injects it into today's and all already created future daily notes.
	 */
	public async addBlueprint(
		blueprint: Omit<RecurringBlueprint, 'id' | 'createdAt'>
	): Promise<{
		blueprint: RecurringBlueprint;
		injectedCount: number;
		todayFile?: TFile;
		todayLine?: number;
	}> {
		const newBp: RecurringBlueprint = {
			...blueprint,
			id: `rec_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
			createdAt: new Date().toISOString(),
		};

		const blueprints = [...this.getBlueprints(), newBp];
		await this.saveBlueprints(blueprints);

		// Sweep today and all already created future daily notes to inject the new task
		let injectedCount = 0;
		let todayFile: TFile | undefined;
		let todayLine: number | undefined;

		const allDailyNotes = getAllDailyNotes();
		const today = moment().startOf('day');
		const italicize = this.shouldItalicize();

		for (const file of Object.values(allDailyNotes)) {
			if (!(file instanceof TFile)) continue;
			const noteDate = getDateFromFile(file, 'day');
			if (!noteDate || !noteDate.isValid()) continue;

			if (noteDate.isSameOrAfter(today) && this.isDue(newBp, noteDate)) {
				await this.app.vault.process(file, (content) => {
					const formattedName = italicize
						? formatCursiveTask(newBp.name)
						: newBp.name;

					if (
						content.includes(newBp.name) ||
						content.includes(formattedName)
					) {
						return content;
					}

					const result = this.dailyNoteManager.insertTaskUnderHeader(
						content,
						newBp.header,
						formattedName
					);
					injectedCount++;

					if (noteDate.isSame(today, 'day')) {
						todayFile = file;
						todayLine = result.insertedLine;
					}

					return result.content;
				});
			}
		}

		return { blueprint: newBp, injectedCount, todayFile, todayLine };
	}

	/**
	 * Cancels a recurring blueprint, removes it from registry, and sweeps future notes to delete orphaned instances.
	 */
	public async cancelBlueprint(
		id: string
	): Promise<{ blueprint: RecurringBlueprint | null; removedCount: number }> {
		const blueprints = this.getBlueprints();
		const index = blueprints.findIndex((b) => b.id === id);

		if (index === -1) {
			return { blueprint: null, removedCount: 0 };
		}

		const [target] = blueprints.splice(index, 1);
		if (!target) {
			return { blueprint: null, removedCount: 0 };
		}

		await this.saveBlueprints(blueprints);

		let removedCount = 0;
		const allDailyNotes = getAllDailyNotes();
		const today = moment().startOf('day');
		const cleanName = target.name.replace(/[*_`#[\]@]/g, '').trim();

		for (const file of Object.values(allDailyNotes)) {
			if (!(file instanceof TFile)) continue;
			const noteDate = getDateFromFile(file, 'day');
			if (!noteDate || !noteDate.isValid()) continue;

			if (noteDate.isSameOrAfter(today)) {
				await this.app.vault.process(file, (content) => {
					if (!content.includes(cleanName) && !content.includes(target.name)) {
						return content;
					}

					const lines = content.split('\n');
					const newLines: string[] = [];
					let skippingChildLines = false;
					let targetIndent = 0;

					for (let i = 0; i < lines.length; i++) {
						const line = lines[i] ?? '';

						if (skippingChildLines) {
							const indentMatch = line.match(/^(\s*)/);
							const lineIndent = indentMatch ? indentMatch[1]?.length || 0 : 0;
							if (lineIndent > targetIndent && line.trim()) {
								continue;
							} else {
								skippingChildLines = false;
							}
						}

						const cleanLine = line.replace(/[*_`#[\]@]/g, '');
						if (
							(line.includes(target.name) || cleanLine.includes(cleanName)) &&
							/^\s*[-*+]\s+\[.\]/.test(line)
						) {
							removedCount++;
							const indentMatch = line.match(/^(\s*)/);
							targetIndent = indentMatch ? indentMatch[1]?.length || 0 : 0;
							skippingChildLines = true;
							continue;
						}

						newLines.push(line);
					}

					return newLines.join('\n');
				});
			}
		}

		return { blueprint: target, removedCount };
	}
}
