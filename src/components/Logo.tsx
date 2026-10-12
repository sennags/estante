/**
 * The Lirismo mark: a handwritten L whose foot runs on as a thread and ends
 * in the quill that wrote it. public/favicon.svg draws the same shapes.
 */
export const LOGO_L = 'M2.5 10C3.5 6 7 3 10.5 3C12.5 3 12.5 5.5 10.5 6.5C9 7.5 7.5 12 5.5 16.5C4.8 18 3 19 2.5 18C2 17 3.8 16.5 5.5 17.5C7.5 18.6 9.5 18.8 11 18C12.5 17.2 13.5 16.5 15 17.2C15.6 17.5 16 17.8 16.5 18';
export const LOGO_QUILL = 'M16.5 18L17.9 16.1C18.4 13.1 20.3 10.4 23.5 9.2C22.1 12.4 20.3 15 17.9 16.1';
export const LOGO_SHAFT = 'M18.4 15.5L22.9 10';

export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="1.3 -0.4 22.8 22.8" fill="none" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: 'none' }}>
      <path d={LOGO_L} stroke="var(--accent)" strokeWidth={1.6} />
      <path d={LOGO_QUILL} stroke="var(--brass)" strokeWidth={1.4} />
      <path d={LOGO_SHAFT} stroke="var(--brass)" strokeWidth={0.6} />
    </svg>
  );
}
