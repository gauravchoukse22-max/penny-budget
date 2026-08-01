export function formatCurrency(amount: number, currency = 'USD'): string {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

/** Masked stand-in for an amount when "Hide amounts" is on — keeps the currency
 * symbol so the layout and context read the same, hides the digits. */
export function maskedAmount(currency = 'USD'): string {
  return `${currencySymbol(currency)}••••`;
}

/** The lone currency symbol for the active currency (e.g. "$", "€", "₹", "¥"). */
export function currencySymbol(currency = 'USD'): string {
  try {
    const parts = new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: 0 }).formatToParts(0);
    return parts.find((p) => p.type === 'currency')?.value ?? '$';
  } catch {
    return '$';
  }
}

export function formatMonthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function formatShortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString(undefined, { month: 'short' });
}

export function formatDayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
}

/** "5 Apr 2026" — the compact form for dense rows like a fund's history, where
 * the long day label would wrap and push the amount off the row. */
export function formatShortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function daysLeftInMonth(yearMonth: string): number {
  const [y, m] = yearMonth.split('-').map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  const now = new Date();
  const curY = now.getFullYear();
  const curM = now.getMonth() + 1;
  if (y === curY && m === curM) return Math.max(0, lastDay - now.getDate());
  // A month that has already ended has no days left.
  if (y < curY || (y === curY && m < curM)) return 0;
  // A future month hasn't started — the whole month is still ahead.
  return lastDay;
}
