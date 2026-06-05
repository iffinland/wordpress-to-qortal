import { loadConfig } from './config.js';
import { WordPressClient } from './wpClient.js';

function printResult(label, result) {
  console.log(`${label}: ${result}`);
}

function printAuthHint(error, config) {
  if (error.status !== 401) {
    return;
  }

  console.log('');
  console.log('Authentication required.');

  if (!config.hasWordPressAuth) {
    console.log('Add the credentials required by WORDPRESS_AUTH_MODE to your .env file.');
  } else {
    console.log('The configured WordPress authentication was rejected.');
  }
}

async function checkStep(label, action, config) {
  try {
    const result = await action();
    const count = Array.isArray(result) ? result.length : 'ok';
    printResult(label, count);
    return true;
  } catch (error) {
    printResult(label, `failed (${error.status || 'unknown'} ${error.statusText || ''})`);
    printAuthHint(error, config);
    return false;
  }
}

async function main() {
  const config = loadConfig();
  const client = new WordPressClient({
    baseUrl: config.wordpressBaseUrl,
    authMode: config.wordpressAuthMode,
    loginUrl: config.wordpressLoginUrl,
    username: config.wordpressUsername,
    appPassword: config.wordpressAppPassword,
    password: config.wordpressPassword
  });

  console.log('');
  console.log('WordPress API inspection');
  console.log('');
  printResult('Base URL', config.wordpressBaseUrl);
  printResult('Authentication mode', config.wordpressAuthMode);
  printResult('Authentication configured', config.hasWordPressAuth ? 'yes' : 'no');
  console.log('');

  await checkStep('REST root /wp-json/', () => client.fetchRoot(), config);
  await checkStep('Posts endpoint', () => client.fetchPosts({
    limit: config.limitPosts,
    offset: config.postsOffset,
    before: config.postsBefore
  }), config);
  await checkStep('Pages endpoint', () => client.fetchPages({ limit: 5 }), config);
  await checkStep('Categories endpoint', () => client.fetchCategories({ limit: 100 }), config);
  await checkStep('Tags endpoint', () => client.fetchTags({ limit: 100 }), config);
  await checkStep('Media endpoint', () => client.fetchMedia({ limit: 100 }), config);

  console.log('');
  console.log('Inspection complete');
}

main().catch((error) => {
  console.error('');
  console.error('Inspection failed');
  console.error(error.message);
  process.exitCode = 1;
});
