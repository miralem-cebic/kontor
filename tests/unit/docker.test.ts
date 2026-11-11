import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../../build/fileProtocol';

// The container image only serves dist/ (ADR 0007). These tests keep its files in line with the build.
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');

describe('the server of the container image (ADR 0007)', () => {
  const conf = read('docker/default.conf');

  it('sends the Content Security Policy of the build, plus frame-ancestors', () => {
    expect(conf).toContain(`add_header Content-Security-Policy "${CONTENT_SECURITY_POLICY}; frame-ancestors 'none'" always;`);
  });

  it('sends the other security headers and no sniffing', () => {
    expect(conf).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(conf).toContain('add_header Referrer-Policy "no-referrer" always;');
  });

  it('makes the browser ask again for every file, because assets/app.js has no hash in its name', () => {
    expect(conf).toContain('add_header Cache-Control "no-cache" always;');
  });

  it('serves nothing but the files of the build and listens on an unprivileged port', () => {
    expect(conf).toContain('listen 8080;');
    expect(conf).toContain('root /usr/share/nginx/html;');
    expect(conf).not.toMatch(/autoindex\s+on/);
    // a listen on [::] stops nginx on a host without IPv6; Docker reaches the container over IPv4
    expect(conf).not.toContain('[::]');
  });
});

describe('Dockerfile', () => {
  const dockerfile = read('Dockerfile');

  it('builds on the build platform, since dist/ is the same for every CPU', () => {
    expect(dockerfile).toMatch(/^FROM --platform=\$BUILDPLATFORM node:\d+-alpine AS build$/m);
  });

  it('uses the same Node major version as the project', () => {
    const major = read('.nvmrc').trim().split('.')[0];
    expect(dockerfile).toContain(`node:${major}-alpine`);
  });

  it('copies the build output and runs as a non-root user', () => {
    expect(dockerfile).toContain('COPY --from=build /app/dist/ /usr/share/nginx/html/');
    expect(dockerfile).toMatch(/^USER (?!root\b|0\b)\S+$/m);
  });

  it('is not built from the working directory with node_modules or dist in it', () => {
    const ignore = read('.dockerignore').split('\n');
    expect(ignore).toContain('node_modules');
    expect(ignore).toContain('dist');
  });
});
