import type { PieceOfWork, ScheduleShift, VehicleBlock } from './types';

/*
 * Stage D1: crew shifts. A block's pieces split into spells wherever the
 * crew are released (a long gap); a spell within the daily limit is one
 * shift, a longer one is cut into the fewest equal shifts, each cut moved to
 * the nearest piece end when every part still fits (a relief at the depot).
 */

interface Spell {
  readonly pieces: readonly PieceOfWork[];
  readonly startMin: number;
  readonly endMin: number;
}

function spellsOf(block: VehicleBlock, releaseGapMin: number): Spell[] {
  const spells: PieceOfWork[][] = [];
  for (const piece of block.pieces) {
    const current = spells[spells.length - 1];
    const last = current?.[current.length - 1];
    if (current === undefined || last === undefined || piece.startMin - last.endMin >= releaseGapMin) spells.push([piece]);
    else current.push(piece);
  }
  return spells.map((pieces) => ({
    pieces,
    startMin: (pieces[0] as PieceOfWork).startMin,
    endMin: (pieces[pieces.length - 1] as PieceOfWork).endMin,
  }));
}

/** Cut points for a spell: equal cuts, each snapped to a piece end when the parts still fit. */
function cutsOf(spell: Spell, limit: number): { readonly at: number; readonly atPieceEnd: boolean }[] {
  const length = spell.endMin - spell.startMin;
  const count = Math.ceil(length / limit);
  if (count <= 1) return [];
  const each = Math.ceil(length / count);
  const boundaries = spell.pieces.slice(0, -1).map((p) => p.endMin);
  const cuts: { at: number; atPieceEnd: boolean }[] = [];
  let previous = spell.startMin;
  for (let i = 1; i < count; i += 1) {
    const ideal = spell.startMin + i * each;
    const remainingParts = count - i;
    const fits = (at: number): boolean => at - previous <= limit && at > previous && spell.endMin - at <= remainingParts * limit;
    const snapped = boundaries
      .filter(fits)
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal) || a - b)[0];
    const at = snapped ?? Math.min(ideal, spell.endMin);
    cuts.push({ at, atPieceEnd: snapped !== undefined });
    previous = at;
  }
  return cuts;
}

/** Every block's shifts, in block then start order, and how many blocks need a relief crew. */
export function shiftsOf(
  blocks: readonly VehicleBlock[],
  releaseGapMin: number,
  dailyLimitMin: number,
): { readonly shifts: readonly ScheduleShift[]; readonly blocksNeedingRelief: number } {
  const shifts: ScheduleShift[] = [];
  let relief = 0;
  for (const block of blocks) {
    const spans: { startMin: number; endMin: number; reliefAtPieceEnd: boolean }[] = [];
    for (const spell of spellsOf(block, releaseGapMin)) {
      const cuts = cutsOf(spell, dailyLimitMin);
      let from = spell.startMin;
      let atPieceEnd = true;
      for (const cut of cuts) {
        spans.push({ startMin: from, endMin: cut.at, reliefAtPieceEnd: atPieceEnd && cut.atPieceEnd });
        from = cut.at;
        atPieceEnd = cut.atPieceEnd;
      }
      spans.push({ startMin: from, endMin: spell.endMin, reliefAtPieceEnd: atPieceEnd });
    }
    if (spans.length > 1) relief += 1;
    spans.forEach((span, shiftIndex) =>
      shifts.push({
        id: `${block.id}-S${shiftIndex}`,
        blockId: block.id,
        shiftIndex,
        shiftCount: spans.length,
        startMin: span.startMin,
        endMin: span.endMin,
        reliefAtPieceEnd: span.reliefAtPieceEnd,
      }),
    );
  }
  return { shifts, blocksNeedingRelief: relief };
}
