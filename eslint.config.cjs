const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier');

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      'logs/**',
      'src/models/plugins/**',
    ],
  },
  {
    // Node globals for the standalone verification and seed scripts. They are
    // CommonJS entry points run directly by `node scripts/...`, not modules loaded
    // by the Express app, so the `src/**` globals block below does not apply to
    // them. Without this every `console.log` and `require` in a verify script is a
    // `no-undef` error and the suite cannot be linted — which is how scripts
    // rot. Pre-existing scripts inherited the same errors before this block.
    files: ['scripts/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        // The block above covered only half the runtime. Verify scripts use
        // these freely (timers, require/module, Buffer) and each one was a
        // spurious `no-undef` before this.
        require: 'readonly',
        module: 'readonly',
        exports: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        setImmediate: 'readonly',
        clearImmediate: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
    },
  },
  js.configs.recommended,
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'commonjs',
      globals: {
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        // `Buffer` is a Node global, not one of the CommonJS-scoped names the
        // parser already knows about, so without it every `Buffer.alloc` in
        // `src/**` is a spurious `no-undef` — including the pre-existing hits in
        // `src/middlewares/upload.js`.
        Buffer: 'readonly',
      },
    },
    rules: {
      'no-console': 'off',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/services/**/*.js'],
    rules: {
      'no-useless-assignment': 'off',
    },
  },
  prettierConfig,
];
