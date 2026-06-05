import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { WordPressClient } from './wpClient.js';
import { ensureDir, readJson, writeJson } from './utils/files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function serializeError(error) {
  return {
    name: error.name,
    message: error.message,
    status: error.status || null,
    url: error.url || null
  };
}

function printAuthHint(error, config) {
  if (error.status !== 401) {
    return;
  }

  console.error('');
  console.error('WordPress requires authentication for this REST API endpoint.');

  if (!config.hasWordPressAuth) {
    console.error('Add the credentials required by WORDPRESS_AUTH_MODE to your .env file.');
  } else {
    console.error('The configured WordPress authentication was rejected.');
  }
}

async function dumpResource({ label, fileName, fetcher, samplePath, useSample, rawDir, errors, config }) {
  try {
    const data = useSample ? await readJson(samplePath) : await fetcher();
    await writeJson(path.join(rawDir, fileName), data);
    return data;
  } catch (error) {
    errors.push({
      resource: label,
      error
    });
    printAuthHint(error, config);
    console.error(`Failed to dump ${label}: ${error.message}`);
    return [];
  }
}

function mergePosts(...collections) {
  const postsById = new Map();

  for (const posts of collections) {
    for (const post of posts) {
      postsById.set(post.id, post);
    }
  }

  return [...postsById.values()].sort((left, right) => {
    const leftDate = Date.parse(left.date_gmt || left.date || 0);
    const rightDate = Date.parse(right.date_gmt || right.date || 0);
    return rightDate - leftDate;
  });
}

async function dumpPosts({ client, config, fixturesDir, useSample, rawDir, errors }) {
  if (useSample) {
    const posts = await readJson(path.join(fixturesDir, 'sample-wordpress-posts.json'));
    await writeJson(path.join(rawDir, 'wordpress-posts.json'), posts);
    return { posts, historicalPosts: posts, recentPosts: [] };
  }

  const historicalPosts = config.fetchHistoricalPosts
    ? await dumpResource({
        label: 'historical posts',
        fileName: 'wordpress-historical-posts.json',
        fetcher: () => client.fetchPosts({
          limit: config.limitPosts,
          offset: config.postsOffset,
          before: config.postsBefore
        }),
        samplePath: '',
        useSample: false,
        rawDir,
        errors,
        config
      })
    : [];
  const recentPosts = config.postsAfter
    ? await dumpResource({
        label: 'recent posts',
        fileName: 'wordpress-recent-posts.json',
        fetcher: () => client.fetchPosts({
          limit: config.limitRecentPosts,
          after: config.postsAfter,
          order: 'asc'
        }),
        samplePath: '',
        useSample: false,
        rawDir,
        errors,
        config
      })
    : [];
  const posts = mergePosts(historicalPosts, recentPosts);
  await writeJson(path.join(rawDir, 'wordpress-posts.json'), posts);
  return { posts, historicalPosts, recentPosts };
}

async function main() {
  const errors = [];
  const config = loadConfig();
  const useSample = process.argv.includes('--sample');
  const client = new WordPressClient({
    baseUrl: config.wordpressBaseUrl,
    authMode: config.wordpressAuthMode,
    loginUrl: config.wordpressLoginUrl,
    username: config.wordpressUsername,
    appPassword: config.wordpressAppPassword,
    password: config.wordpressPassword
  });

  const rawDir = path.join(config.outputDir, 'raw');
  const logsDir = path.join(config.outputDir, 'logs');

  await ensureDir(rawDir);
  await ensureDir(logsDir);

  const fixturesDir = path.join(__dirname, '..', 'fixtures');
  const {
    posts: rawPosts,
    historicalPosts,
    recentPosts
  } = await dumpPosts({ client, config, fixturesDir, useSample, rawDir, errors });
  const rawPages = await dumpResource({
    label: 'pages',
    fileName: 'wordpress-pages.json',
    fetcher: () => client.fetchPages({ limit: config.limitPages }),
    samplePath: path.join(fixturesDir, 'sample-wordpress-pages.json'),
    useSample,
    rawDir,
    errors,
    config
  });
  const rawCategories = await dumpResource({
    label: 'categories',
    fileName: 'wordpress-categories.json',
    fetcher: () => client.fetchCategories({ limit: config.limitCategories }),
    samplePath: path.join(fixturesDir, 'sample-wordpress-categories.json'),
    useSample,
    rawDir,
    errors,
    config
  });
  const rawTags = await dumpResource({
    label: 'tags',
    fileName: 'wordpress-tags.json',
    fetcher: () => client.fetchTags({ limit: config.limitTags }),
    samplePath: path.join(fixturesDir, 'sample-wordpress-tags.json'),
    useSample,
    rawDir,
    errors,
    config
  });
  const rawMedia = await dumpResource({
    label: 'media',
    fileName: 'wordpress-media.json',
    fetcher: () =>
      config.mediaScope === 'selected_posts'
        ? client.fetchMediaForPosts(rawPosts)
        : client.fetchMedia({ limit: config.limitMedia }),
    samplePath: path.join(fixturesDir, 'sample-wordpress-media.json'),
    useSample,
    rawDir,
    errors,
    config
  });

  await writeJson(
    path.join(logsDir, 'errors.json'),
    errors.map(({ resource, error }) => ({
      resource,
      ...serializeError(error)
    }))
  );
  await writeJson(path.join(rawDir, 'dump-manifest.json'), {
    dumped_at: new Date().toISOString(),
    wordpress_base_url: config.wordpressBaseUrl,
    limits: {
      posts: config.limitPosts,
      posts_offset: config.postsOffset,
      posts_before: config.postsBefore || null,
      recent_posts: config.limitRecentPosts,
      posts_after: config.postsAfter || null,
      fetch_historical_posts: config.fetchHistoricalPosts,
      pages: config.limitPages,
      categories: config.limitCategories,
      tags: config.limitTags,
      media: config.limitMedia
    },
    media_scope: config.mediaScope,
    counts: {
      posts: rawPosts.length,
      historical_posts: historicalPosts.length,
      recent_posts: recentPosts.length,
      pages: rawPages.length,
      categories: rawCategories.length,
      tags: rawTags.length,
      media: rawMedia.length
    },
    errors: errors.length,
    post_source_ids: {
      historical: historicalPosts.map((post) => post.id),
      recent: recentPosts.map((post) => post.id),
      combined: rawPosts.map((post) => post.id)
    }
  });

  console.log('');
  console.log(useSample ? 'Sample WordPress raw dump complete' : 'WordPress raw dump complete');
  console.log('');
  console.log(`Posts fetched: ${rawPosts.length}`);
  if (config.postsAfter) {
    console.log(`Historical posts fetched: ${historicalPosts.length}`);
    console.log(`New posts fetched: ${recentPosts.length}`);
  }
  console.log(`Pages fetched: ${rawPages.length}`);
  console.log(`Categories fetched: ${rawCategories.length}`);
  console.log(`Tags fetched: ${rawTags.length}`);
  console.log(`Media items fetched: ${rawMedia.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log('');
  console.log(`Raw directory: ${rawDir}`);
  console.log(`Dump manifest: ${path.join(rawDir, 'dump-manifest.json')}`);
  console.log(`Output directory: ${config.outputDir}`);

  if (errors.length > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('');
  console.error('Dump failed');
  console.error(error.message);
  process.exitCode = 1;
});
