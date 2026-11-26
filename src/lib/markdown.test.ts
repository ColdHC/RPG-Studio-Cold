import { describe, expect, it } from 'vitest';
import { markdownOutline, markdownToHtml } from './markdown';

describe('document markdown renderer', () => {
  it('renders the supported reading primitives and preserves entity references', () => {
    const html = markdownToHtml('# A lenda\n\n**forte** e [[file-1|A Guardiã]]\n\n- [x] pista encontrada\n\n> aviso', (id) => `/files/${id}`);

    expect(html).toContain('<h1 id="a-lenda">A lenda</h1>');
    expect(html).toContain('<strong>forte</strong>');
    expect(html).toContain('data-entity-id="file-1"');
    expect(html).toContain('type="checkbox" disabled checked');
    expect(html).toContain('<blockquote>aviso</blockquote>');
  });

  it('does not execute raw HTML and creates stable duplicate heading ids', () => {
    const html = markdownToHtml('# Cena\n\n# Cena\n\n<script>alert(1)</script>');
    const outline = markdownOutline('# Cena\n\n# Cena');

    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('id="cena-2"');
    expect(outline.map((item) => item.id)).toEqual(['cena', 'cena-2']);
  });

  it('allows same-origin media delivery URLs while rejecting executable protocols', () => {
    const html = markdownToHtml('![Mapa](/api/media/asset-1)\n\n[x](javascript:alert(1))');
    expect(html).toContain('src="/api/media/asset-1"');
    expect(html).not.toContain('javascript:alert');
  });

  it('renders constrained image presentation metadata without accepting arbitrary styles', () => {
    const html = markdownToHtml('![Mapa de batalha](/api/media/asset-1){align=right width=55 caption="Visão do porto"}');

    expect(html).toContain('<figure class="rpgImageFigure"');
    expect(html).toContain('data-align="right"');
    expect(html).toContain('data-width="55"');
    expect(html).toContain('<figcaption>Visão do porto</figcaption>');
    expect(html).not.toContain('style="color:');
  });
});
