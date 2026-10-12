import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import type { Editor } from '@tiptap/react';
import { db, snapshotVersion, type ChapterVersion } from '../db';
import { countWords, formatNumber, plainText } from '../lib/text';
import { Icon } from './Icon';
import { Modal } from './Modal';

const dateFmt = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

type Props = {
  chapterId: string;
  editor: Editor;
  onClose: () => void;
};

export function VersionsDialog({ chapterId, editor, onClose }: Props) {
  const versions = useLiveQuery(
    () => db.versions.where('chapterId').equals(chapterId).reverse().sortBy('createdAt'),
    [chapterId],
  );
  const [preview, setPreview] = useState<ChapterVersion>();

  const current = () => {
    const json = editor.getJSON();
    return { json, words: countWords(json) };
  };

  async function saveNow() {
    const { json, words } = current();
    await snapshotVersion(chapterId, json, words, 'Salva manualmente');
  }

  async function restore(v: ChapterVersion) {
    if (!confirm(`Voltar o capítulo para a versão de ${dateFmt.format(v.createdAt)}? O texto atual fica guardado como uma versão.`)) return;
    const { json, words } = current();
    await snapshotVersion(chapterId, json, words, 'Antes de restaurar');
    editor.commands.setContent(v.content, { emitUpdate: true });
    onClose();
  }

  async function remove(v: ChapterVersion) {
    if (!confirm(`Apagar a versão de ${dateFmt.format(v.createdAt)}? Ela não poderá ser recuperada.`)) return;
    await db.versions.delete(v.id);
    if (preview?.id === v.id) setPreview(undefined);
  }

  return (
    <Modal title="Versões do capítulo" onClose={onClose} wide>
      <p style={{ margin: 0, color: 'var(--ink-3)' }}>
        Uma versão é guardada sozinha a cada 10 minutos de escrita. As 50 mais recentes ficam disponíveis.
      </p>
      <div style={{ display: 'flex', gap: 10 }}>
        <button className="btn btn-outline" onClick={saveNow}>Guardar versão agora</button>
      </div>

      {preview ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="sheet-preview">{plainText(preview.content) || 'Versão vazia.'}</div>
          <div className="dialog-actions">
            <button className="btn btn-ghost btn-danger" style={{ marginRight: 'auto' }} onClick={() => remove(preview)}>Apagar esta versão</button>
            <button className="btn btn-ghost" onClick={() => setPreview(undefined)}>Voltar à lista</button>
            <button className="btn btn-primary" onClick={() => restore(preview)}>Restaurar esta versão</button>
          </div>
        </div>
      ) : (
        <ul className="version-list">
          {versions?.length === 0 && <li className="empty">Nenhuma versão guardada ainda.</li>}
          {versions?.map((v) => (
            <li key={v.id}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <strong style={{ fontWeight: 600 }}>{dateFmt.format(v.createdAt)}</strong>
                <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>
                  {v.label} · {formatNumber(v.wordCount)} palavras
                </span>
              </div>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="btn btn-ghost" onClick={() => setPreview(v)}>Ver</button>
                <button className="btn btn-outline" onClick={() => restore(v)}>Restaurar</button>
                <button className="icon-btn btn-danger" aria-label={`Apagar a versão de ${dateFmt.format(v.createdAt)}`} title="Apagar versão" onClick={() => remove(v)}>
                  <Icon name="trash" size={18} />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
