'use client';

import { useEffect, useRef, useState } from 'react';
import { AlignCenter, AlignLeft, AlignRight, Bold, Code2, Heading2, ImagePlus, Italic, Link2, List, ListOrdered, Minus, Quote, Redo2, Sparkles, Strikethrough, Trash2, Undo2 } from 'lucide-react';
import { mediaApi } from '@/lib/api';
import { htmlToMarkdown, markdownToHtml } from '@/lib/markdown';
import type { MediaAsset } from '@/types';
import { MediaPicker } from './MediaPicker';
import styles from './DocumentEditor.module.css';

export interface DocumentEntityOption {
  id: string;
  name: string;
  type: string;
}

interface DocumentEditorProps {
  content: string;
  onChange: (content: string) => void;
  mode: 'visual' | 'markdown';
  campaignId?: string;
  fileId?: string;
  entityOptions?: DocumentEntityOption[];
  entityHref?: (id: string) => string;
}

const commands = [
  { key: 'titulo', label: 'Título de seção', icon: Heading2 },
  { key: 'citacao', label: 'Citação', icon: Quote },
  { key: 'aviso', label: 'Aviso', icon: Sparkles },
  { key: 'imagem', label: 'Imagem', icon: ImagePlus },
  { key: 'divisor', label: 'Divisor', icon: Minus },
  { key: 'entidade', label: 'Entidade relacionada', icon: Link2 }
] as const;

type ImageInspector = {
  alt: string;
  caption: string;
  align: 'left' | 'center' | 'right';
  width: number;
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] ?? character);
}

function normalizedImageWidth(value: string | null | undefined) {
  const width = Number(value);
  return Number.isFinite(width) && width >= 20 && width <= 100 ? width : 100;
}

function imageFigureMarkup(asset: MediaAsset) {
  const alt = asset.altText || asset.displayName;
  const caption = asset.description?.trim();
  return `<figure data-rpg-image="true" data-align="center" data-width="100" style="--rpg-image-width:100%"><img src="${escapeHtml(asset.url)}" alt="${escapeHtml(alt)}" loading="lazy" />${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ''}</figure><p><br></p>`;
}

function ToolbarButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" className={styles.toolButton} onMouseDown={(event) => event.preventDefault()} onClick={onClick} aria-label={label} title={label}>{children}</button>;
}

