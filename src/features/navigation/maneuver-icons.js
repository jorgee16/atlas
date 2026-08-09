const ICON_PATHS = {
  depart: `
    <path d="M12 22V5"></path>
    <path d="m6 11 6-6 6 6"></path>
  `,
  continue: `
    <path d="M12 22V4"></path>
    <path d="m6 10 6-6 6 6"></path>
  `,
  'turn-left': `
    <path d="M20 20v-5a6 6 0 0 0-6-6H5"></path>
    <path d="m10 4-5 5 5 5"></path>
  `,
  'turn-right': `
    <path d="M4 20v-5a6 6 0 0 1 6-6h9"></path>
    <path d="m14 4 5 5-5 5"></path>
  `,
  'slight-left': `
    <path d="M17 21v-5.5c0-4.8-3.7-7-9-7H5"></path>
    <path d="m10 3.5-5 5 5 5"></path>
  `,
  'slight-right': `
    <path d="M7 21v-5.5c0-4.8 3.7-7 9-7h3"></path>
    <path d="m14 3.5 5 5-5 5"></path>
  `,
  'sharp-left': `
    <path d="M19 21V9.5a4 4 0 0 0-4-4H5"></path>
    <path d="m10 1-5 4.5 5 4.5"></path>
  `,
  'sharp-right': `
    <path d="M5 21V9.5a4 4 0 0 1 4-4h10"></path>
    <path d="m14 1 5 4.5-5 4.5"></path>
  `,
  roundabout: `
    <path d="M8.2 5.2A7.4 7.4 0 1 1 4.7 12"></path>
    <path d="M4.2 4.2 8.4 5l-.8 4.2"></path>
    <path d="M12 4V1"></path>
    <path d="M20 12h3"></path>
  `,
  arrive: `
    <path d="M12 22s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"></path>
    <circle cx="12" cy="10" r="2.2"></circle>
  `
};

export function maneuverIconSvg(
  maneuver,
  {
    className = 'maneuver-icon',
    label = null
  } = {}
) {
  const type = maneuver?.type ?? 'continue';
  const path = ICON_PATHS[type] ??
    ICON_PATHS.continue;

  const exitNumber =
    type === 'roundabout' &&
    Number.isInteger(maneuver.exitNumber)
      ? Math.max(1, maneuver.exitNumber)
      : null;

  const accessibility = label
    ? `role="img" aria-label="${label}"`
    : 'aria-hidden="true"';

  return `
    <span class="${className}" ${accessibility}>
      <svg viewBox="0 0 24 24" fill="none">
        ${path}
      </svg>
      ${exitNumber
        ? `<b class="maneuver-exit-number">${exitNumber}</b>`
        : ''}
    </span>
  `;
}
