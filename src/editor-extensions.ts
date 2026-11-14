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
	acceptCompletion,
	autocompletion,
	closeCompletion,
	startCompletion,
} from '@codemirror/autocomplete';
import type { App, TFile } from 'obsidian';
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

/**
 * Returns a sorted list of vault notes with recent notes boosted to the top.
 */
export function getVaultNoteSuggestions(
	app: App,
	recentNotes: string[] = []
): VaultNoteSuggestion[] {
	const files = app.vault.getMarkdownFiles();
	const fileMap = new Map<string, TFile>();
	for (const file of files) {
		fileMap.set(file.basename.toLowerCase(), file);
	}

	const recentSuggestions: VaultNoteSuggestion[] = [];
	const seen = new Set<string>();

	for (const recentName of recentNotes) {
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

	// 1. Syntax highlighting plugin for dates, headers, recurrence, target notes, and wikilinks
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

				// Green target note highlight (e.g. "/groceries" or '/"Grocery List"')
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

				// Cyan wikilink highlight (e.g. "[[note]]")
				const linkRegex = /\[\[([^\]\n]+)\]\]/g;
				let linkMatch: RegExpExecArray | null;
				while ((linkMatch = linkRegex.exec(docText)) !== null) {
					marks.push({
						from: linkMatch.index,
						to: linkMatch.index + linkMatch[0].length,
						deco: Decoration.mark({
							class: 'dnt-nlp-link',
							attributes: {
								title: `Link: [[${linkMatch[1]}]]`,
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

	// 2. Autocomplete provider for '[[', '@', and '/'
	const autocompleteExtension = autocompletion({
		override: [
			(context: CompletionContext): CompletionResult | null => {
				// 1. Wikilink autocomplete on '[['
				const linkWord = context.matchBefore(/\[\[[^\]\n]*$/);
				if (linkWord) {
					const rawNotes = getVaultNotes();
					const noteSuggestions: VaultNoteSuggestion[] = rawNotes.map((n) =>
						typeof n === 'string' ? { name: n, path: n, isRecent: false } : n
					);

					const fromPos = linkWord.from + 2;

					const options: Completion[] = noteSuggestions.map((note, index) => {
						const detailText = note.isRecent ? '🕒 Recent • Link' : 'Link';
						const boost = note.isRecent ? 100 - index : 0;
						return {
							label: note.name,
							detail: detailText,
							type: 'variable',
							boost,
							apply: (view: EditorView, completion: Completion, from: number, to: number) => {
								const doc = view.state.doc.toString();
								const linkPos = linkWord.from;
								let end = to;
								if (doc.slice(end, end + 2) === ']]') {
									end += 2;
								} else if (doc.slice(end, end + 1) === ']') {
									end += 1;
								}
								const insert = `[[${note.name}]] `;
								view.dispatch({
									changes: { from: linkPos, to: end, insert },
									selection: { anchor: linkPos + insert.length },
								});
							},
						};
					});

					return {
						from: fromPos,
						options,
					};
				}

				// 2. Target note autocomplete on '/'
				const noteWord = context.matchBefore(/\/(?:"[^"]*|[^\n@#]*)$/);
				if (noteWord) {
					const rawNotes = getVaultNotes();
					const noteSuggestions: VaultNoteSuggestion[] = rawNotes.map((n) =>
						typeof n === 'string' ? { name: n, path: n, isRecent: false } : n
					);

					const isQuoted = noteWord.text.startsWith('/"');
					const fromPos = isQuoted ? noteWord.from + 2 : noteWord.from + 1;

					const options: Completion[] = noteSuggestions.map((note, index) => {
						const detailText = note.isRecent ? '🕒 Recent • Note' : 'Note';
						const boost = note.isRecent ? 100 - index : 0;
						return {
							label: note.name,
							detail: detailText,
							type: 'variable',
							boost,
							apply: (view: EditorView, completion: Completion, from: number, to: number) => {
								const doc = view.state.doc.toString();
								const slashPos = noteWord.from;
								let end = to;
								if (doc.slice(end, end + 1) === '"') {
									end += 1;
								}
								const insert = `/"${note.name}" `;
								view.dispatch({
									changes: { from: slashPos, to: end, insert },
									selection: { anchor: slashPos + insert.length },
								});
							},
						};
					});

					return {
						from: fromPos,
						options,
					};
				}

				// 3. Header autocomplete on '@'
				const headerWord = context.matchBefore(/@(?:"[^"]*|[^\n/]*)$/);
				if (headerWord) {
					const docText = context.state.doc.toString();
					const noteName = extractNoteNameFromDoc(docText);
					const headers = getHeaders(noteName);
					const isQuoted = headerWord.text.startsWith('@"');
					const fromPos = isQuoted ? headerWord.from + 2 : headerWord.from + 1;
					const typed = isQuoted
						? headerWord.text.slice(2).trim()
						: headerWord.text.slice(1).trim();

					const options: Completion[] = headers.map((h, index) => {
						const detailText = h.isRecent
							? `🕒 Recent • H${h.level}`
							: `H${h.level}`;
						const boost = h.isRecent ? 100 - index : 0;
						return {
							label: h.heading,
							detail: detailText,
							type: 'keyword',
							boost,
							apply: (view: EditorView, completion: Completion, from: number, to: number) => {
								const doc = view.state.doc.toString();
								const atPos = headerWord.from;
								let end = to;
								if (doc.slice(end, end + 1) === '"') {
									end += 1;
								}
								const insert = `@"${h.heading}" `;
								view.dispatch({
									changes: { from: atPos, to: end, insert },
									selection: { anchor: atPos + insert.length },
								});
							},
						};
					});

					if (typed && !headers.some((h) => h.heading.toLowerCase() === typed.toLowerCase())) {
						const hashes = '#'.repeat(Math.max(1, Math.min(6, newHeaderLevel)));
						options.push({
							label: typed,
							detail: `✨ Will create ${hashes} ${typed}`,
							type: 'text',
							boost: -1,
							apply: (view: EditorView, completion: Completion, from: number, to: number) => {
								const doc = view.state.doc.toString();
								const atPos = headerWord.from;
								let end = to;
								if (doc.slice(end, end + 1) === '"') {
									end += 1;
								}
								const insert = `@"${typed}" `;
								view.dispatch({
									changes: { from: atPos, to: end, insert },
									selection: { anchor: atPos + insert.length },
								});
							},
						});
					}

					return {
						from: fromPos,
						options,
					};
				}

				return null;
			},
		],
	});

	// 3. Auto-pair input handler for '/', '@', and '[' plus closing step-overs
	const autoPairInputHandler = EditorView.inputHandler.of(
		(view: EditorView, from: number, to: number, text: string): boolean => {
			const doc = view.state.doc;

			// Auto-pair '/' -> /""
			if (text === '/') {
				if (from !== to) {
					const selected = doc.sliceString(from, to);
					const insert = `/"${selected}"`;
					view.dispatch({
						changes: { from, to, insert },
						selection: { anchor: from + insert.length },
					});
					return true;
				}

				const needsLeadingSpace =
					from > 0 && !/\s/.test(doc.sliceString(from - 1, from));
				const insert = needsLeadingSpace ? ' /""' : '/""';
				const caretOffset = needsLeadingSpace ? 3 : 2;

				view.dispatch({
					changes: { from, to, insert },
					selection: { anchor: from + caretOffset },
				});
				window.setTimeout(() => {
					startCompletion(view);
				}, 20);
				return true;
			}

			// Auto-pair '@' -> @""
			if (text === '@') {
				if (from !== to) {
					const selected = doc.sliceString(from, to);
					const insert = `@"${selected}"`;
					view.dispatch({
						changes: { from, to, insert },
						selection: { anchor: from + insert.length },
					});
					return true;
				}

				const needsLeadingSpace =
					from > 0 && !/\s/.test(doc.sliceString(from - 1, from));
				const insert = needsLeadingSpace ? ' @""' : '@""';
				const caretOffset = needsLeadingSpace ? 3 : 2;

				view.dispatch({
					changes: { from, to, insert },
					selection: { anchor: from + caretOffset },
				});
				window.setTimeout(() => {
					startCompletion(view);
				}, 20);
				return true;
			}

			// Auto-pair '[' -> [[]]
			if (text === '[') {
				if (from !== to) {
					const selected = doc.sliceString(from, to);
					const insert = `[[${selected}]]`;
					view.dispatch({
						changes: { from, to, insert },
						selection: { anchor: from + insert.length },
					});
					return true;
				}

				// If already between [[ and ]], typing '[' keeps caret inside
				if (
					from >= 2 &&
					from + 2 <= doc.length &&
					doc.sliceString(from - 2, from) === '[[' &&
					doc.sliceString(from, from + 2) === ']]'
				) {
					return true;
				}

				// If immediately after a single '[', convert to [[]]
				if (from > 0 && doc.sliceString(from - 1, from) === '[') {
					const after = doc.sliceString(from, from + 1);
					if (after === ']') {
						view.dispatch({
							changes: [
								{ from: from, to: from, insert: '[' },
								{ from: from + 1, to: from + 1, insert: ']' },
							],
							selection: { anchor: from + 1 },
						});
					} else {
						view.dispatch({
							changes: [{ from: from, to: from, insert: '[]]' }],
							selection: { anchor: from + 1 },
						});
					}
					window.setTimeout(() => {
						startCompletion(view);
					}, 20);
					return true;
				}

				const needsLeadingSpace =
					from > 0 && !/\s/.test(doc.sliceString(from - 1, from));
				const insert = needsLeadingSpace ? ' [[]]' : '[[]]';
				const caretOffset = needsLeadingSpace ? 3 : 2;

				view.dispatch({
					changes: { from, to, insert },
					selection: { anchor: from + caretOffset },
				});
				window.setTimeout(() => {
					startCompletion(view);
				}, 20);
				return true;
			}

			// Step-over closing quote '"'
			if (text === '"' && from === to) {
				if (from < doc.length && doc.sliceString(from, from + 1) === '"') {
					view.dispatch({
						selection: { anchor: from + 1 },
					});
					return true;
				}
			}

			// Step-over closing ']' or ']]'
			if (text === ']' && from === to) {
				if (from + 2 <= doc.length && doc.sliceString(from, from + 2) === ']]') {
					view.dispatch({
						selection: { anchor: from + 2 },
					});
					return true;
				}
				if (from < doc.length && doc.sliceString(from, from + 1) === ']') {
					view.dispatch({
						selection: { anchor: from + 1 },
					});
					return true;
				}
			}

			return false;
		}
	);

	// 4. Single-line transaction filter (strips newlines)
	const singleLineFilter = EditorState.transactionFilter.of((tr) => {
		if (tr.docChanged) {
			const text = tr.newDoc.toString();
			if (text.includes('\n') || text.includes('\r')) {
				return [];
			}
		}
		return tr;
	});

	// 5. Custom keymap for Enter, Escape, and atomic Backspace
	const modalKeymap = Prec.highest(
		keymap.of([
			{
				key: 'Enter',
				run: (view) => {
					if (acceptCompletion(view)) {
						return true;
					}
					onSubmit();
					return true;
				},
			},
			{
				key: 'Escape',
				run: (view) => {
					if (closeCompletion(view)) {
						return true;
					}
					onCancel();
					return true;
				},
			},
			{
				key: 'Backspace',
				run: (view: EditorView) => {
					const { from, to } = view.state.selection.main;
					if (from !== to) return false;

					const doc = view.state.doc;
					const docLen = doc.length;

					// Check for /"" (caret inside empty quotes: /|"|)
					if (from >= 2 && from + 1 <= docLen) {
						const before = doc.sliceString(from - 2, from);
						const after = doc.sliceString(from, from + 1);
						if (before === '/"' && after === '"') {
							let deleteFrom = from - 2;
							if (
								deleteFrom > 0 &&
								doc.sliceString(deleteFrom - 1, deleteFrom) === ' '
							) {
								deleteFrom -= 1;
							}
							view.dispatch({
								changes: { from: deleteFrom, to: from + 1, insert: '' },
								selection: { anchor: deleteFrom },
							});
							return true;
						}
					}

					// Check for @"" (caret inside empty quotes: @"|"|)
					if (from >= 2 && from + 1 <= docLen) {
						const before = doc.sliceString(from - 2, from);
						const after = doc.sliceString(from, from + 1);
						if (before === '@"' && after === '"') {
							let deleteFrom = from - 2;
							if (
								deleteFrom > 0 &&
								doc.sliceString(deleteFrom - 1, deleteFrom) === ' '
							) {
								deleteFrom -= 1;
							}
							view.dispatch({
								changes: { from: deleteFrom, to: from + 1, insert: '' },
								selection: { anchor: deleteFrom },
							});
							return true;
						}
					}

					// Check for [[]] (caret inside empty wikilink: [[|]])
					if (from >= 2 && from + 2 <= docLen) {
						const before = doc.sliceString(from - 2, from);
						const after = doc.sliceString(from, from + 2);
						if (before === '[[' && after === ']]') {
							let deleteFrom = from - 2;
							if (
								deleteFrom > 0 &&
								doc.sliceString(deleteFrom - 1, deleteFrom) === ' '
							) {
								deleteFrom -= 1;
							}
							view.dispatch({
								changes: { from: deleteFrom, to: from + 2, insert: '' },
								selection: { anchor: deleteFrom },
							});
							return true;
						}
					}

					// Check for [] (caret inside empty brackets: [|])
					if (from >= 1 && from + 1 <= docLen) {
						const before = doc.sliceString(from - 1, from);
						const after = doc.sliceString(from, from + 1);
						if (before === '[' && after === ']') {
							let deleteFrom = from - 1;
							if (
								deleteFrom > 0 &&
								doc.sliceString(deleteFrom - 1, deleteFrom) === ' '
							) {
								deleteFrom -= 1;
							}
							view.dispatch({
								changes: { from: deleteFrom, to: from + 1, insert: '' },
								selection: { anchor: deleteFrom },
							});
							return true;
						}
					}

					return false;
				},
			},
		])
	);

	return [
		highlightPlugin,
		autocompleteExtension,
		autoPairInputHandler,
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
 * Inserts a sign or word (e.g. '/', '@', '#', '[[', 'tod') at cursor in a CodeMirror 6 EditorView.
 * Automatically handles quote/bracket auto-pairing, adds leading space if needed, and triggers completion.
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
	let cursorOffset = symbol.length;

	const selectedText = sel.from !== sel.to ? doc.sliceString(sel.from, sel.to) : '';

	if (symbol === '/') {
		if (selectedText) {
			textToInsert = `/"${selectedText}"`;
			cursorOffset = textToInsert.length;
		} else {
			textToInsert = '/""';
			cursorOffset = 2; // place cursor inside quotes: /|"|
		}
	} else if (symbol === '@') {
		if (selectedText) {
			textToInsert = `@"${selectedText}"`;
			cursorOffset = textToInsert.length;
		} else {
			textToInsert = '@""';
			cursorOffset = 2; // place cursor inside quotes: @"|"|
		}
	} else if (symbol === '[[') {
		if (selectedText) {
			textToInsert = `[[${selectedText}]]`;
			cursorOffset = textToInsert.length;
		} else {
			textToInsert = '[[]]';
			cursorOffset = 2; // place cursor inside brackets: [[|]]
		}
	}

	if (sel.from === sel.to && pos > 0) {
		const prevChar = doc.sliceString(pos - 1, pos);
		if (prevChar !== ' ' && prevChar !== '\t' && prevChar !== '\n') {
			textToInsert = ' ' + textToInsert;
			cursorOffset += 1;
		}
	}

	view.dispatch({
		changes: { from: sel.from, to: sel.to, insert: textToInsert },
		selection: { anchor: sel.from + cursorOffset },
	});
	view.focus();

	if (triggerCompletion) {
		window.setTimeout(() => {
			startCompletion(view);
		}, 30);
	}
}
