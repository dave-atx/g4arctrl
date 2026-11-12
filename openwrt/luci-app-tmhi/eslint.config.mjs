// ESLint for the LuCI views. A LuCI module is the body of a function (it
// ends in a top-level `return`), loaded with LuCI's globals in scope.
//   npx --yes eslint -c openwrt/luci-app-tmhi/eslint.config.mjs openwrt/luci-app-tmhi
// The rules are listed rather than imported from @eslint/js, so it runs with
// nothing installed.
const errors = [
	'constructor-super', 'for-direction', 'getter-return', 'no-async-promise-executor',
	'no-case-declarations', 'no-class-assign', 'no-compare-neg-zero', 'no-cond-assign',
	'no-const-assign', 'no-constant-binary-expression', 'no-constant-condition',
	'no-control-regex', 'no-debugger', 'no-delete-var', 'no-dupe-args', 'no-dupe-class-members',
	'no-dupe-else-if', 'no-dupe-keys', 'no-duplicate-case', 'no-empty', 'no-empty-character-class',
	'no-empty-pattern', 'no-ex-assign', 'no-fallthrough', 'no-func-assign', 'no-global-assign',
	'no-import-assign', 'no-invalid-regexp', 'no-irregular-whitespace', 'no-loss-of-precision',
	'no-misleading-character-class', 'no-new-native-nonconstructor', 'no-nonoctal-decimal-escape',
	'no-obj-calls', 'no-octal', 'no-prototype-builtins', 'no-redeclare', 'no-regex-spaces',
	'no-self-assign', 'no-setter-return', 'no-shadow-restricted-names', 'no-sparse-arrays',
	'no-this-before-super', 'no-undef', 'no-unexpected-multiline', 'no-unreachable',
	'no-unsafe-finally', 'no-unsafe-negation', 'no-unsafe-optional-chaining', 'no-unused-labels',
	'no-useless-backreference', 'no-useless-catch', 'no-useless-escape', 'no-with',
	'require-yield', 'use-isnan', 'valid-typeof'
];

// LuCI defines a variable for each 'require foo' (or 'require a.b.c as name')
// line before running the module. Declare those for ESLint, on the first
// line so line numbers stay the same.
const luci = {
	processors: {
		require: {
			preprocess(text) {
				const names = [ ...text.matchAll(/^'require ([\w.]+)(?: as (\w+))?';$/gm) ]
					.map(m => m[2] || m[1].split('.').pop());

				return [ names.length ? '/* global ' + names.join(', ') + ' */ ' + text : text ];
			},
			postprocess: messages => messages.flat(),
			supportsAutofix: false
		}
	}
};

export default [
	{
		files: [ '**/*.js' ],
		plugins: { luci },
		processor: 'luci/require',
		languageOptions: {
			ecmaVersion: 2022,
			sourceType: 'script',
			parserOptions: { ecmaFeatures: { globalReturn: true } },
			globals: {
				L: 'readonly', E: 'readonly', _: 'readonly', N_: 'readonly',
				window: 'readonly', document: 'readonly', location: 'readonly',
				performance: 'readonly', Node: 'readonly', Intl: 'readonly', console: 'readonly'
			}
		},
		rules: Object.assign(Object.fromEntries(errors.map(r => [ r, 'error' ])), {
			'no-unused-vars': [ 'error', { args: 'none' } ]
		})
	}
];
