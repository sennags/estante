import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { StoryLayout, StoryIndex } from './pages/StoryLayout';
import { ChapterEditor } from './pages/ChapterEditor';
import { Universe } from './pages/Universe';
import { Trash } from './pages/Trash';
import { Planning } from './pages/Planning';
import { Threads } from './pages/Threads';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/lixeira" element={<Trash />} />
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
    </HashRouter>
  );
}
