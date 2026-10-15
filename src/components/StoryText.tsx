import { Fragment, type ReactNode } from 'react';
import type { JSONContent } from '@tiptap/react';
import { publishableDoc } from '../sync/community';

/**
 * A chapter's text for readers, built as React elements from the editor's
 * JSON: never HTML, so a published chapter cannot carry a script. Anything
 * the editor does not make is dropped by publishableDoc first.
 */
export function StoryText({ doc }: { doc: JSONContent }) {
  return <div className="story-text">{children(publishableDoc(doc))}</div>;
}

const children = (node: JSONContent) => (node.content ?? []).map((n, i) => render(n, i));

function render(node: JSONContent, key: number): ReactNode {
  const align = node.attrs?.textAlign as string | undefined;
  const style = align && align !== 'justify' ? { textAlign: align as 'left' | 'center' | 'right', textIndent: 0 } : undefined;
  switch (node.type) {
    case 'paragraph':
      return <p key={key} style={style}>{node.content ? children(node) : <br />}</p>;
    case 'heading':
      return node.attrs?.level === 3
        ? <h4 key={key} style={style}>{children(node)}</h4>
        : <h3 key={key} style={style}>{children(node)}</h3>;
    case 'blockquote':
      return <blockquote key={key}>{children(node)}</blockquote>;
    case 'bulletList':
      return <ul key={key}>{children(node)}</ul>;
    case 'orderedList':
      return <ol key={key}>{children(node)}</ol>;
    case 'listItem':
      return <li key={key}>{children(node)}</li>;
    case 'horizontalRule':
      return <hr key={key} />;
    case 'pageBreak':
      return <div key={key} className="story-text-gap" aria-hidden="true" />;
    case 'hardBreak':
      return <br key={key} />;
    case 'text':
      return <Fragment key={key}>{(node.marks ?? []).reduceRight<ReactNode>((inner, mark) => {
        if (mark.type === 'bold') return <strong>{inner}</strong>;
        if (mark.type === 'italic') return <em>{inner}</em>;
        if (mark.type === 'strike') return <s>{inner}</s>;
        if (mark.type === 'underline') return <u>{inner}</u>;
        return inner;
      }, node.text ?? '')}</Fragment>;
    default:
      return null;
  }
}
