import { App, CachedMetadata, Editor, TFile } from 'obsidian';

export interface ExtractedTaskBlock {
	fullText: string;
	startLine: number;
	endLine: number;
	headerName: string | null;
}

export class TaskAstParser {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * Extracts the list item (and any indented children/notes) at the current cursor line.
	 */
	public extractTaskAtCursor(
		editor: Editor,
		file: TFile
	): ExtractedTaskBlock | null {
		const cursor = editor.getCursor();
		const currentLineNum = cursor.line;
		const totalLines = editor.lineCount();
		const currentLineText = editor.getLine(currentLineNum);

		const cache = this.app.metadataCache.getFileCache(file);
		const listItems = cache?.listItems || [];

		// Find list item matching or enclosing cursor line
		let targetItem = listItems.find(
			(item) =>
				item.position.start.line <= currentLineNum &&
				item.position.end.line >= currentLineNum
		);

		let startLine = currentLineNum;
		let startIndent = 0;

		if (targetItem) {
			startLine = targetItem.position.start.line;
			const lineStr = editor.getLine(startLine);
			const indentMatch = lineStr.match(/^(\s*)/);
			startIndent = indentMatch ? indentMatch[1]?.length || 0 : 0;
		} else {
			// Fallback: check if line starts with a list bullet
			const bulletMatch = currentLineText.match(/^(\s*)[-*+]\s+/);
			if (!bulletMatch) {
				return null;
			}
			startIndent = bulletMatch[1]?.length || 0;
		}

		// Find endLine: all subsequent lines with greater indentation or child items
		let endLine = startLine;
		for (let lineIdx = startLine + 1; lineIdx < totalLines; lineIdx++) {
			const lineStr = editor.getLine(lineIdx);

			// If empty line, peek ahead to see if indented content continues
			if (!lineStr.trim()) {
				let hasIndentedContinuation = false;
				for (let peekIdx = lineIdx + 1; peekIdx < totalLines; peekIdx++) {
					const peekLine = editor.getLine(peekIdx);
					if (!peekLine.trim()) continue; // keep skipping empty lines
					const peekIndentMatch = peekLine.match(/^(\s*)/);
					const peekIndent = peekIndentMatch ? peekIndentMatch[1]?.length || 0 : 0;
					if (peekIndent > startIndent) {
						hasIndentedContinuation = true;
					}
					break;
				}

				if (hasIndentedContinuation) {
					endLine = lineIdx;
					continue;
				} else {
					break;
				}
			}

			const lineIndentMatch = lineStr.match(/^(\s*)/);
			const lineIndent = lineIndentMatch ? lineIndentMatch[1]?.length || 0 : 0;

			// If indentation is greater, it's a child bullet or note
			if (lineIndent > startIndent) {
				endLine = lineIdx;
			} else {
				// Reached a sibling or parent bullet, or unindented text
				break;
			}
		}

		// Collect the text block
		const lines: string[] = [];
		for (let i = startLine; i <= endLine; i++) {
			lines.push(editor.getLine(i));
		}
		const fullText = lines.join('\n');

		// Detect parent header under which this task resides
		const headerName = this.findEnclosingHeader(cache, startLine);

		return {
			fullText,
			startLine,
			endLine,
			headerName,
		};
	}

	/**
	 * Finds the nearest Markdown heading preceding the given line.
	 */
	private findEnclosingHeader(
		cache: CachedMetadata | null,
		lineNum: number
	): string | null {
		if (!cache || !cache.headings || cache.headings.length === 0) {
			return null;
		}

		let nearestHeader: string | null = null;
		for (const h of cache.headings) {
			if (h.position.start.line < lineNum) {
				nearestHeader = h.heading;
			} else {
				break;
			}
		}

		if (nearestHeader) {
			return nearestHeader.replace(/[*_`#[\]@]/g, '').trim();
		}

		return null;
	}
}
