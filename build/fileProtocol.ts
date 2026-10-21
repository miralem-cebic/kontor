import type { Plugin } from 'vite';

/**
 * Content Security Policy of the built app. The app runs from file:// and talks to nothing on the network:
 * scripts and styles come only from the build, images and fonts may be inline data or object URLs.
 * Set in the build only, because the dev server injects inline scripts for hot reloading.
 */
export const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

/**
 * Chrome blocks module scripts and CORS requests under file:// (origin "null").
 * This plugin turns the built index.html into a classic document:
 * - <script type="module" crossorigin> → <script defer>
 * - removes crossorigin from stylesheets
 * - removes modulepreload links
 */
export function fileProtocol(): Plugin {
  return {
    name: 'kontor:file-protocol',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const asset of Object.values(bundle)) {
        if (asset.type !== 'asset' || !asset.fileName.endsWith('.html')) continue;
        let html = String(asset.source);
        html = html.replace(/<link[^>]*rel="modulepreload"[^>]*>\s*/g, '');
        html = html.replace(/<script\b([^>]*)>/g, (_m, attrs: string) => {
          const cleaned = attrs.replace(/\s+type="module"/, '').replace(/\s+crossorigin(="[^"]*")?/, '');
          return /\bsrc=/.test(cleaned) ? `<script defer${cleaned}>` : `<script${cleaned}>`;
        });
        html = html.replace(/(<link\b[^>]*?)\s+crossorigin(="[^"]*")?/g, '$1');
        html = html.replace(/<head>/, `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`);
        if (/type="module"/.test(html)) {
          this.error('index.html still contains type="module" – under file:// the app would not start.');
        }
        asset.source = html;
      }
    },
  };
}
