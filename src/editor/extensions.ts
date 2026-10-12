import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import { PageBreak } from './pagination';

export const ALIGNMENTS = ['justify', 'left', 'center', 'right'];
export type Alignment = 'justify' | 'left' | 'center' | 'right';

/** The document schema, shared by the editor and the export so both render the same DOM. */
export const contentExtensions = () => [
  StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false }),
  PageBreak,
  // Book text is justified; a paragraph can be set apart (an epigraph, a letter's signature).
  TextAlign.configure({ types: ['paragraph', 'heading'], alignments: ALIGNMENTS, defaultAlignment: 'justify' }),
];
