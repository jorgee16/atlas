const ICON_PATHS = {
  depart: `
    <path d="M12 21V5"></path>
    <path d="m7 10 5-5 5 5"></path>
  `,
  continue: `
    <path d="M12 21V4"></path>
    <path d="m7 9 5-5 5 5"></path>
  `,
  'turn-left': `
    <path d="M19 20v-5.2a5.8 5.8 0 0 0-5.8-5.8H5"></path>
    <path d="m9.5 4.5-4.5 4.5 4.5 4.5"></path>
  `,
  'turn-right': `
    <path d="M5 20v-5.2A5.8 5.8 0 0 1 10.8 9H19"></path>
    <path d="m14.5 4.5 4.5 4.5-4.5 4.5"></path>
  `,
  'slight-left': `
    <path d="M18 20v-4.8c0-4.5-3.7-7.2-9.2-7.2H5"></path>
    <path d="m9.5 3.5-4.5 4.5 4.5 4.5"></path>
  `,
  'slight-right': `
    <path d="M6 20v-4.8C6 10.7 9.7 8 15.2 8H19"></path>
    <path d="m14.5 3.5 4.5 4.5-4.5 4.5"></path>
  `,
  'sharp-left': `
    <path d="M19 21V9.5A4.5 4.5 0 0 0 14.5 5H5"></path>
    <path d="m9.5 1 4.5 4-4.5 4"></path>
  `,
  'sharp-right': `
    <path d="M5 21V9.5A4.5 4.5 0 0 1 9.5 5H19"></path>
    <path d="m14.5 1 4.5 4-4.5 4"></path>
  `,
  'u-turn-left': `
    <path d="M17 21V10a5 5 0 0 0-10 0v3"></path>
    <path d="m3.5 10 3.5 3.5 3.5-3.5"></path>
  `,
  'u-turn-right': `
    <path d="M7 21V10a5 5 0 0 1 10 0v3"></path>
    <path d="m13.5 10 3.5 3.5 3.5-3.5"></path>
  `,
  roundabout: `
    <circle cx="12" cy="12" r="6.4"></circle>
    <path d="M12 5.6V2.4"></path>
    <path d="M18.4 12H22"></path>
    <path d="M7.5 7.5 5.2 5.2"></path>
    <path d="m17.9 8.1.5-3.9 3.8.8"></path>
  `,
  arrive: `
    <path d="M12 22s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"></path>
    <circle cx="12" cy="10" r="2.2"></circle>
  `
};

function normalizedType(maneuver) {
  const raw = String(maneuver?.type ?? 'continue').toLowerCase();
  const modifier = String(
    maneuver?.modifier ??
    maneuver?.direction ??
    ''
  ).toLowerCase();

  if (
    raw === 'roundabout' ||
    raw === 'rotary' ||
    raw === 'exit-roundabout' ||
    raw === 'exit_rotary' ||
    raw.includes('roundabout') ||
    raw.includes('rotary')
  ) {
    return 'roundabout';
  }

  if (raw === 'turn' || raw === 'fork' || raw === 'merge' || raw === 'exit' || raw === 'off-ramp' || raw === 'on-ramp') {
    if (modifier.includes('sharp') && modifier.includes('left')) return 'sharp-left';
    if (modifier.includes('sharp') && modifier.includes('right')) return 'sharp-right';
    if (modifier.includes('slight') && modifier.includes('left')) return 'slight-left';
    if (modifier.includes('slight') && modifier.includes('right')) return 'slight-right';
    if (modifier.includes('uturn') || modifier.includes('u-turn')) {
      return modifier.includes('right') ? 'u-turn-right' : 'u-turn-left';
    }
    if (modifier.includes('left')) return 'turn-left';
    if (modifier.includes('right')) return 'turn-right';
  }

  if (ICON_PATHS[raw]) return raw;
  return 'continue';
}

function roundaboutExitNumber(maneuver) {
  const value =
    maneuver?.exitNumber ??
    maneuver?.exit ??
    maneuver?.roundaboutExit ??
    maneuver?.roundabout_exit;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

export function maneuverIconSvg(
  maneuver,
  {
    className = 'maneuver-icon',
    label = null
  } = {}
) {
  const type = normalizedType(maneuver);
  const path = ICON_PATHS[type] ?? ICON_PATHS.continue;
  const exitNumber = type === 'roundabout'
    ? roundaboutExitNumber(maneuver)
    : null;

  const accessibility = label
    ? `role="img" aria-label="${label}"`
    : 'aria-hidden="true"';

  return `
    <span class="${className}${type === 'roundabout' ? ' maneuver-icon--roundabout' : ''}" ${accessibility}>
      <svg viewBox="0 0 24 24" fill="none">
        ${path}
      </svg>
      ${exitNumber
        ? `<b class="maneuver-exit-number" aria-label="Exit ${exitNumber}">${exitNumber}</b>`
        : ''}
    </span>
  `;
}
