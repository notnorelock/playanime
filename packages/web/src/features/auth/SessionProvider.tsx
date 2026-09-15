import type { LoginBody, RegisterBody, SessionUser } from '@playanime/contracts';
import {
  createContext,
  createResource,
  createSignal,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js';
import {
  getCurrentUser,
  login as requestLogin,
  logout as requestLogout,
  register as requestRegister,
} from './services/session.service.js';

export type SessionAction = 'login' | 'register' | 'logout';

export interface SessionController {
  /** Undefined while resolving, null for a guest, otherwise the signed-in user. */
  user: Accessor<SessionUser | null | undefined>;
  loading: Accessor<boolean>;
  error: Accessor<unknown>;
  pendingAction: Accessor<SessionAction | null>;
  isAuthenticated: Accessor<boolean>;
  login: (body: LoginBody) => Promise<SessionUser>;
  register: (body: RegisterBody) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refresh: () => Promise<SessionUser | null | undefined>;
}

const SessionContext = createContext<SessionController>();

export function SessionProvider(props: { children: JSX.Element }) {
  const [session, { mutate, refetch }] = createResource<SessionUser | null>(getCurrentUser);
  const [pendingAction, setPendingAction] = createSignal<SessionAction | null>(null);
  const [actionError, setActionError] = createSignal<unknown>();

  const runUserAction = async (
    action: Exclude<SessionAction, 'logout'>,
    request: () => Promise<SessionUser>,
  ): Promise<SessionUser> => {
    setPendingAction(action);
    setActionError(undefined);

    try {
      const user = await request();
      mutate(user);
      return user;
    } catch (error: unknown) {
      setActionError(error);
      throw error;
    } finally {
      setPendingAction(null);
    }
  };

  const controller: SessionController = {
    user: session,
    loading: () => session.loading,
    error: () => actionError() ?? session.error,
    pendingAction,
    isAuthenticated: () => session() !== null && session() !== undefined,
    login: (body) => runUserAction('login', () => requestLogin(body)),
    register: (body) => runUserAction('register', () => requestRegister(body)),
    logout: async () => {
      setPendingAction('logout');
      setActionError(undefined);

      try {
        await requestLogout();
        mutate(null);
      } catch (error: unknown) {
        setActionError(error);
        throw error;
      } finally {
        setPendingAction(null);
      }
    },
    refresh: refetch,
  };

  return <SessionContext.Provider value={controller}>{props.children}</SessionContext.Provider>;
}

export function useSession(): SessionController {
  const controller = useContext(SessionContext);

  if (controller === undefined) {
    throw new Error('useSession must be used inside SessionProvider.');
  }

  return controller;
}
