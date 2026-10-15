import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { db, type Chapter, type Story } from '../db';
import { Modal } from './Modal';
import { Icon } from './Icon';
import { ask, tell } from './Ask';
import { SignInDialog, useAccount } from './AccountDialogs';
import { getMyPublication, isPublishQuota, publishChapters, unpublishChapter, unpublishStory, type MyPublication } from '../sync/community';
import { chapterName, plural } from '../lib/text';
import './PublishDialog.css';

type Props = { story: Story; chapters: Chapter[]; beforeSave: () => Promise<void> | undefined };

/** The "Publicar" button of the story's side menu; hidden when accounts are off. */
export function PublishButton(props: Props) {
  const { configured } = useAccount();
  const [open, setOpen] = useState(false);
  if (!configured) return null;
  return (
    <>
      <button className="btn btn-outline" onClick={() => setOpen(true)}>
        <Icon name="upload" size={16} />
        Publicar
      </button>
      {open && <PublishDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function PublishDialog({ story, chapters, beforeSave, onClose }: Props & { onClose: () => void }) {
  const { email, profile, handle } = useAccount();
  const [signingIn, setSigningIn] = useState(false);
  // undefined while loading; null when nothing of this story is published.
  const [pub, setPub] = useState<MyPublication | null>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState<string>();
  const userId = profile?.userId;

  const load = useCallback(async () => {
    if (!userId) return;
    try {
      setPub(await getMyPublication(userId, story.id));
      setFailed(false);
    } catch (err) {
      console.error(err);
      setFailed(true);
    }
  }, [userId, story.id]);

  useEffect(() => {
    if (handle) load();
  }, [handle, load]);

  if (!email || !userId) {
    return (
      <>
        <Modal title="Publicar na comunidade" onClose={onClose}>
          <div className="ask-message">
            <p>Na comunidade do Lirismo, qualquer pessoa pode ler os capítulos que você publicar.</p>
            <p>Para publicar, entre na sua conta: é ela que assina a história com o seu @.</p>
          </div>
          <div className="dialog-actions">
            <button className="btn btn-ghost" onClick={onClose}>Agora não</button>
            <button className="btn btn-primary" data-autofocus onClick={() => setSigningIn(true)}>Entrar</button>
          </div>
        </Modal>
        {signingIn && <SignInDialog onClose={() => setSigningIn(false)} />}
      </>
    );
  }

  if (!handle) {
    return (
      <Modal title="Publicar na comunidade" onClose={onClose}>
        <div className="ask-message">
          <p>{handle === null ? 'Antes de publicar, escolha o seu @: é ele que assina a história.' : 'Carregando…'}</p>
        </div>
      </Modal>
    );
  }

  async function run(key: string, action: () => Promise<unknown>) {
    setBusy(key);
    try {
      await action();
    } catch (err) {
      console.error(err);
      tell(
        isPublishQuota(err as Error)
          ? {
              title: 'Chegou ao limite',
              message: <p>Cada conta publica até 20 histórias e 300 capítulos, com até 5 MB de texto. Tire do ar o que não quer mais na comunidade para liberar espaço.</p>,
            }
          : {
              title: 'Não deu para publicar',
              message: <p>{navigator.onLine ? 'Algo deu errado. Seu texto está salvo; tente de novo daqui a pouco.' : 'Sem conexão com a internet. Tente de novo quando ela voltar.'}</p>,
            },
      );
    } finally {
      await load();
      setBusy(undefined);
    }
  }

  /** The chapters as saved right now, with whatever was just typed. */
  async function fresh(ids: string[]) {
    await beforeSave();
    const latest = await db.chapters.bulkGet(ids);
    return latest.filter((c): c is Chapter => !!c);
  }

  const publish = (c: Chapter) =>
    run(c.id, async () => {
      const [latest] = await fresh([c.id]);
      if (!latest?.wordCount) {
        return tell({ title: 'Capítulo em branco', message: <p>Escreva alguma coisa em <strong>{chapterName(c.order, c.title)}</strong> antes de publicar.</p> });
      }
      await publishChapters(userId!, profile?.name ?? '', story, chapters, [latest]);
    });

  const updateAll = (changed: Chapter[]) =>
    run('all', async () => publishChapters(userId!, profile?.name ?? '', story, chapters, await fresh(changed.map((c) => c.id))));

  const takeDown = (c: Chapter) =>
    run(c.id, async () => {
      const last = pub!.chapters.size === 1;
      const ok = await ask({
        title: 'Tirar o capítulo do ar?',
        message: (
          <p>
            {last
              ? <>É o único capítulo publicado: a história sai da comunidade. O seu texto continua aqui.</>
              : <>Os leitores deixam de ver <strong>{chapterName(c.order, c.title)}</strong>. O seu texto continua aqui.</>}
          </p>
        ),
        confirm: 'Tirar do ar',
        danger: true,
      });
      if (ok) await unpublishChapter(userId!, pub!, c.id);
    });

  const takeStoryDown = () =>
    run('story', async () => {
      const ok = await ask({
        title: 'Tirar a história do ar?',
        message: <p>Ela sai da comunidade, com todos os capítulos publicados. O seu texto continua aqui, e dá para publicar de novo quando quiser.</p>,
        confirm: 'Tirar do ar',
        danger: true,
      });
      if (ok) await unpublishStory(userId!, pub!);
    });

  const changed = pub ? chapters.filter((c) => (pub.chapters.get(c.id)?.source_updated_at ?? Infinity) < c.updatedAt) : [];

  return (
    <Modal title="Publicar na comunidade" onClose={onClose} wide>
      {pub === null && (
        <div className="publish-note">
          <p>Qualquer pessoa vai poder ler os capítulos que você publicar, mesmo sem conta, com a assinatura <strong>@{handle}</strong>.</p>
          <p>Publique a partir do primeiro capítulo pronto e vá acrescentando os outros. Mudar o texto depois não muda o que os leitores veem até você atualizar.</p>
          <p>Publique só o que é seu (ver os <a href="termos.html" target="_blank" rel="noreferrer">Termos de Serviço</a>).</p>
        </div>
      )}
      {pub && (
        <div className="publish-live">
          <span className="publish-dot" aria-hidden="true" />
          <span>
            Na comunidade, com {plural(pub.chapters.size, 'capítulo', 'capítulos')}.{' '}
            <Link to={`/ler/${pub.id}`} onClick={onClose}>Ver como leitor</Link>
          </span>
        </div>
      )}

      {failed && <p className="form-error">Não deu para ver o que está publicado. Confira a internet e abra esta janela de novo.</p>}

      {pub !== undefined && (
        <ol className="publish-list">
          {chapters.map((c) => {
            const live = pub?.chapters.get(c.id);
            const isChanged = !!live && live.source_updated_at < c.updatedAt;
            return (
              <li key={c.id}>
                <span className="publish-chapter">
                  <span className="publish-title">{chapterName(c.order, c.title)}</span>
                  <span className={`publish-state ${live ? (isChanged ? 'is-changed' : 'is-live') : ''}`}>
                    {!live ? (c.wordCount ? 'Não publicado' : 'Em branco') : isChanged ? 'Mudou depois de publicado' : 'Publicado'}
                  </span>
                </span>
                <span className="publish-actions">
                  {!live && (
                    <button className="btn btn-sm btn-primary" disabled={!!busy || !c.wordCount} onClick={() => publish(c)}>
                      {busy === c.id ? 'Publicando…' : 'Publicar'}
                    </button>
                  )}
                  {isChanged && (
                    <button className="btn btn-sm btn-outline" disabled={!!busy} onClick={() => publish(c)}>
                      {busy === c.id ? 'Atualizando…' : 'Atualizar'}
                    </button>
                  )}
                  {live && (
                    <button className="btn btn-sm btn-ghost" disabled={!!busy} onClick={() => takeDown(c)}>
                      Tirar do ar
                    </button>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <div className="dialog-actions">
        {pub && (
          <button className="btn btn-danger" disabled={!!busy} onClick={takeStoryDown} style={{ marginRight: 'auto' }}>
            Tirar a história do ar
          </button>
        )}
        {changed.length > 1 && (
          <button className="btn btn-outline" disabled={!!busy} onClick={() => updateAll(changed)}>
            {busy === 'all' ? 'Atualizando…' : `Atualizar os ${changed.length}`}
          </button>
        )}
        <button className="btn btn-dark" data-autofocus onClick={onClose}>Pronto</button>
      </div>
    </Modal>
  );
}
