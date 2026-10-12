import StarterKit from '@tiptap/starter-kit';
import { PageBreak } from './pagination';

/** The document schema, shared by the editor and the export so both render the same DOM. */
export const contentExtensions = () => [
  StarterKit.configure({ heading: { levels: [2, 3] }, codeBlock: false, code: false }),
  PageBreak,
];
