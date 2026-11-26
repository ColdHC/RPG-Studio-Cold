export interface MarkdownOutlineItem {
  id: string;
  level: number;
  text: string;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function safeUrl(value: string) {
  const url = value.trim();
  return /^(https?:|mailto:|data:image\/)/i.test(url) || url.startsWith('/') ? url : '';
}

type ImagePresentation = {
  align: 'left' | 'center' | 'right';
  width: number;
  caption?: string;
};

const defaultImagePresentation: ImagePresentation = { align: 'center', width: 100 };

function imagePresentation(attributes?: string): ImagePresentation {
  if (!attributes) return defaultImagePresentation;
  const align = attributes.match(/(?:^|\s)align=(left|center|right)(?:\s|$)/i)?.[1]?.toLowerCase();
  const widthValue = Number(attributes.match(/(?:^|\s)width=(\d{1,3})(?:\s|$)/i)?.[1]);
  const caption = attributes.match(/(?:^|\s)caption=(?:"([^"]*)"|'([^']*)')/)?.slice(1).find((value) => value !== undefined)?.trim();
  return {
    align: align === 'left' || align === 'right' || align === 'center' ? align : 'center',
    width: Number.isFinite(widthValue) && widthValue >= 20 && widthValue <= 100 ? widthValue : 100,
    ...(caption ? { caption } : {})
  };
}

function imageAttributes(presentation: ImagePresentation) {
  const attributes: string[] = [];
  if (presentation.align !== 'center') attributes.push(`align=${presentation.align}`);
  if (presentation.width !== 100) attributes.push(`width=${presentation.width}`);
  if (presentation.caption) attributes.push(`caption="${presentation.caption.replace(/["\\]/g, '\\$&')}"`);
  return attributes.length ? `{${attributes.join(' ')}}` : '';
}

function imageHtml(source: string, alt: string, presentation: ImagePresentation) {
  return `<img src="${escapeHtml(source)}" alt="${escapeHtml(alt)}" loading="lazy" data-rpg-image="true" data-align="${presentation.align}" data-width="${presentation.width}" style="--rpg-image-width:${presentation.width}%" />`;
}

function imageMarkdown(image: HTMLImageElement, caption?: string) {
  const align = image.getAttribute('data-align');
  const width = Number(image.getAttribute('data-width'));
  const presentation: ImagePresentation = {
    align: align === 'left' || align === 'right' || align === 'center' ? align : 'center',
    width: Number.isFinite(width) && width >= 20 && width <= 100 ? width : 100,
    ...(caption?.trim() ? { caption: caption.trim() } : {})
  };
  return `![${image.getAttribute('alt') ?? ''}](${image.getAttribute('src') ?? ''})${imageAttributes(presentation)}`;
}

function slugify(value: string) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'secao';
}

function inlineMarkdown(value: string, entityHref?: (id: string) => string) {
  let html = escapeHtml(value);
  html = html.replace(/!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?/g, (_, alt: string, url: string, attributes?: string) => {
    const source = safeUrl(url);
    return source ? imageHtml(source, alt, imagePresentation(attributes)) : escapeHtml(alt);
  });
  html = html.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, id: string, label?: string) => {
    const text = label ?? id;
    const href = entityHref?.(id);
    return href ? `<a href="${escapeHtml(href)}" class="entityLink" data-entity-id="${escapeHtml(id)}">${escapeHtml(text)}</a>` : `<span class="entityMention">${escapeHtml(text)}</span>`;
  });
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) => {
    const href = safeUrl(url);
    return href ? `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>` : label;
  });
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return html;
}

