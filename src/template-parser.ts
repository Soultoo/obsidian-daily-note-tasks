import { App, TFile } from 'obsidian';
import { getDailyNoteSettings } from 'obsidian-daily-notes-interface';
import { TemplateHeader } from './types';

export class TemplateParser {
	private app: App;
	private cachedHeaders: TemplateHeader[] = [];

	constructor(app: App) {
		this.app = app;
	}

	public async loadHeaders(): Promise<TemplateHeader[]> {
		const settings = getDailyNoteSettings();
		const templatePath = settings.template;

		if (!templatePath) {
			this.cachedHeaders = this.getDefaultHeaders();
			return this.cachedHeaders;
		}

		let file = this.app.vault.getAbstractFileByPath(templatePath);
		if (!file && !templatePath.endsWith('.md')) {
			file = this.app.vault.getAbstractFileByPath(`${templatePath}.md`);
		}

		if (!(file instanceof TFile)) {
			const files = this.app.vault.getMarkdownFiles();
			const matched = files.find(
				(f) =>
					f.path === templatePath ||
					f.basename === templatePath ||
					f.name === templatePath
			);
			if (matched) {
				file = matched;
			}
		}

		if (!(file instanceof TFile)) {
			this.cachedHeaders = this.getDefaultHeaders();
			return this.cachedHeaders;
		}

		const cache = this.app.metadataCache.getFileCache(file);
		if (cache && cache.headings && cache.headings.length > 0) {
			this.cachedHeaders = cache.headings.map((h) => ({
				heading: this.cleanHeading(h.heading),
				level: h.level,
				fullText: `${'#'.repeat(h.level)} ${h.heading}`,
			}));
			return this.cachedHeaders;
		}

		const content = await this.app.vault.read(file);
		const lines = content.split('\n');
		const headers: TemplateHeader[] = [];

		for (const line of lines) {
			const match = line.match(/^(#{1,6})\s+(.+)$/);
			if (match && match[1] && match[2]) {
				const level = match[1].length;
				const rawHeading = match[2].trim();
				headers.push({
					heading: this.cleanHeading(rawHeading),
					level,
					fullText: line.trim(),
				});
			}
		}

		this.cachedHeaders = headers.length > 0 ? headers : this.getDefaultHeaders();
		return this.cachedHeaders;
	}

	public getHeaders(recentHeaders: string[] = []): TemplateHeader[] {
		const baseHeaders =
			this.cachedHeaders.length > 0 ? this.cachedHeaders : this.getDefaultHeaders();

		if (!recentHeaders || recentHeaders.length === 0) {
			return baseHeaders;
		}

		// Sort by recency: headers in recentHeaders first, then remaining
		const recentList: TemplateHeader[] = [];
		const remainingList: TemplateHeader[] = [];

		for (const recentName of recentHeaders) {
			const found = baseHeaders.find(
				(h) => h.heading.toLowerCase() === recentName.toLowerCase()
			);
			if (found) {
				recentList.push({ ...found, isRecent: true });
			} else {
				// If a custom recent header was used that wasn't in template
				recentList.push({
					heading: recentName,
					level: 3,
					fullText: `### ${recentName}`,
					isRecent: true,
				});
			}
		}

		for (const h of baseHeaders) {
			if (!recentList.some((r) => r.heading.toLowerCase() === h.heading.toLowerCase())) {
				remainingList.push(h);
			}
		}

		return [...recentList, ...remainingList];
	}

	public getHeaderNames(recentHeaders: string[] = []): string[] {
		return this.getHeaders(recentHeaders).map((h) => h.heading);
	}

	private cleanHeading(heading: string): string {
		return heading
			.replace(/\[\[(.*?)\]\]/g, '$1')
			.replace(/[*_`]/g, '')
			.trim();
	}

	private getDefaultHeaders(): TemplateHeader[] {
		return [
			{ heading: 'Todos', level: 3, fullText: '### Todos' },
			{ heading: 'Written plan', level: 4, fullText: '#### Written plan' },
			{ heading: '2 minute stuff', level: 5, fullText: '##### 2 minute stuff' },
			{ heading: '20 minute stuff', level: 5, fullText: '##### 20 minute stuff' },
			{ heading: 'Generic checkboxes', level: 4, fullText: '#### Generic checkboxes' },
			{ heading: 'Memos', level: 3, fullText: '### Memos' },
			{ heading: 'Review', level: 3, fullText: '### Review' },
		];
	}
}
