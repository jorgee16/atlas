export function formatTollMoney(amount, tolls) {
  const currency = tolls?.currency;
  if (!/^[A-Z]{3}$/.test(currency ?? '')) return String(amount);
  try { return new Intl.NumberFormat('pt-PT', {style:'currency',currency}).format(amount); }
  catch { return `${currency} ${amount}`; }
}
export function tollPriceLabel(tolls) {
  if (tolls?.tolledDistanceMeters === 0) return 'No toll roads';
  if (!Number.isFinite(tolls?.totalEuros) || tolls.totalEuros < 0) return 'Toll price unavailable';
  return `${tolls.pricing==='exact' ? '' : 'Est. '}${formatTollMoney(tolls.totalEuros, tolls)} · Class ${tolls.vehicleClass}${tolls.pricing==='exact' ? ' · exact' : ''}`;
}
