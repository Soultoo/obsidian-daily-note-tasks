import esbuild from 'esbuild';
import process from 'process';

await esbuild.build({
	entryPoints: ['tests/suite.ts'],
	bundle: true,
	format: 'esm',
	platform: 'node',
	target: 'node18',
	outfile: 'tests/dist/suite.mjs',
	plugins: [
		{
			name: 'mock-obsidian',
			setup(build) {
				build.onResolve({ filter: /^obsidian$/ }, (args) => ({
					path: args.path,
					namespace: 'obsidian-mock',
				}));
				build.onLoad({ filter: /.*/, namespace: 'obsidian-mock' }, () => ({
					contents: `
						import moment from 'moment';
						export { moment };
						export class Notice { constructor(msg) { this.msg = msg; } }
						export class TFile {}
						export class TFolder {}
						export class Vault {}
						export function normalizePath(p) { return p; }
						export class Plugin {}
						export class Modal {}
						export class PluginSettingTab { constructor(app, plugin) { this.app = app; this.plugin = plugin; this.containerEl = { empty() {}, createEl() {}, createDiv() {} }; } }
						export class Setting {
							constructor(el) { this.settingEl = { style: {} }; }
							setName() { return this; }
							setDesc() { return this; }
							addToggle() { return this; }
							addDropdown() { return this; }
							addText() { return this; }
							addButton() { return this; }
							setClass() { return this; }
						}
						export class MarkdownView {}
					`,
					resolveDir: process.cwd(),
					loader: 'js',
				}));
			},
		},
	],
});
