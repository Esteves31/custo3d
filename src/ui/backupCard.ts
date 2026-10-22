import { formatDateTime } from '../calc/format';
import {
  BackupError, backupFileName, backupToJson, createBackup, loadLastBackup, markBackupDone, NOT_A_BACKUP, parseBackup,
  restoreBackup, type Backup, type RestoreResult,
} from '../store/backup';
import { loadSales, type Sale } from '../store/sales';
import { h, icon, ICONS } from './dom';
import { downloadFile, plural } from './listParts';

/** Com vendas novas e o último backup mais velho que isso, o cartão pede um backup novo. */
export const BACKUP_REMIND_DAYS = 30;

export type BackupStatus = { warn: boolean; text: string };

export type BackupCard = {
  element: HTMLElement;
  /** Lê de novo a data do último backup e as vendas. A mensagem da última ação continua. */
  refresh: () => void;
};

/** Dias de calendário entre duas datas, no fuso do computador. */
function daysBetween(from: Date, to: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(to) - day(from)) / 86_400_000);
}

const ago = (days: number) => (days <= 0 ? 'hoje' : days === 1 ? 'ontem' : `há ${days} dias`);

/** O texto sobre o último backup e se é hora de lembrar a pessoa de fazer outro. */
export function backupStatus(last: Date | null, sales: Sale[], now = new Date()): BackupStatus {
  if (!last) {
    return sales.length === 0
      ? { warn: false, text: 'Nenhum backup feito ainda.' }
      : { warn: true, text: 'Você ainda não fez nenhum backup. Se os dados do navegador forem apagados, as vendas se perdem.' };
  }
  const lastIso = last.toISOString();
  const newSales = sales.filter((s) => s.soldAt > lastIso).length;
  const days = daysBetween(last, now);
  const when = `Último backup: ${formatDateTime(last)} (${ago(days)}).`;
  if (newSales === 0) return { warn: false, text: `${when} Nenhuma venda nova desde então.` };
  const news = `${plural(newSales, 'venda nova', 'vendas novas')} desde então.`;
  return days >= BACKUP_REMIND_DAYS
    ? { warn: true, text: `${when} ${news} Faça um backup novo.` }
    : { warn: false, text: `${when} ${news}` };
}

/** A mensagem depois de restaurar. `skipped` são os registros estragados que ficaram de fora. */
export function restoredText(result: RestoreResult, skipped: number): string {
  const parts: string[] = [];
  if (result.sales) parts.push(`Vendas adicionadas: ${result.sales}.`);
  if (result.quotes) parts.push(`Cotações adicionadas: ${result.quotes}.`);
  if (result.values) parts.push('Os campos vazios de "Seus valores" foram preenchidos.');
  const text = parts.length
    ? `Backup restaurado. ${parts.join(' ')}`
    : 'Nada novo para restaurar: tudo o que está nesse backup já estava aqui.';
  return skipped ? `${text} ${plural(skipped, 'registro estragado ficou de fora', 'registros estragados ficaram de fora')}.` : text;
}

function confirmText(backup: Backup): string {
  const created = new Date(backup.createdAt);
  const from = Number.isNaN(created.getTime()) ? '' : ` de ${formatDateTime(created)}`;
  return `Restaurar o backup${from}?\n\n`
    + `Ele tem ${plural(backup.sales.length, 'venda', 'vendas')} e ${plural(backup.history.length, 'cotação', 'cotações')}. `
    + 'Nada do que já está aqui é apagado: só entra o que estiver faltando.';
}

/** Cartão "Backup" do Resumo: baixa tudo num .json e restaura a partir dele. */
export function mountBackupCard(onRestored: () => void): BackupCard {
  const status = h('p', { class: 'backup-status', id: 'backup-status' });
  const message = h('p', { class: 'backup-message', id: 'backup-message', role: 'status' });
  const saveButton = h('button', { type: 'button', class: 'btn btn-primary', id: 'backup-save' }, 'Fazer backup');
  const restoreButton = h('button', { type: 'button', class: 'btn btn-secondary', id: 'backup-restore' }, 'Restaurar backup');
  const fileInput = h('input', { type: 'file', id: 'backup-file', accept: '.json,application/json', hidden: true });

  const element = h('section', { class: 'card summary-card backup-card', 'aria-labelledby': 'backup-title' },
    h('h2', { id: 'backup-title', class: 'card-title' }, 'Backup'),
    h('p', { class: 'muted' },
      'Vendas, cotações e valores ficam guardados só neste navegador. O backup salva tudo num arquivo: com ele, '
      + 'você recupera os dados se o navegador for limpo, ou leva tudo para outro computador.'),
    status,
    h('div', { class: 'backup-actions' }, saveButton, restoreButton),
    message,
    fileInput,
  );

  function say(kind: 'ok' | 'error', text: string): void {
    message.className = `backup-message is-${kind}`;
    message.textContent = text;
  }

  function refresh(): void {
    const s = backupStatus(loadLastBackup(), loadSales());
    status.replaceChildren(...(s.warn ? [icon(ICONS.alert)] : []), h('span', null, s.text));
    status.classList.toggle('is-warn', s.warn);
  }

  saveButton.addEventListener('click', () => {
    const now = new Date();
    const name = backupFileName(now);
    downloadFile(backupToJson(createBackup(now)), name, 'application/json');
    markBackupDone(now);
    refresh();
    say('ok', `Backup salvo na pasta Downloads: ${name}. Guarde uma cópia fora deste computador (pendrive, e-mail ou Google Drive).`);
  });

  async function restoreFrom(file: File): Promise<void> {
    let text: string;
    try {
      text = await file.text();
    } catch {
      return say('error', 'Não consegui ler esse arquivo.');
    }
    let parsed: ReturnType<typeof parseBackup>;
    try {
      parsed = parseBackup(text);
    } catch (e) {
      return say('error', e instanceof BackupError ? e.message : NOT_A_BACKUP);
    }
    if (!window.confirm(confirmText(parsed.backup))) return;

    const result = restoreBackup(parsed.backup);
    // Mesmo com erro, parte pode ter entrado: as telas leem de novo.
    onRestored();
    if (!result) return say('error', 'Não consegui restaurar tudo: o espaço do navegador pode estar cheio ou bloqueado.');
    say('ok', restoredText(result, parsed.skipped));
  }

  restoreButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // permite escolher o mesmo arquivo de novo
    if (file) void restoreFrom(file);
  });

  refresh();
  return { element, refresh };
}
