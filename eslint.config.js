import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

/**
 * Lint-Regeln.
 *
 * Der Typprüfer nimmt dem Linter das meiste ab — `strict`,
 * `noUncheckedIndexedAccess` und `exactOptionalPropertyTypes` sind an, und was
 * `tsc` bereits meldet, muss hier nicht noch einmal stehen. Übrig bleibt genau
 * das, was ein Typsystem nicht sieht:
 *
 * - **Vergessenes `await`.** Ein nicht abgewartetes Promise ist typkorrekt und
 *   trotzdem ein Fehler. Das Autospeichern in `store.ts` ist die einzige Stelle,
 *   an der das Absicht ist — sie steht dort mit `void` markiert.
 * - **Toter Code.** Ungenutzte Variablen und Importe sammeln sich in einem
 *   wachsenden Projekt still an.
 * - **`any`.** Nicht verboten, aber gemeldet: an den paar Stellen, wo eine
 *   fremde Bibliothek nichts Besseres hergibt, steht ein `eslint-disable` mit
 *   Begründung — und das ist mehr, als ein stilles `any` je gesagt hätte.
 * - **Abhängigkeiten von React-Hooks.** Der klassische Fehler, den kein
 *   Typsystem findet: ein `useMemo`, das eine veraltete Zahl festhält.
 *
 * Bewusst **nicht** eingerichtet: ein Formatierer. Die Formatierung ist im
 * Bestand einheitlich, und ein Werkzeug, das jede Datei anfasst, macht jede
 * spätere Änderung schwerer zu lesen.
 */

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.vite/**',
      'apps/web/public/**',
      'data/**/out/**',
      'eslint.config.js',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,

  {
    languageOptions: {
      parserOptions: {
        // Ohne Projektbezug gäbe es keine typbewussten Regeln — und genau die
        // sind der Grund, hier überhaupt einen Linter zu haben.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Ein `_`-Präfix heisst „absichtlich ungenutzt". Es steht im Bestand an
      // jeder Stelle, an der eine Eigenschaft per Rest-Muster entfernt wird.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-floating-promises': 'error',

      // Diese drei melden in einer Codebasis mit `unknown`-Eingaben (Spielstände,
      // Wikidata-Antworten) fast nur Stellen, an denen die Prüfung danebensteht.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
    },
  },

  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },

  {
    // Tests dürfen `as never` benutzen, um ein Fahrzeug mit drei Feldern zu
    // bauen. Die Alternative wäre, in jedem Test ein vollständiges Objekt zu
    // konstruieren — das prüfte dann den Aufbau und nicht mehr die Sache.
    files: ['**/*.test.ts', 'tools/**/*.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
)