export function markdownToHtml(markdown: string, entityHref?: (id: string) => string) {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const output: string[] = [];
  const usedHeadingIds = new Map<string, number>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (line.trim().startsWith('```')) {
      const language = line.trim().slice(3).trim();
      const code: string[] = [];
      index += 1;
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) code.push(lines[index++] ?? '');
      index += 1;
      output.push(`<pre><code class="language-${escapeHtml(language)}">${escapeHtml(code.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const hashes = heading[1] ?? '';
      const text = (heading[2] ?? '').trim();
      const baseId = slugify(text);
      const count = usedHeadingIds.get(baseId) ?? 0;
      usedHeadingIds.set(baseId, count + 1);
      const id = count ? `${baseId}-${count + 1}` : baseId;
      output.push(`<h${hashes.length} id="${id}">${inlineMarkdown(text, entityHref)}</h${hashes.length}>`);
      index += 1;
      continue;
    }
    if (/^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(line)) {
      output.push('<hr />');
      index += 1;
      continue;
    }
    const imageBlock = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)(?:\{([^}]*)\})?\s*$/);
    if (imageBlock) {
      const source = safeUrl(imageBlock[2] ?? '');
      if (source) {
        const presentation = imagePresentation(imageBlock[3]);
        const caption = presentation.caption ? `<figcaption>${escapeHtml(presentation.caption)}</figcaption>` : '';
        output.push(`<figure class="rpgImageFigure" data-rpg-image="true" data-align="${presentation.align}" data-width="${presentation.width}" style="--rpg-image-width:${presentation.width}%">${imageHtml(source, imageBlock[1] ?? '', presentation)}${caption}</figure>`);
      } else {
        output.push(`<p>${escapeHtml(imageBlock[1] ?? '')}</p>`);
      }
      index += 1;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index] ?? '')) quote.push((lines[index++] ?? '').replace(/^\s*>\s?/, ''));
      output.push(`<blockquote>${inlineMarkdown(quote.join('\n'), entityHref).replace(/\n/g, '<br />')}</blockquote>`);
      continue;
    }
    const listMatch = line.match(/^\s*([-*]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[1] ?? '');
      const items: string[] = [];
      while (index < lines.length) {
        const item = (lines[index] ?? '').match(/^\s*([-*]|\d+\.)\s+(.*)$/);
        if (!item || /^\d/.test(item[1] ?? '') !== ordered) break;
        const itemText = item[2] ?? '';
        const checked = itemText.match(/^\[([ xX])\]\s+(.*)$/);
        items.push(`<li>${checked ? `<label><input type="checkbox" disabled ${((checked[1] ?? '').toLowerCase() === 'x') ? 'checked' : ''} /> ${inlineMarkdown(checked[2] ?? '', entityHref)}</label>` : inlineMarkdown(itemText, entityHref)}</li>`);
        index += 1;
      }
      output.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(#{1,6})\s|^\s*([-*]|\d+\.)\s+|^\s*>|^\s*```|^\s*(\*{3,}|-{3,}|_{3,})\s*$/.test(lines[index] ?? '')) paragraph.push(lines[index++] ?? '');
    output.push(`<p>${inlineMarkdown(paragraph.join('\n'), entityHref).replace(/\n/g, '<br />')}</p>`);
  }

  return output.join('');
}

export function markdownOutline(markdown: string): MarkdownOutlineItem[] {
  const used = new Map<string, number>();
  return markdown.split(/\r?\n/).flatMap((line) => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (!heading) return [];
    const hashes = heading[1] ?? '';
    const text = (heading[2] ?? '').trim();
    const base = slugify(text);
    const count = used.get(base) ?? 0;
    used.set(base, count + 1);
    return [{ id: count ? `${base}-${count + 1}` : base, level: hashes.length, text }];
  });
}

function nodeMarkdown(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (!(node instanceof HTMLElement)) return Array.from(node.childNodes).map(nodeMarkdown).join('');
  const tag = node.tagName.toLowerCase();
  if (tag === 'figure' && node.hasAttribute('data-rpg-image')) {
    const image = node.querySelector('img');
    if (image instanceof HTMLImageElement) return `${imageMarkdown(image, node.querySelector('figcaption')?.textContent?.trim())}\n\n`;
  }
  const children = Array.from(node.childNodes).map(nodeMarkdown).join('');
  if (tag === 'br') return '\n';
  if (/^h[1-6]$/.test(tag)) return `${'#'.repeat(Number(tag.slice(1)))} ${children.trim()}\n\n`;
  if (tag === 'p' || tag === 'div') return `${children.trim()}\n\n`;
  if (tag === 'strong' || tag === 'b') return `**${children.trim()}**`;
  if (tag === 'em' || tag === 'i') return `*${children.trim()}*`;
  if (tag === 'del' || tag === 's') return `~~${children.trim()}~~`;
  if (tag === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') return `\`${children}\``;
  if (tag === 'pre') return `\n\n\`\`\`\n${node.textContent ?? ''}\n\`\`\`\n\n`;
  if (tag === 'blockquote') return `${children.trim().split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
  if (tag === 'hr') return '\n\n---\n\n';
  if (tag === 'a') {
    const entityId = node.getAttribute('data-entity-id');
    return entityId ? `[[${entityId}|${children.trim()}]]` : `[${children.trim()}](${node.getAttribute('href') ?? ''})`;
  }
  if (tag === 'img' && node instanceof HTMLImageElement) return imageMarkdown(node);
  if (tag === 'li') {
    const checkbox = node.querySelector('input[type="checkbox"]');
    const text = children.replace(/\s+/g, ' ').trim();
    return `- ${checkbox ? `[${checkbox.hasAttribute('checked') ? 'x' : ' '}] ` : ''}${text.replace(/^\s*\[\s*[xX ]\s*\]\s*/, '')}\n`;
  }
  if (tag === 'ul' || tag === 'ol') return `${Array.from(node.children).map((child, index) => `${tag === 'ol' ? `${index + 1}.` : '-'} ${nodeMarkdown(child).replace(/^[-\d.]+\s+/, '').trim()}`).join('\n')}\n\n`;
  return children;
}

export function htmlToMarkdown(html: string) {
  if (typeof DOMParser === 'undefined') return html;
  const document = new DOMParser().parseFromString(`<main>${html}</main>`, 'text/html');
  return nodeMarkdown(document.body.querySelector('main') ?? document.body).replace(/\n{3,}/g, '\n\n').trim();
}
