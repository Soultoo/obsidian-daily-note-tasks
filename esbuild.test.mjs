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
						export class PluginSettingTab {}
						export class MarkdownView {}
					`,
					resolveDir: process.cwd(),
					loader: 'js',
				}));
			},
		},
	],
});
