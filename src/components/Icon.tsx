const PATHS = {
  plus: 'M12 5v14 M5 12h14',
  search: 'M20 20l-3.5-3.5 M18 11a7 7 0 1 1-14 0a7 7 0 1 1 14 0',
  back: 'M15 6l-6 6 6 6',
  arrowRight: 'M5 12h14 M13 6l6 6-6 6',
  check: 'M5 12l4 4 10-10',
  chevronDown: 'M6 9l6 6 6-6',
  chevronUp: 'M6 15l6-6 6 6',
  up: 'M12 19V5 M6 11l6-6 6 6',
  down: 'M12 5v14 M6 13l6 6 6-6',
  focus: 'M16 12a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M2 12h3 M19 12h3 M12 2v3 M12 19v3',
  history: 'M12 8v4l3 2 M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5 M3.5 4v4.5H8',
  download: 'M12 4v11 M7 10l5 5 5-5 M5 20h14',
  menu: 'M4 7h16 M4 12h16 M4 17h10',
  close: 'M6 6l12 12 M18 6L6 18',
  edit: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13',
  panel: 'M4 5h16v14H4z M15 5v14',
  book: 'M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h11',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1 M13.5 7.5a4 4 0 1 1-8 0a4 4 0 1 1 8 0 M17 11a3 3 0 0 0 0-6 M21 19v-1a4 4 0 0 0-3-3.9',
  layout: 'M4 4h7v7H4z M13 4h7v4h-7z M13 10h7v10h-7z M4 13h7v7H4z',
  thread: 'M3 12c3-6 6-6 9 0s6 6 9 0',
  image: 'M4 5h16v14H4z M4 16l5-5 4 4 3-3 4 4 M16.5 9a1.5 1.5 0 1 1-3 0a1.5 1.5 0 1 1 3 0',
  grip: 'M9 5v.01 M9 12v.01 M9 19v.01 M15 5v.01 M15 12v.01 M15 19v.01',
  alert: 'M12 4l9 16H3z M12 10v4 M12 17v.01',
  undo: 'M9 14L4 9l5-5 M4 9h10a6 6 0 0 1 0 12h-3',
  chevronLeft: 'M15 6l-6 6 6 6',
  chevronRight: 'M9 6l6 6-6 6',
  alignJustify: 'M4 6h16 M4 10h16 M4 14h16 M4 18h16',
  alignLeft: 'M4 6h16 M4 10h10 M4 14h16 M4 18h10',
  alignCenter: 'M4 6h16 M7 10h10 M4 14h16 M7 18h10',
  alignRight: 'M4 6h16 M10 10h10 M4 14h16 M10 18h10',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, stroke = 2 }: { name: IconName; size?: number; stroke?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flex: 'none' }}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
