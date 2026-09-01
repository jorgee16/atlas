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

function normalizedAngle(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-150, Math.min(150, value));
}

function roundaboutPath(maneuver) {
  const angle = normalizedAngle(
    Number(maneuver?.turnAngleDegrees)
  );

  // Entry is always from the bottom of the symbol. The exit arm rotates by
  // the real before/after route angle: positive = right, zero = straight,
  // negative = left. This mirrors the quick-glance roundabout language used
  // by dedicated driving navigation apps much better than a generic loop.
  return `
    <path class="maneuver-roundabout-entry" d="M12 22V18.3"></path>
    <circle class="maneuver-roundabout-ring" cx="12" cy="11.5" r="6.8"></circle>
    <g class="maneuver-roundabout-exit" transform="rotate(${angle} 12 11.5)">
      <path d="M12 4.7V1.5"></path>
      <path d="m8.9 4.2 3.1-3.1 3.1 3.1"></path>
    </g>
  `;
}

export function maneuverIconSvg(
  maneuver,
  {
    className = 'maneuver-icon',
    label = null
  } = {}
) {
  const type = normalizedType(maneuver);
  const path = type === 'roundabout'
    ? roundaboutPath(maneuver)
    : ICON_PATHS[type] ?? ICON_PATHS.continue;
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
