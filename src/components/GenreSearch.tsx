import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { searchGenres } from '../lib/genres';
import './GenreSearch.css';

type Props = {
  /** The chosen genre; '' for all. */
  value: string;
  onChange: (genre: string) => void;
};

/**
 * Filter by genre: the reader types and picks from the suggestions (only
 * genres of the list). With one chosen, it shows as a tag that clears.
 */
export function GenreSearch({ value, onChange }: Props) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const options = searchGenres(text);

  function pick(genre: string) {
    onChange(genre);
    setText('');
    setOpen(false);
  }

  function clear() {
    onChange('');
    setText('');
    // Back to the field, ready for another genre.
    requestAnimationFrame(() => input.current?.focus());
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) return setOpen(true);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((i) => (i + step + options.length) % Math.max(options.length, 1));
    } else if (e.key === 'Enter') {
      if (open && options[active]) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    } else if (e.key === 'Backspace' && !text && value) {
      onChange('');
    }
  }

  if (value) {
    return (
      <div className="genre-search">
        <span className="genre-search-label">Gênero:</span>
        <span className="genre-tag">
          {value}
          <button type="button" className="genre-tag-clear" aria-label={`Tirar o filtro ${value}`} onClick={clear}>
            <Icon name="close" size={14} />
          </button>
        </span>
      </div>
    );
  }

  return (
    <div className="genre-search">
      <label className="search genre-search-field">
        <Icon name="search" size={16} />
        <span className="sr-only">Buscar gênero</span>
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
          placeholder="Buscar gênero: fantasia, romance…"
          value={text}
          autoComplete="off"
          onChange={(e) => {
            setText(e.target.value);
            setActive(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
      </label>
      {open && (
        <ul className="genre-options" id={listId} role="listbox" aria-label="Gêneros">
          {options.length === 0 && <li className="genre-none">Nenhum gênero com “{text}”.</li>}
          {options.map((g, i) => (
            <li
              key={g}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'is-active' : ''}
              // mousedown, not click: the field's blur would close the list first.
              onMouseDown={(e) => {
                e.preventDefault();
                pick(g);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {g}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
