import { useState } from 'react';
import { EXTERNAL_NARRATORS, type Entry, type Narrator } from '../db';

type Props = {
  value?: Narrator;
  onChange: (n: Narrator | undefined) => void;
  /** Characters to choose from. */
  entries: Entry[];
  /** Label for the empty choice: "Sem narrador definido", or the inherited one for a scene. */
  emptyLabel: string;
  id?: string;
};

const encode = (n?: Narrator) =>
  !n ? '' : n.kind === 'personagem' ? `p:${n.id}` : EXTERNAL_NARRATORS.includes(n.label) ? `x:${n.label}` : 'outro';

/** Picks a character from the entries or an outside narrator, with free text for "Outro". */
export function NarratorSelect({ value, onChange, entries, emptyLabel, id }: Props) {
  const characters = entries.filter((e) => e.kind === 'personagem');
  const [custom, setCustom] = useState(encode(value) === 'outro');
  const current = custom ? 'outro' : encode(value);
  const missing = value?.kind === 'personagem' && !characters.some((c) => c.id === value.id);

  function pick(v: string) {
    setCustom(v === 'outro');
    if (!v) onChange(undefined);
    else if (v.startsWith('p:')) onChange({ kind: 'personagem', id: v.slice(2) });
    else if (v.startsWith('x:')) onChange({ kind: 'externo', label: v.slice(2) });
    else onChange({ kind: 'externo', label: value?.kind === 'externo' && !EXTERNAL_NARRATORS.includes(value.label) ? value.label : '' });
  }

  return (
    <div className="narrator-select">
      <select id={id} className="select" value={current} onChange={(e) => pick(e.target.value)}>
        <option value="">{emptyLabel}</option>
        {(characters.length > 0 || missing) && (
          <optgroup label="Personagens">
            {missing && <option value={current}>Personagem removido</option>}
            {characters.map((c) => (
              <option key={c.id} value={`p:${c.id}`}>{c.name || 'Sem nome'}</option>
            ))}
          </optgroup>
        )}
        <optgroup label="Narrador externo">
          {EXTERNAL_NARRATORS.map((l) => (
            <option key={l} value={`x:${l}`}>{l}</option>
          ))}
          <option value="outro">Outro…</option>
        </optgroup>
      </select>
      {custom && (
        <input
          className="input"
          aria-label="Descreva o narrador"
          placeholder="Por exemplo: o diário da avó"
          value={value?.kind === 'externo' ? value.label : ''}
          onChange={(e) => onChange({ kind: 'externo', label: e.target.value })}
          autoFocus
        />
      )}
    </div>
  );
}
