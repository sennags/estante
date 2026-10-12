import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { Library } from './pages/Library';
import { StoryLayout, StoryIndex } from './pages/StoryLayout';
import { ChapterEditor } from './pages/ChapterEditor';
import { Universe } from './pages/Universe';

export function App() {
  return (
    <HashRouter>
      <Routes>
        <Route path="/" element={<Library />} />
        <Route path="/historia/:storyId" element={<StoryLayout />}>
          <Route index element={<StoryIndex />} />
          <Route path="capitulo/:chapterId" element={<ChapterEditor />} />
          <Route path="universo" element={<Universe />} />
          <Route path="universo/:entryId" element={<Universe />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  );
}
