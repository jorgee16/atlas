export function formatTollMoney(amount, tolls) {
  const currency = tolls?.currency;
  if (!/^[A-Z]{3}$/.test(currency ?? '')) return String(amount);
  try { return new Intl.NumberFormat('pt-PT', {style:'currency',currency}).format(amount); }
  catch { return `${currency} ${amount}`; }
}
export function tollPriceLabel(tolls) {
  if (tolls?.tolledDistanceMeters === 0) return 'No toll roads';
  if (!Number.isFinite(tolls?.totalEuros) || tolls.totalEuros < 0) return 'Toll price unavailable';
  const exact=tolls.pricing==='exact',low=!exact&&tolls.pricingConfidence==='low';
  return `${exact ? '' : low ? 'Est. (low confidence) ' : 'Est. '}${formatTollMoney(tolls.totalEuros, tolls)} · Class ${tolls.vehicleClass}${exact ? ' · exact' : low ? ' · incomplete tariff coverage' : ''}`;
}
