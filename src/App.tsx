import { Route, Routes } from 'react-router-dom';
import { SignIn } from './pages/SignIn';

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
      <Route path="/signin" element={<SignIn />} />
    </Routes>
  );
}
