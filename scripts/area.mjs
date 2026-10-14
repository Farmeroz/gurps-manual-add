import { validateSeed } from './core.mjs';
import { distanceInYards } from './fragmentation-workbench.mjs';

export const AREA_MODES = { uniform: 'Uniform AoE', explosion: 'Explosion', cone: 'Cone' };

export function explosionDivisor(distance, directHit = false) {
  if (directHit) return 1;
  if (String(distance).trim() === '' || !Number.isFinite(Number(distance)) || Number(distance) < 0)
    throw new Error('Enter a non-negative distance for every included blast recipient.');
  // B414: collateral distance is never less than one yard. Zero is not a direct hit.
  return 3 * Math.max(1, Number(distance));
}

export function areaEvents(recipients, rows, input, mode, types, radius = Infinity) {
  if (!Object.hasOwn(AREA_MODES, mode)) throw new Error('Choose an area damage mode.');
  return recipients
    .filter((r) => rows[r.key]?.include)
    .map((recipient, index) => {
      const common = validateSeed(Array.isArray(input) ? input[index] : input, types);
      const row = rows[recipient.key];
      const divisor = mode === 'explosion' ? explosionDivisor(row.distance, row.directHit) : 1;
      const inRange = mode !== 'explosion' || row.directHit || Number(row.distance) <= radius;
      const effective = inRange ? Math.floor(common.damage / divisor) : 0;
      return {
        recipient,
        effective,
        inRange,
        seed: {
          ...common,
          hitlocation: 'Large-Area',
          isExplosion: mode === 'explosion' && !row.directHit,
          armorDivisor: mode === 'explosion' && !row.directHit ? 1 : common.armorDivisor,
          areaAttack: mode,
          directHit: mode === 'explosion' && Boolean(row.directHit),
          hexesFromExplosion:
            mode === 'explosion' ? Math.max(1, Number(row.distance) || 0) : undefined,
          rollInfo: `${AREA_MODES[mode]}: ${common.damage} basic damage${mode === 'explosion' ? (row.directHit ? '; direct hit, full damage' : ` ÷ ${divisor} (${row.distance} yd, minimum 1 yd) = ${effective} before DR`) : '; no distance falloff'}. Review cover and large-area protection (GURPS 4e B400, B413–414).`,
        },
      };
    });
}

export function pointDistance(origin, recipient) {
  if (!origin) return null;
  return distanceInYards(
    {
      token: { center: origin },
      document: { parent: { id: origin.sceneId }, elevation: origin.elevation },
    },
    recipient,
  );
}
