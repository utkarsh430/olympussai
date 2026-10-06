import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DataTable } from '@/components/depot/shell/DataTable';
import { Figure, FigureBand } from '@/components/depot/shell/FigureBand';
import { SectionLabel } from '@/components/depot/shell/SectionLabel';

const CSS = readFileSync(path.resolve(__dirname, '../../app/globals.css'), 'utf8');

afterEach(cleanup);

/** The 16px line box around each tag (a label row, or a wrapping section label), or null. */
const tagRows = (): readonly (Element | null)[] =>
  screen.getAllByTestId('depot-provenance').map((tag) => tag.closest('.depot-tag-row, .depot-tag-fit'));

describe('a tag on a label never changes its line box', () => {
  it('sets the row 16px high and the tag to fit inside it (11px type, 14px line, 1px borders)', () => {
    expect(/\.depot-tag-row \{([^}]*)\}/.exec(CSS)?.[1]).toMatch(/\bh-4\b/);
    expect(/\.depot-tag-row \.depot-tag,\s*\.depot-tag-fit \.depot-tag \{([^}]*)\}/.exec(CSS)?.[1]).toMatch(
      /py-0 leading-\[14px\]/,
    );
  });

  it('holds a figure label, the band head, a section label and a header cell to it', () => {
    render(
      <>
        <FigureBand label="Yard" tag="modelled">
          <Figure label="Bays" value="12" tag="modelled" />
        </FigureBand>
        <SectionLabel label="Plan" tag="modelled" />
        <DataTable
          columns={[{ key: 'a', header: 'A', render: () => 'x', tag: 'modelled' }]}
          rows={[{}]}
          rowKey={() => 'r'}
          caption="t"
        />
      </>,
    );
    expect(tagRows()).toHaveLength(4);
    expect(tagRows().every((row) => row !== null)).toBe(true);
  });

  it('gives every figure the same label row, with or without a tag', () => {
    render(
      <FigureBand label="Yard">
        <Figure label="Bays" value="12" tag="modelled" />
        <Figure label="Free" value="3" />
      </FigureBand>,
    );
    expect(document.querySelectorAll('li > .depot-tag-row')).toHaveLength(2);
  });
});
