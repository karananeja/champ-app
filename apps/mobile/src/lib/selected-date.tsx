import { mobileDateOptions } from '@champ/shared';
import { createContext, useContext, useState, type ReactNode } from 'react';

interface SelectedDate {
  date: string;
  setDate(date: string): void;
}

const Ctx = createContext<SelectedDate | null>(null);

/** The header date, shared by the home tiles and the task list (same `date` in both requests). */
export function SelectedDateProvider({ children, initial }: { children: ReactNode; initial?: string }) {
  const [date, setDate] = useState(() => initial ?? (mobileDateOptions(new Date())[0] as string));
  return <Ctx.Provider value={{ date, setDate }}>{children}</Ctx.Provider>;
}

export function useSelectedDate(): SelectedDate {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSelectedDate outside SelectedDateProvider');
  return v;
}
