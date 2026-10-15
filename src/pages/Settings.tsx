import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { statusText } from '../components/AccountMenu';
import { DeleteAccountDialog, SignInDialog, SignOutDialog, useAccount } from '../components/AccountDialogs';
import { tell } from '../components/Ask';
import { PhotoCropDialog } from '../components/PhotoCropDialog';
import { HandleInput, useHandleForm } from '../components/HandleField';
import { syncNow } from '../sync/engine';
import { NAME_MAX, removeImage, saveImage, saveName, useBannerUrl, usePhotoUrl, type Crop, type ImageKind } from '../sync/profile';
import { AUTO_SHEET, setSettings, SHEET_LABEL, THEME_LABEL, useSettings, type SheetColor, type Theme } from '../lib/settings';
import '../components/AccountMenu.css';
import './Library.css';
import './Settings.css';

type Section = 'perfil' | 'aparencia' | 'conta';

const SECTIONS: { id: Section; label: string; icon: IconName; account?: boolean }[] = [
  { id: 'perfil', label: 'Perfil', icon: 'user', account: true },
  { id: 'aparencia', label: 'Aparência', icon: 'palette' },
  { id: 'conta', label: 'Conta', icon: 'cloud', account: true },
];

/** Settings: the author's profile, the look of the app and the account. Its own screen, with the sections side by side. */
export function Settings() {
  const { secao } = useParams();
  const account = useAccount();
  const navigate = useNavigate();
  const location = useLocation();
  const sections = SECTIONS.filter((s) => !s.account || account.configured);
  const section = sections.find((s) => s.id === secao);

  if (!section) return <Navigate to={`/configuracoes/${sections[0].id}`} replace />;

  // Back to where the author came from; straight to the library when the page was opened directly.
  const back = () => (location.key === 'default' ? navigate('/') : navigate(-1));

  return (
    <div className="library">
      <header className="library-header">
        <button className="btn btn-ghost" style={{ marginLeft: -12 }} onClick={back}>
          <Icon name="back" size={16} />
          Voltar
        </button>
      </header>

      <main className="settings">
        <nav className="settings-nav" aria-label="Seções das configurações">
          <span className="eyebrow">Configurações</span>
          {sections.map((s) => (
            <NavLink key={s.id} to={`/configuracoes/${s.id}`} replace className="settings-tab">
              <Icon name={s.icon} size={18} />
              {s.label}
            </NavLink>
          ))}
        </nav>
        <section className="settings-panel" aria-labelledby="settings-title">
          <h1 id="settings-title">{section.label}</h1>
          {section.id === 'perfil' && <ProfileSection />}
          {section.id === 'aparencia' && <AppearanceSection />}
          {section.id === 'conta' && <AccountSection />}
        </section>
      </main>
    </div>
  );
}

function SignInPrompt({ children }: { children: string }) {
  const [signingIn, setSigningIn] = useState(false);
  return (
    <div className="settings-card">
      <p className="settings-note">{children}</p>
      <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => setSigningIn(true)}>
        <Icon name="user" size={16} />
        Entrar
      </button>
      {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
    </div>
  );
}

