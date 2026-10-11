/** Saves a blob as a file through a temporary link (fires the browser's download). */
export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves text (e.g. a generated CSV) as a file. A BOM is added for CSV so Excel reads UTF-8. */
export function saveText(text: string, filename: string, type = 'text/csv;charset=utf-8') {
  const content = type.startsWith('text/csv') ? `\uFEFF${text}` : text;
  saveBlob(new Blob([content], { type }), filename);
}
