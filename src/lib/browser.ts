// What the browser does with a file or a link: a download, and the mail program opened with a mailto: link. Only
// src/domain/links.ts builds the link; a href from anywhere else stays forbidden (CLAUDE.md, "Links").

/** Saves bytes as a file through the browser's download. The URL is kept until the download has started. */
export function saveFile(bytes: Uint8Array, fileName: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  // the download has started; the URL is only needed until then
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens the mail program with a mailto: link from domain/links.ts (`mailtoHref`) */
export function openMailLink(href: string): void {
  const link = document.createElement('a');
  link.href = href;
  document.body.append(link);
  link.click();
  link.remove();
}
