import { MarkdownView, moment } from 'obsidian';

if (typeof (global as any).window === 'undefined') {
	(global as any).window = global;
}
import { parseTaskInput } from '../src/parser';
import { DailyNoteManager } from '../src/daily-note-manager';
import { RecurringBlueprint, RecurringManager, formatCursiveTask } from '../src/recurring-manager';
import { isRecurrenceDue, parseRecurrenceFromText } from '../src/recurrence-parser';
import { TaskAstParser } from '../src/task-ast';
import { applyTimeToMovedTask } from '../src/move-modal';
import { DailyNoteTasksSettingTab } from '../src/settings';
import { DEFAULT_SETTINGS } from '../src/types';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string, details?: string) {
	if (condition) {
		passed++;
		console.log(`  PASS: ${testName}`);
	} else {
		failed++;
		console.error(`  FAIL: ${testName}${details ? ` -> ${details}` : ''}`);
	}
}

function assertEqual<T>(actual: T, expected: T, testName: string) {
	const match = JSON.stringify(actual) === JSON.stringify(expected);
	assert(match, testName, `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

console.log('\n=== RUNNING DAILY NOTE TASKS STRESS TEST SUITE ===\n');

const templateHeaders = [
	'Written plan',
	'Todos',
	'2 minute stuff',
	'20 minute stuff',
	'Generic checkboxes',
	'Memos',
	'Review',
	'Overall plan',
];

// ----------------------------------------------------
// 1. Target Note ('/note') Tests
// ----------------------------------------------------
console.log('--- 1. Target Note ("/note") Tests ---');

// Test 1.1: Target note with custom header
{
	const r = parseTaskInput('Buy apples and bananas /groceries @Produce', templateHeaders);
	assertEqual(r.targetNote, 'groceries', 'target note: extracted /groceries');
	assertEqual(r.header, 'Produce', 'target note: extracted @Produce');
	assertEqual(r.cleanText, 'Buy apples and bananas', 'target note: cleanText is clean');
}

// Test 1.2: Target note without @header (defaults to ## Todos)
{
	const r = parseTaskInput('Milk and eggs /groceries', templateHeaders);
	assertEqual(r.targetNote, 'groceries', 'target note: extracted /groceries');
	assertEqual(r.header, 'Todos', 'target note: defaulted header to Todos');
	assertEqual(r.cleanText, 'Milk and eggs', 'target note: cleanText is Milk and eggs');
}

// Test 1.3: Quoted target note with spaces
{
	const r = parseTaskInput('Finish slides /"Project Apollo" @Work tod 14:00', templateHeaders);
	assertEqual(r.targetNote, 'Project Apollo', 'target note: extracted quoted /"Project Apollo"');
	assertEqual(r.header, 'Work', 'target note: extracted @Work');
	assertEqual(r.finalTaskText, 'Finish slides 14:00', 'target note: finalTaskText preserves time');
	assertEqual(r.date?.format('YYYY-MM-DD'), moment().format('YYYY-MM-DD'), 'target note: date is today');
}

// Test 1.4: Quoted target note with spaces and emoji header
{
	const r = parseTaskInput('Fix critical bug /"Obsidian plugin development with agents" @"⚓ Anchor"', templateHeaders);
	assertEqual(r.targetNote, 'Obsidian plugin development with agents', 'target note: extracted quoted note with spaces');
	assertEqual(r.header, '⚓ Anchor', 'target note: extracted quoted header with emoji and spaces');
	assertEqual(r.cleanText, 'Fix critical bug', 'target note: cleanText is clean');
}

// Test 1.5: Target note with quoted Swedish header
{
	const r = parseTaskInput('mjölk /Groceries @"Ej mataffär"', templateHeaders);
	assertEqual(r.targetNote, 'Groceries', 'target note: extracted /Groceries');
	assertEqual(r.header, 'Ej mataffär', 'target note: extracted @"Ej mataffär"');
	assertEqual(r.cleanText, 'mjölk', 'target note: cleanText does not contain header text');
}

// Test 1.6: Dynamic note headers (unquoted header with spaces matched against note headers)
{
	const groceriesHeaders = ['Ej mataffär', 'Frukt & Grönt', 'Mejeri', ...templateHeaders];
	const r = parseTaskInput('/Groceries @Ej mataffär köpa smör', groceriesHeaders);
	assertEqual(r.targetNote, 'Groceries', 'target note: extracted /Groceries');
	assertEqual(r.header, 'Ej mataffär', 'target note: matched unquoted @Ej mataffär from note headers');
	assertEqual(r.cleanText, 'köpa smör', 'target note: cleanText is solely the task text');
}

// ----------------------------------------------------
// 2. NLP Parser & Bug Fix Tests
// ----------------------------------------------------
console.log('\n--- 2. NLP Parser & Bug Fix Tests ---');

// Test 2.1: BUG FIX for "#mobile @20 minute stuff "
{
	const r = parseTaskInput('#mobile @20 minute stuff ', templateHeaders);
	assertEqual(r.header, '20 minute stuff', 'bugfix 20min: matched header @20 minute stuff');
	assert(!r.hasTime, 'bugfix 20min: did NOT falsely parse "20 minute" as a time of day');
	assert(r.timeStr === null, 'bugfix 20min: timeStr is null');
	assertEqual(r.cleanText, '#mobile', 'bugfix 20min: cleanText is #mobile');
}

// Test 2.2: Natural time placement
{
	const r = parseTaskInput('Meeting at 14:00 with team tod @Todos', templateHeaders);
	assertEqual(r.header, 'Todos', 'natural time: header is Todos');
	assertEqual(r.finalTaskText, 'Meeting at 14:00 with team', 'natural time: preserved "at 14:00" in sentence flow');

	const r2 = parseTaskInput('14:00 Team sync tod @Todos', templateHeaders);
	assertEqual(r2.finalTaskText, '14:00 Team sync', 'natural time: preserved prefix time');
}

// Test 2.3: Year differentiation (Jan 3 2027 vs Jan 3 2028)
{
	const r2027 = parseTaskInput('Conference Jan 3 2027 @Todos', templateHeaders);
	const r2028 = parseTaskInput('Conference Jan 3 2028 @Todos', templateHeaders);
	assertEqual(r2027.date?.format('YYYY-MM-DD'), '2027-01-03', 'year: parsed 2027 correctly');
	assertEqual(r2028.date?.format('YYYY-MM-DD'), '2028-01-03', 'year: parsed 2028 correctly');
	assert(r2027.date?.year() !== r2028.date?.year(), 'year: differentiated years');
}

// Test 2.4: 'tod' shortcut
{
	const r = parseTaskInput('Buy milk tod @Todos', templateHeaders);
	assert(r.date !== null, 'tod: date recognized');
	assertEqual(r.date?.format('YYYY-MM-DD'), moment().format('YYYY-MM-DD'), 'tod: resolves to today');
	assertEqual(r.header, 'Todos', 'tod: header matches Todos');
	assertEqual(r.cleanText, 'Buy milk', 'tod: cleanText has date and @header stripped');
}

// Test 2.5: Swedish 'idag' (today) & 'imorgon' (tomorrow)
{
	const r = parseTaskInput('Kolla lägenheter idag @2 minute stuff', templateHeaders);
	assertEqual(r.date?.format('YYYY-MM-DD'), moment().format('YYYY-MM-DD'), 'idag: resolves to today');
	assertEqual(r.header, '2 minute stuff', 'idag: matches 2 minute stuff');

	const r2 = parseTaskInput('Städa rummet imorgon @Written plan', templateHeaders);
	assertEqual(r2.date?.format('YYYY-MM-DD'), moment().add(1, 'day').format('YYYY-MM-DD'), 'imorgon: resolves to tomorrow');
	assertEqual(r2.cleanText, 'Städa rummet', 'imorgon: clean text');
}

// Test 2.6: Date mention inside topic name vs action date
{
	const r = parseTaskInput('Discuss Nov 15 release tod @Todos', templateHeaders);
	assertEqual(r.date?.format('YYYY-MM-DD'), moment().format('YYYY-MM-DD'), 'multi-dates: action date "tod" prioritized over topic date "Nov 15"');
	assertEqual(r.cleanText, 'Discuss Nov 15 release', 'multi-dates: topic preserved in task description');
}

// Test 2.7: Punctuation attached to @section
{
	const r = parseTaskInput('Important meeting @Todos: urgent stuff tod', templateHeaders);
	assertEqual(r.header, 'Todos', 'punct: stripped trailing colon from @Todos:');
	assertEqual(r.cleanText, 'Important meeting urgent stuff', 'punct: clean text');
}

// Test 2.8: Native #tags preserved
{
	const r = parseTaskInput('*In och kolla ungdomslägenheter* #mobile tod @2 minute stuff', templateHeaders);
	assertEqual(r.header, '2 minute stuff', 'tags: matches multi-word section');
	assert(r.cleanText.includes('#mobile'), 'tags: preserves #mobile in cleanText');
	assertEqual(r.cleanText, '*In och kolla ungdomslägenheter* #mobile', 'tags: exact cleanText');
}

// ----------------------------------------------------
// 3. NLP Recurrence ("every X Y") Tests
// ----------------------------------------------------
console.log('\n--- 3. NLP Recurrence ("every X Y") Tests ---');

// Test 3.1: Recurrence at START of input (Bugfix: did not swallow task text!)
{
	const r = parseTaskInput('every month on the 1st yay first day thing @Written plan', templateHeaders);
	assert(r.recurrence !== null, 'rec start: recurrence parsed');
	assertEqual(r.recurrence?.unit, 'month', 'rec start: unit is month');
	assertEqual(r.recurrence?.dayOfMonth, 1, 'rec start: day of month is 1');
	assertEqual(r.cleanText, 'yay first day thing', 'rec start: cleanText does NOT include recurrence');
	assertEqual(r.header, 'Written plan', 'rec start: header matches Written plan');
}

// Test 3.2: Recurrence at END of input
{
	const r = parseTaskInput('yay first day thing every month on the 1st @Written plan', templateHeaders);
	assert(r.recurrence !== null, 'rec end: recurrence parsed');
	assertEqual(r.recurrence?.unit, 'month', 'rec end: unit is month');
	assertEqual(r.recurrence?.dayOfMonth, 1, 'rec end: day of month is 1');
	assertEqual(r.cleanText, 'yay first day thing', 'rec end: cleanText matches');
}

// Test 3.3: every 2 days
{
	const r = parseTaskInput('Water the plants every 2 days @Written plan', templateHeaders);
	assert(r.recurrence !== null, 'recurrence: parsed recurrence rule');
	assertEqual(r.recurrence?.interval, 2, 'recurrence: interval is 2');
	assertEqual(r.recurrence?.unit, 'day', 'recurrence: unit is day');
	assertEqual(r.cleanText, 'Water the plants', 'recurrence: cleanText stripped recurrence words');
	assertEqual(r.header, 'Written plan', 'recurrence: header is Written plan');
}

// Test 3.4: every weekday
{
	const r = parseTaskInput('Check support emails every weekday @Todos', templateHeaders);
	assert(r.recurrence !== null, 'recurrence: parsed every weekday');
	assertEqual(r.recurrence?.unit, 'week', 'recurrence: unit is week');
	assertEqual(r.recurrence?.daysOfWeek, [1, 2, 3, 4, 5], 'recurrence: daysOfWeek is Mon-Fri');
	assertEqual(r.cleanText, 'Check support emails', 'recurrence: cleanText stripped recurrence');
}

// Test 3.5: every 3 weeks on friday
{
	const r = parseTaskInput('Sprint review every 3 weeks on friday @Review', templateHeaders);
	assert(r.recurrence !== null, 'recurrence: parsed every 3 weeks on friday');
	assertEqual(r.recurrence?.interval, 3, 'recurrence: interval is 3');
	assertEqual(r.recurrence?.unit, 'week', 'recurrence: unit is week');
	assertEqual(r.recurrence?.daysOfWeek, [5], 'recurrence: day is Friday (5)');
	assertEqual(r.cleanText, 'Sprint review', 'recurrence: cleanText is clean');
}

// Test 3.6: Cursive formatting
{
	assertEqual(formatCursiveTask('Dagbok!'), '*Dagbok!*', 'cursive: wraps normal text');
	assertEqual(formatCursiveTask('*Already italic*'), '*Already italic*', 'cursive: keeps existing italics');
	assertEqual(
		formatCursiveTask('In och kolla ungdomslägenheter #mobile'),
		'*In och kolla ungdomslägenheter* #mobile',
		'cursive: places trailing tags outside asterisks'
	);
}

// ----------------------------------------------------
// 4. Move Task Timestamp Application Tests
// ----------------------------------------------------
console.log('\n--- 4. Move Task Timestamp Application Tests ---');

// Test 4.1: Apply time to task without previous timestamp
{
	const original = '- [ ] Buy groceries\n    - Milk\n    - Eggs';
	const updated = applyTimeToMovedTask(original, '14:00', 'prefix');
	const lines = updated.split('\n');
	assertEqual(lines[0], '- [ ] 14:00 Buy groceries', 'move time: prefixed timestamp into first line');
	assertEqual(lines[1], '    - Milk', 'move time: preserved child bullet 1');
	assertEqual(lines[2], '    - Eggs', 'move time: preserved child bullet 2');
}

// Test 4.2: Replace old timestamp on moved task
{
	const original = '- [ ] 09:30 Team sync';
	const updated = applyTimeToMovedTask(original, '15:00', 'prefix');
	assertEqual(updated, '- [ ] 15:00 Team sync', 'move time: replaced old timestamp');
}

// ----------------------------------------------------
// 5. Daily Note Header Insertion Stress Tests
// ----------------------------------------------------
console.log('\n--- 5. Daily Note Header Insertion Stress Tests ---');

const mockApp: any = { vault: { process: async () => {}, getMarkdownFiles: () => [] } };
const manager = new DailyNoteManager(mockApp);

// Test 5.1: Sub-heading boundary (H3 with H4 subheadings)
{
	const note = `### Todos\n- [ ] Existing direct todo\n\n#### Written plan\n- [ ] Plan item 1\n\n##### 2 minute stuff\n- [ ] Dagbok!\n`;
	const res = manager.insertTaskUnderHeader(note, 'Todos', 'New direct todo');
	const lines = res.content.split('\n');
	const newIdx = lines.findIndex((l) => l.includes('New direct todo'));
	const writtenPlanIdx = lines.findIndex((l) => l.includes('#### Written plan'));
	const existingIdx = lines.findIndex((l) => l.includes('Existing direct todo'));

	assert(newIdx > existingIdx, 'sub-heading boundary: inserted after existing direct todo');
	assert(newIdx < writtenPlanIdx, 'sub-heading boundary: inserted BEFORE #### Written plan');
}

// Test 5.2: Substring collision (Overall plan vs Written plan)
{
	const note = `### Overall plan\n- [ ] Strategy\n\n#### Written plan\n- [ ] Daily action\n`;
	const res = manager.insertTaskUnderHeader(note, 'Written plan', 'New written task');
	const lines = res.content.split('\n');
	const newIdx = lines.findIndex((l) => l.includes('New written task'));
	const writtenPlanIdx = lines.findIndex((l) => l.includes('#### Written plan'));
	const overallPlanIdx = lines.findIndex((l) => l.includes('### Overall plan'));

	assert(newIdx > writtenPlanIdx, 'exact match: inserted after #### Written plan');
	assert(writtenPlanIdx > overallPlanIdx, 'exact match: did not mistake Overall plan for Written plan');
}

// Test 5.3: Custom note target insertion under ## Todos
{
	const note = `# Groceries List\nSome intro text\n`;
	const res = manager.insertTaskUnderHeader(note, 'Todos', 'Buy apples');
	assert(res.content.includes('## Todos'), 'custom note: created ## Todos header');
	assert(res.content.includes('- [ ] Buy apples'), 'custom note: appended Buy apples');
}

// ----------------------------------------------------
// 6. Task AST Caret & Blank Line Tests
// ----------------------------------------------------
console.log('\n--- 6. Task AST Caret & Blank Line Tests ---');

function createMockEditor(lines: string[]) {
	let cursor = { line: 0, ch: 0 };
	return {
		getCursor: () => cursor,
		setCursor: (l: number, c = 0) => (cursor = { line: l, ch: c }),
		getLine: (idx: number) => lines[idx] || '',
		lineCount: () => lines.length,
	} as any;
}

const astParser = new TaskAstParser({
	metadataCache: {
		getFileCache: () => ({
			listItems: [
				{ position: { start: { line: 1, col: 0, offset: 0 }, end: { line: 1, col: 10, offset: 10 } } },
				{ position: { start: { line: 2, col: 4, offset: 15 }, end: { line: 2, col: 20, offset: 31 } } },
				{ position: { start: { line: 4, col: 4, offset: 35 }, end: { line: 4, col: 20, offset: 51 } } },
			],
			headings: [
				{ heading: '#### Written plan', level: 4, position: { start: { line: 0, col: 0, offset: 0 } } },
			],
		}),
	},
} as any);

// Test 6.1: Task item with blank line between indented sub-notes
{
	const lines = [
		'#### Written plan',
		'- [ ] Project kickoff',
		'    - Sub item 1',
		'    ',
		'    - Sub item 2 after empty line',
		'- [ ] Sibling task',
	];
	const editor = createMockEditor(lines);
	editor.setCursor(1, 4);

	const block = astParser.extractTaskAtCursor(editor, {} as any);
	assert(block !== null, 'ast: extracted block');
	assertEqual(block?.startLine, 1, 'ast: startLine is 1');
	assertEqual(block?.endLine, 4, 'ast: endLine encompasses blank line and sub-item 2');
	assert(!block?.fullText.includes('Sibling task'), 'ast: stopped before sibling task');
	assertEqual(block?.headerName, 'Written plan', 'ast: detected preceding header Written plan');
}

// ----------------------------------------------------
// 7. Open Note & Highlight Task Tests
// ----------------------------------------------------
console.log('\n--- 7. Open Note & Highlight Task Tests ---');

{
	let selectedRange: any = null;
	let scrolledRange: any = null;
	let activeLeafFocused = false;

	const mockLines = [
		'# Daily Note',
		'### Todos',
		'- [ ] First task',
		'- [ ] Target task to highlight',
		'- [ ] Third task',
	];

	const mockEditor = {
		lineCount: () => mockLines.length,
		getLine: (i: number) => mockLines[i] || '',
		setSelection: (from: any, to: any) => {
			selectedRange = { from, to };
		},
		scrollIntoView: (range: any, center?: boolean) => {
			scrolledRange = { range, center };
		},
	};

	const mockContainerEl = {
		querySelector: () => ({
			classList: {
				add: () => {},
				remove: () => {},
			},
		}),
	};

	const mockView = {
		file: { path: 'Daily/2026-11-12.md' },
		editor: mockEditor,
		containerEl: mockContainerEl,
	};
	// Prototype setup for instanceof MarkdownView
	Object.setPrototypeOf(mockView, MarkdownView.prototype);

	const mockLeaf = {
		view: mockView,
		openFile: async () => {},
	};

	const mockAppWithLeaf: any = {
		vault: { process: async () => {}, getMarkdownFiles: () => [] },
		workspace: {
			getLeavesOfType: () => [mockLeaf],
			getLeaf: () => mockLeaf,
			setActiveLeaf: (_l: any, _opts: any) => {
				activeLeafFocused = true;
			},
		},
	};

	const mgr = new DailyNoteManager(mockAppWithLeaf);
	await mgr.openAndHighlightTask(
		{ path: 'Daily/2026-11-12.md' } as any,
		3,
		'Target task to highlight'
	);

	assert(activeLeafFocused, 'openAndHighlight: active leaf set and focused');
	assert(selectedRange !== null, 'openAndHighlight: setSelection called');
	assertEqual(selectedRange?.from.line, 3, 'openAndHighlight: selection starts at line 3');
	assertEqual(selectedRange?.from.ch, 0, 'openAndHighlight: selection starts at ch 0');
	assertEqual(
		selectedRange?.to.ch,
		mockLines[3].length,
		'openAndHighlight: selection spans entire line'
	);
	assert(scrolledRange !== null, 'openAndHighlight: scrollIntoView called');
	assertEqual(scrolledRange?.center, true, 'openAndHighlight: centered in viewport');
}

// Test 7.2: Open in new tab with swapToNewTab = true
{
	let getLeafArg = '';
	let openFileOptions: any = null;
	let activeLeafFocused = false;

	const mockLeaf: any = {
		view: Object.setPrototypeOf(
			{
				editor: {
					lineCount: () => 1,
					getLine: () => 'Task line',
					setSelection: () => {},
					scrollIntoView: () => {},
				},
				containerEl: { querySelector: () => null },
			},
			MarkdownView.prototype
		),
		openFile: async (_f: any, opts: any) => {
			openFileOptions = opts;
		},
	};

	const mockAppWithTab: any = {
		vault: { process: async () => {}, getMarkdownFiles: () => [] },
		workspace: {
			getLeaf: (arg: string) => {
				getLeafArg = arg;
				return mockLeaf;
			},
			getLeavesOfType: () => [],
			setActiveLeaf: () => {
				activeLeafFocused = true;
			},
		},
	};

	const mgr = new DailyNoteManager(mockAppWithTab);
	await mgr.openAndHighlightTask(
		{ path: 'Daily/2026-11-12.md' } as any,
		0,
		'Task line',
		true, // openInNewTab
		true // swapToNewTab
	);

	assertEqual(getLeafArg, 'tab', 'openInNewTab: requested tab leaf');
	assertEqual(openFileOptions?.active, true, 'openInNewTab: opened file as active');
	assert(activeLeafFocused, 'openInNewTab: swapped to new tab');
}

// Test 7.3: Open in new tab with swapToNewTab = false
{
	let openFileOptions: any = null;
	let activatedLeaf: any = null;

	const previousLeaf: any = {
		id: 'previous-leaf',
		parent: { selectTab: () => {} },
	};

	const newLeaf: any = {
		id: 'new-tab-leaf',
		view: Object.setPrototypeOf(
			{
				editor: {
					lineCount: () => 1,
					getLine: () => 'Task line',
					setSelection: () => {},
					scrollIntoView: () => {},
				},
				containerEl: { querySelector: () => null },
			},
			MarkdownView.prototype
		),
		openFile: async (_f: any, opts: any) => {
			openFileOptions = opts;
		},
	};

	const mockAppWithTab: any = {
		vault: { process: async () => {}, getMarkdownFiles: () => [] },
		workspace: {
			getActiveViewOfType: () => ({ leaf: previousLeaf }),
			getMostRecentLeaf: () => previousLeaf,
			getLeaf: () => newLeaf,
			getLeavesOfType: () => [],
			setActiveLeaf: (l: any) => {
				activatedLeaf = l;
			},
		},
	};

	const mgr = new DailyNoteManager(mockAppWithTab);
	await mgr.openAndHighlightTask(
		{ path: 'Daily/2026-11-12.md' } as any,
		0,
		'Task line',
		true, // openInNewTab
		false // swapToNewTab (stay in current tab)
	);

	assertEqual(openFileOptions?.active, false, 'openInNewTab background: opened file as inactive');
	assertEqual(activatedLeaf?.id, 'previous-leaf', 'openInNewTab background: kept previous tab active');
}

// ----------------------------------------------------
// 8. Code Block Parser & Prompt Tests
// ----------------------------------------------------
console.log('\n--- 8. Code Block Parser & Prompt Tests ---');

function parseCodeBlockParams(source: string) {
	let targetHeader = '';
	let explicitNote = '';
	let customLabel = '';
	let explicitDate = '';

	const lines = source.split('\n');
	for (const l of lines) {
		const hMatch = l.match(/^\s*(?:header|section)\s*:\s*(.+)$/i);
		if (hMatch && hMatch[1]) targetHeader = hMatch[1].trim();

		const nMatch = l.match(/^\s*(?:note|file|target)\s*:\s*(.+)$/i);
		if (nMatch && nMatch[1]) explicitNote = nMatch[1].trim();

		const lMatch = l.match(/^\s*(?:label|button|text)\s*:\s*(.+)$/i);
		if (lMatch && lMatch[1]) customLabel = lMatch[1].trim();

		const dMatch = l.match(/^\s*date\s*:\s*(.+)$/i);
		if (dMatch && dMatch[1]) explicitDate = dMatch[1].trim();
	}

	return { targetHeader, explicitNote, customLabel, explicitDate };
}

{
	const source = 'note: groceries\nheader: Produce\nlabel: + Buy Food\n';
	const params = parseCodeBlockParams(source);
	assertEqual(params.explicitNote, 'groceries', 'codeblock: parsed explicit note');
	assertEqual(params.targetHeader, 'Produce', 'codeblock: parsed explicit header');
	assertEqual(params.customLabel, '+ Buy Food', 'codeblock: parsed custom label');
}

{
	const source = 'note: today\nheader: Written plan\n';
	const params = parseCodeBlockParams(source);
	assertEqual(params.explicitNote, 'today', 'codeblock: parsed note today');
	assertEqual(params.targetHeader, 'Written plan', 'codeblock: parsed header Written plan');
}

{
	const source = '```task-add\n```';
	const params = parseCodeBlockParams(source);
	assertEqual(params.explicitNote, '', 'codeblock empty: note is empty string');
	assertEqual(params.targetHeader, '', 'codeblock empty: header is empty string');
}

// ----------------------------------------------------
// 9. Declarative Settings Search API Definitions Tests
// ----------------------------------------------------
console.log('\n--- 9. Declarative Settings Search API Definitions Tests ---');

{
	const mockPlugin: any = {
		settings: {
			...DEFAULT_SETTINGS,
			openNoteOnTaskAdd: true,
			openNoteInNewTab: false,
			swapToNewTab: true,
		},
		templateParser: {
			getHeaderNames: () => ['Written plan', 'Todos'],
		},
		saveSettings: async () => {},
	};

	const tab = new DailyNoteTasksSettingTab({} as any, mockPlugin);
	const defs = tab.getSettingDefinitions();

	assert(Array.isArray(defs), 'settings search: returned definitions array');

	const allItems = defs.flatMap((d: any) => (d.items ? d.items : [d]));
	assert(allItems.length > 5, 'settings search: contains multiple definitions');

	const openNoteDef = allItems.find((d: any) => d.control?.key === 'openNoteOnTaskAdd');
	assert(openNoteDef !== undefined, 'settings search: includes openNoteOnTaskAdd definition');
	assertEqual(openNoteDef?.name, 'Open note on task add', 'settings search: openNoteOnTaskAdd name matches');

	const newTabDef = allItems.find((d: any) => d.control?.key === 'openNoteInNewTab');
	assert(newTabDef !== undefined, 'settings search: includes openNoteInNewTab definition');
	assertEqual(newTabDef?.name, 'In new tab', 'settings search: in new tab name matches');
	assertEqual(newTabDef?.visible(), true, 'settings search: in new tab visible when openNoteOnTaskAdd is true');

	const swapTabDef = allItems.find((d: any) => d.control?.key === 'swapToNewTab');
	assert(swapTabDef !== undefined, 'settings search: includes swapToNewTab definition');
	assertEqual(swapTabDef?.name, 'Swap to new tab', 'settings search: swap to new tab name matches');
	assertEqual(swapTabDef?.visible(), false, 'settings search: swap to new tab hidden when openNoteInNewTab is false');

	// Toggle openNoteInNewTab to true
	mockPlugin.settings.openNoteInNewTab = true;
	assertEqual(swapTabDef?.visible(), true, 'settings search: swap to new tab visible when openNoteInNewTab is true');
}

console.log(`\n=== ALL STRESS TESTS COMPLETED: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) {
	process.exit(1);
}
