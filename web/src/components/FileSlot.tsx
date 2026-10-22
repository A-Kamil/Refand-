import { useId, useRef, useState, type DragEvent } from 'react';
import { fileSize } from '../lib/format';
import { IconFile, IconUpload, IconX, IconCheck } from './Icons';

export type SlotStatus = 'empty' | 'ready' | 'uploading' | 'uploaded' | 'error';

export interface SlotState {
  file?: File;
  status: SlotStatus;
  error?: string;
}

interface Props {
  label: string;
  hint: string;
  accept: string[]; // extensions, ex. ['.pdf', '.csv']
  maxMb: number;
  value: SlotState;
  onChange: (next: SlotState) => void;
}

/** Valide extension + taille + non-vide. Retourne un message d'erreur ou null. */
export function validateFile(file: File, accept: string[], maxMb: number): string | null {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!accept.includes(ext)) return `Unsupported format ${ext || '(none)'}. Accepted: ${accept.join(', ')}.`;
  if (file.size === 0) return 'This file is empty.';
  if (file.size > maxMb * 1024 * 1024) return `File is ${fileSize(file.size)}; the limit is ${maxMb} MB.`;
  return null;
}

export function FileSlot({ label, hint, accept, maxMb, value, onChange }: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function pick(file: File | undefined) {
    if (!file) return;
    const error = validateFile(file, accept, maxMb);
    onChange(error ? { file, status: 'error', error } : { file, status: 'ready' });
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    pick(e.dataTransfer.files[0]);
  }

  const hasFile = !!value.file;
  return (
    <div className="slot">
      <label className="slot__label" htmlFor={id}>
        {label}
      </label>

      {!hasFile ? (
        <div
          className={`dropzone ${over ? 'is-over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={onDrop}
          onClick={() => input.current?.click()}
        >
          <IconUpload width={22} height={22} />
          <div>
            <strong>Drop a file</strong> or <span className="dropzone__browse">browse</span>
          </div>
          <div className="faint small">{hint}</div>
        </div>
      ) : (
        <div className={`slot__file slot__file--${value.status}`}>
          <IconFile />
          <div className="slot__meta">
            <div className="slot__name">{value.file!.name}</div>
            <div className="small">
              {value.status === 'error' ? (
                <span className="slot__error">{value.error}</span>
              ) : value.status === 'uploading' ? (
                <span className="muted">Uploading…</span>
              ) : value.status === 'uploaded' ? (
                <span className="slot__ok">
                  <IconCheck width={13} height={13} strokeWidth={2.4} /> Uploaded
                </span>
              ) : (
                <span className="faint">{fileSize(value.file!.size)} · ready</span>
              )}
            </div>
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Remove ${value.file!.name}`}
            disabled={value.status === 'uploading'}
            onClick={() => onChange({ status: 'empty' })}
          >
            <IconX />
          </button>
        </div>
      )}
      <input
        id={id}
        ref={input}
        className="sr-only"
        type="file"
        accept={accept.join(',')}
        onChange={(e) => {
          pick(e.target.files?.[0]);
          e.target.value = '';
        }}
      />
    </div>
  );
}
