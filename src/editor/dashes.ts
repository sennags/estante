import { Extension, textInputRule } from '@tiptap/react';

/**
 * The dialogue dash of Portuguese prose, typed with the plain hyphen key:
 * "- " opening a paragraph, " - " between words and "--" all become "—".
 * Backspace right after undoes it, for when a hyphen was really meant.
 * Runs before the list rules so "- " opens a line of dialogue, not a bullet.
 */
export const Dashes = Extension.create({
  name: 'dashes',
  priority: 1000,

  addInputRules() {
    return [
      textInputRule({ find: /^(-)\s$/, replace: '—' }),
      textInputRule({ find: /\s(-)\s$/, replace: '—' }),
      textInputRule({ find: /(--)$/, replace: '—' }),
    ];
  },
});
