import * as chrono from 'chrono-node';
import { moment } from 'obsidian';
import { parseRecurrenceFromText } from './recurrence-parser';
import { ParsedTask, Span } from './types';

function createCustomChrono() {
	const custom = chrono.casual.clone();

	custom.parsers.unshift({
		pattern: () => /(?:^|\b)(tod|tom)(?=\W|$)/i,
		extract: (context, match) => {
			const text = match[1]?.toLowerCase();
			const comp = context.createParsingComponents();
			const refDate = context.refDate;
			const target = new Date(refDate.getTime());

			if (text === 'tom') {
				target.setDate(target.getDate() + 1);
			}

			comp.assign('year', target.getFullYear());
			comp.assign('month', target.getMonth() + 1);
			comp.assign('day', target.getDate());
			comp.imply('hour', 12);
			comp.imply('minute', 0);
			comp.imply('second', 0);
			return comp;
		},
	});

	return custom;
}

const customChrono = createCustomChrono();

export function parseTaskInput(
	input: string,
	availableHeaders: string[] = [],
	defaultHeader = 'Written plan',
	timeFormat = 'HH:mm',
	timePosition: 'natural' | 'prefix' | 'suffix' = 'natural',
	defaultCustomNoteHeader = 'Todos'
): ParsedTask {
	const raw = input;

	// ----------------------------------------------------
	// STEP 1: Parse target note indicated by '/'
	// ----------------------------------------------------
	let targetNoteSpan: Span | null = null;
	let targetNoteText: string | null = null;
	let targetNote: string | null = null;

	const noteRegex = /(?:^|\s)\/(?:"([^"]+)"|'([^']+)'|([^\s@#]+))([,;:.!?]*)/;
	const noteMatch = input.match(noteRegex);
	if (noteMatch && noteMatch.index !== undefined) {
		const slashIndex = input.indexOf('/', noteMatch.index);
		const fullMatch = noteMatch[0].trim();
		const captured = (noteMatch[1] || noteMatch[2] || noteMatch[3] || '').replace(/[,;:.!?]+$/, '');
		targetNoteSpan = {
			from: slashIndex,
			to: slashIndex + fullMatch.length,
		};
		targetNoteText = '/' + captured;
		targetNote = captured;
	}

	// ----------------------------------------------------
	// STEP 2: Parse header / section indicated by '@'
	// ----------------------------------------------------
	let headerSpan: Span | null = null;
	let headerText: string | null = null;
	let matchedHeader: string | null = null;

	const sortedHeaders = [...availableHeaders].sort((a, b) => b.length - a.length);

	for (const heading of sortedHeaders) {
		const escapedHeading = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		const regex = new RegExp(`(?:^|\\s)@(?:"${escapedHeading}"|'${escapedHeading}'|${escapedHeading})([,;:.!?]*)(?=$|\\s)`, 'i');
		const match = input.match(regex);
		if (match && match.index !== undefined) {
			const atIndex = input.indexOf('@', match.index);
			const fullMatch = match[0].trim();
			headerSpan = {
				from: atIndex,
				to: atIndex + fullMatch.length,
			};
			headerText = `@${heading}`;
			matchedHeader = heading;
			break;
		}
	}

	if (!headerSpan) {
		const genericRegex = /(?:^|\s)@(?:"([^"]+)"|'([^']+)'|([^\s/#]+))([,;:.!?]*)/;
		const match = input.match(genericRegex);
		if (match && match.index !== undefined) {
			const atIndex = input.indexOf('@', match.index);
			const fullMatch = match[0].trim();
			const captured = (match[1] || match[2] || match[3] || '').replace(/[,;:.!?]+$/, '');
			headerSpan = {
				from: atIndex,
				to: atIndex + fullMatch.length,
			};
			headerText = '@' + captured;
			matchedHeader = captured;
		}
	}

	// ----------------------------------------------------
	// STEP 3: Parse recurrence (e.g. "every 2 days")
	// ----------------------------------------------------
	const recParsed = parseRecurrenceFromText(input);
	const recurrence = recParsed.rule;
	const recurrenceSpan = recParsed.span;
	const recurrenceText = recParsed.rule ? recParsed.rule.rawText : null;

	// ----------------------------------------------------
	// STEP 4: Mask out target note, header, and recurrence before Chrono
	// (Prevents "@20 minute stuff" or "/groceries 2" from parsing as dates/times!)
	// ----------------------------------------------------
	let maskedForChrono = input;

	if (targetNoteSpan) {
		const spaces = ' '.repeat(targetNoteSpan.to - targetNoteSpan.from);
		maskedForChrono =
			maskedForChrono.slice(0, targetNoteSpan.from) +
			spaces +
			maskedForChrono.slice(targetNoteSpan.to);
	}

	if (headerSpan) {
		const spaces = ' '.repeat(headerSpan.to - headerSpan.from);
		maskedForChrono =
			maskedForChrono.slice(0, headerSpan.from) +
			spaces +
			maskedForChrono.slice(headerSpan.to);
	}

	if (recurrenceSpan) {
		const spaces = ' '.repeat(recurrenceSpan.to - recurrenceSpan.from);
		maskedForChrono =
			maskedForChrono.slice(0, recurrenceSpan.from) +
			spaces +
			maskedForChrono.slice(recurrenceSpan.to);
	}

	// ----------------------------------------------------
	// STEP 5: Parse natural language dates & times
	// ----------------------------------------------------
	let dateSpan: Span | null = null;
	let dateText: string | null = null;
	let parsedMoment: moment.Moment | null = null;
	let hasTime = false;
	let timeStr: string | null = null;

	const chronoResults = customChrono.parse(maskedForChrono, new Date(), { forwardDate: true });
	if (chronoResults.length > 0) {
		let selectedResult = chronoResults[0];
		for (const res of chronoResults) {
			const lower = res.text.toLowerCase();
			if (
				lower.includes('tod') ||
				lower.includes('tom') ||
				lower.includes('today') ||
				lower.includes('tomorrow')
			) {
				selectedResult = res;
				break;
			}
		}

		if (selectedResult) {
			dateSpan = {
				from: selectedResult.index,
				to: selectedResult.index + selectedResult.text.length,
			};
			dateText = selectedResult.text;
			const parsedDate = selectedResult.start.date();
			parsedMoment = moment(parsedDate);

			if (selectedResult.start.isCertain('hour')) {
				hasTime = true;
				timeStr = parsedMoment.format(timeFormat || 'HH:mm');
			}
		}
	}

	// ----------------------------------------------------
	// STEP 6: Construct clean task text
	// ----------------------------------------------------
	const spansToRemove: Span[] = [];
	if (targetNoteSpan) spansToRemove.push(targetNoteSpan);
	if (dateSpan) spansToRemove.push(dateSpan);
	if (headerSpan) spansToRemove.push(headerSpan);
	if (recurrenceSpan) spansToRemove.push(recurrenceSpan);

	spansToRemove.sort((a, b) => b.from - a.from);

	let cleanText = input;
	for (const span of spansToRemove) {
		cleanText = cleanText.slice(0, span.from) + cleanText.slice(span.to);
	}

	// Clean up extra whitespace and stray prepositions
	cleanText = cleanText
		.replace(/\s+/g, ' ')
		.replace(/\s+([,:;?!])\s+/g, ' ')
		.replace(/\s+(at|on|by|in|due|for|kl|klockan)\s*$/i, '')
		.replace(/^(at|on|by|in|due|for|kl|klockan)\s+/i, '')
		.trim();

	// ----------------------------------------------------
	// STEP 7: Natural time placement
	// ----------------------------------------------------
	let finalTaskText = cleanText;

	if (hasTime && timeStr && cleanText) {
		const alreadyHasTime =
			cleanText.includes(timeStr) ||
			/\b\d{1,2}[:.]\d{2}\b/.test(cleanText) ||
			/\b\d{1,2}\s*(am|pm)\b/i.test(cleanText);

		if (!alreadyHasTime) {
			if (timePosition === 'prefix') {
				finalTaskText = `${timeStr} ${cleanText}`;
			} else if (timePosition === 'suffix') {
				finalTaskText = `${cleanText} ${timeStr}`;
			} else {
				if (dateSpan && dateSpan.from === 0) {
					finalTaskText = `${timeStr} ${cleanText}`;
				} else {
					finalTaskText = `${cleanText} ${timeStr}`;
				}
			}
		}
	}

	// Determine effective header fallback:
	// If a specific target note is given and no @header specified, default to defaultCustomNoteHeader ('Todos')
	const effectiveHeader = matchedHeader
		? matchedHeader
		: targetNote
		? defaultCustomNoteHeader
		: defaultHeader;

	return {
		raw,
		cleanText,
		finalTaskText,
		date: parsedMoment,
		dateText,
		dateSpan,
		hasTime,
		timeStr,
		header: effectiveHeader,
		headerText,
		headerSpan,
		targetNote,
		targetNoteText,
		targetNoteSpan,
		recurrence,
		recurrenceText,
		recurrenceSpan,
	};
}
