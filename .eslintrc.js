// ESLint configuration.
//
// `package.json` has declared `"lint": "next lint"` for the life of this
// project, but eslint and eslint-config-next were never installed and no CI
// job ever invoked it — so the script has never run once. A declared
// capability that does not exist, the same family as #443's gate that could
// not fail and #426's coverage tier that was a comment rather than a
// property. Adopting it rather than deleting the script, because the first
// real run found things.
//
// ## What the first run found
//
// 25 errors, 30 warnings. The errors broke down as:
//
//   18  react/no-unescaped-entities   — fixed, not silenced
//    4  @typescript-eslint/...        — rule was not even LOADED (below)
//    3  react-hooks/rules-of-hooks    — two naming false positives (below)
//
// ## Why `rules-of-hooks` is off for API routes only
//
// The rule identifies hooks by the `use` prefix, and it cannot tell a React
// hook from an ordinary function that happens to start with "use". It flagged
// `SafetyService.useXCard(...)` inside `src/app/api/.../xcard/route.ts`.
//
// "Use the X-Card" is the actual tabletop safety-tool term, so that method is
// named correctly for its domain; it simply collides with a React convention.
// And the site is an API ROUTE — server-only, no React, no render, so a hook
// violation is not merely unlikely there but impossible. A rule that can only
// produce false positives in a directory is switched off for that directory,
// which is a statement about the category rather than a line-by-line silence.
//
// It stays ON everywhere else, because everywhere else it is a correctness
// rule and hook-order bugs are real. The other flagged site was a genuine
// naming problem in a component and was RENAMED
// (useSuggestion -> applySuggestion) rather than exempted.
module.exports = {
  extends: 'next/core-web-vitals',

  // eslint-config-next ships the @typescript-eslint plugin and sets the
  // parser, but does not register the plugin's rules. Without this, the four
  // pre-existing `// eslint-disable-next-line @typescript-eslint/no-explicit-any`
  // comments in the tree fail with "Definition for rule ... was not found" —
  // an ERROR, so the codebase's own suppression comments broke the lint run.
  //
  // Declaring the plugin makes those comments resolve. Deliberately NOT
  // extending plugin:@typescript-eslint/recommended: that would turn on a
  // large ruleset across 349 files in the same change that introduces linting
  // at all, and a first adoption that dumps hundreds of findings is one
  // nobody reads. A separate, deliberate change if it is ever wanted.
  plugins: ['@typescript-eslint'],

  ignorePatterns: [
    '.next/',
    'node_modules/',
    'coverage/',
    'prisma/migrations/',
  ],

  overrides: [
    {
      // See the header. Server-only route handlers cannot contain React
      // hooks, so the `use`-prefix heuristic has nothing true to say here.
      files: ['src/app/api/**'],
      rules: { 'react-hooks/rules-of-hooks': 'off' },
    },
  ],
}
