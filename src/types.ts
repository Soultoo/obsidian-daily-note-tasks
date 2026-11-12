import type { moment } from 'obsidian';

export type Moment = moment.Moment;

export interface Span {
	from: number;
	to: number;
}

export interface RecurrenceRule {
	rawText: string;
	interval: number; // e.g. 1, 2, 3...
	unit: 'day' | 'week' | 'month' | 'year';
	daysOfWeek?: number[]; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
	dayOfMonth?: number; // 1 to 31
	baseDate: string; // YYYY-MM-DD
}

export interface ParsedTask {
	raw: string;
	cleanText: string;
	finalTaskText: string;
	date: Moment | null;
	dateText: string | null;
	dateSpan: Span | null;
	hasTime: boolean;
	timeStr: string | null;
	header: string | null;
	headerText: string | null;
	headerSpan: Span | null;
	targetNote: string | null;
	targetNoteText: string | null;
	targetNoteSpan: Span | null;
	recurrence: RecurrenceRule | null;
	recurrenceText: string | null;
	recurrenceSpan: Span | null;
}

export interface TemplateHeader {
	heading: string;
	level: number;
	fullText: string;
	isRecent?: boolean;
}

export interface RecurringBlueprint {
	id: string;
	name: string;
	header: string;
	rule: RecurrenceRule;
	createdAt: string;
}

export interface PluginSettings {
	defaultHeader: string;
	defaultCustomNoteHeader: string;
	dateFormat: string;
	timeFormat: string;
	timePosition: 'natural' | 'prefix' | 'suffix';
	recentHeaders: string[];
	recentNotes: string[];
	italicizeRecurringTasks: boolean;
	recurringBlueprints: RecurringBlueprint[];
	openNoteOnTaskAdd: boolean;
	openNoteInNewTab: boolean;
	swapToNewTab: boolean;
	reopenCaptureOnCodeBlock: boolean;
}

export const DEFAULT_SETTINGS: PluginSettings = {
	defaultHeader: 'Written plan',
	defaultCustomNoteHeader: 'Todos',
	dateFormat: 'YYYY-MM-DD',
	timeFormat: 'HH:mm',
	timePosition: 'natural',
	recentHeaders: [],
	recentNotes: [],
	italicizeRecurringTasks: true,
	recurringBlueprints: [],
	openNoteOnTaskAdd: false,
	openNoteInNewTab: false,
	swapToNewTab: true,
	reopenCaptureOnCodeBlock: true,
};
