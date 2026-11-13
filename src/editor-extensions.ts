import {
	Decoration,
	DecorationSet,
	EditorView,
	ViewPlugin,
	ViewUpdate,
	keymap,
} from '@codemirror/view';
import {
	EditorState,
	Extension,
	Prec,
	RangeSetBuilder,
} from '@codemirror/state';
import {
	Completion,
	CompletionContext,
	CompletionResult,
	autocompletion,
	startCompletion,
} from '@codemirror/autocomplete';
import { parseTaskInput } from './parser';
import { ParsedTask, TemplateHeader, VaultNoteSuggestion } from './types';

export interface EditorExtensionOptions {
	getHeaders: (targetNoteName?: string | null) => TemplateHeader[];
	getVaultNotes?: () => VaultNoteSuggestion[] | string[];
	isHeaderExisting?: (headerName: string, targetNoteName?: string | null) => boolean;
	newHeaderLevel?: number;
	defaultHeader: string;
	defaultCustomNoteHeader?: string;
	timeFormat?: string;
	timePosition?: 'natural' | 'prefix' | 'suffix';
	onParsedChange?: (parsed: ParsedTask) => void;
	onSubmit: () => void;
	onCancel: () => void;
}

function extractNoteNameFromDoc(docText: string): string | null {
	const noteMatch = docText.match(/(?:^|\s)\/(?:"([^"]+)"|'([^']+)'|([^\s@#]+))/);
	return noteMatch ? (noteMatch[1] || noteMatch[2] || noteMatch[3] || null) : null;
}

