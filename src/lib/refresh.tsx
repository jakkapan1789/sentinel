import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

/** App-wide "refresh" signal: bump() forces pages whose useAsync deps include the version to refetch. */
const RefreshContext = createContext<{ version: number; bump: () => void }>({ version: 0, bump: () => {} });

export function RefreshProvider({ children }: { children: ReactNode }) {
  const [version, setVersion] = useState(0);
  return (
    <RefreshContext.Provider value={{ version, bump: () => setVersion((v) => v + 1) }}>
      {children}
    </RefreshContext.Provider>
  );
}

export const useRefreshVersion = () => useContext(RefreshContext).version;
export const useRefreshBump = () => useContext(RefreshContext).bump;
