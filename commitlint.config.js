// Conventional Commits enforcement per platform ADR-0002.
// Used by .pre-commit-config.yaml's commitlint hook.

export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'header-max-length': [2, 'always', 100],
    'body-max-line-length': [1, 'always', 100],
    'type-enum': [
      2,
      'always',
      ['feat', 'fix', 'chore', 'docs', 'refactor', 'test', 'ci', 'perf', 'build', 'revert', 'deps'],
    ],
  },
};
