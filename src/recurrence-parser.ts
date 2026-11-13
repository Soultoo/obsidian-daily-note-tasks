import { moment } from 'obsidian';
type Moment = moment.Moment;
import { RecurrenceRule, Span } from './types';

const DAY_MAP: Record<string, number> = {
	sun: 0,
	sunday: 0,
	mon: 1,
	monday: 1,
	tue: 2,
	tuesday: 2,
	wed: 3,
	wednesday: 3,
	thu: 4,
	thursday: 4,
	fri: 5,
	friday: 5,
	sat: 6,
	saturday: 6,
};

export function parseRecurrenceFromText(
	input: string,
	baseDateMoment: Moment = moment()
): { rule: RecurrenceRule | null; span: Span | null } {
	// 1. Matches base frequency: "every 2 days", "every weekday", "every month", "every week", etc.
	// 2. Strict, non-greedy on clause: ONLY matches ordinals (e.g. "the 1st", "15th") or weekday names.
	// Does NOT swallow regular task words like "yay first day thing"!
	const regex =
		/(?:^|\s)(every)\s+(\d+)?\s*(day|days|week|weeks|month|months|year|years|weekday|weekdays|mon|tue|wed|thu|fri|sat|sun)(?:\s+on\s+(?:the\s+)?(\d{1,2}(?:st|nd|rd|th)?|(?:(?:mon|tue|wed|thu|fri|sat|sun|monday|tuesday|wednesday|thursday|friday|saturday|sunday)(?:[,\s]+and?[,\s]*)*)))?(?=$|\s|@)/i;

	const match = input.match(regex);
	if (!match || match.index === undefined) {
		return { rule: null, span: null };
	}

	const keyword = match[1] || 'every';
	const matchStart = input.indexOf(keyword, match.index);
	const matchLength = match[0].trim().length;

	const countStr = match[2];
	const interval = countStr ? parseInt(countStr, 10) : 1;
	const unitStr = (match[3] || '').toLowerCase();
	const onClause = (match[4] || '').toLowerCase().trim();

	const baseDate = baseDateMoment.format('YYYY-MM-DD');

	let unit: 'day' | 'week' | 'month' | 'year' = 'day';
	let daysOfWeek: number[] | undefined = undefined;
	let dayOfMonth: number | undefined = undefined;

	if (unitStr === 'day' || unitStr === 'days') {
		unit = 'day';
	} else if (unitStr === 'weekday' || unitStr === 'weekdays') {
		unit = 'week';
		daysOfWeek = [1, 2, 3, 4, 5]; // Mon - Fri
	} else if (unitStr === 'week' || unitStr === 'weeks') {
		unit = 'week';
		if (onClause) {
			daysOfWeek = parseDaysOfWeek(onClause);
		} else {
			daysOfWeek = [baseDateMoment.day()];
		}
	} else if (unitStr === 'month' || unitStr === 'months') {
		unit = 'month';
		if (onClause) {
			const dayNum = parseInt(onClause.replace(/\D/g, ''), 10);
			if (!isNaN(dayNum) && dayNum >= 1 && dayNum <= 31) {
				dayOfMonth = dayNum;
			} else {
				dayOfMonth = baseDateMoment.date();
			}
		} else {
			dayOfMonth = baseDateMoment.date();
		}
	} else if (unitStr === 'year' || unitStr === 'years') {
		unit = 'year';
	} else if (DAY_MAP[unitStr] !== undefined) {
		unit = 'week';
		daysOfWeek = [DAY_MAP[unitStr]];
	}

	const rule: RecurrenceRule = {
		rawText: match[0].trim(),
		interval,
		unit,
		daysOfWeek,
		dayOfMonth,
		baseDate,
	};

	return {
		rule,
		span: {
			from: matchStart,
			to: matchStart + matchLength,
		},
	};
}

function parseDaysOfWeek(str: string): number[] {
	const tokens = str.split(/[,\s]+/).map((t) => t.trim().toLowerCase());
	const days: number[] = [];
	for (const token of tokens) {
		if (DAY_MAP[token] !== undefined) {
			days.push(DAY_MAP[token]);
		}
	}
	return days.length > 0 ? Array.from(new Set(days)) : [1];
}

/**
 * Checks whether a given recurrence rule is due on the specified target date.
 */
export function isRecurrenceDue(rule: RecurrenceRule, targetDate: Moment): boolean {
	const start = moment(rule.baseDate).startOf('day');
	const current = targetDate.clone().startOf('day');

	if (current.isBefore(start)) {
		return false;
	}

	if (rule.unit === 'day') {
		const diffDays = Math.round(current.diff(start, 'days', true));
		return diffDays >= 0 && diffDays % rule.interval === 0;
	}

	if (rule.unit === 'week') {
		if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
			if (!rule.daysOfWeek.includes(current.day())) {
				return false;
			}
		}

		if (rule.interval === 1) {
			return true;
		}

		const diffWeeks = Math.floor(current.clone().startOf('isoWeek').diff(start.clone().startOf('isoWeek'), 'weeks', true));
		return diffWeeks >= 0 && diffWeeks % rule.interval === 0;
	}

	if (rule.unit === 'month') {
		const targetDay = rule.dayOfMonth ?? start.date();
		if (current.date() !== targetDay) {
			return false;
		}

		const diffMonths = (current.year() - start.year()) * 12 + (current.month() - start.month());
		return diffMonths >= 0 && diffMonths % rule.interval === 0;
	}

	if (rule.unit === 'year') {
		const sameMonth = current.month() === start.month();
		const sameDay = current.date() === start.date();
		if (!sameMonth || !sameDay) {
			return false;
		}
		const diffYears = current.year() - start.year();
		return diffYears >= 0 && diffYears % rule.interval === 0;
	}

	return false;
}

export function formatRecurrenceLabel(rule: RecurrenceRule): string {
	if (rule.unit === 'day') {
		return rule.interval === 1 ? 'Every day' : `Every ${rule.interval} days`;
	}
	if (rule.unit === 'week') {
		if (
			rule.daysOfWeek &&
			rule.daysOfWeek.length === 5 &&
			[1, 2, 3, 4, 5].every((d) => rule.daysOfWeek?.includes(d))
		) {
			return 'Every weekday';
		}
		const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		const daysStr = rule.daysOfWeek ? rule.daysOfWeek.map((d) => dayNames[d]).join(', ') : '';
		if (rule.interval === 1) {
			return daysStr ? `Every ${daysStr}` : 'Every week';
		}
		return daysStr ? `Every ${rule.interval} weeks on ${daysStr}` : `Every ${rule.interval} weeks`;
	}
	if (rule.unit === 'month') {
		const suffix = getOrdinalSuffix(rule.dayOfMonth ?? 1);
		const dayStr = `${rule.dayOfMonth ?? 1}${suffix}`;
		return rule.interval === 1 ? `Every month on the ${dayStr}` : `Every ${rule.interval} months on the ${dayStr}`;
	}
	return `Every ${rule.interval} ${rule.unit}s`;
}

function getOrdinalSuffix(n: number): string {
	const s = ['th', 'st', 'nd', 'rd'];
	const v = n % 100;
	return s[(v - 20) % 10] || s[v] || s[0] || 'th';
}
