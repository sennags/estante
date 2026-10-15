import { useEffect } from 'react';
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { StoryLayout, StoryIndex } from './pages/StoryLayout';
import { ChapterEditor } from './pages/ChapterEditor';
import { Universe } from './pages/Universe';
import { Trash } from './pages/Trash';
import { Planning } from './pages/Planning';
import { Threads } from './pages/Threads';
import { Settings } from './pages/Settings';
import { AskHost } from './components/Ask';
import { NewPasswordDialog, useAccount } from './components/AccountDialogs';
import { ChooseHandleDialog } from './components/HandleField';
import { startSync } from './sync/engine';

export function App() {
  const { recovering, linked, handle, profile } = useAccount();

  // Runs after <AskHost /> is ready, since signing in may ask about this browser's stories.
  // It also empties the trash of anything older than a week.
  useEffect(() => {
    startSync();
  }, []);

  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/lixeira" element={<Trash />} />
        <Route path="/configuracoes/:secao?" element={<Settings />} />
        <Route path="/historia/:storyId" element={<StoryLayout />}>
          <Route index element={<StoryIndex />} />
          <Route path="capitulo/:chapterId" element={<ChapterEditor />} />
          <Route path="universo" element={<Universe />} />
          <Route path="universo/:entryId" element={<Universe />} />
          <Route path="planejamento" element={<Planning />} />
          <Route path="fios" element={<Threads />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {recovering && <NewPasswordDialog />}
      {/* After the question about this device's stories, so the two windows do not stack. */}
      {!recovering && linked && handle === null && profile && <ChooseHandleDialog userId={profile.userId} />}
      <AskHost />
    </HashRouter>
  );
}
