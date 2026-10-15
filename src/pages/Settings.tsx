import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Navigate, NavLink, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { Avatar } from '../components/Avatar';
import { statusText } from '../components/AccountMenu';
import { DeleteAccountDialog, SignInDialog, SignOutDialog, useAccount } from '../components/AccountDialogs';
import { tell } from '../components/Ask';
import { PhotoCropDialog } from '../components/PhotoCropDialog';
import { setHandle, syncNow } from '../sync/engine';
import { HANDLE_MAX, handleAvailable, handleProblem, HandleTaken, NAME_MAX, removePhoto, saveHandle, type Crop, saveName, savePhoto, usePhotoUrl } from '../sync/profile';
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
  const [name, setName] = useState(profile?.name ?? '');
  const [busy, setBusy] = useState<'' | 'photo' | 'name'>('');
  const [saved, setSaved] = useState(false);
  const [cropping, setCropping] = useState<File>();

  // The name changed on another device, or the profile just arrived.
  useEffect(() => setName(profile?.name ?? ''), [profile?.name]);

  if (!email || !profile) return <SignInPrompt>Entre na sua conta para ter um perfil com foto e nome. Sem conta, as histórias ficam só neste aparelho.</SignInPrompt>;

  function pickPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) setCropping(file);
  }

  async function applyPhoto(file: File, crop: Crop) {
    setCropping(undefined);
    if (!navigator.onLine) return tell({ title: 'Sem internet', message: 'A foto fica guardada na sua conta. Tente de novo quando a conexão voltar.' });
    setBusy('photo');
    try {
      await savePhoto(profile!.userId, file, crop);
    } catch (err) {
      console.warn('Trocar a foto falhou', err);
      tell({ title: 'Não deu para trocar a foto', message: 'Tente outra imagem, em JPG, PNG ou WebP. Se a imagem estiver certa, tente de novo daqui a pouco.' });
    } finally {
      setBusy('');
    }
  }

  async function dropPhoto() {
    setBusy('photo');
    try {
      await removePhoto(profile!.userId);
    } catch (err) {
      console.warn('Tirar a foto falhou', err);
      tell({ title: 'Não deu para tirar a foto', message: 'Tente de novo daqui a pouco.' });
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
      <div className="settings-card settings-photo">
        <Avatar profile={profile} email={email} size={88} />
        <div className="settings-photo-actions">
          <label className={`btn btn-outline ${busy ? 'is-disabled' : ''}`}>
            <Icon name="camera" size={16} />
            {busy === 'photo' ? 'Salvando…' : 'Trocar foto'}
            <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={!!busy} onChange={pickPhoto} />
          </label>
          {photo && (
            <button className="link-btn settings-link" disabled={!!busy} onClick={dropPhoto}>
              Tirar a foto
            </button>
          )}
          <span className="settings-hint">
            {profile.photo ? 'Ao trocar, você escolhe a parte da foto que aparece.' : profile.googlePhoto && profile.photo !== false ? 'Esta é a foto da sua conta Google.' : 'Sem foto, aparecem as suas iniciais.'}
          </span>
        </div>
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

      {cropping && <PhotoCropDialog file={cropping} onCancel={() => setCropping(undefined)} onDone={(crop) => applyPhoto(cropping, crop)} />}

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
        <span className="field-label">Sincronização</span>
        <p className={`account-status is-${account.status}`} style={{ margin: 0 }} aria-live="polite">{statusText(account)}</p>
        <div className="settings-row">
          <button className="btn btn-outline" disabled={account.status === 'syncing'} onClick={() => syncNow()}>
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

type HandleCheck = { handle: string; state: 'checking' | 'free' | 'taken' | 'error' };

/** The @, unique per account: checked as the author types, saved on its own. */
function HandleForm({ userId }: { userId: string }) {
  const { handle: current } = useAccount();
  const [handle, setHandleText] = useState(current ?? '');
  const [check, setCheck] = useState<HandleCheck>();
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => setHandleText(current ?? ''), [current]);

  const problem = handle ? handleProblem(handle) : null;
  const same = !!current && handle.toLowerCase() === current.toLowerCase() && handle === current;
  const sameIgnoringCase = !!current && handle.toLowerCase() === current.toLowerCase();

  // Asks the server a moment after the author stops typing.
  useEffect(() => {
    if (!handle || problem || sameIgnoringCase) return setCheck(undefined);
    setCheck({ handle, state: 'checking' });
    let alive = true;
    const timer = window.setTimeout(() => {
      handleAvailable(handle)
        .then((free) => alive && setCheck({ handle, state: free ? 'free' : 'taken' }))
        .catch(() => alive && setCheck({ handle, state: 'error' }));
    }, 400);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [handle, problem, sameIgnoringCase]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!handle || problem || same) return;
    setBusy(true);
    try {
      await saveHandle(userId, handle);
      setHandle(handle);
      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      if (err instanceof HandleTaken) setCheck({ handle, state: 'taken' });
      else {
        console.warn('Salvar o @ falhou', err);
        tell({ title: 'Não deu para salvar o @', message: navigator.onLine ? 'Tente de novo daqui a pouco.' : 'Sem conexão com a internet. Tente de novo quando ela voltar.' });
      }
    } finally {
      setBusy(false);
    }
  }

  const status =
    problem ??
    (check?.state === 'checking' ? 'Conferindo…' : check?.state === 'taken' ? 'Este @ já é de outra pessoa.' : check?.state === 'free' ? 'Disponível.' : check?.state === 'error' ? 'Não deu para conferir agora.' : null);
  const bad = !!problem || check?.state === 'taken';

  return (
    <form className="settings-card" onSubmit={submit}>
      <label className="field">
        <span>@ (nome de usuário)</span>
        <span className={`handle-input ${bad ? 'is-bad' : ''}`}>
          <span aria-hidden="true">@</span>
          <input
            className="input"
            value={handle}
            maxLength={HANDLE_MAX}
            placeholder="seu_nome"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-invalid={bad}
            aria-describedby="handle-status"
            onChange={(e) => setHandleText(e.target.value.replace(/^@/, '').trim())}
          />
        </span>
      </label>
      <p id="handle-status" className={`settings-hint ${bad ? 'is-bad' : check?.state === 'free' ? 'is-good' : ''}`} aria-live="polite" style={{ margin: 0 }}>
        {status ?? (current ? 'Só seu: ninguém mais pode usar este @.' : 'Escolha um @ só seu: de 4 a 15 letras sem acento, números ou “_”.')}
      </p>
      <div className="settings-row">
        <button type="submit" className="btn btn-primary" disabled={busy || !handle || !!problem || same || check?.state === 'taken' || check?.state === 'checking'}>
          {busy ? 'Salvando…' : 'Salvar @'}
        </button>
        {saved && (
          <span className="settings-saved" role="status">
            <Icon name="check" size={14} />
            Salvo
          </span>
        )}
      </div>
    </form>
  );
}