export function DocumentEditor({ content, onChange, mode, campaignId, fileId, entityOptions = [], entityHref }: DocumentEditorProps) {
  const visualRef = useRef<HTMLDivElement>(null);
  const lastRenderedContent = useRef<string | null>(null);
  const selectedImageRef = useRef<{ image: HTMLImageElement; figure: HTMLElement } | null>(null);
  const [slashQuery, setSlashQuery] = useState('');
  const [imageInspector, setImageInspector] = useState<ImageInspector | null>(null);
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [uploadingMedia, setUploadingMedia] = useState(false);
  const slashCommands = campaignId && fileId ? commands.filter((command) => command.key !== 'imagem') : commands;

  useEffect(() => {
    if (mode !== 'visual' || !visualRef.current) return;
    if (lastRenderedContent.current === content && document.activeElement === visualRef.current) return;
    visualRef.current.innerHTML = markdownToHtml(content, entityHref);
    lastRenderedContent.current = content;
  }, [content, entityHref, mode]);

  function emitVisualChange() {
    if (!visualRef.current) return;
    const next = htmlToMarkdown(visualRef.current.innerHTML);
    lastRenderedContent.current = next;
    onChange(next);
    const match = visualRef.current.innerText.match(/(?:^|\s)\/([^\s]*)$/);
    setSlashQuery(match?.[1] ?? '');
  }

  function runCommand(command: string, value?: string) {
    visualRef.current?.focus();
    document.execCommand(command, false, value);
    emitVisualChange();
  }

  function insertHtml(html: string) {
    visualRef.current?.focus();
    document.execCommand('insertHTML', false, html);
    emitVisualChange();
    setSlashQuery('');
  }

  function selectionRange() {
    const selection = window.getSelection();
    return selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : undefined;
  }

  function restoreSelection(range?: Range) {
    if (!range) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  function insertMediaAsset(asset: MediaAsset, range?: Range) {
    restoreSelection(range);
    insertHtml(imageFigureMarkup(asset));
  }

  async function uploadInlineImages(files: File[], range?: Range) {
    if (!campaignId || !fileId) return;
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (!images.length) return;
    setUploadingMedia(true);
    setMediaError(null);
    try {
      const uploaded = await mediaApi.upload(campaignId, images);
      await Promise.all(uploaded.items.map((asset) => mediaApi.attach(campaignId, asset.id, { fileId, purpose: 'CONTENT' })));
      uploaded.items.forEach((asset, index) => insertMediaAsset(asset, index === 0 ? range : undefined));
    } catch (cause) {
      setMediaError(cause instanceof Error ? cause.message : 'Não foi possível inserir as imagens.');
    } finally {
      setUploadingMedia(false);
    }
  }

  function ensureImageFigure(image: HTMLImageElement) {
    const existing = image.closest('figure[data-rpg-image]');
    if (existing instanceof HTMLElement) return existing;
    const figure = document.createElement('figure');
    figure.setAttribute('data-rpg-image', 'true');
    figure.dataset.align = 'center';
    figure.dataset.width = '100';
    figure.style.setProperty('--rpg-image-width', '100%');
    const parent = image.parentElement;
    const isStandaloneParagraph = parent?.tagName.toLowerCase() === 'p' && Array.from(parent.childNodes).every((node) => node === image || !node.textContent?.trim());
    if (parent && isStandaloneParagraph) {
      parent.replaceWith(figure);
      figure.append(image);
    } else if (parent?.tagName.toLowerCase() === 'p') {
      parent.before(figure);
      figure.append(image);
    } else {
      image.before(figure);
      figure.append(image);
    }
    return figure;
  }

  function inspectImage(image: HTMLImageElement) {
    const figure = ensureImageFigure(image);
    selectedImageRef.current = { image, figure };
    setImageInspector({
      alt: image.alt,
      caption: figure.querySelector('figcaption')?.textContent?.trim() ?? '',
      align: figure.dataset.align === 'left' || figure.dataset.align === 'right' ? figure.dataset.align : 'center',
      width: normalizedImageWidth(figure.dataset.width)
    });
  }

  function updateInspectedImage(patch: Partial<ImageInspector>) {
    const selected = selectedImageRef.current;
    if (!selected || !imageInspector) return;
    const next = { ...imageInspector, ...patch };
    selected.image.alt = next.alt;
    selected.figure.dataset.align = next.align;
    selected.figure.dataset.width = String(next.width);
    selected.figure.style.setProperty('--rpg-image-width', `${next.width}%`);
    const currentCaption = selected.figure.querySelector('figcaption');
    if (next.caption.trim()) {
      const caption = currentCaption ?? document.createElement('figcaption');
      caption.textContent = next.caption.trim();
      if (!currentCaption) selected.figure.append(caption);
    } else {
      currentCaption?.remove();
    }
    setImageInspector(next);
    emitVisualChange();
  }

  function removeInspectedImage() {
    selectedImageRef.current?.figure.remove();
    selectedImageRef.current = null;
    setImageInspector(null);
    emitVisualChange();
  }

  function executeSlashCommand(key: (typeof commands)[number]['key']) {
    const entity = entityOptions[0];
    if (key === 'titulo') insertHtml('<h2>Nova seção</h2><p>Escreva aqui...</p>');
    if (key === 'citacao') insertHtml('<blockquote>Uma frase importante para esta história.</blockquote><p><br></p>');
    if (key === 'aviso') insertHtml('<blockquote data-callout="warning"><strong>Aviso</strong><br>Descreva o perigo ou a regra importante.</blockquote><p><br></p>');
    if (key === 'imagem') {
      const url = window.prompt('URL da imagem');
      if (url) insertHtml(`<p><img src="${url.replace(/"/g, '&quot;')}" alt="Imagem da campanha" /></p>`);
    }
    if (key === 'divisor') insertHtml('<hr><p><br></p>');
    if (key === 'entidade' && entity) insertHtml(`[[${entity.id}|${entity.name}]]&nbsp;`);
    if (key === 'entidade' && !entity) setSlashQuery('');
  }

  if (mode === 'markdown') {
    return (
      <div className={styles.markdownEditor}>
        <div className={styles.codeHeader}><span>Markdown</span><span>Ctrl/Cmd + S salva automaticamente</span></div>
        <textarea className={styles.markdownInput} value={content} onChange={(event) => onChange(event.target.value)} spellCheck={false} aria-label="Conteúdo em Markdown" />
      </div>
    );
  }

  return (
    <div className={styles.visualEditor}>
      <div className={styles.toolbar} role="toolbar" aria-label="Formatação do documento">
        <ToolbarButton label="Desfazer" onClick={() => runCommand('undo')}><Undo2 size={15} /></ToolbarButton>
        <ToolbarButton label="Refazer" onClick={() => runCommand('redo')}><Redo2 size={15} /></ToolbarButton>
        <span className={styles.separator} />
        <select className={styles.headingSelect} aria-label="Nível do título" defaultValue="p" onChange={(event) => runCommand('formatBlock', event.target.value)}>
          <option value="p">Texto</option><option value="h1">Título 1</option><option value="h2">Título 2</option><option value="h3">Título 3</option><option value="h4">Título 4</option>
        </select>
        <ToolbarButton label="Negrito" onClick={() => runCommand('bold')}><Bold size={15} /></ToolbarButton>
        <ToolbarButton label="Itálico" onClick={() => runCommand('italic')}><Italic size={15} /></ToolbarButton>
        <ToolbarButton label="Riscado" onClick={() => runCommand('strikeThrough')}><Strikethrough size={15} /></ToolbarButton>
        <ToolbarButton label="Lista com marcadores" onClick={() => runCommand('insertUnorderedList')}><List size={15} /></ToolbarButton>
        <ToolbarButton label="Lista numerada" onClick={() => runCommand('insertOrderedList')}><ListOrdered size={15} /></ToolbarButton>
        <ToolbarButton label="Citação" onClick={() => runCommand('formatBlock', 'blockquote')}><Quote size={15} /></ToolbarButton>
        <ToolbarButton label="Bloco de código" onClick={() => insertHtml('<pre><code>código</code></pre>')}><Code2 size={15} /></ToolbarButton>
        <ToolbarButton label="Inserir link" onClick={() => { const url = window.prompt('URL do link'); if (url) runCommand('createLink', url); }}><Link2 size={15} /></ToolbarButton>
        {campaignId && fileId ? <MediaPicker campaignId={campaignId} fileId={fileId} purpose="CONTENT" triggerLabel="Inserir imagem" onSelect={(asset) => insertMediaAsset(asset)} /> : <ToolbarButton label="Inserir imagem" onClick={() => executeSlashCommand('imagem')}><ImagePlus size={15} /></ToolbarButton>}
        <ToolbarButton label="Inserir divisor" onClick={() => insertHtml('<hr><p><br></p>')}><Minus size={15} /></ToolbarButton>
        <span className={styles.toolbarHint}>{uploadingMedia ? 'Enviando imagem…' : 'Digite / para comandos'}</span>
      </div>
      {imageInspector && <div className={styles.imageInspector} role="region" aria-label="Propriedades da imagem selecionada">
        <label>Texto alternativo<input value={imageInspector.alt} onChange={(event) => updateInspectedImage({ alt: event.target.value })} /></label>
        <label>Legenda<input value={imageInspector.caption} onChange={(event) => updateInspectedImage({ caption: event.target.value })} /></label>
        <label>Largura <output>{imageInspector.width}%</output><input type="range" min="20" max="100" step="5" value={imageInspector.width} onChange={(event) => updateInspectedImage({ width: Number(event.target.value) })} /></label>
        <div className={styles.imageInspectorActions}><span>Alinhamento</span><button type="button" className={imageInspector.align === 'left' ? styles.imageInspectorActionActive : ''} onClick={() => updateInspectedImage({ align: 'left' })} aria-label="Alinhar imagem à esquerda"><AlignLeft size={15} /></button><button type="button" className={imageInspector.align === 'center' ? styles.imageInspectorActionActive : ''} onClick={() => updateInspectedImage({ align: 'center' })} aria-label="Centralizar imagem"><AlignCenter size={15} /></button><button type="button" className={imageInspector.align === 'right' ? styles.imageInspectorActionActive : ''} onClick={() => updateInspectedImage({ align: 'right' })} aria-label="Alinhar imagem à direita"><AlignRight size={15} /></button><button type="button" className={styles.imageRemove} onClick={removeInspectedImage}><Trash2 size={14} />Remover</button></div>
      </div>}
      {mediaError && <p className={styles.mediaError} role="alert">{mediaError}</p>}
      <div ref={visualRef} className={styles.visualInput} contentEditable suppressContentEditableWarning onInput={emitVisualChange} onClick={(event) => { if (event.target instanceof HTMLImageElement) inspectImage(event.target); }} onPaste={(event) => { const files = Array.from(event.clipboardData.files); if (files.some((file) => file.type.startsWith('image/')) && campaignId && fileId) { event.preventDefault(); void uploadInlineImages(files, selectionRange()); } }} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const files = Array.from(event.dataTransfer.files); if (files.some((file) => file.type.startsWith('image/')) && campaignId && fileId) { event.preventDefault(); void uploadInlineImages(files, selectionRange()); } }} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault(); }} aria-label="Editor visual do documento" role="textbox" />
      {slashQuery !== '' && (
        <div className={styles.commandMenu} role="menu" aria-label="Comandos do editor">
          {slashCommands.filter((command) => command.key.includes(slashQuery.toLowerCase())).map((command) => { const Icon = command.icon; return <button type="button" role="menuitem" key={command.key} onMouseDown={(event) => event.preventDefault()} onClick={() => executeSlashCommand(command.key)}><Icon size={15} /><span><strong>/{command.key}</strong><small>{command.label}</small></span></button>; })}
          {slashQuery === 'entidade' && entityOptions.slice(0, 5).map((entity) => <button type="button" role="menuitem" key={entity.id} onClick={() => { insertHtml(`[[${entity.id}|${entity.name}]]&nbsp;`); }}><Link2 size={15} /><span><strong>{entity.name}</strong><small>{entity.type}</small></span></button>)}
        </div>
      )}
    </div>
  );
}
