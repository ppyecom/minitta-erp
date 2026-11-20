import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { LoginInput } from '@minitta/shared';
import { api, onUnauthorized } from './api';

// Sesión del ERP. El usuario sale de la cookie que puso la API al loguearse:
// el navegador ya no elige quién es, así que el created_by de un movimiento y la
// firma de una merma significan algo. La sede de trabajo y el tema siguen siendo
// preferencias de esta PC.

export interface Me {
  id: number;
  username: string;
  full_name: string;
  permissions: string[];
  must_change_password: boolean;
}

type Status = 'loading' | 'anonymous' | 'bootstrap' | 'ready';

interface Session {
  status: Status;
  user: Me | null;
  /** ¿Tiene este permiso? Es lo mismo que pregunta la API con core.user_can(). */
  can: (permission: string) => boolean;
  login: (body: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
  /** Vuelve a leer /auth/me (después de cambiar la clave, por ejemplo). */
  refresh: () => Promise<void>;
  locationId: number | null;
  setLocationId: (id: number | null) => void;
  theme: 'light' | 'dark';
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

/** El nombre de la PC lo escribe el usuario una vez; va en la auditoría. */
export function station() {
  return read('minitta-station') || '';
}
export function setStation(v: string) {
  write('minitta-station', v || null);
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading');
  const [user, setUser] = useState<Me | null>(null);
  const [locationId, setLocation] = useState<number | null>(
    () => Number(read('minitta-location')) || null,
  );
  const [theme, setTheme] = useState<'light' | 'dark'>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  );

  const refresh = useCallback(async () => {
    try {
      const me = await api.get<Me>('/auth/me');
      setUser(me);
      setStatus('ready');
    } catch {
      setUser(null);
      // sin sesión: ¿es que todavía no hay ningún usuario creado?
      try {
        const s = await api.get<{ needsBootstrap: boolean }>('/auth/status');
        setStatus(s.needsBootstrap ? 'bootstrap' : 'anonymous');
      } catch {
        setStatus('anonymous');
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // si la API contesta 401 en cualquier petición, la sesión venció: a la pantalla
  // de login, sin esperar que el usuario descubra solo que ya no está conectado
  useEffect(() => {
    const off = onUnauthorized(() => {
      setUser(null);
      setStatus('anonymous');
    });
    return () => {
      off();
    };
  }, []);

  const login = useCallback(async (body: LoginInput) => {
    const me = await api.post<Me>('/auth/login', body);
    setUser(me);
    setStatus('ready');
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setStatus('anonymous');
    }
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

  const can = useCallback(
    (permission: string) => Boolean(user?.permissions.includes(permission)),
    [user],
  );

  const value = useMemo(
    () => ({
      status, user, can, login, logout, refresh,
      locationId, setLocationId, theme, toggleTheme,
    }),
    [status, user, can, login, logout, refresh, locationId, setLocationId, theme, toggleTheme],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const s = useContext(Ctx);
  if (!s) throw new Error('useSession fuera de SessionProvider');
  return s;
}
