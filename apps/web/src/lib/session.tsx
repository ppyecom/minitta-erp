import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

// Sesión local de esta PC: usuario elegido (va en la auditoría), sede de trabajo y tema.
// Cuando exista el login, esto se reemplaza por el usuario autenticado.

interface Session {
  userId: number | null;
  locationId: number | null;
  theme: 'light' | 'dark';
  setUserId: (id: number | null) => void;
  setLocationId: (id: number | null) => void;
  toggleTheme: () => void;
}

const Ctx = createContext<Session | null>(null);

function read(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, v: string | null) {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* modo privado: se pierde al cerrar, no pasa nada */
  }
}

// la API lee el usuario de esta variable en cada petición
export const sessionRef = { userId: null as number | null, station: null as string | null };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [userId, setUser] = useState<number | null>(() => Number(read('minitta-user')) || null);
  const [locationId, setLocation] = useState<number | null>(() => Number(read('minitta-location')) || null);
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  sessionRef.userId = userId;

  const setUserId = useCallback((id: number | null) => {
    setUser(id);
    sessionRef.userId = id;
    write('minitta-user', id ? String(id) : null);
  }, []);
  const setLocationId = useCallback((id: number | null) => {
    setLocation(id);
    write('minitta-location', id ? String(id) : null);
  }, []);
  const toggleTheme = useCallback(() => {
    setTheme((t) => {
      const n = t === 'dark' ? 'light' : 'dark';
      write('minitta-theme', n);
      return n;
    });
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, [theme]);

  const value = useMemo(
    () => ({ userId, locationId, theme, setUserId, setLocationId, toggleTheme }),
    [userId, locationId, theme, setUserId, setLocationId, toggleTheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}