function ProfileSection() {
  const { email, profile } = useAccount();
  const photo = usePhotoUrl(profile);
  const banner = useBannerUrl(profile);
  const [name, setName] = useState(profile?.name ?? '');
  const [busy, setBusy] = useState<'' | ImageKind | 'name'>('');
  const [saved, setSaved] = useState(false);
  const [cropping, setCropping] = useState<{ kind: ImageKind; file: File }>();

  // The name changed on another device, or the profile just arrived.
  useEffect(() => setName(profile?.name ?? ''), [profile?.name]);

  if (!email || !profile) return <SignInPrompt>Entre na sua conta para ter um perfil com foto e nome. Sem conta, as histórias ficam só neste aparelho.</SignInPrompt>;

  const WHAT: Record<ImageKind, string> = { photo: 'a foto', banner: 'a capa' };

  async function apply(kind: ImageKind, file: File, crop: Crop) {
    setCropping(undefined);
    if (!navigator.onLine) return tell({ title: 'Sem internet', message: 'A imagem fica guardada na sua conta. Tente de novo quando a conexão voltar.' });
    setBusy(kind);
    try {
      await saveImage(profile!.userId, kind, file, crop);
    } catch (err) {
      console.warn('Trocar a imagem falhou', kind, err);
      tell({ title: `Não deu para trocar ${WHAT[kind]}`, message: 'Tente outra imagem, em JPG, PNG ou WebP. Se a imagem estiver certa, tente de novo daqui a pouco.' });
    } finally {
      setBusy('');
    }
  }

  async function drop(kind: ImageKind) {
    setBusy(kind);
    try {
      await removeImage(profile!.userId, kind);
    } catch (err) {
      console.warn('Tirar a imagem falhou', kind, err);
      tell({ title: `Não deu para tirar ${WHAT[kind]}`, message: 'Tente de novo daqui a pouco.' });
    } finally {
      setBusy('');
    }
  }

  async function submitName(e: FormEvent) {
    e.preventDefault();
    setBusy('name');
    try {
      await saveName(name);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      console.warn('Salvar o nome falhou', err);
      tell({ title: 'Não deu para salvar o nome', message: navigator.onLine ? 'Tente de novo daqui a pouco.' : 'Sem conexão com a internet. Tente de novo quando ela voltar.' });
    } finally {
      setBusy('');
    }
  }

  return (
    <>
      <div className="settings-card profile-head">
        {/* Same look as the account card; the photo and the cover are changed right on it. */}
        <div className={`profile-cover ${busy === 'banner' ? 'is-busy' : ''}`} style={banner ? { backgroundImage: `url(${banner})` } : undefined}>
          <ImageMenu
            className="profile-cover-btn"
            label={profile.banner ? 'Capa do perfil' : 'Pôr uma capa'}
            menuLabel="Capa do perfil"
            disabled={!!busy}
            onFile={(file) => setCropping({ kind: 'banner', file })}
            onAdjust={banner ? () => setCropping({ kind: 'banner', file: fileFrom(banner) }) : undefined}
            onRemove={profile.banner ? () => drop('banner') : undefined}
            removeLabel="Tirar a capa"
          >
            <Icon name="image" size={15} />
            {busy === 'banner' ? 'Salvando…' : profile.banner ? 'Trocar capa' : 'Pôr uma capa'}
          </ImageMenu>
        </div>
        <span className={`profile-photo ${busy === 'photo' ? 'is-busy' : ''}`}>
          <Avatar profile={profile} email={email} size={88} />
          <ImageMenu
            className="profile-photo-btn"
            label={busy === 'photo' ? 'Salvando a foto…' : 'Foto do perfil'}
            menuLabel="Foto do perfil"
            disabled={!!busy}
            onFile={(file) => setCropping({ kind: 'photo', file })}
            onAdjust={profile.photo && photo ? () => setCropping({ kind: 'photo', file: fileFrom(photo) }) : undefined}
            onRemove={photo ? () => drop('photo') : undefined}
            removeLabel="Tirar a foto"
          >
            <span className="profile-photo-badge">
              <Icon name="camera" size={15} />
            </span>
          </ImageMenu>
        </span>
        <p className="settings-hint profile-hint">
          {profile.googlePhoto && profile.photo === undefined
            ? 'Esta é a foto da sua conta Google. Toque nela ou na capa para trocar.'
            : 'Toque na foto ou na capa para trocar, ajustar a parte que aparece ou tirar.'}
        </p>
      </div>

      <form className="settings-card" onSubmit={submitName}>
        <label className="field">
          <span>Nome</span>
          <input className="input" value={name} maxLength={NAME_MAX} placeholder="Seu nome" onChange={(e) => setName(e.target.value)} />
        </label>
        <div className="settings-row">
          <button type="submit" className="btn btn-primary" disabled={!!busy || name.trim() === profile.name}>
            {busy === 'name' ? 'Salvando…' : 'Salvar nome'}
          </button>
          {saved && (
            <span className="settings-saved" role="status">
              <Icon name="check" size={14} />
              Salvo
            </span>
          )}
        </div>
      </form>

      <HandleForm userId={profile.userId} />

      {cropping && (
        <PhotoCropDialog
          file={cropping.file}
          kind={cropping.kind}
          onCancel={() => setCropping(undefined)}
          onDone={(crop) => apply(cropping.kind, cropping.file, crop)}
        />
      )}

      <div className="settings-card">
        <span className="field-label">E-mail</span>
        <span>{email}</span>
      </div>
    </>
  );
}

