import { Route, Routes } from 'react-router-dom';

function Home() {
  return (
    <main>
      <h1>workbench</h1>
    </main>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  );
}
