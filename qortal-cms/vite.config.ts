import react from '@vitejs/plugin-react';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import type { Plugin } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const contentTypes: Record<string, string> = {
  '.json': 'application/json',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.pdf': 'application/pdf'
};

function localContentPlugin(contentRoot: string): Plugin {
  return {
    name: 'qortal-cms-local-content',
    configureServer(server) {
      server.middlewares.use('/qortal-content', (request, response, next) => {
        if (!request.url) {
          next();
          return;
        }

        const requestPath = decodeURIComponent(request.url.split('?')[0] || '/');
        const resolved = path.resolve(contentRoot, `.${requestPath}`);

        if (!resolved.startsWith(contentRoot) || !existsSync(resolved)) {
          response.statusCode = 404;
          response.end('Not found');
          return;
        }

        const fileStat = statSync(resolved);
        if (!fileStat.isFile()) {
          next();
          return;
        }

        response.setHeader('Content-Type', contentTypes[path.extname(resolved).toLowerCase()] || 'application/octet-stream');
        response.setHeader('Content-Length', fileStat.size);
        createReadStream(resolved).pipe(response);
      });
    }
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootDir, '');
  const profileId = process.env.MIGRATION_PROFILE || env.MIGRATION_PROFILE || 'generic';
  const profilePath = path.resolve(rootDir, 'profiles', profileId, 'profile.json');
  const profile = JSON.parse(readFileSync(profilePath, 'utf8')) as {
    resource_prefix: string;
    qortal_site_name?: string;
    qortal_content_name?: string;
    qortal_media_name?: string;
    qortal_sysop_names?: string[];
    qortal_coauthor_names?: string[];
    public_author_name?: string;
    cms_site_title?: string;
    cms_tagline?: string;
    cms_trusted_coauthors_can_adopt_imports?: boolean;
    cms_trusted_coauthors_can_publish_media?: boolean;
    default_output_dir?: string;
  };
  const outputDir = process.env.OUTPUT_DIR
    || env.OUTPUT_DIR
    || profile.default_output_dir
    || `./workspaces/${profileId}/wp-qortal-import`;
  const contentRoot = path.resolve(rootDir, outputDir);

  return {
    base: './',
    define: {
      'import.meta.env.VITE_CMS_PROFILE': JSON.stringify(profileId),
      'import.meta.env.VITE_CMS_SITE_TITLE': JSON.stringify(profile.cms_site_title || ''),
      'import.meta.env.VITE_CMS_TAGLINE': JSON.stringify(profile.cms_tagline || ''),
      'import.meta.env.VITE_CMS_OWNER_NAME': JSON.stringify(profile.qortal_site_name || ''),
      'import.meta.env.VITE_CMS_PUBLIC_AUTHOR_NAME': JSON.stringify(profile.public_author_name || ''),
      'import.meta.env.VITE_CMS_CONTENT_NAME': JSON.stringify(profile.qortal_content_name || ''),
      'import.meta.env.VITE_CMS_MEDIA_NAME': JSON.stringify(profile.qortal_media_name || ''),
      'import.meta.env.VITE_CMS_SYSOP_NAMES': JSON.stringify((profile.qortal_sysop_names || []).join(',')),
      'import.meta.env.VITE_CMS_COAUTHOR_NAMES': JSON.stringify((profile.qortal_coauthor_names || []).join(',')),
      'import.meta.env.VITE_CMS_IMPORT_OWNER_NAME': JSON.stringify(profile.qortal_site_name || profile.qortal_content_name || ''),
      'import.meta.env.VITE_CMS_TRUSTED_COAUTHORS_CAN_ADOPT_IMPORTS': JSON.stringify(String(Boolean(profile.cms_trusted_coauthors_can_adopt_imports))),
      'import.meta.env.VITE_CMS_TRUSTED_COAUTHORS_CAN_PUBLISH_MEDIA': JSON.stringify(String(Boolean(profile.cms_trusted_coauthors_can_publish_media))),
      'import.meta.env.VITE_QDN_MANIFEST_IDENTIFIER': JSON.stringify(`${profile.resource_prefix}-qdn-manifest`)
    },
    plugins: [react(), localContentPlugin(contentRoot)],
    server: {
      port: 5180
    }
  };
});