/** The colors each theme preview shows, whatever the current theme is. */
const THEME_PREVIEW: Record<Theme, { ground: string; paper: string; line: string; ink: string }> = {
  claro: { ground: '#f3efe6', paper: '#fffdf8', line: '#ddd5c4', ink: '#1f2421' },
  meio: { ground: '#2f2c28', paper: '#3a3631', line: '#4a453e', ink: '#ede7db' },
  escuro: { ground: '#161513', paper: '#201f1c', line: '#34322d', ink: '#ece6da' },
};
const SHEET_PREVIEW: Record<Exclude<SheetColor, 'auto'>, { bg: string; ink: string }> = {
  branca: { bg: '#fffdf8', ink: '#b5ad9c' },
  amarelada: { bg: '#f3e8cc', ink: '#b9a884' },
  preta: { bg: '#1b1a18', ink: '#5d584f' },
};

function AppearanceSection() {
  const { theme, sheet } = useSettings();

  return (
    <>
      <fieldset className="settings-card">
        <legend className="field-label">Tema</legend>
        <div className="choice-grid">
          {(Object.keys(THEME_LABEL) as Theme[]).map((t) => {
            const c = THEME_PREVIEW[t];
            return (
              <label key={t} className="choice">
                <input type="radio" name="tema" className="sr-only" checked={theme === t} onChange={() => setSettings({ theme: t })} />
                <span className="theme-preview" style={{ background: c.ground, borderColor: c.line }} aria-hidden="true">
                  <span style={{ background: c.paper, borderColor: c.line }}>
                    <i style={{ background: c.ink }} />
                    <i style={{ background: c.line }} />
                    <i style={{ background: c.line }} />
                  </span>
                </span>
                <span className="choice-label">{THEME_LABEL[t]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <fieldset className="settings-card">
        <legend className="field-label">Cor da folha</legend>
        <p className="settings-note">A folha onde você escreve os capítulos. O PDF sai sempre em folha branca.</p>
        <div className="choice-grid sheets">
          {(Object.keys(SHEET_LABEL) as SheetColor[]).map((s) => {
            const c = SHEET_PREVIEW[s === 'auto' ? AUTO_SHEET[theme] : s];
            return (
              <label key={s} className="choice">
                <input type="radio" name="folha" className="sr-only" checked={sheet === s} onChange={() => setSettings({ sheet: s })} />
                <span className="sheet-preview-mini" style={{ background: c.bg }} aria-hidden="true">
                  {s === 'auto' && <b style={{ color: c.ink }}>Auto</b>}
                  <i style={{ background: c.ink }} />
                  <i style={{ background: c.ink }} />
                  <i style={{ background: c.ink, width: '60%' }} />
                </span>
                <span className="choice-label">{SHEET_LABEL[s]}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
      <p className="settings-hint">O tema e a cor da folha ficam guardados neste aparelho.</p>
    </>
  );
}

function AccountSection() {
  const account = useAccount();
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (!account.email) return <SignInPrompt>Com uma conta, as suas histórias ficam guardadas na nuvem e abrem em qualquer aparelho.</SignInPrompt>;

  return (
    <>
      <div className="settings-card">
        <span className="field-label">E-mail da conta</span>
        <p style={{ margin: 0 }}>{account.email}</p>
        <p className="settings-hint" style={{ margin: 0 }}>Só você vê. No cartão da conta aparecem o nome e o @.</p>
      </div>
      <div className="settings-card">
        <span className="field-label">Sincronização</span>
        <p className={`account-status is-${account.status}`} style={{ margin: 0 }} aria-live="polite">{statusText(account)}</p>
        <div className="settings-row">
          <button className="btn btn-outline" disabled={account.status === 'syncing'} onClick={() => syncNow(true)}>
            <Icon name="refresh" size={16} />
            Sincronizar agora
          </button>
          <button className="btn btn-ghost" onClick={() => setSigningOut(true)}>
            <Icon name="logout" size={16} />
            Sair
          </button>
        </div>
      </div>
      <button className="link-btn account-delete" onClick={() => setDeleting(true)}>
        Excluir minha conta
      </button>
      {signingOut && <SignOutDialog onClose={() => setSigningOut(false)} />}
      {deleting && <DeleteAccountDialog email={account.email} onClose={() => setDeleting(false)} />}
    </>
  );
}

/** A saved image (a data URL) as a file, to adjust it again in the editor. */
function fileFrom(dataUrl: string): File {
  const [head, body] = dataUrl.split(',');
  const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/jpeg';
  const bytes = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return new File([bytes], 'atual.jpg', { type });
}

type ImageMenuProps = {
  className: string;
  /** What the button says to a screen reader. */
  label: string;
  menuLabel: string;
  disabled: boolean;
  onFile: (file: File) => void;
  onAdjust?: () => void;
  onRemove?: () => void;
  removeLabel: string;
  children: ReactNode;
};

/**
 * The button on the cover or on the photo. With nothing to adjust or take out
 * it goes straight to choosing a file; otherwise it opens a small menu.
 */
function ImageMenu({ className, label, menuLabel, disabled, onFile, onAdjust, onRemove, removeLabel, children }: ImageMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const hasMenu = !!onAdjust || !!onRemove;

  useEffect(() => {
    if (!open) return;
    ref.current?.querySelector<HTMLElement>('[role=menuitem]')?.focus();
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const keys = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>('[aria-haspopup]')?.focus();
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role=menuitem]') ?? [])];
        const at = items.indexOf(document.activeElement as HTMLElement);
        items[(at + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', away);
    document.addEventListener('keydown', keys);
    return () => {
      document.removeEventListener('pointerdown', away);
      document.removeEventListener('keydown', keys);
    };
  }, [open]);

  const run = (action: () => void) => () => {
    setOpen(false);
    action();
  };

  return (
    <div className={`image-menu ${className}`} ref={ref}>
      <button
        type="button"
        className="image-menu-btn"
        aria-label={label}
        aria-haspopup={hasMenu ? 'menu' : undefined}
        aria-expanded={hasMenu ? open : undefined}
        disabled={disabled}
        onClick={() => (hasMenu ? setOpen((o) => !o) : input.current?.click())}
      >
        {children}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file) onFile(file);
        }}
      />
      {open && (
        <div className="image-menu-list" role="menu" aria-label={menuLabel}>
          <button type="button" role="menuitem" onClick={run(() => input.current?.click())}>
            <Icon name="upload" size={16} />
            Escolher outra imagem
          </button>
          {onAdjust && (
            <button type="button" role="menuitem" onClick={run(onAdjust)}>
              <Icon name="crop" size={16} />
              Ajustar a parte que aparece
            </button>
          )}
          {onRemove && (
            <button type="button" role="menuitem" className="is-danger" onClick={run(onRemove)}>
              <Icon name="trash" size={16} />
              {removeLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** The @, unique per account: checked as the author types, saved on its own. */
function HandleForm({ userId }: { userId: string }) {
  const form = useHandleForm(userId);

  return (
    <form className="settings-card" onSubmit={form.submit}>
      <HandleInput form={form} />
      <div className="settings-row">
        <button type="submit" className="btn btn-primary" disabled={!form.canSave}>
          {form.busy ? 'Salvando…' : 'Salvar @'}
        </button>
        {form.saved && (
          <span className="settings-saved" role="status">
            <Icon name="check" size={14} />
            Salvo
          </span>
        )}
      </div>
    </form>
  );
}