export function createCaptureEditorExtensions(options: EditorExtensionOptions): Extension[] {
	const {
		getHeaders,
		getVaultNotes = () => [],
		isHeaderExisting,
		newHeaderLevel = 2,
		defaultHeader,
		defaultCustomNoteHeader = 'Todos',
		timeFormat = 'HH:mm',
		timePosition = 'natural',
		onParsedChange,
		onSubmit,
		onCancel,
	} = options;

	// 1. Syntax highlighting plugin for dates (blue), headers (red), recurrence (purple), and target note (green)
	const highlightPlugin = ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.buildDecorations(view);
			}

			update(update: ViewUpdate) {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.buildDecorations(update.view);
					if (onParsedChange && update.docChanged) {
						const docText = update.view.state.doc.toString();
						const noteName = extractNoteNameFromDoc(docText);
						const headerNames = getHeaders(noteName).map((h) => h.heading);
						const parsed = parseTaskInput(
							docText,
							headerNames,
							defaultHeader,
							timeFormat,
							timePosition,
							defaultCustomNoteHeader
						);
						onParsedChange(parsed);
					}
				}
			}

			buildDecorations(view: EditorView): DecorationSet {
				const builder = new RangeSetBuilder<Decoration>();
				const docText = view.state.doc.toString();
				const noteName = extractNoteNameFromDoc(docText);
				const headerNames = getHeaders(noteName).map((h) => h.heading);
				const parsed = parseTaskInput(
					docText,
					headerNames,
					defaultHeader,
					timeFormat,
					timePosition,
					defaultCustomNoteHeader
				);

				const marks: { from: number; to: number; deco: Decoration }[] = [];

				// Green target note highlight (e.g. "/groceries")
				if (
					parsed.targetNoteSpan &&
					parsed.targetNoteSpan.from >= 0 &&
					parsed.targetNoteSpan.to <= docText.length &&
					parsed.targetNoteSpan.from < parsed.targetNoteSpan.to
				) {
					marks.push({
						from: parsed.targetNoteSpan.from,
						to: parsed.targetNoteSpan.to,
						deco: Decoration.mark({
							class: 'dnt-nlp-note',
							attributes: {
								title: `Target Note: ${parsed.targetNote || ''}`,
							},
						}),
					});
				}

				// Blue date highlight
				if (
					parsed.dateSpan &&
					parsed.dateSpan.from >= 0 &&
					parsed.dateSpan.to <= docText.length &&
					parsed.dateSpan.from < parsed.dateSpan.to
				) {
					const title = parsed.date
						? `Date: ${parsed.date.format('YYYY-MM-DD')}${parsed.timeStr ? ` ${parsed.timeStr}` : ''}`
						: '';
					marks.push({
						from: parsed.dateSpan.from,
						to: parsed.dateSpan.to,
						deco: Decoration.mark({
							class: 'dnt-nlp-date',
							attributes: { title },
						}),
					});
				}

				// Red header highlight (or highlighted as new if not existing)
				if (
					parsed.headerSpan &&
					parsed.headerSpan.from >= 0 &&
					parsed.headerSpan.to <= docText.length &&
					parsed.headerSpan.from < parsed.headerSpan.to
				) {
					const headerName = parsed.header || '';
					const isExisting = isHeaderExisting
						? isHeaderExisting(headerName, parsed.targetNote)
						: true;
					const hashes = '#'.repeat(Math.max(1, Math.min(6, newHeaderLevel)));
					const cls = isExisting
						? 'dnt-nlp-header'
						: 'dnt-nlp-header dnt-nlp-header-new';
					const title = isExisting
						? `Section: @${headerName}`
						: `Section: @${headerName} ✨ (will create ${hashes} ${headerName})`;

					marks.push({
						from: parsed.headerSpan.from,
						to: parsed.headerSpan.to,
						deco: Decoration.mark({
							class: cls,
							attributes: {
								title,
							},
						}),
					});
				}

				// Purple recurrence highlight (e.g. "every 2 days")
				if (
					parsed.recurrenceSpan &&
					parsed.recurrenceSpan.from >= 0 &&
					parsed.recurrenceSpan.to <= docText.length &&
					parsed.recurrenceSpan.from < parsed.recurrenceSpan.to
				) {
					marks.push({
						from: parsed.recurrenceSpan.from,
						to: parsed.recurrenceSpan.to,
						deco: Decoration.mark({
							class: 'dnt-nlp-recurrence',
							attributes: {
								title: `Recurrence: ${parsed.recurrenceText || ''}`,
							},
						}),
					});
				}

				marks.sort((a, b) => a.from - b.from);

				let lastTo = -1;
				for (const mark of marks) {
					if (mark.from >= lastTo) {
						builder.add(mark.from, mark.to, mark.deco);
						lastTo = mark.to;
					}
				}

				return builder.finish();
			}
		},
		{
			decorations: (v) => v.decorations,
		}
	);

	// 2. Autocomplete provider for '@' (headers) and '/' (target notes)
	const autocompleteExtension = autocompletion({
		override: [
			(context: CompletionContext): CompletionResult | null => {
				// Target note autocomplete on '/'
				const noteWord = context.matchBefore(/\/[^\n@#]*$/);
				if (noteWord) {
					const rawNotes = getVaultNotes();
					const noteSuggestions: VaultNoteSuggestion[] = rawNotes.map((n) =>
						typeof n === 'string' ? { name: n, path: n, isRecent: false } : n
					);

					return {
						from: noteWord.from,
						options: noteSuggestions.map((note, index) => {
							const hasSpacesOrSpecial =
								note.name.includes(' ') || /[^\w\-/.]/.test(note.name);
							const applyText = hasSpacesOrSpecial ? `/"${note.name}" ` : `/${note.name} `;
							const detailText = note.isRecent ? '🕒 Recent • Note' : 'Note';
							const boost = note.isRecent ? 100 - index : 0;
							return {
								label: `/${note.name}`,
								detail: detailText,
								apply: applyText,
								type: 'variable',
								boost,
							};
						}),
					};
				}

				// Header autocomplete on '@'
				const headerWord = context.matchBefore(/@[^\n/]*$/);
				if (headerWord) {
					const docText = context.state.doc.toString();
					const noteName = extractNoteNameFromDoc(docText);
					const headers = getHeaders(noteName);
					const typed = headerWord.text.slice(1).trim().replace(/^["']|["']$/g, '');

					const options: Completion[] = headers.map((h, index) => {
						const detailText = h.isRecent
							? `🕒 Recent • H${h.level}`
							: `H${h.level}`;
						const needsQuotes = h.heading.includes(' ') || /[^\w\-/]/.test(h.heading);
						const applyText = needsQuotes ? `@"${h.heading}" ` : `@${h.heading} `;
						const boost = h.isRecent ? 100 - index : 0;
						return {
							label: `@${h.heading}`,
							detail: detailText,
							apply: applyText,
							type: 'keyword',
							boost,
						};
					});

					if (typed && !headers.some((h) => h.heading.toLowerCase() === typed.toLowerCase())) {
						const hashes = '#'.repeat(Math.max(1, Math.min(6, newHeaderLevel)));
						const needsQuotes = typed.includes(' ') || /[^\w\-/]/.test(typed);
						const applyText = needsQuotes ? `@"${typed}" ` : `@${typed} `;
						options.push({
							label: `@${typed}`,
							detail: `✨ Will create ${hashes} ${typed}`,
							apply: applyText,
							type: 'text',
							boost: -1,
						});
					}

					return {
						from: headerWord.from,
						options,
					};
				}

				return null;
			},
		],
	});

	// 3. Single-line transaction filter (strips newlines)
	const singleLineFilter = EditorState.transactionFilter.of((tr) => {
		if (tr.docChanged) {
			const text = tr.newDoc.toString();
			if (text.includes('\n') || text.includes('\r')) {
				return [];
			}
		}
		return tr;
	});

	// 4. Custom keymap for Enter (submit) and Escape (cancel)
	const modalKeymap = Prec.highest(
		keymap.of([
			{
				key: 'Enter',
				run: () => {
					onSubmit();
					return true;
				},
			},
			{
				key: 'Escape',
				run: () => {
					onCancel();
					return true;
				},
			},
		])
	);

	return [
		highlightPlugin,
		autocompleteExtension,
		singleLineFilter,
		modalKeymap,
		EditorView.theme({
			'&': {
				fontSize: '15px',
			},
			'.cm-content': {
				padding: '8px 12px',
				caretColor: 'var(--text-accent, #705dcf)',
			},
			'&.cm-focused': {
				outline: 'none',
			},
			'.cm-line': {
				lineHeight: '1.5',
			},
		}),
	];
}

/**
 * Inserts a sign or word (e.g. '/', '@', '#', 'tod') at cursor in a CodeMirror 6 EditorView.
 * Adds leading space if previous character is not whitespace, and optionally opens autocomplete.
 */
export function insertSymbolAtCursor(
	view: EditorView,
	symbol: string,
	triggerCompletion = false
): void {
	const sel = view.state.selection.main;
	const doc = view.state.doc;
	const pos = sel.head;

	let textToInsert = symbol;
	if (pos > 0) {
		const prevChar = doc.sliceString(pos - 1, pos);
		if (prevChar !== ' ' && prevChar !== '\t' && prevChar !== '\n') {
			textToInsert = ' ' + symbol;
		}
	}

	view.dispatch({
		changes: { from: sel.from, to: sel.to, insert: textToInsert },
		selection: { anchor: sel.from + textToInsert.length },
	});
	view.focus();

	if (triggerCompletion) {
		window.setTimeout(() => {
			startCompletion(view);
		}, 30);
	}
}
